export const NATIVE_NETEASE_COOKIE_SECRET_KEY = 'netease_auth_cookie';
export const NETEASE_COOKIE_HEADER = 'X-Netease-Cookie';
export const SESSION_EXPIRED_TOAST_TEXT = '登录状态已过期，请重新登录';

const MUSIC_U_VALUE_RE = /(?:^|;\s*)MUSIC_U=([^;\s]+)/;
const SENSITIVE_KV_TEXT_RE =
  /\b(MUSIC_U|MUSIC_A|SESSDATA|bili_jct|qqmusic_key|qm_keyst|p_skey|pt4_token|qrsig|__csrf)=([^;\s&"']+)/gi;
const SENSITIVE_QUERY_PARAM_RE =
  /([?&](?:cookie|token|secret|password|authorization|auth)=)([^&#\s]+)/gi;
const SENSITIVE_BEARER_RE = /(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;
const SENSITIVE_KEY_NAME_RE =
  /(cookie|token|secret|password|authorization|x-alger-token|x-netease-cookie|skey|qm_keyst|sessdata|bili_jct|qrsig)/i;

export interface AuthTokenStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HydrateAuthTokenParams {
  storage: AuthTokenStorageLike;
  isNativeAndroid: boolean;
  readSecureCookie: () => string;
  writeSecureCookie: (value: string) => boolean;
  readCookieManagerCookie: () => string;
}

export interface HydrateAuthTokenResult {
  restored: boolean;
  syncedToNative: boolean;
  token: string;
  source: 'localStorage' | 'secureStore' | 'cookieManager' | 'none';
}

export type SessionVerifyStatus = 'valid' | 'expired' | 'inconclusive';

export interface SessionVerifyDecision {
  status: SessionVerifyStatus;
  reason: string;
}

export type Session301Action = 'kept-valid' | 'logged-out' | 'ignored';

export interface Session301ActionResult {
  action: Session301Action;
  reason: string;
}

export interface Http301SessionGuardDeps {
  verifySession: () => Promise<any>;
  hasActiveAuthSession: () => boolean;
  isOffline: () => boolean;
  onConfirmedExpired: () => Promise<void> | void;
  now?: () => number;
  validCooldownMs?: number;
  expiredCooldownMs?: number;
}

export interface AuthRequestConfigLike {
  url?: string;
  method?: string;
  params?: Record<string, any>;
  headers?: any;
  data?: any;
  skip301Guard?: boolean;
  noRetry?: boolean;
  timeout?: number;
}

export interface AttachAuthCookieOptions {
  preferHeader?: boolean;
}

function hasHeaderCaseInsensitive(headers: any, name: string): boolean {
  if (!headers || typeof headers !== 'object') return false;
  if (typeof headers.has === 'function') {
    return Boolean(headers.has(name));
  }
  const target = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target && Boolean(headers[k]));
}

function setHeaderIfMissing(config: AuthRequestConfigLike, name: string, value: string): void {
  if (!config.headers || typeof config.headers !== 'object') {
    config.headers = {};
  }
  if (typeof config.headers.set === 'function') {
    if (!hasHeaderCaseInsensitive(config.headers, name)) {
      config.headers.set(name, value, false);
    }
    return;
  }
  if (!hasHeaderCaseInsensitive(config.headers, name)) {
    config.headers[name] = value;
  }
}

export function redactSensitiveText(input: string): string {
  return String(input || '')
    .replace(SENSITIVE_KV_TEXT_RE, '$1=[REDACTED]')
    .replace(SENSITIVE_QUERY_PARAM_RE, '$1[REDACTED]')
    .replace(SENSITIVE_BEARER_RE, '$1[REDACTED]');
}

function sanitizeParamsForLog(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const val = (raw as Record<string, unknown>)[key];
    if (SENSITIVE_KEY_NAME_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof val === 'string') {
      out[key] = redactSensitiveText(val);
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      out[key] = val;
    }
  }
  return out;
}

export function redactSensitiveErrorForLog(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return {
      message: typeof error === 'string' ? redactSensitiveText(error) : 'Request failed'
    };
  }
  const err = error as Record<string, any>;
  const safe: Record<string, unknown> = {
    message: typeof err.message === 'string' ? redactSensitiveText(err.message) : 'Request failed'
  };
  if (typeof err.name === 'string' && err.name) safe.name = err.name;
  if (err.code !== undefined) safe.code = err.code;
  if (err.response?.status !== undefined) safe.status = err.response.status;
  if (err.config?.method) safe.method = String(err.config.method).toUpperCase();
  if (typeof err.config?.url === 'string') safe.url = redactSensitiveText(err.config.url);
  const safeParams = sanitizeParamsForLog(err.config?.params);
  if (safeParams && Object.keys(safeParams).length > 0) safe.params = safeParams;
  return safe;
}

/**
 * 构造 301 会话二次核验专用请求配置：
 * - 显式跳过 301 守卫防重入递归（skip301Guard: true）
 * - 绝不附带 noLogin: true，确保请求拦截器携带当前 MUSIC_U Token 供后端核验真实登录态
 */
export function buildLoginStatusVerifyConfig(): {
  noRetry: true;
  skip301Guard: true;
  timeout: number;
} {
  return {
    noRetry: true,
    skip301Guard: true,
    timeout: 8000
  };
}

/**
 * 向请求配置安全注入网易云登录 Cookie：
 * - 仅在未设置 noLogin / noCookie 时注入
 * - 对非 POST 请求默认优先通过 `X-Netease-Cookie` 请求头传递，减少 GET URL Query 明文泄露
 * - 对 POST 重试时已被 Axios 序列化的 JSON 字符串 body 先还原为对象，避免 `{ ...jsonStr }` 按字符展开破坏请求体
 */
export function attachAuthCookieToRequestConfig<T extends AuthRequestConfigLike>(
  config: T,
  token: string | null | undefined,
  options?: AttachAuthCookieOptions
): T {
  const cleanToken = typeof token === 'string' ? token : '';
  if (!cleanToken || config.params?.noLogin === true || config.params?.noCookie === true) {
    return config;
  }

  const preferHeader = options?.preferHeader !== false;
  const method = String(config.method || 'get').toLowerCase();
  if (method !== 'post') {
    if (preferHeader) {
      if (config.params?.cookie === undefined) {
        setHeaderIfMissing(config, NETEASE_COOKIE_HEADER, cleanToken);
      }
      return config;
    }
    const params =
      config.params && typeof config.params === 'object' ? { ...config.params } : {};
    if (params.cookie === undefined) {
      params.cookie = cleanToken;
    }
    config.params = params;
    return config;
  }

  const rawData = config.data;
  if (rawData === undefined || rawData === null) {
    config.data = { cookie: cleanToken };
    return config;
  }

  if (typeof rawData === 'string') {
    const trimmed = rawData.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config.data =
            parsed.cookie !== undefined ? parsed : { ...parsed, cookie: cleanToken };
          return config;
        }
      } catch {
        // 非法或非 JSON 对象字符串，保持原值不按字符展开
      }
    }
    if (preferHeader) {
      setHeaderIfMissing(config, NETEASE_COOKIE_HEADER, cleanToken);
    }
    return config;
  }

  if (typeof URLSearchParams !== 'undefined' && rawData instanceof URLSearchParams) {
    if (!rawData.has('cookie')) {
      rawData.set('cookie', cleanToken);
    }
    return config;
  }

  if (typeof FormData !== 'undefined' && rawData instanceof FormData) {
    if (!rawData.has('cookie')) {
      rawData.append('cookie', cleanToken);
    }
    return config;
  }

  if (typeof rawData === 'object' && !Array.isArray(rawData)) {
    config.data =
      rawData.cookie !== undefined ? rawData : { ...rawData, cookie: cleanToken };
  }

  return config;
}

