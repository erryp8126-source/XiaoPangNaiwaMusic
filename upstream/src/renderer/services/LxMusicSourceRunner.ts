/**
 * 落雪音乐 (LX Music) 音源脚本执行器
 *
 * 核心职责：
 * 1. 解析脚本元信息
 * 2. 在 Worker 隔离环境执行用户脚本
 * 3. 模拟 globalThis.lx API
 * 4. 处理初始化和音乐解析请求
 */

import type {
  LxInitedData,
  LxLyricResult,
  LxMusicInfo,
  LxQuality,
  LxScriptInfo,
  LxSourceConfig,
  LxSourceKey
} from '@/types/lxMusic';

type WorkerInitializeMessage = {
  type: 'initialize';
  script: string;
  scriptInfo: LxScriptInfo;
};

type WorkerInvokeMessage = {
  type: 'invoke-request';
  callId: string;
  payload: any;
};

type WorkerHttpResponseMessage = {
  type: 'http-response';
  requestId: string;
  response: any;
  body: any;
  error?: string;
};

type RunnerToWorkerMessage =
  | WorkerInitializeMessage
  | WorkerInvokeMessage
  | WorkerHttpResponseMessage;

type WorkerInitializedMessage = {
  type: 'initialized';
  data: LxInitedData;
};

type WorkerScriptErrorMessage = {
  type: 'script-error';
  message: string;
};

type WorkerInvokeResultMessage = {
  type: 'invoke-result';
  callId: string;
  result: any;
};

type WorkerInvokeErrorMessage = {
  type: 'invoke-error';
  callId: string;
  message: string;
};

type WorkerHttpRequestMessage = {
  type: 'http-request';
  requestId: string;
  url: string;
  options: any;
};

type WorkerLogMessage = {
  type: 'log';
  level: 'log' | 'warn' | 'error' | 'info';
  args: any[];
};

type WorkerToRunnerMessage =
  | WorkerInitializedMessage
  | WorkerScriptErrorMessage
  | WorkerInvokeResultMessage
  | WorkerInvokeErrorMessage
  | WorkerHttpRequestMessage
  | WorkerLogMessage;

type PendingInvocation = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

const LOCAL_SERVER_DEFAULT_PORT = '30488';

const parseIpv4Octets = (host: string): [number, number, number, number] | null => {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const nums = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
};

