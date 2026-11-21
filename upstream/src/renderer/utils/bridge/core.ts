import type { AndroidServerConfig, NativeCapabilities, NativeEventListener } from './types';

export const isAndroid = (): boolean => {
  return typeof window !== 'undefined' && typeof window.AlgerAndroid !== 'undefined';
};

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