export function hasNeteaseUserCookie(raw: string | null | undefined): boolean {
  const clean = typeof raw === 'string' ? raw.trim() : '';
  if (!clean) return false;
  return MUSIC_U_VALUE_RE.test(clean);
}

/**
 * 同步恢复 Android 原生存储中的登录 Cookie 至 localStorage，并将既有 localStorage Cookie 备份进原生 Keystore。
 * 在首屏任何需要鉴权的业务请求触发之前调用，避免覆盖安装或 WebView 数据波动触发误登出。
 */
export function hydrateAuthTokenSync(params: HydrateAuthTokenParams): HydrateAuthTokenResult {
  const {
    storage,
    isNativeAndroid,
    readSecureCookie,
    writeSecureCookie,
    readCookieManagerCookie
  } = params;

  const localToken = (storage.getItem('token') || '').trim();
  if (localToken) {
    let syncedToNative = false;
    if (isNativeAndroid) {
      const existingSecure = (readSecureCookie() || '').trim();
      if (existingSecure !== localToken) {
        syncedToNative = Boolean(writeSecureCookie(localToken));
      } else {
        syncedToNative = true;
      }
    }
    return {
      restored: false,
      syncedToNative,
      token: localToken,
      source: 'localStorage'
    };
  }

  if (isNativeAndroid) {
    const secureToken = (readSecureCookie() || '').trim();
    if (secureToken) {
      storage.setItem('token', secureToken);
      return {
        restored: true,
        syncedToNative: false,
        token: secureToken,
        source: 'secureStore'
      };
    }

    const cmCookie = (readCookieManagerCookie() || '').trim();
    if (hasNeteaseUserCookie(cmCookie)) {
      storage.setItem('token', cmCookie);
      const syncedToNative = Boolean(writeSecureCookie(cmCookie));
      return {
        restored: true,
        syncedToNative,
        token: cmCookie,
        source: 'cookieManager'
      };
    }
  }

  return {
    restored: false,
    syncedToNative: false,
    token: '',
    source: 'none'
  };
}

