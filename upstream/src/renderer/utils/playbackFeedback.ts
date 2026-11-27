/**
 * Unified playback feedback & throttling utility (zero DOM / router side-effects on import).
 * Converges fragmented technical playback errors into concise, non-stacking human-readable prompts.
 */

export const PLAYBACK_FEEDBACK_COPY = {
  AUTO_FALLBACK: '当前音源不可用，已自动切换',
  BUFFERING_BETTER_SOURCE: '正在缓冲更稳定的版本',
  UNAVAILABLE: '该歌曲暂不可播放',
  SEARCH_OTHER_VERSION: '搜其他版本',
  OFFLINE_BANNER: '当前处于离线状态 · 可播放本地与已缓存曲目',
  LOCAL_MISSING: '本地音频文件暂不可用'
} as const;

export interface PlaybackToastAction {
  label: string;
  onClick: () => void;
}

export type PlaybackToastSink = (
  message: string,
  iconName?: string,
  durationMs?: number,
  action?: PlaybackToastAction
) => void;

export type PlaybackFeedbackKind = 'auto-fallback' | 'buffering-retry' | 'unavailable';

export interface PlaybackFeedbackEvaluateOptions {
  trackName?: string;
  isOffline?: boolean;
  isLocal?: boolean;
}

export interface PlaybackFeedbackDecision {
  shouldShow: boolean;
  suppressedReason?: 'offline' | 'throttled';
  kind: PlaybackFeedbackKind;
  text: string;
  icon: string;
  durationMs: number;
  actionLabel?: string;
  searchKeyword?: string;
}

const SAME_KIND_COOLDOWN_MS = 2500;
const SAME_TRACK_COOLDOWN_MS = 3200;
const RAPID_SKIP_SPACING_MS = 1400;

const TECHNICAL_LEAK_REGEX =
  /\b(403|404|500|502|503|504|ETIMEDOUT|ECONNABORTED|ECONNRESET|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|NetworkError|NotAllowedError|AbortError|gdmusic|pyncmd|kuwo|kugou|migu|lxMusic|lx-wy|ExoPlayer|AVPlayer|Howl|AudioContext)\b|\/api\/|\/song\/url|status code\s*\d+/i;

function getCanonicalFeedbackText(kind: PlaybackFeedbackKind, isLocal?: boolean): string {
  if (kind === 'auto-fallback') {
    return PLAYBACK_FEEDBACK_COPY.AUTO_FALLBACK;
  }
  if (kind === 'buffering-retry') {
    return PLAYBACK_FEEDBACK_COPY.BUFFERING_BETTER_SOURCE;
  }
  return isLocal ? PLAYBACK_FEEDBACK_COPY.LOCAL_MISSING : PLAYBACK_FEEDBACK_COPY.UNAVAILABLE;
}

function getFeedbackIcon(kind: PlaybackFeedbackKind): string {
  if (kind === 'auto-fallback') return 'ri-route-line';
  if (kind === 'buffering-retry') return 'ri-loader-4-line';
  return 'ri-music-2-line';
}

/**
 * Strips raw HTTP codes, API endpoints, and internal engine/source identifiers so users never see jargon.
 */
export function sanitizePlaybackFeedbackText(
  raw: string,
  fallbackKind: PlaybackFeedbackKind
): string {
  const clean = String(raw ?? '').trim();
  if (!clean || TECHNICAL_LEAK_REGEX.test(clean)) {
    return getCanonicalFeedbackText(fallbackKind);
  }
  return clean;
}

