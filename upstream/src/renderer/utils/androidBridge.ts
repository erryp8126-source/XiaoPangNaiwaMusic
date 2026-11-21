/**
 * AlgerMusicPlayer Android 原生桥接层
 * 提供 WebView 与 Kotlin 原生壳（Media3 ExoPlayer、本地网易云代理、下载管理、MediaStore 扫描、悬浮歌词、CORS-free HTTP）的通信接口
 */

export interface AndroidServerConfig {
  mode: 'local' | 'custom';
  localPort: number;
  customApiUrl: string;
  customMusicApiUrl: string;
  floatingLyricEnabled: boolean;
}

export interface AndroidBridgeInterface {
  getServerConfig(): string;
  setServerConfig(json: string): string;
  getLocalServerStatus(): string;
  invokeAsync(callbackId: string, action: string, payloadJson: string): void;
  // Audio control (Media3 ExoPlayer Foreground Service)
  audioLoad(payloadJson: string): void;
  audioPlay(): void;
  audioPause(): void;
  audioStop(): void;
  audioSeek(positionSec: number): void;
  audioSetVolume(volume: number): void;
  audioSetRate(rate: number): void;
  audioGetState(): string;
  audioGetActiveTrack?(): string;
  audioSyncQueue(queueJson: string): void;
  // Hardware Equalizer
  eqSetEnabled(enabled: boolean): void;
  eqSetBandGain(freqHz: number, gainDb: number): void;
  eqReset(): void;
  // Desktop / Floating Lyrics
  setFloatingLyricEnabled(enabled: boolean): boolean;
  isFloatingLyricEnabled(): boolean;
  isFloatingLyricLocked?(): boolean;
  setFloatingLyricLocked?(locked: boolean): boolean;
  updateFloatingLyric(text: string, translation: string, songTitle: string, isPlaying: boolean): void;
  syncFloatingLyricLines?(songId: string, songTitle: string, linesJson: string): void;
  // System UI & Power
  setStatusBarStyle(isDark: boolean): void;
  requestIgnoreBatteryOptimizations(): void;
  isIgnoringBatteryOptimizations(): boolean;
  openExternalUrl(url: string): void;
  showToast(msg: string): void;
  exitApp?(): void;
  getAudioCacheSize?(): number;
  clearAudioCache?(): boolean;
  getListeningStats?(): string;
  resetListeningStats?(): boolean;
  mergeListeningStats?(statsJson: string): string;
}

declare global {
  interface Window {
    AlgerAndroid?: AndroidBridgeInterface;
    __algerNativeCallback?: (callbackId: string, success: boolean, resultJson: string) => void;
    __algerNativeEvent?: (channel: string, payloadJson: string) => void;
    __algerHandleBack?: () => boolean;
  }
}

export const isAndroid = (): boolean => {
  return typeof window !== 'undefined' && typeof window.AlgerAndroid !== 'undefined';
};

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

// ==================== Event Bus ====================
type EventListener = (event: any, data: any) => void;
const eventListeners = new Map<string, Set<EventListener>>();

export function onAndroidEvent(channel: string, listener: EventListener): void {
  if (!eventListeners.has(channel)) {
    eventListeners.set(channel, new Set());
  }
  eventListeners.get(channel)!.add(listener);
}

export function offAndroidEvent(channel: string, listener?: EventListener): void {
  if (!listener) {
    eventListeners.delete(channel);
    return;
  }
  eventListeners.get(channel)?.delete(listener);
}