const isBlockedIpv4 = ([b0, b1, b2]: [number, number, number, number]): boolean => {
  if (b0 === 0) return true; // 0.0.0.0/8
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 CGNAT
  if (b0 === 127) return true; // 127.0.0.0/8 loopback
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
  if (b0 === 192 && b1 === 0 && b2 === 0) return true; // 192.0.0.0/24 IETF protocol
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16
  if (b0 >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
  return false;
};

const parseIpv6Hextets = (rawAddr: string): number[] | null => {
  const addr = rawAddr.split('%')[0].toLowerCase();
  if (!addr) return null;
  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (segStr: string, allowEmbeddedIpv4: boolean): number[] | null => {
    if (!segStr) return [];
    const parts = segStr.split(':');
    const out: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) return null;
      if (part.includes('.')) {
        if (!allowEmbeddedIpv4 || i !== parts.length - 1) return null;
        const v4 = parseIpv4Octets(part);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSegmentList(doubleColonParts[0], true);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseSegmentList(doubleColonParts[0], false);
  const tail = parseSegmentList(doubleColonParts[1], true);
  if (!head || !tail) return null;
  const zeroFill = 8 - (head.length + tail.length);
  if (zeroFill < 1) return null;
  return [...head, ...new Array<number>(zeroFill).fill(0), ...tail];
};

const isBlockedIpv6 = (host: string): boolean => {
  const h = parseIpv6Hextets(host);
  if (!h) return true; // 格式异常按 fail-closed 拦截

  const allZero = h.every((v) => v === 0);
  if (allZero) return true; // ::

  const isLoopback = h.slice(0, 7).every((v) => v === 0) && h[7] === 1;
  if (isLoopback) return true; // ::1

  const isV4Mapped = h.slice(0, 5).every((v) => v === 0) && h[5] === 0xffff;
  const isV4Compat = h.slice(0, 6).every((v) => v === 0);
  const isNat64 = h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((v) => v === 0);
  if (isV4Mapped || isV4Compat || isNat64) {
    const v4: [number, number, number, number] = [
      (h[6] >> 8) & 0xff,
      h[6] & 0xff,
      (h[7] >> 8) & 0xff,
      h[7] & 0xff
    ];
    return isBlockedIpv4(v4);
  }

  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
};

const getLocalServerPorts = (): Set<string> => {
  const ports = new Set<string>([LOCAL_SERVER_DEFAULT_PORT]);
  if (typeof window !== 'undefined') {
    try {
      const cfgRaw = (window as any).AlgerAndroid?.getServerConfig?.();
      if (typeof cfgRaw === 'string' && cfgRaw.trim()) {
        const cfg = JSON.parse(cfgRaw);
        const p = Number(cfg?.localPort);
        if (Number.isInteger(p) && p > 0 && p <= 65535) {
          ports.add(String(p));
        }
      }
    } catch {
      // ignore
    }
    if (window.location?.port) {
      ports.add(String(window.location.port));
    }
  }
  return ports;
};

/**
 * 校验第三方 LX 音源脚本发起的网络请求 URL：
 * 仅放行公网 HTTP(S) 音源请求，严禁探测本机服务、内网/链路本地网段及云同步后端域名
 */
export const assertSafeLxRequestUrl = (rawUrl: string): string => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Blocked empty LX HTTP request URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Blocked malformed LX HTTP request URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked disallowed LX protocol: ${parsed.protocol}`);
  }

  const normalizedHost = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const bareHost =
    normalizedHost.startsWith('[') && normalizedHost.endsWith(']')
      ? normalizedHost.slice(1, -1)
      : normalizedHost;

  if (!bareHost) {
    throw new Error('Blocked LX request with empty host');
  }

  if (
    bareHost === 'localhost' ||
    bareHost.endsWith('.localhost') ||
    bareHost === 'supabase.co' ||
    bareHost.endsWith('.supabase.co') ||
    bareHost === 'appassets.androidplatform.net' ||
    bareHost.endsWith('.local') ||
    bareHost.endsWith('.internal')
  ) {
    throw new Error(`Blocked restricted LX host: ${bareHost}`);
  }

  const ipv4 = parseIpv4Octets(bareHost);
  if (ipv4 && isBlockedIpv4(ipv4)) {
    throw new Error(`Blocked private/loopback IPv4 LX host: ${bareHost}`);
  }

  if (bareHost.includes(':') && isBlockedIpv6(bareHost)) {
    throw new Error(`Blocked private/loopback IPv6 LX host: ${bareHost}`);
  }

  const explicitPort = parsed.port;
  if (explicitPort === LOCAL_SERVER_DEFAULT_PORT) {
    throw new Error(`Blocked local server port in LX request: ${LOCAL_SERVER_DEFAULT_PORT}`);
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const appHost = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    const localPorts = getLocalServerPorts();
    if (
      bareHost === appHost &&
      ((explicitPort && localPorts.has(explicitPort)) ||
        (window.location.protocol === 'http:' && (bareHost === '127.0.0.1' || bareHost === 'localhost')))
    ) {
      throw new Error(`Blocked same-origin local service target in LX request: ${bareHost}`);
    }
  }

  return parsed.toString();
};

/**
 * 解析脚本头部注释中的元信息
 */
export const parseScriptInfo = (script: string): LxScriptInfo => {
  const info: LxScriptInfo = {
    name: '未知音源',
    rawScript: script
  };

  const headerMatch = script.match(/^\/\*+[\s\S]*?\*\//);
  if (!headerMatch) {
    console.warn('[parseScriptInfo] 未找到脚本头部注释块');
    return info;
  }

  const header = headerMatch[0];

  const nameMatch = header.match(/@name\s+(.+?)(?:\r?\n|\*\/)/);
  if (nameMatch) {
    info.name = nameMatch[1].trim().replace(/^\*\s*/, '');
  } else {
    console.warn('[parseScriptInfo] 未找到 @name 标签');
  }

  const descMatch = header.match(/@description\s+(.+?)(?:\r?\n|\*\/)/);
  if (descMatch) {
    info.description = descMatch[1].trim().replace(/^\*\s*/, '');
  }

  const versionMatch = header.match(/@version\s+(.+?)(?:\r?\n|\*\/)/);
  if (versionMatch) {
    info.version = versionMatch[1].trim().replace(/^\*\s*/, '');
  }

  const authorMatch = header.match(/@author\s+(.+?)(?:\r?\n|\*\/)/);
  if (authorMatch) {
    info.author = authorMatch[1].trim().replace(/^\*\s*/, '');
  }

  const homepageMatch = header.match(/@homepage\s+(.+?)(?:\r?\n|\*\/)/);
  if (homepageMatch) {
    info.homepage = homepageMatch[1].trim().replace(/^\*\s*/, '');
  }

  return info;
};

/**
 * 落雪音源脚本执行器
 * 通过 Worker 隔离用户脚本执行，避免主线程直接执行动态脚本
 */
export class LxMusicSourceRunner {
  private script: string;
  private scriptInfo: LxScriptInfo;
  private sources: Partial<Record<LxSourceKey, LxSourceConfig>> = {};
  private initialized = false;
  private initPromise: Promise<LxInitedData> | null = null;

  private worker: Worker | null = null;
  private pendingInvocations = new Map<string, PendingInvocation>();
  private pendingHttpCancels = new Map<string, () => void>();
  private callSequence = 0;

  private initResolver: ((data: LxInitedData) => void) | null = null;
  private initRejecter: ((error: Error) => void) | null = null;
  private initTimeoutId: number | null = null;

  // 临时存储最后一次 HTTP 请求返回的音乐 URL（用于脚本返回 undefined 时的后备）
  private lastMusicUrl: string | null = null;

  constructor(script: string) {
    this.script = script;
    this.scriptInfo = parseScriptInfo(script);
  }

  /**
   * 获取脚本信息
   */
  getScriptInfo(): LxScriptInfo {
    return this.scriptInfo;
  }

  /**
   * 获取支持的音源列表
   */
  getSources(): Partial<Record<LxSourceKey, LxSourceConfig>> {
    return this.sources;
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(new URL('./workers/lxScriptSandbox.worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event: MessageEvent<WorkerToRunnerMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      const message = event.message || '脚本 Worker 运行错误';
      console.error('[LxMusicRunner] Worker error:', message);
      this.rejectInitialization(new Error(message));
      this.rejectAllInvocations(new Error(message));
    };

    this.worker = worker;
    return worker;
  }

  private clearInitState() {
    this.initResolver = null;
    this.initRejecter = null;
    if (this.initTimeoutId) {
      clearTimeout(this.initTimeoutId);
      this.initTimeoutId = null;
    }
  }

  private rejectInitialization(error: Error) {
    if (this.initRejecter) {
      this.initRejecter(error);
    }
    this.clearInitState();
    this.initPromise = null;
  }

  private resolveInitialization(data: LxInitedData) {
    if (this.initResolver) {
      this.initResolver(data);
    }
    this.clearInitState();
  }

  private rejectAllInvocations(error: Error) {
    this.pendingInvocations.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    });
    this.pendingInvocations.clear();
  }

  private settleInvocationResult(callId: string, result: any) {
    const pending = this.pendingInvocations.get(callId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pendingInvocations.delete(callId);
    pending.resolve(result);
  }

  private settleInvocationError(callId: string, message: string) {
    const pending = this.pendingInvocations.get(callId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pendingInvocations.delete(callId);
    pending.reject(new Error(message));
  }

  private postToWorker(message: RunnerToWorkerMessage) {
    const worker = this.ensureWorker();
    worker.postMessage(message);
  }

  private handleWorkerMessage(message: WorkerToRunnerMessage) {
    switch (message.type) {
      case 'initialized':
        this.sources = message.data.sources;
        this.initialized = true;
        console.log('[LxMusicRunner] 初始化成功:', message.data.sources);
        this.resolveInitialization(message.data);
        break;

      case 'script-error':
        console.error('[LxMusicRunner] 脚本初始化失败:', message.message);
        this.rejectInitialization(new Error(message.message));
        break;

      case 'http-request':
        this.handleWorkerHttpRequest(message);
        break;

      case 'invoke-result':
        this.settleInvocationResult(message.callId, message.result);
        break;

      case 'invoke-error':
        this.settleInvocationError(message.callId, message.message);
        break;

      case 'log':
        if (message.level === 'error') {
          console.error('[LxScript]', ...message.args);
        } else if (message.level === 'warn') {
          console.warn('[LxScript]', ...message.args);
        } else if (message.level === 'info') {
          console.info('[LxScript]', ...message.args);
        } else {
          console.log('[LxScript]', ...message.args);
        }
        break;

      default:
        break;
    }
  }

  private handleWorkerHttpRequest(message: WorkerHttpRequestMessage) {
    const cancel = this.handleHttpRequest(
      message.url,
      message.options,
      (error: Error | null, response: any, body: any) => {
        this.pendingHttpCancels.delete(message.requestId);

        if (body && typeof body.url === 'string') {
          this.lastMusicUrl = body.url;
        }

        this.postToWorker({
          type: 'http-response',
          requestId: message.requestId,
          response,
          body,
          error: error?.message
        });
      }
    );

    this.pendingHttpCancels.set(message.requestId, cancel);
  }

  private async invokeRequest(payload: any, timeoutMs = 20000): Promise<any> {
    if (!this.initialized) {
      throw new Error('脚本尚未初始化');
    }

    const callId = `call_${Date.now()}_${this.callSequence++}`;
    return await new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingInvocations.delete(callId);
        reject(new Error('脚本请求超时'));
      }, timeoutMs);

      this.pendingInvocations.set(callId, {
        resolve,
        reject,
        timeoutId
      });

      this.postToWorker({
        type: 'invoke-request',
        callId,
        payload
      });
    });
  }

  /**
   * 初始化执行器
   */
  async initialize(): Promise<LxInitedData> {
    if (this.initPromise) return this.initPromise;
    if (this.initialized) {
      return {
        openDevTools: false,
        sources: this.sources
      };
    }

    this.initPromise = new Promise<LxInitedData>((resolve, reject) => {
      this.initResolver = resolve;
      this.initRejecter = reject;
      this.initTimeoutId = window.setTimeout(() => {
        this.rejectInitialization(new Error('脚本初始化超时'));
      }, 10000);
    });

    this.postToWorker({
      type: 'initialize',
      script: this.script,
      scriptInfo: this.scriptInfo
    });

    return this.initPromise;
  }

  /**
   * 处理 HTTP 请求（优先使用主进程，绕过 CORS 限制）
   */
  private handleHttpRequest(
    url: string,
    options: any,
    callback: (err: Error | null, resp: any, body: any) => void
  ): () => void {
    let safeUrl: string;
    try {
      safeUrl = assertSafeLxRequestUrl(url);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Blocked unsafe LX HTTP request URL');
      console.warn('[LxMusicRunner] 已拦截不安全的 LX 网络请求:', url, err.message);
      queueMicrotask(() => {
        callback(err, null, null);
      });
      return () => {};
    }

    console.log(`[LxMusicRunner] HTTP 请求: ${options.method || 'GET'} ${safeUrl}`);

    const timeout = options.timeout || 30000;
    const requestId = `lx_http_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const hasMainProcessHttp = typeof window.api?.lxMusicHttpRequest === 'function';

    if (hasMainProcessHttp) {
      window.api
        .lxMusicHttpRequest({
          url: safeUrl,
          options: {
            ...options,
            timeout
          },
          requestId
        })
        .then((response: any) => {
          callback(null, response, response.body);
        })
        .catch((error: Error) => {
          callback(error, null, null);
        });

      return () => {
        void window.api?.lxMusicHttpCancel?.(requestId);
      };
    }

    const controller = new AbortController();
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...options.headers
      },
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    };

    if (options.body) {
      if (
        typeof options.body === 'object' &&
        !(options.body instanceof FormData) &&
        !(options.body instanceof Blob) &&
        !(options.body instanceof URLSearchParams) &&
        !(options.body instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(options.body)
      ) {
        fetchOptions.body = JSON.stringify(options.body);
      } else {
        fetchOptions.body = options.body;
      }
    } else if (options.form) {
      fetchOptions.body = new URLSearchParams(options.form);
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      };
    } else if (options.formData) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(options.formData)) {
        formData.append(key, value as string);
      }
      fetchOptions.body = formData;
    }

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeout);

    fetch(safeUrl, fetchOptions)
      .then(async (response) => {
        clearTimeout(timeoutId);
        const rawBody = await response.text();

        let parsedBody: any = rawBody;
        const contentType = response.headers.get('content-type') || '';
        if (
          contentType.includes('application/json') ||
          rawBody.startsWith('{') ||
          rawBody.startsWith('[')
        ) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            // keep raw text
          }
        }

        callback(
          null,
          {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: parsedBody
          },
          parsedBody
        );
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        callback(error, null, null);
      });

    return () => controller.abort();
  }

  /**
   * 获取音乐 URL
   */
  async getMusicUrl(
    source: LxSourceKey,
    musicInfo: LxMusicInfo,
    quality: LxQuality
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig) {
      throw new Error(`脚本不支持音源: ${source}`);
    }

    if (!sourceConfig.actions.includes('musicUrl')) {
      throw new Error(`音源 ${source} 不支持获取音乐 URL`);
    }

    let targetQuality = quality;
    if (!sourceConfig.qualitys.includes(quality)) {
      const qualityPriority: LxQuality[] = ['flac24bit', 'flac', '320k', '128k'];
      for (const q of qualityPriority) {
        if (sourceConfig.qualitys.includes(q)) {
          targetQuality = q;
          break;
        }
      }
    }

    try {
      const result = await this.invokeRequest({
        source,
        action: 'musicUrl',
        info: {
          type: targetQuality,
          musicInfo
        }
      });

      let url: string | undefined;
      if (typeof result === 'string') {
        url = result;
      } else if (result && typeof result === 'object') {
        url = result.url || result.data || result;
      }

      if (typeof url !== 'string' || !url) {
        if (this.lastMusicUrl) {
          url = this.lastMusicUrl;
          this.lastMusicUrl = null;
        } else {
          throw new Error(result?.message || result?.msg || '获取音乐 URL 失败');
        }
      }

      return url;
    } catch (error) {
      console.error('[LxMusicRunner] 获取音乐 URL 失败:', error);
      throw error;
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(source: LxSourceKey, musicInfo: LxMusicInfo): Promise<LxLyricResult | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig || !sourceConfig.actions.includes('lyric')) {
      return null;
    }

    try {
      const result = await this.invokeRequest({
        source,
        action: 'lyric',
        info: {
          type: null,
          musicInfo
        }
      });

      return result as LxLyricResult;
    } catch (error) {
      console.error('[LxMusicRunner] 获取歌词失败:', error);
      return null;
    }
  }

  /**
   * 获取封面图
   */
  async getPic(source: LxSourceKey, musicInfo: LxMusicInfo): Promise<string | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const sourceConfig = this.sources[source];
    if (!sourceConfig || !sourceConfig.actions.includes('pic')) {
      return null;
    }

    try {
      const result = await this.invokeRequest({
        source,
        action: 'pic',
        info: {
          type: null,
          musicInfo
        }
      });
      return typeof result === 'string' ? result : null;
    } catch (error) {
      console.error('[LxMusicRunner] 获取封面失败:', error);
      return null;
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 销毁执行器
   */
  dispose() {
    this.pendingHttpCancels.forEach((cancel) => {
      try {
        cancel();
      } catch {
        // ignore
      }
    });
    this.pendingHttpCancels.clear();

    this.rejectAllInvocations(new Error('执行器已销毁'));
    this.clearInitState();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.initialized = false;
    this.initPromise = null;
    this.sources = {};
    this.lastMusicUrl = null;
  }
}

// 全局单例
let runnerInstance: LxMusicSourceRunner | null = null;

/**
 * 获取落雪音源执行器实例
 */
export const getLxMusicRunner = (): LxMusicSourceRunner | null => {
  return runnerInstance;
};

/**
 * 设置落雪音源执行器实例
 */
export const setLxMusicRunner = (runner: LxMusicSourceRunner | null): void => {
  if (runnerInstance && runnerInstance !== runner) {
    runnerInstance.dispose();
  }
  runnerInstance = runner;
};

/**
 * 初始化落雪音源执行器（从脚本内容）
 */
export const initLxMusicRunner = async (script: string): Promise<LxMusicSourceRunner> => {
  if (runnerInstance) {
    runnerInstance.dispose();
  }

  const runner = new LxMusicSourceRunner(script);
  await runner.initialize();

  runnerInstance = runner;
  return runner;
};