export function isOfflineQuietError(error?: unknown, isOfflineFlag?: boolean): boolean {
  if (isOfflineFlag) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (typeof error === 'object' && (error as any)?.isOfflineError === true) {
    return true;
  }
  const msg =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.name} ${error.message}`
        : String((error as any)?.message || '');
  return /err_internet_disconnected|network error|failed to fetch|offline/i.test(msg);
}

/**
 * Stateful throttler that deduplicates repeated fallback/buffering/unavailable notices
 * while letting final `'unavailable'` notices supersede transient retry hints.
 */
export class PlaybackFeedbackThrottle {
  private readonly nowFn: () => number;
  private lastShownAt = -Infinity;
  private lastKind: PlaybackFeedbackKind | null = null;
  private readonly lastShownByKind = new Map<PlaybackFeedbackKind, number>();
  private readonly lastShownByTrackKey = new Map<string, number>();

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  reset(): void {
    this.lastShownAt = -Infinity;
    this.lastKind = null;
    this.lastShownByKind.clear();
    this.lastShownByTrackKey.clear();
  }

  evaluate(
    kind: PlaybackFeedbackKind,
    opts: PlaybackFeedbackEvaluateOptions = {}
  ): PlaybackFeedbackDecision {
    const cleanTrackName = String(opts.trackName ?? '').trim();

    // Suppress online network/source popups in offline quiet mode; keep local-file warnings active.
    if (opts.isOffline && !opts.isLocal) {
      return {
        shouldShow: false,
        suppressedReason: 'offline',
        kind,
        text: '',
        icon: '',
        durationMs: 0
      };
    }

    const now = this.nowFn();
    const lastForKind = this.lastShownByKind.get(kind);
    if (lastForKind !== undefined && now - lastForKind < SAME_KIND_COOLDOWN_MS) {
      return {
        shouldShow: false,
        suppressedReason: 'throttled',
        kind,
        text: '',
        icon: '',
        durationMs: 0
      };
    }

    const trackKey = cleanTrackName ? `${kind}:${cleanTrackName.toLowerCase()}` : '';
    if (trackKey) {
      const lastForTrack = this.lastShownByTrackKey.get(trackKey);
      if (lastForTrack !== undefined && now - lastForTrack < SAME_TRACK_COOLDOWN_MS) {
        return {
          shouldShow: false,
          suppressedReason: 'throttled',
          kind,
          text: '',
          icon: '',
          durationMs: 0
        };
      }
    }

    const canSupersede =
      kind === 'unavailable' &&
      (this.lastKind === 'auto-fallback' || this.lastKind === 'buffering-retry');

    if (!canSupersede && now - this.lastShownAt < RAPID_SKIP_SPACING_MS) {
      return {
        shouldShow: false,
        suppressedReason: 'throttled',
        kind,
        text: '',
        icon: '',
        durationMs: 0
      };
    }

    this.lastShownAt = now;
    this.lastKind = kind;
    this.lastShownByKind.set(kind, now);
    if (trackKey) {
      this.lastShownByTrackKey.set(trackKey, now);
    }

    const text = getCanonicalFeedbackText(kind, opts.isLocal);
    const icon = getFeedbackIcon(kind);
    const durationMs = kind === 'unavailable' ? 4200 : 1800;

    if (kind === 'unavailable' && !opts.isLocal && cleanTrackName) {
      return {
        shouldShow: true,
        kind,
        text,
        icon,
        durationMs,
        actionLabel: PLAYBACK_FEEDBACK_COPY.SEARCH_OTHER_VERSION,
        searchKeyword: cleanTrackName
      };
    }

    return {
      shouldShow: true,
      kind,
      text,
      icon,
      durationMs
    };
  }
}

const playbackFeedbackThrottle = new PlaybackFeedbackThrottle();
let searchNavigator: ((keyword: string) => void) | null = null;
let toastSink: PlaybackToastSink | null = null;

export function registerPlaybackSearchNavigator(handler: ((keyword: string) => void) | null): void {
  searchNavigator = handler;
}

export function registerPlaybackToastSink(sink: PlaybackToastSink | null): void {
  toastSink = sink;
}

export function resetPlaybackFeedbackThrottle(): void {
  playbackFeedbackThrottle.reset();
}

function dispatchToast(
  message: string,
  iconName: string,
  durationMs: number,
  action?: PlaybackToastAction
): void {
  if (toastSink) {
    toastSink(message, iconName, durationMs, action);
    return;
  }
  if (typeof window !== 'undefined') {
    void import('./shortcutToast')
      .then(({ showFloatingToast }) => showFloatingToast(message, iconName, durationMs, action))
      .catch(() => {});
  }
}

export function notifyPlaybackAutoFallback(
  trackName?: string,
  opts: { isOffline?: boolean } = {}
): void {
  const decision = playbackFeedbackThrottle.evaluate('auto-fallback', {
    trackName,
    isOffline: opts.isOffline
  });
  if (!decision.shouldShow) return;
  dispatchToast(decision.text, decision.icon, decision.durationMs);
}

export function notifyPlaybackBufferingRetry(
  trackName?: string,
  opts: { isOffline?: boolean } = {}
): void {
  const decision = playbackFeedbackThrottle.evaluate('buffering-retry', {
    trackName,
    isOffline: opts.isOffline
  });
  if (!decision.shouldShow) return;
  dispatchToast(decision.text, decision.icon, decision.durationMs);
}

export function notifyPlaybackUnavailable(
  trackName?: string,
  opts: { isOffline?: boolean; isLocal?: boolean } = {}
): void {
  const decision = playbackFeedbackThrottle.evaluate('unavailable', {
    trackName,
    isOffline: opts.isOffline,
    isLocal: opts.isLocal
  });
  if (!decision.shouldShow) return;

  const action =
    decision.actionLabel && decision.searchKeyword && searchNavigator
      ? {
          label: decision.actionLabel,
          onClick: () => searchNavigator?.(decision.searchKeyword as string)
        }
      : undefined;

  dispatchToast(decision.text, decision.icon, decision.durationMs, action);
}