function unwrapLoginStatusBody(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const obj = payload as Record<string, any>;
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const inner = obj.data as Record<string, any>;
    if ('account' in inner || 'profile' in inner || 'code' in inner) {
      return inner;
    }
  }
  return obj;
}

/**
 * 严格判定 `/login/status` 返回体：仅在明确确认会话已失效时返回 `expired`，
 * 服务端异常/结构异常等不确定场景返回 `inconclusive` 避免误杀用户登录态。
 */
export function evaluateLoginStatusResponse(payload: unknown): SessionVerifyDecision {
  const body = unwrapLoginStatusBody(payload);
  if (!body) {
    return { status: 'inconclusive', reason: 'malformed-payload' };
  }

  const code = typeof body.code === 'number' ? body.code : null;
  if (code === 301 || code === 401) {
    return { status: 'expired', reason: `status-code-${code}` };
  }

  if (code !== null && code !== 200) {
    return { status: 'inconclusive', reason: `non-200-code-${code}` };
  }

  const profile = body.profile;
  const account = body.account;

  if (profile && typeof profile === 'object' && Number(profile.userId) > 0) {
    return { status: 'valid', reason: 'profile-valid' };
  }

  if (
    account &&
    typeof account === 'object' &&
    Number(account.id) > 0 &&
    account.anonimousUser !== true
  ) {
    return { status: 'valid', reason: 'account-valid' };
  }

  if (code === 200 || 'account' in body || 'profile' in body) {
    return { status: 'expired', reason: 'no-valid-account-or-profile' };
  }

  return { status: 'inconclusive', reason: 'malformed-payload' };
}

/**
 * 核验请求本身报错时的分级判定：断网、超时、5xx、429 一律视作不确定（不登出），仅明确的 301/401 判为过期。
 */
