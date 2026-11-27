/**
 * 极简首次使用引导资格判定（纯逻辑，零 Vue/DOM 依赖，可直接单测）
 * - 仅向全新用户展示一次
 * - 若检测到用户已有收藏、播放历史、自建歌单或主动修改过的自定义配置，直接跳过并标记完成
 * - 出厂默认写入的 appSettings 快照不会误判为自定义配置
 */

export interface ExistingConfigInspectionInput {
  rawToken?: string | null;
  rawCloudSyncConfigJson?: string | null;
  rawCustomPlaylistsJson?: string | null;
  rawPwaApiUrl?: string | null;
  rawDownloadedTracksJson?: string | null;
  rawAppSettingsJson?: string | null;
}

export interface OnboardingEligibilityInput {
  isLyricWindow: boolean;
  alreadyCompleted: boolean;
  disclaimerAgreed: boolean;
  favoritesCount: number;
  playHistoryCount: number;
  customPlaylistsCount: number;
  hasCustomConfig: boolean;
}

export interface OnboardingDecision {
  shouldShow: boolean;
  shouldAutoMarkCompleted: boolean;
  reason:
    | 'lyric-window'
    | 'already-completed'
    | 'awaiting-disclaimer'
    | 'existing-user-data'
    | 'fresh-user';
}

function safeParseJson<T = any>(raw: string | null | undefined): T | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export function detectExistingUserCustomConfig(input: ExistingConfigInspectionInput): boolean {
  const token = String(input.rawToken || '').trim();
  if (token && token !== 'null' && token !== 'undefined') {
    return true;
  }

  const pwaApi = String(input.rawPwaApiUrl || '').trim();
  if (pwaApi) {
    return true;
  }

  const cloudCfg = safeParseJson<Record<string, any>>(input.rawCloudSyncConfigJson);
  if (cloudCfg && typeof cloudCfg === 'object') {
    if (String(cloudCfg.quick?.syncCode || '').trim()) return true;
    if (String(cloudCfg.webdav?.username || '').trim()) return true;
    if (String(cloudCfg.github?.token || '').trim()) return true;
    if (String(cloudCfg.customDeviceName || '').trim()) return true;
  }

  const customPlaylists = safeParseJson<any[]>(input.rawCustomPlaylistsJson);
  if (Array.isArray(customPlaylists) && customPlaylists.length > 0) {
    return true;
  }

  const downloadedTracks = safeParseJson<any[]>(input.rawDownloadedTracksJson);
  if (Array.isArray(downloadedTracks) && downloadedTracks.length > 0) {
    return true;
  }

  const settings = safeParseJson<Record<string, any>>(input.rawAppSettingsJson);
  if (settings && typeof settings === 'object') {
    if (settings.autoTheme === true) return true;
    if (settings.manualTheme === 'dark') return true;
    if (settings.musicQuality && settings.musicQuality !== 'higher') return true;
    if (settings.powerSavingMode === true) return true;
    if (settings.crossfadeEnabled === true) return true;
    if (settings.volumeNormalizationEnabled === true) return true;
    if (settings.enableDynamicBackground === false) return true;
    if (settings.launchHomeMode === 'classic') return true;
    if (String(settings.customApiPlugin || '').trim()) return true;
    if (Array.isArray(settings.lxMusicScripts) && settings.lxMusicScripts.length > 0) return true;
    if (settings.proxyConfig?.enable === true) return true;
    if (settings.enableRealIP === true) return true;
  }

  return false;
}

export function evaluateOnboardingEligibility(
  input: OnboardingEligibilityInput
): OnboardingDecision {
  if (input.isLyricWindow) {
    return {
      shouldShow: false,
      shouldAutoMarkCompleted: false,
      reason: 'lyric-window'
    };
  }
  if (input.alreadyCompleted) {
    return {
      shouldShow: false,
      shouldAutoMarkCompleted: false,
      reason: 'already-completed'
    };
  }
  if (!input.disclaimerAgreed) {
    return {
      shouldShow: false,
      shouldAutoMarkCompleted: false,
      reason: 'awaiting-disclaimer'
    };
  }

  const hasExistingData =
    (Number(input.favoritesCount) || 0) > 0 ||
    (Number(input.playHistoryCount) || 0) > 0 ||
    (Number(input.customPlaylistsCount) || 0) > 0 ||
    Boolean(input.hasCustomConfig);

  if (hasExistingData) {
    return {
      shouldShow: false,
      shouldAutoMarkCompleted: true,
      reason: 'existing-user-data'
    };
  }

  return {
    shouldShow: true,
    shouldAutoMarkCompleted: false,
    reason: 'fresh-user'
  };
}