function emitAndroidEvent(channel: string, data: any): void {
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

// ==================== Android IPC-Compatible Adapter ====================
export interface NativeIpcAdapter {
  on(channel: string, listener: EventListener): void;
  removeListener(channel: string, listener: EventListener): void;
  removeAllListeners(channel: string): void;
  send(channel: string, ...args: any[]): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
}

const androidIpcAdapter: NativeIpcAdapter = {
  on(channel, listener) {
    onAndroidEvent(channel, listener);
  },
  removeListener(channel, listener) {
    offAndroidEvent(channel, listener);
  },
  removeAllListeners(channel) {
    offAndroidEvent(channel);
  },
  send(channel, ...args) {
    if (!isAndroid()) return;
    if (channel === 'download-music') {
      void invokeAndroidAsync('download-music', args[0] || {});
    } else if (channel === 'open-directory') {
      window.AlgerAndroid!.showToast(`保存位置: ${args[0] || 'Music/AlgerMusicPlayer'}`);
    } else if (channel === 'close-lyric') {
      window.AlgerAndroid!.setFloatingLyricEnabled(false);
    } else if (channel === 'update-play-state') {
      // Handled directly by NativeHowl / ExoPlayer
    } else if (channel === 'set-store-value') {
      const key = String(args[0] || '');
      try {
        localStorage.setItem(`alger_store_${key}`, JSON.stringify(args[1]));
      } catch {
        // ignore
      }
    }
  },
  async invoke(channel, ...args) {
    if (!isAndroid()) return null;
    switch (channel) {
      case 'get-store-value': {
        const key = String(args[0] || '');
        const raw = localStorage.getItem(`alger_store_${key}`);
        if (raw === null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      case 'get-downloads-path':
        return invokeAndroidAsync('get-downloads-path', {});
      case 'get-downloaded-music':
        return invokeAndroidAsync('get-downloaded-music', {});
      case 'check-file-exists':
        return invokeAndroidAsync('check-file-exists', { path: args[0] || '' });
      case 'delete-downloaded-music':
        return invokeAndroidAsync('delete-downloaded-music', { path: args[0] || '' });
      case 'clear-downloaded-music':
        return invokeAndroidAsync('clear-downloaded-music', {});
      case 'save-lyric-file':
        return invokeAndroidAsync('save-lyric-file', args[0] || {});
      case 'select-directory':
        return invokeAndroidAsync('select-local-music-source', {});
      case 'get-download-settings':
        return invokeAndroidAsync('get-download-settings', {});
      case 'save-download-settings':
        return invokeAndroidAsync('save-download-settings', args[0] || {});
      case 'resolve-cached-music-url':
        return { url: args[0]?.url, cached: false };
      case 'get-cached-lyric':
        return null;
      case 'cache-lyric':
        return true;
      default:
        return invokeAndroidAsync(channel, { args });
    }
  }
};

export function getNativeIpc(): NativeIpcAdapter | null {
  if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
    return (window as any).electron.ipcRenderer;
  }
  if (isAndroid()) {
    return androidIpcAdapter;
  }
  return null;
}

// ==================== NativeHowl (Backed by Android Media3 ExoPlayer) ====================
let activeNativeHowl: NativeHowl | null = null;
let nativeHowlSeq = 0;

export class NativeHowl {
  public readonly instanceId: number;
  private url: string;
  private trackMeta: {
    id: string;
    title: string;
    artist: string;
    album: string;
    cover: string;
    durationSec: number;
  };
  private _state: 'loading' | 'loaded' | 'unloaded' = 'loading';
  private _playing = false;
  private _position = 0;
  private _duration = 0;
  private _volume = 1;
  private _rate = 1;
  private _initialSeekTime = 0;
  private _seekGuardUntil = 0;
  private listeners: Map<string, Set<Function>> = new Map();
  private onceListeners: Map<string, Set<Function>> = new Map();
  private loadedEmitted = false;

  constructor(options: {
    src: string[];
    track?: any;
    volume?: number;
    rate?: number;
    autoplay?: boolean;
    seekTime?: number;
    attachOnly?: boolean;
    fixedInstanceId?: number;
    initialPosition?: number;
    initialPlaying?: boolean;
    onload?: () => void;
    onloaderror?: (_id: any, err: any) => void;
  }) {
    this.instanceId =
      typeof options.fixedInstanceId === 'number' ? options.fixedInstanceId : ++nativeHowlSeq;
    this.url = options.src?.[0] || '';
    this._volume = options.volume ?? 1;
    this._rate = options.rate ?? 1;
    this._initialSeekTime = options.seekTime && options.seekTime > 0 ? options.seekTime : 0;

    const track = options.track || {};
    const artists = track.ar
      ? track.ar.map((a: any) => a.name).join(' / ')
      : track.song?.artists
        ? track.song.artists.map((a: any) => a.name).join(' / ')
        : '';
    const album = track.al?.name || track.song?.album?.name || '';
    const cover = track.picUrl || track.al?.picUrl || '';
    const expectedDur = (track.dt || track.duration || 0) / 1000;

    this.trackMeta = {
      id: String(track.id || ''),
      title: track.name || '未知歌曲',
      artist: artists || '未知歌手',
      album,
      cover,
      durationSec: expectedDur > 0 ? expectedDur : 0
    };
    if (expectedDur > 0) {
      this._duration = expectedDur;
    }

    if (options.onload) {
      this.once('load', options.onload);
    }
    if (options.onloaderror) {
      this.once('loaderror', options.onloaderror);
    }

    if (options.attachOnly) {
      activeNativeHowl = this;
      this._state = 'loaded';
      this.loadedEmitted = true;
      this._position = Math.max(0, options.initialPosition || 0);
      this._playing = Boolean(options.initialPlaying);
    } else {
      // Load immediately into native ExoPlayer if this is created for active playback
      this.activateAndLoad(Boolean(options.autoplay));
    }
  }

  public updateTrackMeta(track: any): void {
    if (!track) return;
    const artists = track.ar
      ? track.ar.map((a: any) => a.name).join(' / ')
      : track.song?.artists
        ? track.song.artists.map((a: any) => a.name).join(' / ')
        : '';
    const album = track.al?.name || track.song?.album?.name || '';
    const cover = track.picUrl || track.al?.picUrl || '';
    const expectedDur = (track.dt || track.duration || 0) / 1000;
    this.trackMeta = {
      id: String(track.id || this.trackMeta.id),
      title: track.name || this.trackMeta.title,
      artist: artists || this.trackMeta.artist,
      album: album || this.trackMeta.album,
      cover: cover || this.trackMeta.cover,
      durationSec: expectedDur > 0 ? expectedDur : this.trackMeta.durationSec
    };
  }

  public activateAndLoad(autoplay: boolean): void {
    activeNativeHowl = this;
    this._state = 'loading';
    this.loadedEmitted = false;

    if (!this.url) {
      this.handleNativeEvent({ type: 'loaderror', error: 'Empty audio URL' });
      return;
    }

    try {
      window.AlgerAndroid?.audioLoad(
        JSON.stringify({
          instanceId: this.instanceId,
          url: this.url,
          title: this.trackMeta.title,
          artist: this.trackMeta.artist,
          album: this.trackMeta.album,
          cover: this.trackMeta.cover,
          songId: this.trackMeta.id,
          durationSec: this.trackMeta.durationSec,
          autoplay,
          seekTime: this._initialSeekTime,
          volume: this._volume,
          rate: this._rate
        })
      );
      if (this._initialSeekTime > 0) {
        this._position = this._initialSeekTime;
        this._initialSeekTime = 0;
      }
    } catch (e) {
      this.handleNativeEvent({ type: 'loaderror', error: String(e) });
    }
  }

  public handleNativeEvent(evt: any): void {
    if (evt.instanceId !== undefined && evt.instanceId !== 0 && evt.instanceId !== this.instanceId) {
      return;
    }

    const now = Date.now();
    const isSeekEvent = evt.type === 'seek' || evt.type === 'replayed' || evt.type === 'sync-state';
    if (isSeekEvent) {
      this._seekGuardUntil = 0;
    }

    if (typeof evt.position === 'number' && !Number.isNaN(evt.position)) {
      // 在刚触发 seek 后的短暂保护窗内，忽略 Seek 之前在管道里排队的旧 timeupdate，防止进度条弹回
      if (evt.type !== 'timeupdate' || now >= this._seekGuardUntil) {
        this._position = Math.max(0, evt.position);
      }
    }
    if (typeof evt.duration === 'number' && evt.duration > 0 && !Number.isNaN(evt.duration)) {
      this._duration = evt.duration;
    }
    const prevPlaying = this._playing;
    if (typeof evt.playing === 'boolean') {
      this._playing = evt.playing;
    }

    switch (evt.type) {
      case 'loaded':
        this._state = 'loaded';
        if (!this.loadedEmitted) {
          this.loadedEmitted = true;
          this._emit('load', this.instanceId);
        }
        break;
      case 'play':
        this._state = 'loaded';
        this._playing = true;
        if (!this.loadedEmitted) {
          this.loadedEmitted = true;
          this._emit('load', this.instanceId);
        }
        this._emit('play', this.instanceId);
        break;
      case 'pause':
        this._playing = false;
        this._emit('pause', this.instanceId);
        break;
      case 'end':
        this._playing = false;
        this._emit('end', this.instanceId);
        break;
      case 'replayed':
        this._position = 0;
        this._playing = true;
        this._emit('seek', this.instanceId);
        this._emit('play', this.instanceId);
        break;
      case 'sync-state':
        this._emit('seek', this.instanceId);
        if (this._playing && !prevPlaying) {
          this._emit('play', this.instanceId);
        } else if (!this._playing && prevPlaying) {
          this._emit('pause', this.instanceId);
        }
        break;
      case 'seek':
        this._emit('seek', this.instanceId);
        break;
      case 'loaderror':
        this._playing = false;
        this._state = 'unloaded';
        this._emit('loaderror', this.instanceId, evt.error || 'ExoPlayer load error');
        break;
      case 'playerror':
        this._playing = false;
        this._emit('playerror', this.instanceId, evt.error || 'ExoPlayer play error');
        break;
      case 'timeupdate':
        // Position and duration already updated above
        break;
    }
  }

  private _emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      Array.from(set).forEach((fn) => {
        try {
          fn(...args);
        } catch (e) {
          console.error(`[NativeHowl] Listener error for ${event}:`, e);
        }
      });
    }
    const onceSet = this.onceListeners.get(event);
    if (onceSet) {
      const fns = Array.from(onceSet);
      this.onceListeners.delete(event);
      fns.forEach((fn) => {
        try {
          fn(...args);
        } catch (e) {
          console.error(`[NativeHowl] Once listener error for ${event}:`, e);
        }
      });
    }
  }

  public on(event: string, fn: Function): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  public once(event: string, fn: Function): this {
    if (!this.onceListeners.has(event)) this.onceListeners.set(event, new Set());
    this.onceListeners.get(event)!.add(fn);
    return this;
  }

  public off(event?: string, fn?: Function): this {
    if (!event) {
      this.listeners.clear();
      this.onceListeners.clear();
      return this;
    }
    if (!fn) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(fn);
      this.onceListeners.get(event)?.delete(fn);
    }
    return this;
  }

  public play(): number {
    if (activeNativeHowl !== this) {
      this.activateAndLoad(true);
    } else {
      this._playing = true;
      window.AlgerAndroid?.audioPlay();
    }
    return this.instanceId;
  }

  public pause(): this {
    if (activeNativeHowl === this) {
      this._playing = false;
      window.AlgerAndroid?.audioPause();
    }
    return this;
  }

  public stop(): this {
    if (activeNativeHowl === this) {
      this._playing = false;
      this._position = 0;
      window.AlgerAndroid?.audioStop();
    }
    return this;
  }

  public unload(): void {
    this._playing = false;
    this._state = 'unloaded';
    if (activeNativeHowl === this) {
      window.AlgerAndroid?.audioStop();
      activeNativeHowl = null;
    }
    this.listeners.clear();
    this.onceListeners.clear();
  }

  public seek(pos?: number): number | this {
    if (typeof pos === 'number' && !Number.isNaN(pos)) {
      const clamped =
        this._duration > 0 ? Math.max(0, Math.min(pos, this._duration)) : Math.max(0, pos);
      this._position = clamped;
      this._seekGuardUntil = Date.now() + 750;
      if (this._state !== 'unloaded') {
        activeNativeHowl = this;
        window.AlgerAndroid?.audioSeek(this._position);
      }
      return this;
    }
    return this._position;
  }

  public duration(): number {
    return this._duration;
  }

  public playing(): boolean {
    return this._playing;
  }

  public state(): 'loading' | 'loaded' | 'unloaded' {
    return this._state;
  }

  public volume(vol?: number): number | this {
    if (typeof vol === 'number') {
      this._volume = Math.max(0, Math.min(1, vol));
      if (activeNativeHowl === this) {
        window.AlgerAndroid?.audioSetVolume(this._volume);
      }
      return this;
    }
    return this._volume;
  }

  public rate(r?: number): number | this {
    if (typeof r === 'number') {
      this._rate = Math.max(0.25, Math.min(4, r));
      if (activeNativeHowl === this) {
        window.AlgerAndroid?.audioSetRate(this._rate);
      }
      return this;
    }
    return this._rate;
  }
}