export function classifySessionVerifyError(error: any, isOffline: boolean): SessionVerifyDecision {
  if (isOffline || Boolean(error?.isOfflineError)) {
    return { status: 'inconclusive', reason: 'offline' };
  }

  if (!error?.response) {
    return { status: 'inconclusive', reason: 'network-or-timeout' };
  }

  const httpStatus = Number(error.response.status);
  if (httpStatus === 301 || httpStatus === 401) {
    return { status: 'expired', reason: `http-${httpStatus}` };
  }

  if (httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) {
    return { status: 'inconclusive', reason: `http-${httpStatus}` };
  }

  const nested = evaluateLoginStatusResponse(error.response.data);
  if (nested.status === 'expired') {
    return nested;
  }

  return {
    status: 'inconclusive',
    reason: Number.isFinite(httpStatus) ? `http-${httpStatus}` : 'unknown-http-error'
  };
}

/**
 * 防并发 HTTP 301 会话守卫：
 * - 并发 301 共享同一次 `/login/status` 核验，杜绝重复登出与竞态闪退
 * - 若会话仍然有效则保留登录态，交由调用方安全重试
 * - 仅在在线且明确确认失效时才执行清理登录态与原生 Cookie
 */
export function createHttp301SessionGuard(deps: Http301SessionGuardDeps) {
  const now = deps.now ?? (() => Date.now());
  const validCooldownMs = deps.validCooldownMs ?? 8000;
  const expiredCooldownMs = deps.expiredCooldownMs ?? 5000;

  let inFlightPromise: Promise<Session301ActionResult> | null = null;
  let lastVerifiedValidAt = 0;
  let lastConfirmedExpiredAt = 0;

  const reset = () => {
    inFlightPromise = null;
    lastVerifiedValidAt = 0;
    lastConfirmedExpiredAt = 0;
  };

  const handle301 = async (options?: {
    url?: string;
    noLogin?: boolean;
    skip301Guard?: boolean;
  }): Promise<Session301ActionResult> => {
    const cleanUrl = String(options?.url || '');
    if (
      options?.skip301Guard === true ||
      options?.noLogin === true ||
      cleanUrl.includes('/login/status') ||
      cleanUrl.includes('/logout')
    ) {
      return { action: 'ignored', reason: 'no-login-or-auth-endpoint' };
    }

    if (deps.isOffline()) {
      return { action: 'ignored', reason: 'offline' };
    }

    if (!deps.hasActiveAuthSession()) {
      return { action: 'ignored', reason: 'no-active-session' };
    }

    if (inFlightPromise) {
      return inFlightPromise;
    }

    const currentTs = now();
    if (lastVerifiedValidAt > 0 && currentTs - lastVerifiedValidAt < validCooldownMs) {
      return { action: 'kept-valid', reason: 'recent-valid-cache' };
    }

    if (lastConfirmedExpiredAt > 0 && currentTs - lastConfirmedExpiredAt < expiredCooldownMs) {
      return { action: 'ignored', reason: 'recent-expired-cooldown' };
    }

    inFlightPromise = (async (): Promise<Session301ActionResult> => {
      let decision: SessionVerifyDecision;
      try {
        const res = await deps.verifySession();
        decision = evaluateLoginStatusResponse(res?.data ?? res);
      } catch (err) {
        decision = classifySessionVerifyError(err, deps.isOffline());
      }

      if (decision.status === 'valid') {
        lastVerifiedValidAt = now();
        return { action: 'kept-valid', reason: decision.reason };
      }

      if (decision.status === 'inconclusive') {
        return { action: 'ignored', reason: decision.reason };
      }

      if (deps.isOffline() || !deps.hasActiveAuthSession()) {
        return { action: 'ignored', reason: 'state-changed-during-verify' };
      }

      lastConfirmedExpiredAt = now();
      await deps.onConfirmedExpired();
      return { action: 'logged-out', reason: decision.reason };
    })().finally(() => {
      inFlightPromise = null;
    });

    return inFlightPromise;
  };

  return {
    handle301,
    reset
  };
}
