import { isAndroid } from './core';

// ==================== NativeHowl (Backed by Android ExoPlayer / iOS AVPlayer) ====================
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
        this._emit('loaderror', this.instanceId, evt.error || 'Native player load error');
        break;
      case 'playerror':
        this._playing = false;
        this._emit('playerror', this.instanceId, evt.error || 'Native player play error');
        break;
      case 'timeupdate':
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
  intelligencePlaylistId?: string | number | null;
  intelligenceSeedSongId?: string | number | null;
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
        unblockSources: params.unblockSources || ['pyncmd', 'kuwo', 'kugou', 'migu', 'gdmusic'],
        isFm: Boolean(params.isFm),
        stopAfterCurrent: Boolean(params.stopAfterCurrent),
        cookie: params.cookie || '',
        intelligencePlaylistId: params.intelligencePlaylistId ?? null,
        intelligenceSeedSongId: params.intelligenceSeedSongId ?? null,
        items
      })
    );
  } catch (e) {
    console.warn('[AndroidBridge] syncAndroidPlaybackQueue error:', e);
  }
}
