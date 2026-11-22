import type { AndroidServerConfig, HapticStyle, NativeCapabilities, NativeEventListener } from './types';

export const isAndroid = (): boolean => {
  return typeof window !== 'undefined' && typeof window.AlgerAndroid !== 'undefined';
};

/**
 * 触发原生触觉反馈（Android HapticFeedbackConstants / iOS UIFeedbackGenerator）
 * Web / PWA 环境静默降级为无操作
 */
export function triggerHaptic(style: HapticStyle = 'light'): void {
  if (typeof window === 'undefined') return;
  try {
    window.AlgerAndroid?.triggerHaptic?.(style);
  } catch {
    // 非原生或不支持环境静默降级
  }
}

/**
 * 检测当前是否连接了外部音频输出设备（有线耳机 / 蓝牙耳机 / AirPlay / USB 音频等）
 * - Android 原生：AudioManager.getDevices(GET_DEVICES_OUTPUTS)
 * - iOS 原生：AVAudioSession.sharedInstance().currentRoute.outputs
 * - Web / 非原生环境返回 false
 */
export function isExternalAudioOutputConnected(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.AlgerAndroid?.isAudioOutputExternal?.());
  } catch {
    return false;
  }
}

/**
 * 查询 Android 原生 SimpleCache 是否已缓存指定曲目与音质
 */
export function isAndroidAudioCached(songId: string | number, quality: string = 'higher'): boolean {
  if (typeof window === 'undefined' || !songId) return false;
  try {
    return Boolean(window.AlgerAndroid?.isAudioCached?.(String(songId), quality || 'higher'));
  } catch {
    return false;
  }
}

export interface OfflinePlayableIdGroups {
  cachedIds: string[];
  downloadedIds: string[];
  localIds: string[];
}

/**
 * 查询原生端已缓存 / 已下载 / 本地曲目 ID 集合
 */
export async function fetchNativeOfflinePlayableIds(): Promise<OfflinePlayableIdGroups> {
  const empty: OfflinePlayableIdGroups = { cachedIds: [], downloadedIds: [], localIds: [] };
  if (!isAndroid()) return empty;
  try {
    if (typeof window.AlgerAndroid?.getOfflinePlayableIds === 'function') {
      const raw = window.AlgerAndroid.getOfflinePlayableIds();
      const parsed = JSON.parse(raw || '{}');
      return {
        cachedIds: Array.isArray(parsed.cachedIds) ? parsed.cachedIds.map(String) : [],
        downloadedIds: Array.isArray(parsed.downloadedIds) ? parsed.downloadedIds.map(String) : [],
        localIds: Array.isArray(parsed.localIds) ? parsed.localIds.map(String) : []
      };
    }
    const resp = await invokeAndroidAsync<any>('get-offline-playable-ids', {}, 8000);
    return {
      cachedIds: Array.isArray(resp?.cachedIds) ? resp.cachedIds.map(String) : [],
      downloadedIds: Array.isArray(resp?.downloadedIds) ? resp.downloadedIds.map(String) : [],
      localIds: Array.isArray(resp?.localIds) ? resp.localIds.map(String) : []
    };
  } catch {
    return empty;
  }
}

/**
 * 同步切歌淡入淡出与跨音源音量平滑配置到原生播放引擎
 */
export function syncNativeAudioEnhancement(config: {
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number;
  volumeNormalizationEnabled: boolean;
}): void {
  if (!isAndroid()) return;
  try {
    const crossfadeMs = config.crossfadeEnabled
      ? Math.max(0, Math.min(3000, Math.round((Number(config.crossfadeDurationSec) || 0) * 1000)))
      : 0;
    window.AlgerAndroid?.audioSetAudioEnhancement?.(
      JSON.stringify({
        crossfadeMs,
        volumeNormalization: Boolean(config.volumeNormalizationEnabled)
      })
    );
  } catch {
    // ignore
  }
}

/**
 * 保存或分享听歌统计报告卡片 PNG（Android 保存至系统相册，iOS 调起原生分享/保存面板）
 */