export function getActiveNativeHowl(): NativeHowl | null {
  return activeNativeHowl;
}

export function syncAndroidPlaybackQueue(params: {
  playList: any[];
  currentIndex: number;
  playMode: number;
  musicQuality?: string;
  unblockSources?: string[];
  isFm?: boolean;
  stopAfterCurrent?: boolean;
  cookie?: string;
}): void {
  if (!isAndroid()) return;
  try {
    const items = (params.playList || []).slice(0, 1000).map((song: any) => {
      const artists = song?.ar
        ? song.ar.map((a: any) => a.name).join(' / ')
        : song?.song?.artists
          ? song.song.artists.map((a: any) => a.name).join(' / ')
          : '';
      return {
        id: String(song?.id ?? ''),
        name: song?.name || '未知歌曲',
        artist: artists,
        album: song?.al?.name || song?.song?.album?.name || '',
        cover: song?.picUrl || song?.al?.picUrl || '',
        url: song?.playMusicUrl || '',
        source: song?.source || 'netease',
        dt: Number(song?.dt || song?.duration || 0)
      };
    });

    window.AlgerAndroid?.audioSyncQueue(
      JSON.stringify({
        playMode: params.playMode ?? 0,
        currentIndex: Math.max(0, params.currentIndex ?? 0),
        musicQuality: params.musicQuality || 'higher',
        unblockSources: params.unblockSources || ['kuwo', 'kugou', 'migu', 'gdmusic'],
        isFm: Boolean(params.isFm),
        stopAfterCurrent: Boolean(params.stopAfterCurrent),
        cookie: params.cookie || '',
        items
      })
    );
  } catch (e) {
    console.warn('[AndroidBridge] syncAndroidPlaybackQueue error:', e);
  }
}