export async function saveImageViaNativeBridge(
  filename: string,
  dataUrl: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!isAndroid()) {
    return { success: false, error: 'Not running in native shell' };
  }
  try {
    const resp = await invokeAndroidAsync<any>('save-image-file', { filename, dataUrl }, 20000);
    return {
      success: Boolean(resp?.success),
      path: resp?.path,
      error: resp?.error
    };
  } catch (err: any) {
    return { success: false, error: err?.message || '保存图片失败' };
  }
}

const isIOSNativeEnv = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.__ALGER_PLATFORM__ === 'ios' ||
    (typeof navigator !== 'undefined' && /AlgerIOS/i.test(navigator.userAgent))
  );
};

/**
 * 读取当前运行环境的平台原生能力标志
 * - Android 原生端：全部原生扩展能力开启
 * - iOS 原生端：显式声明 supportsEq=false / supportsFloatingLyric=false / supportsBatteryOptimization=false / supportsAudioCache=false
 * - 桌面端 / Web：Web Audio EQ 可用，其余移动端原生能力为 false
 */
export function getNativeCapabilities(): NativeCapabilities {
  if (typeof window === 'undefined') {
    return {
      supportsEq: false,
      supportsFloatingLyric: false,
      supportsBatteryOptimization: false,
      supportsAudioCache: false
    };
  }

  if (isAndroid()) {
    try {
      const raw = window.AlgerAndroid?.getCapabilities?.();
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<NativeCapabilities>;
        return {
          supportsEq: Boolean(parsed.supportsEq),
          supportsFloatingLyric: Boolean(parsed.supportsFloatingLyric),
          supportsBatteryOptimization: Boolean(parsed.supportsBatteryOptimization),
          supportsAudioCache: Boolean(parsed.supportsAudioCache)
        };
      }
    } catch (e) {
      console.warn('[AndroidBridge] Failed to parse getCapabilities:', e);
    }

    if (window.__ALGER_CAPABILITIES__) {
      const caps = window.__ALGER_CAPABILITIES__;
      return {
        supportsEq: Boolean(caps.supportsEq),
        supportsFloatingLyric: Boolean(caps.supportsFloatingLyric),
        supportsBatteryOptimization: Boolean(caps.supportsBatteryOptimization),
        supportsAudioCache: Boolean(caps.supportsAudioCache)
      };
    }

    const isIos = isIOSNativeEnv();
    return {
      supportsEq: !isIos,
      supportsFloatingLyric: !isIos,
      supportsBatteryOptimization: !isIos,
      supportsAudioCache: !isIos
    };
  }

  return {
    supportsEq: true,
    supportsFloatingLyric: false,
    supportsBatteryOptimization: false,
    supportsAudioCache: false
  };
}

// ==================== Layered Android Back-Button Stack ====================
type AndroidBackHandler = () => boolean;
const androidBackHandlers: Array<{ id: number; priority: number; fn: AndroidBackHandler }> = [];
let androidBackHandlerSeq = 0;

export function registerAndroidBackHandler(fn: AndroidBackHandler, priority = 0): () => void {
  const id = ++androidBackHandlerSeq;
  androidBackHandlers.push({ id, priority, fn });
  androidBackHandlers.sort((a, b) => b.priority - a.priority || b.id - a.id);
  return () => {
    const idx = androidBackHandlers.findIndex((item) => item.id === id);
    if (idx !== -1) androidBackHandlers.splice(idx, 1);
  };
}