// ==================== Global Window Bridge Installer ====================
let installed = false;

export function installAndroidWindowApi(): void {
  if (installed || !isAndroid()) return;
  installed = true;

  // 1. Register async callback dispatcher called from Kotlin
  window.__algerNativeCallback = (callbackId: string, success: boolean, resultJson: string) => {
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
  };

  // 2. Register native event dispatcher called from Kotlin
  window.__algerNativeEvent = (channel: string, payloadJson: string) => {
    let payload: any = payloadJson;
    if (typeof payloadJson === 'string' && payloadJson.length > 0) {
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        payload = payloadJson;
      }
    }

    if (channel === 'audio-event') {
      if (payload?.type === 'nexttrack' || payload?.type === 'previoustrack') {
        emitAndroidEvent('media-control', payload.type);
      } else if (payload?.type === 'native-track-changed') {
        emitAndroidEvent('native-track-changed', payload);
      } else if (activeNativeHowl) {
        activeNativeHowl.handleNativeEvent(payload);
      }
      return;
    }

    emitAndroidEvent(channel, payload);
  };

  // 3. Install window.api shim for AlgerMusicPlayer v5.1.0 features
  const existingApi = (window as any).api || {};
  (window as any).api = {
    ...existingApi,

    // Multi-source music unblock via Kotlin embedded unblock engine
    unblockMusic: async (id: number | string, songData: any, enabledSources?: string[]) => {
      return invokeAndroidAsync('unblock-music', {
        id: Number(id) || id,
        songData,
        enabledSources: enabledSources || ['kuwo', 'kugou', 'migu', 'gdmusic']
      });
    },

    // CORS-free HTTP request for LX Music scripts, GDMusic, and Custom API plugins
    lxMusicHttpRequest: async (params: { url: string; options?: any; requestId?: string }) => {
      return invokeAndroidAsync(
        'http-request',
        {
          url: params.url,
          method: params.options?.method || 'GET',
          headers: params.options?.headers || {},
          body: params.options?.body || null,
          form: params.options?.form || null,
          timeout: params.options?.timeout || 15000
        },
        (params.options?.timeout || 15000) + 5000
      );
    },

    lxMusicHttpCancel: async (_requestId: string) => {
      return true;
    },

    // Import local .js / .json script via Android SAF document picker
    importLxMusicScript: async () => {
      return invokeAndroidAsync('pick-text-file', { accept: '.js' }, 120000);
    },

    importCustomApiPlugin: async () => {
      return invokeAndroidAsync('pick-text-file', { accept: '.json' }, 120000);
    },

    // Local music scanning via Android MediaStore
    scanLocalMusicWithStats: async (folderPath: string) => {
      return invokeAndroidAsync('scan-local-music', { folderPath }, 60000);
    },

    parseLocalMusicMetadata: async (filePaths: string[]) => {
      return invokeAndroidAsync('parse-local-music-metadata', { filePaths }, 60000);
    },

    // Floating lyrics bridge
    openLyric: () => {
      window.AlgerAndroid?.setFloatingLyricEnabled(true);
    },
    sendLyric: (dataStr: string) => {
      try {
        const data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (data?.type === 'update' || data?.text !== undefined) {
          // Handled via dedicated floating lyric sync in MusicHook
        }
      } catch {
        // ignore
      }
    },
    sendSong: (_song: any) => {
      // Metadata synced directly through NativeHowl -> MediaSession
    },
    onLyricWindowClosed: (cb: () => void) => {
      onAndroidEvent('floating-lyric-closed', () => cb());
    },
    onLyricWindowReady: (_cb: () => void) => {},
    onLanguageChanged: (_cb: (lang: string) => void) => {},
    quitApp: () => {},
    invoke: (channel: string, ...args: any[]) => androidIpcAdapter.invoke(channel, ...args)
  };
}