export function dispatchAndroidBackHandlers(): boolean {
  for (const item of [...androidBackHandlers]) {
    try {
      if (item.fn()) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

// ==================== Async Callback Registry ====================
interface PendingCallback {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: number;
}

const pendingCallbacks = new Map<string, PendingCallback>();
let callbackSeq = 0;

export function invokeAndroidAsync<T = any>(
  action: string,
  payload: Record<string, any> = {},
  timeoutMs = 30000
): Promise<T> {
  if (!isAndroid()) {
    return Promise.reject(new Error('Not running in Android WebView'));
  }
  const id = `cb_${Date.now()}_${++callbackSeq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error(`Android native call timeout: ${action}`));
      }
    }, timeoutMs);

    pendingCallbacks.set(id, { resolve, reject, timer });
    try {
      window.AlgerAndroid!.invokeAsync(id, action, JSON.stringify(payload));
    } catch (err) {
      window.clearTimeout(timer);
      pendingCallbacks.delete(id);
      reject(err);
    }
  });
}

export function resolvePendingNativeCallback(
  callbackId: string,
  success: boolean,
  resultJson: string
): void {
  const entry = pendingCallbacks.get(callbackId);
  if (!entry) return;
  pendingCallbacks.delete(callbackId);
  window.clearTimeout(entry.timer);

  let parsed: any = resultJson;
  if (typeof resultJson === 'string' && resultJson.length > 0) {
    try {
      parsed = JSON.parse(resultJson);
    } catch {
      parsed = resultJson;
    }
  }

  if (success) {
    entry.resolve(parsed);
  } else {
    const msg =
      typeof parsed === 'object' && parsed?.error
        ? parsed.error
        : typeof parsed === 'string'
          ? parsed
          : 'Native error';
    entry.reject(new Error(msg));
  }
}

// ==================== Event Bus ====================
const eventListeners = new Map<string, Set<NativeEventListener>>();

export function onAndroidEvent(channel: string, listener: NativeEventListener): void {
  if (!eventListeners.has(channel)) {
    eventListeners.set(channel, new Set());
  }
  eventListeners.get(channel)!.add(listener);
}

export function offAndroidEvent(channel: string, listener?: NativeEventListener): void {
  if (!listener) {
    eventListeners.delete(channel);
    return;
  }
  eventListeners.get(channel)?.delete(listener);
}

export function emitAndroidEvent(channel: string, data: any): void {
  const listeners = eventListeners.get(channel);
  if (!listeners) return;
  listeners.forEach((fn) => {
    try {
      fn({}, data);
    } catch (e) {
      console.error(`[AndroidBridge] Event listener error on ${channel}:`, e);
    }
  });
}

// ==================== Server Config Helpers ====================
let cachedServerConfig: AndroidServerConfig | null = null;

export function getAndroidServerConfig(forceRefresh = false): AndroidServerConfig {
  if (!isAndroid()) {
    return {
      mode: 'local',
      localPort: 30488,
      customApiUrl: '',
      customMusicApiUrl: '',
      floatingLyricEnabled: false
    };
  }
  if (!cachedServerConfig || forceRefresh) {
    try {
      const raw = window.AlgerAndroid!.getServerConfig();
      cachedServerConfig = JSON.parse(raw);
    } catch (e) {
      console.error('[AndroidBridge] Failed to read server config:', e);
      cachedServerConfig = {
        mode: 'local',
        localPort: 30488,
        customApiUrl: '',
        customMusicApiUrl: '',
        floatingLyricEnabled: false
      };
    }
  }
  return cachedServerConfig!;
}

export function saveAndroidServerConfig(partial: Partial<AndroidServerConfig>): AndroidServerConfig {
  const current = getAndroidServerConfig(true);
  const next = { ...current, ...partial };
  if (isAndroid()) {
    try {
      const raw = window.AlgerAndroid!.setServerConfig(JSON.stringify(next));
      cachedServerConfig = JSON.parse(raw);
      return cachedServerConfig!;
    } catch (e) {
      console.error('[AndroidBridge] Failed to save server config:', e);
    }
  }
  cachedServerConfig = next;
  return next;
}

export function getAndroidApiBaseUrl(): string {
  const cfg = getAndroidServerConfig();
  if (cfg.mode === 'custom' && cfg.customApiUrl?.trim()) {
    return cfg.customApiUrl.trim().replace(/\/+$/, '');
  }
  return `http://127.0.0.1:${cfg.localPort || 30488}`;
}

export function getAndroidMusicApiBaseUrl(): string {
  const cfg = getAndroidServerConfig();
  if (cfg.customMusicApiUrl?.trim()) {
    return cfg.customMusicApiUrl.trim().replace(/\/+$/, '');
  }
  return `http://127.0.0.1:${cfg.localPort || 30488}`;
}

export function getAndroidLocalServerUrl(): string {
  const cfg = getAndroidServerConfig();
  return `http://127.0.0.1:${cfg.localPort || 30488}`;
}

export function getAndroidLocalAuthToken(): string {
  if (!isAndroid()) return '';
  const cfg = getAndroidServerConfig();
  return cfg.localToken || '';
}
