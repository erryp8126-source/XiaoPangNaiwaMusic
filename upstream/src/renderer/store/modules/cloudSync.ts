import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { BUILTIN_QUICK_SYNC_CONFIG, hasBuiltinQuickSync } from '@/config/quickSyncConfig';
import { useFavoriteStore } from '@/store/modules/favorite';
import { useListeningStatsStore } from '@/store/modules/listeningStats';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useSettingsStore } from '@/store/modules/settings';
import { invokeAndroidAsync, isAndroid } from '@/utils/androidBridge';
import {
  type CloudSyncSnapshot,
  computeSyncSnapshotDigest,
  detectSyncConflict,
  smartMergeCloudSnapshots,
  type SyncCustomPlaylist
} from '@/utils/cloudSyncMerge';
import {
  decryptSyncPayload,
  deriveSyncId,
  encryptSyncPayload,
  generateFriendlySyncCode,
  normalizeSyncCode,
  validateSyncCode
} from '@/utils/syncCrypto';

export type { CloudSyncSnapshot };
export type SyncProvider = 'quick' | 'webdav' | 'github';
export type ConflictResolutionStrategy = 'smart-merge' | 'use-remote' | 'overwrite-remote';

export interface CloudSyncConfig {
  provider: SyncProvider;
  autoSyncOnLaunch: boolean;
  autoSyncOnPlay: boolean;
  syncHistory: boolean;
  syncFavorites: boolean;
  syncListeningStats: boolean;
  quick: {
    syncCode: string;
    customSupabaseUrl: string;
    customSupabaseAnonKey: string;
  };
  webdav: {
    serverUrl: string;
    username: string;
    password: string;
    folderPath: string;
    fileName: string;
  };
  github: {
    token: string;
    gistId: string;
  };
}

export interface PendingSyncConflict {
  provider: SyncProvider;
  localSnapshot: CloudSyncSnapshot;
  remoteSnapshot: CloudSyncSnapshot;
  remoteUpdatedAt: number;
  reason: string;
  localSummary: {
    revision: number;
    updatedAt: number;
    deviceName: string;
    songsCount: number;
    favoritesCount: number;
    playlistsCount: number;
  };
  remoteSummary: {
    revision: number;
    updatedAt: number;
    deviceName: string;
    songsCount: number;
    favoritesCount: number;
    playlistsCount: number;
  };
}

export interface CloudSyncResult {
  ok: boolean;
  message: string;
  conflict?: boolean;
  syncCode?: string;
  songsCount?: number;
  favoritesCount?: number;
  totalSeconds?: number;
}

const CONFIG_STORAGE_KEY = 'xiaopang_cloud_sync_config_v1';
const META_STORAGE_KEY = 'xiaopang_cloud_sync_meta_v1';
const DEVICE_ID_STORAGE_KEY = 'xiaopang_cloud_sync_device_id_v1';
const CUSTOM_PLAYLISTS_STORAGE_KEY = 'xiaopang_custom_playlists_v1';
const GIST_FILENAME = 'xiaopang-music-sync-v1.json';
const QUICK_MAX_PAYLOAD_BYTES = 480 * 1024;
const SYNCABLE_PREF_KEYS = [
  'musicQuality',
  'enableMusicUnblock',
  'enabledMusicSources',
  'enableDynamicBackground',
  'crossfadeEnabled',
  'crossfadeDurationSec',
  'volumeNormalizationEnabled',
  'autoPlay',
  'autoTheme',
  'manualTheme',
  'language'
] as const;

const DEFAULT_CONFIG: CloudSyncConfig = {
  provider: 'quick',
  autoSyncOnLaunch: true,
  autoSyncOnPlay: true,
  syncHistory: true,
  syncFavorites: true,
  syncListeningStats: true,
  quick: {
    syncCode: '',
    customSupabaseUrl: '',
    customSupabaseAnonKey: ''
  },
  webdav: {
    serverUrl: 'https://dav.jianguoyun.com/dav/',
    username: '',
    password: '',
    folderPath: '/XiaoPangNaiwaMusic',
    fileName: 'sync-data-v1.json'
  },
  github: {
    token: '',
    gistId: ''
  }
};

function structuredCloneCompat<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function loadConfig(): CloudSyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return structuredCloneCompat(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      quick: { ...DEFAULT_CONFIG.quick, ...(parsed.quick || {}) },
      webdav: { ...DEFAULT_CONFIG.webdav, ...(parsed.webdav || {}) },
      github: { ...DEFAULT_CONFIG.github, ...(parsed.github || {}) }
    };
  } catch {
    return structuredCloneCompat(DEFAULT_CONFIG);
  }
}

interface SyncBaselineMeta {
  lastSyncAt: number;
  lastSyncMsg: string;
  lastSyncProvider: string;
  lastSyncedRevision: number;
  lastRemoteUpdatedAt: number;
  lastSyncedLocalDigest: string;
}

function loadMeta(): SyncBaselineMeta {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lastSyncAt: Number(parsed.lastSyncAt) || 0,
        lastSyncMsg: String(parsed.lastSyncMsg || ''),
        lastSyncProvider: String(parsed.lastSyncProvider || ''),
        lastSyncedRevision: Number(parsed.lastSyncedRevision) || 0,
        lastRemoteUpdatedAt: Number(parsed.lastRemoteUpdatedAt) || 0,
        lastSyncedLocalDigest: String(parsed.lastSyncedLocalDigest || '')
      };
    }
  } catch {
    // ignore
  }
  return {
    lastSyncAt: 0,
    lastSyncMsg: '',
    lastSyncProvider: '',
    lastSyncedRevision: 0,
    lastRemoteUpdatedAt: 0,
    lastSyncedLocalDigest: ''
  };
}

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'dev_local';
  }
}

function loadLocalCustomPlaylists(): SyncCustomPlaylist[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PLAYLISTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalCustomPlaylists(list: SyncCustomPlaylist[]): void {
  try {
    localStorage.setItem(CUSTOM_PLAYLISTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface HttpResp {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

async function nativeAwareRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}): Promise<HttpResp> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const timeout = options.timeout || 20000;

  // Android / iOS 原生壳走无跨域代理（彻底绕过 WebView CORS）
  if (isAndroid()) {
    const resp = await invokeAndroidAsync<any>(
      'http-request',
      {
        url: options.url,
        method,
        headers,
        body: options.body,
        timeout
      },
      timeout + 5000
    );
    return {
      statusCode: Number(resp?.statusCode ?? 0),
      body: resp?.body ?? '',
      headers: resp?.headers || {}
    };
  }

  // Web / Safari PWA 走浏览器 fetch
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(options.url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
      signal: controller.signal
    });
    const text = await res.text();
    let parsedBody: any = text;
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsedBody = JSON.parse(trimmed);
      } catch {
        parsedBody = text;
      }
    }
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k.toLowerCase()] = v;
    });
    return {
      statusCode: res.status,
      body: parsedBody,
      headers: respHeaders
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function parseJsonBody(body: any): any | null {
  if (!body) return null;
  if (typeof body === 'object') return body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeWebdavUrls(cfg: CloudSyncConfig['webdav']) {
  const base = cfg.serverUrl.trim().replace(/\/+$/, '');
  const cleanFolder = cfg.folderPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const cleanFile = encodeURIComponent((cfg.fileName || 'sync-data-v1.json').trim());
  const folderUrl = cleanFolder ? `${base}/${cleanFolder}` : base;
  const fileUrl = `${folderUrl}/${cleanFile}`;
  return { base, cleanFolder, folderUrl, fileUrl };
}

function detectDeviceName(): string {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  return 'Web';
}

export const useCloudSyncStore = defineStore('cloudSync', () => {
  const config = ref<CloudSyncConfig>(loadConfig());
  const meta = loadMeta();
  const currentDeviceId = getOrCreateDeviceId();
  const lastSyncAt = ref<number>(meta.lastSyncAt || 0);
  const lastSyncMsg = ref<string>(meta.lastSyncMsg || '');
  const lastSyncProvider = ref<string>(meta.lastSyncProvider || '');
  const lastSyncedRevision = ref<number>(meta.lastSyncedRevision || 0);
  const lastRemoteUpdatedAt = ref<number>(meta.lastRemoteUpdatedAt || 0);
  const lastSyncedLocalDigest = ref<string>(meta.lastSyncedLocalDigest || '');
  const pendingConflict = ref<PendingSyncConflict | null>(null);
  const syncing = ref(false);
  const testing = ref(false);

  let playSyncTimer: number | null = null;
  let lastPlaySyncAt = 0;

  const effectiveSupabaseUrl = computed(() => {
    return (
      config.value.quick.customSupabaseUrl.trim() ||
      BUILTIN_QUICK_SYNC_CONFIG.supabaseUrl.trim()
    )
      .replace(/\/+$/, '')
      .replace(/\/rest\/v1$/i, '');
  });

  const effectiveSupabaseAnonKey = computed(() => {
    return (
      config.value.quick.customSupabaseAnonKey.trim() ||
      BUILTIN_QUICK_SYNC_CONFIG.supabaseAnonKey.trim()
    );
  });

  const hasQuickSyncEndpoint = computed(() => {
    return Boolean(effectiveSupabaseUrl.value && effectiveSupabaseAnonKey.value);
  });

  const isBuiltinQuickSyncReady = computed(() => hasBuiltinQuickSync());

  const isQuickSyncConfigured = computed(() => {
    return (
      hasQuickSyncEndpoint.value && validateSyncCode(config.value.quick.syncCode).valid
    );
  });

  const isWebdavConfigured = computed(() => {
    const w = config.value.webdav;
    return Boolean(w.serverUrl.trim() && w.username.trim() && w.password.trim());
  });

  const isGithubConfigured = computed(() => {
    return Boolean(config.value.github.token.trim());
  });

  const isConfigured = computed(() => {
    if (config.value.provider === 'quick') return isQuickSyncConfigured.value;
    if (config.value.provider === 'github') return isGithubConfigured.value;
    return isWebdavConfigured.value;
  });

  const providerDisplayName = computed(() => {
    if (config.value.provider === 'quick') return '同步口令云';
    if (config.value.provider === 'github') return 'GitHub 云';
    return 'WebDAV';
  });

  const saveConfig = (next?: CloudSyncConfig) => {
    if (next) {
      config.value = {
        ...DEFAULT_CONFIG,
        ...next,
        quick: { ...DEFAULT_CONFIG.quick, ...next.quick },
        webdav: { ...DEFAULT_CONFIG.webdav, ...next.webdav },
        github: { ...DEFAULT_CONFIG.github, ...next.github }
      };
    }
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config.value));
    } catch {
      // ignore
    }
  };

  const saveMeta = (
    msg: string,
    providerLabel: string,
    baseline?: { revision?: number; remoteUpdatedAt?: number; localDigest?: string }
  ) => {
    lastSyncAt.value = Date.now();
    lastSyncMsg.value = msg;
    lastSyncProvider.value = providerLabel;
    if (baseline) {
      if (typeof baseline.revision === 'number') {
        lastSyncedRevision.value = baseline.revision;
      }
      if (typeof baseline.remoteUpdatedAt === 'number' && baseline.remoteUpdatedAt > 0) {
        lastRemoteUpdatedAt.value = baseline.remoteUpdatedAt;
      }
      if (typeof baseline.localDigest === 'string') {
        lastSyncedLocalDigest.value = baseline.localDigest;
      }
    }
    try {
      localStorage.setItem(
        META_STORAGE_KEY,
        JSON.stringify({
          lastSyncAt: lastSyncAt.value,
          lastSyncMsg: lastSyncMsg.value,
          lastSyncProvider: lastSyncProvider.value,
          lastSyncedRevision: lastSyncedRevision.value,
          lastRemoteUpdatedAt: lastRemoteUpdatedAt.value,
          lastSyncedLocalDigest: lastSyncedLocalDigest.value
        })
      );
    } catch {
      // ignore
    }
  };

  /**
   * 打包本地所有个人数据快照（含单调递增 revision 与 clientUpdatedAt）
   */
  const buildLocalSnapshot = async (maxSongsOverride?: number): Promise<CloudSyncSnapshot> => {
    const playHistoryStore = usePlayHistoryStore();
    const favoriteStore = useFavoriteStore();
    const listeningStatsStore = useListeningStatsStore();
    const settingsStore = useSettingsStore();

    if (config.value.syncListeningStats) {
      await listeningStatsStore.refreshStats();
    }

    const now = Date.now();
    const prefData: Record<string, any> = {};
    for (const key of SYNCABLE_PREF_KEYS) {
      if (settingsStore.setData && settingsStore.setData[key] !== undefined) {
        prefData[key] = structuredCloneCompat(settingsStore.setData[key]);
      }
    }

    const snapshot: CloudSyncSnapshot = {
      schema: 'xiaopang-music-sync-v1',
      revision: Math.max(0, lastSyncedRevision.value),
      clientUpdatedAt: now,
      updatedAt: now,
      deviceId: currentDeviceId,
      deviceName: detectDeviceName(),
      customPlaylists: loadLocalCustomPlaylists(),
      preferences: {
        updatedAt: now,
        data: prefData
      }
    };

    if (config.value.syncHistory) {
      const compact = playHistoryStore.getCompactSnapshot();
      if (maxSongsOverride && compact.musicHistory.length > maxSongsOverride) {
        compact.musicHistory = compact.musicHistory.slice(0, maxSongsOverride);
      }
      snapshot.playHistory = compact;
    }
    if (config.value.syncFavorites) {
      snapshot.favoriteList = [...favoriteStore.favoriteList];
      snapshot.dislikeList = [...favoriteStore.dislikeList];
    }
    if (config.value.syncListeningStats) {
      snapshot.listeningStats = structuredCloneCompat(listeningStatsStore.stats);
    }

    return snapshot;
  };

  /**
   * 将远端/合并快照应用到本地各 Store 与配置项
   */
  const applyRemoteSnapshot = async (
    remote: Partial<CloudSyncSnapshot> | null,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ songsCount: number; favoritesCount: number; totalSeconds: number }> => {
    const playHistoryStore = usePlayHistoryStore();
    const favoriteStore = useFavoriteStore();
    const listeningStatsStore = useListeningStatsStore();
    const settingsStore = useSettingsStore();

    if (remote && typeof remote === 'object') {
      if (config.value.syncHistory && remote.playHistory) {
        playHistoryStore.mergeRemoteHistory(remote.playHistory, mode);
      }
      if (config.value.syncFavorites && (remote.favoriteList || remote.dislikeList)) {
        favoriteStore.mergeRemoteFavorites(remote.favoriteList, remote.dislikeList, mode);
      }
      if (Array.isArray(remote.customPlaylists)) {
        saveLocalCustomPlaylists(remote.customPlaylists);
      }
      if (config.value.syncListeningStats && remote.listeningStats) {
        await listeningStatsStore.mergeRemoteStats(remote.listeningStats);
      }
      if (remote.preferences?.data && typeof remote.preferences.data === 'object') {
        const nextPrefs: Record<string, any> = {};
        for (const key of SYNCABLE_PREF_KEYS) {
          if (remote.preferences.data[key] !== undefined) {
            nextPrefs[key] = structuredCloneCompat(remote.preferences.data[key]);
          }
        }
        if (Object.keys(nextPrefs).length > 0) {
          settingsStore.setSetData(nextPrefs);
        }
      }
    }

    if (config.value.syncListeningStats && (!remote || !remote.listeningStats)) {
      await listeningStatsStore.refreshStats();
    }

    return {
      songsCount: playHistoryStore.musicHistory.length,
      favoritesCount: favoriteStore.favoriteList.length,
      totalSeconds: listeningStatsStore.stats.totalSeconds
    };
  };

  const buildSnapshotSummary = (snap: Partial<CloudSyncSnapshot>, fallbackUpdatedAt = 0) => ({
    revision: Math.max(0, Number(snap.revision) || 0),
    updatedAt: Number(snap.clientUpdatedAt || snap.updatedAt || fallbackUpdatedAt) || 0,
    deviceName: snap.deviceName || '其他设备',
    songsCount: snap.playHistory?.musicHistory?.length || 0,
    favoritesCount: snap.favoriteList?.length || 0,
    playlistsCount: snap.customPlaylists?.length || 0
  });

  type SyncDecision =
    | { status: 'conflict' }
    | {
        status: 'use-remote-done';
        counts: { songsCount: number; favoritesCount: number; totalSeconds: number };
        revision: number;
        remoteUpdatedAt: number;
        localDigest: string;
      }
    | {
        status: 'upload';
        snapshotToUpload: CloudSyncSnapshot;
        counts: { songsCount: number; favoritesCount: number; totalSeconds: number };
      };

  /**
   * 统一执行版本冲突检测与合并决策（三端协议共用）
   */
  const evaluateAndPrepareSyncWrite = async (
    provider: SyncProvider,
    remoteSnapshot: CloudSyncSnapshot | null,
    remoteUpdatedAt: number,
    silent: boolean,
    strategy?: ConflictResolutionStrategy
  ): Promise<SyncDecision> => {
    const localSnapshot = await buildLocalSnapshot();

    if (remoteSnapshot && !strategy) {
      const detection = detectSyncConflict({
        localSnapshot,
        remoteSnapshot,
        remoteUpdatedAt,
        lastRemoteUpdatedAt: lastRemoteUpdatedAt.value,
        lastSyncedRevision: lastSyncedRevision.value,
        lastSyncedLocalDigest: lastSyncedLocalDigest.value,
        currentDeviceId
      });

      if (detection.hasConflict && !silent) {
        pendingConflict.value = {
          provider,
          localSnapshot,
          remoteSnapshot,
          remoteUpdatedAt,
          reason: detection.reason,
          localSummary: buildSnapshotSummary(localSnapshot, localSnapshot.clientUpdatedAt),
          remoteSummary: buildSnapshotSummary(remoteSnapshot, remoteUpdatedAt)
        };
        return { status: 'conflict' };
      }
    }

    if (strategy === 'use-remote' && remoteSnapshot) {
      const counts = await applyRemoteSnapshot(remoteSnapshot, 'replace');
      const alignedLocal = await buildLocalSnapshot();
      return {
        status: 'use-remote-done',
        counts,
        revision: Math.max(Number(remoteSnapshot.revision) || 0, 1),
        remoteUpdatedAt: remoteUpdatedAt || remoteSnapshot.clientUpdatedAt || remoteSnapshot.updatedAt || Date.now(),
        localDigest: computeSyncSnapshotDigest(alignedLocal)
      };
    }

    if (strategy === 'overwrite-remote') {
      const now = Date.now();
      const nextRev = Math.max(localSnapshot.revision, Number(remoteSnapshot?.revision) || 0) + 1;
      const snapshotToUpload: CloudSyncSnapshot = {
        ...localSnapshot,
        revision: nextRev,
        clientUpdatedAt: now,
        updatedAt: now
      };
      const counts = {
        songsCount: localSnapshot.playHistory?.musicHistory?.length || 0,
        favoritesCount: localSnapshot.favoriteList?.length || 0,
        totalSeconds: localSnapshot.listeningStats?.totalSeconds || 0
      };
      return { status: 'upload', snapshotToUpload, counts };
    }

    // 默认或用户选择「智能合并（推荐）」：按 ID 去重并集 + 较新配置保留 + revision 递增
    const mergedSnapshot = smartMergeCloudSnapshots(localSnapshot, remoteSnapshot);
    const counts = await applyRemoteSnapshot(mergedSnapshot, 'replace');
    return { status: 'upload', snapshotToUpload: mergedSnapshot, counts };
  };

  // ==================== 方案 1：专属同步口令（Supabase 端到端加密云同步） ====================

  const getSupabaseHeaders = () => {
    const key = effectiveSupabaseAnonKey.value;
    const headers: Record<string, string> = {
      apikey: key,
      'Content-Type': 'application/json; charset=utf-8'
    };
    // 兼容传统 JWT anon key 与新版 sb_publishable_ key
    if (key.startsWith('eyJ')) {
      headers.Authorization = `Bearer ${key}`;
    }
    return headers;
  };

  const testQuickSyncConnection = async (): Promise<CloudSyncResult> => {
    if (!hasQuickSyncEndpoint.value) {
      return {
        ok: false,
        message: '尚未配置同步口令云服务地址（请在下方折叠栏填入 Supabase URL 和公开 Key）'
      };
    }
    testing.value = true;
    try {
      const resp = await nativeAwareRequest({
        url: `${effectiveSupabaseUrl.value}/rest/v1/rpc/ping_sync`,
        method: 'POST',
        headers: getSupabaseHeaders(),
        body: '{}',
        timeout: 15000
      });
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        return { ok: true, message: '云同步服务器连接正常！' };
      }
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        return { ok: false, message: 'Supabase Key 校验失败（401/403），请确认填写了 anon/publishable key' };
      }
      if (resp.statusCode === 404) {
        return { ok: false, message: '未找到同步接口，请确认已在 Supabase SQL Editor 中执行了 schema.sql' };
      }
      return { ok: false, message: `云端连接异常（HTTP ${resp.statusCode}）` };
    } catch (err: any) {
      return { ok: false, message: `连接云同步服务失败：${err?.message || '网络异常'}` };
    } finally {
      testing.value = false;
    }
  };

  const syncQuickCode = async (
    silent = false,
    strategy?: ConflictResolutionStrategy
  ): Promise<CloudSyncResult> => {
    if (!hasQuickSyncEndpoint.value) {
      return {
        ok: false,
        message: '同步口令服务尚未初始化，请先完成 Supabase 配置或使用离线迁移 / WebDAV'
      };
    }
    const rawCode = config.value.quick.syncCode;
    const check = validateSyncCode(rawCode);
    if (!check.valid) {
      return { ok: false, message: check.reason || '同步口令格式不正确' };
    }

    const normalizedCode = normalizeSyncCode(rawCode);
    if (config.value.quick.syncCode !== normalizedCode) {
      config.value.quick.syncCode = normalizedCode;
      saveConfig();
    }

    const syncId = await deriveSyncId(normalizedCode);
    const headers = getSupabaseHeaders();
    const baseUrl = effectiveSupabaseUrl.value;

    // 1. 拉取远端密文与服务端 updated_at
    const getRes = await nativeAwareRequest({
      url: `${baseUrl}/rest/v1/rpc/get_sync_blob`,
      method: 'POST',
      headers,
      body: JSON.stringify({ p_sync_id: syncId }),
      timeout: 20000
    });

    if (getRes.statusCode < 200 || getRes.statusCode >= 300) {
      if (getRes.statusCode === 401 || getRes.statusCode === 403) {
        return { ok: false, message: '云同步鉴权失败，请检查 Supabase Key 配置' };
      }
      return { ok: false, message: `读取云端记录失败（HTTP ${getRes.statusCode}）` };
    }

    const getBody = parseJsonBody(getRes.body);
    let remoteSnapshot: CloudSyncSnapshot | null = null;

    if (getBody?.found && typeof getBody.payload === 'string' && getBody.payload.trim()) {
      try {
        const plainJson = await decryptSyncPayload(getBody.payload, normalizedCode);
        const parsed = JSON.parse(plainJson);
        if (parsed && typeof parsed === 'object') {
          remoteSnapshot = parsed as CloudSyncSnapshot;
        }
      } catch (err: any) {
        return {
          ok: false,
          message: `云端数据解密失败：${err?.message || '请确认同步口令是否完整准确'}`
        };
      }
    }

    const remoteUpdatedAt =
      Number(getBody?.updated_at) ||
      Number(remoteSnapshot?.clientUpdatedAt) ||
      Number(remoteSnapshot?.updatedAt) ||
      0;

    // 2. 冲突检测与合并决策（多端并发更新时弹出三选一）
    const decision = await evaluateAndPrepareSyncWrite(
      'quick',
      remoteSnapshot,
      remoteUpdatedAt,
      silent,
      strategy
    );

    if (decision.status === 'conflict') {
      return {
        ok: false,
        conflict: true,
        syncCode: normalizedCode,
        message: '检测到云端与本机存在并发修改，请在弹窗中选择合并策略'
      };
    }

    if (decision.status === 'use-remote-done') {
      const msg = `已以云端版本为准恢复（历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
      saveMeta(msg, '同步口令云', {
        revision: decision.revision,
        remoteUpdatedAt: decision.remoteUpdatedAt,
        localDigest: decision.localDigest
      });
      return {
        ok: true,
        message: msg,
        syncCode: normalizedCode,
        ...decision.counts
      };
    }

    // 3. 端到端加密并回传最新快照（如超 480KB 自动按条数精简历史以适配 512KB 上限，保持 revision 不变）
    let snapshotToUpload: CloudSyncSnapshot = decision.snapshotToUpload;
    let encryptedEnvelope = await encryptSyncPayload(
      JSON.stringify(snapshotToUpload),
      normalizedCode
    );
    for (const limit of [260, 120]) {
      if (new TextEncoder().encode(encryptedEnvelope).length <= QUICK_MAX_PAYLOAD_BYTES) {
        break;
      }
      if (snapshotToUpload.playHistory?.musicHistory) {
        snapshotToUpload = {
          ...snapshotToUpload,
          playHistory: {
            ...snapshotToUpload.playHistory,
            musicHistory: snapshotToUpload.playHistory.musicHistory.slice(0, limit)
          }
        };
        encryptedEnvelope = await encryptSyncPayload(
          JSON.stringify(snapshotToUpload),
          normalizedCode
        );
      }
    }

    const putRes = await nativeAwareRequest({
      url: `${baseUrl}/rest/v1/rpc/put_sync_blob`,
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_sync_id: syncId,
        p_payload: encryptedEnvelope
      }),
      timeout: 25000
    });

    if (putRes.statusCode < 200 || putRes.statusCode >= 300) {
      return { ok: false, message: `上传云端失败（HTTP ${putRes.statusCode}）` };
    }

    const putBody = parseJsonBody(putRes.body);
    if (putBody && putBody.ok === false) {
      return { ok: false, message: `云端写入被拒绝（${putBody.error || '未知错误'}）` };
    }

    const syncedLocalDigest = computeSyncSnapshotDigest(await buildLocalSnapshot());
    const uploadedRemoteAt =
      Number(putBody?.updated_at) || snapshotToUpload.clientUpdatedAt || Date.now();
    const actionTip =
      strategy === 'overwrite-remote'
        ? '已以本机版本覆盖云端'
        : remoteSnapshot
          ? '云端智能合并成功'
          : '已安全备份到云端';
    const msg = `${actionTip}（v${snapshotToUpload.revision} · 历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
    saveMeta(msg, '同步口令云', {
      revision: snapshotToUpload.revision,
      remoteUpdatedAt: uploadedRemoteAt,
      localDigest: syncedLocalDigest
    });
    return {
      ok: true,
      message: msg,
      syncCode: normalizedCode,
      ...decision.counts
    };
  };

  /**
   * 面向普通用户的一键开启/恢复同步口令入口
   */
  const enableQuickSyncWithCode = async (rawCode?: string): Promise<CloudSyncResult> => {
    const code = rawCode?.trim() ? normalizeSyncCode(rawCode) : generateFriendlySyncCode();
    const check = validateSyncCode(code);
    if (!check.valid) {
      return { ok: false, message: check.reason || '同步口令至少需要 10 位字符' };
    }
    const codeChanged = config.value.quick.syncCode !== code;
    config.value.provider = 'quick';
    config.value.quick.syncCode = code;
    saveConfig();

    if (codeChanged) {
      lastSyncedRevision.value = 0;
      lastRemoteUpdatedAt.value = 0;
      lastSyncedLocalDigest.value = '';
      pendingConflict.value = null;
    }

    const res = await syncNow(false);
    return { ...res, syncCode: code };
  };

  const disconnectQuickSync = () => {
    config.value.quick.syncCode = '';
    lastSyncedRevision.value = 0;
    lastRemoteUpdatedAt.value = 0;
    lastSyncedLocalDigest.value = '';
    pendingConflict.value = null;
    saveConfig();
  };

  // ==================== 极客方案 A：WebDAV ====================

  const getWebdavAuthHeaders = () => {
    const { username, password } = config.value.webdav;
    return {
      Authorization: `Basic ${toBase64Utf8(`${username.trim()}:${password.trim()}`)}`
    };
  };

  const testWebdavConnection = async (): Promise<CloudSyncResult> => {
    const w = config.value.webdav;
    if (!w.serverUrl.trim() || !w.username.trim() || !w.password.trim()) {
      return { ok: false, message: '请先填写 WebDAV 服务器地址、账号和应用密码' };
    }
    testing.value = true;
    try {
      const { base } = normalizeWebdavUrls(w);
      const resp = await nativeAwareRequest({
        url: `${base}/`,
        method: 'PROPFIND',
        headers: {
          ...getWebdavAuthHeaders(),
          Depth: '0',
          'Content-Type': 'application/xml; charset=utf-8'
        },
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
        timeout: 15000
      });

      if ([200, 204, 207, 301, 302, 405].includes(resp.statusCode)) {
        return { ok: true, message: 'WebDAV 连接成功！账号密码验证通过' };
      }
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        return {
          ok: false,
          message: '认证失败（401/403），请确认填写的是「应用密码」而非网页登录密码'
        };
      }
      return { ok: false, message: `连接返回状态码 ${resp.statusCode}，请检查服务器地址` };
    } catch (err: any) {
      const errMsg = String(err?.message || err || '');
      if (!isAndroid() && /Failed to fetch|NetworkError|CORS|Load failed/i.test(errMsg)) {
        return {
          ok: false,
          message:
            '网页版受浏览器跨域限制无法直连此 WebDAV，建议使用顶部的「一键同步口令」或在手机客户端内使用'
        };
      }
      return { ok: false, message: `连接失败：${errMsg || '网络异常'}` };
    } finally {
      testing.value = false;
    }
  };

  const syncWebdav = async (
    silent = false,
    strategy?: ConflictResolutionStrategy
  ): Promise<CloudSyncResult> => {
    const w = config.value.webdav;
    if (!isWebdavConfigured.value) {
      return { ok: false, message: '请先填写完整的 WebDAV 配置' };
    }
    const authHeaders = getWebdavAuthHeaders();
    const { base, cleanFolder, fileUrl } = normalizeWebdavUrls(w);

    if (cleanFolder) {
      const segments = cleanFolder.split('/');
      let cur = base;
      for (const seg of segments) {
        cur = `${cur}/${seg}`;
        const mkRes = await nativeAwareRequest({
          url: cur,
          method: 'MKCOL',
          headers: authHeaders,
          timeout: 12000
        });
        if (mkRes.statusCode === 401 || mkRes.statusCode === 403) {
          return { ok: false, message: 'WebDAV 认证失败（401/403），请检查账号与应用密码' };
        }
      }
    }

    let remoteSnapshot: CloudSyncSnapshot | null = null;
    const getRes = await nativeAwareRequest({
      url: fileUrl,
      method: 'GET',
      headers: {
        ...authHeaders,
        Accept: 'application/json'
      },
      timeout: 20000
    });

    if (getRes.statusCode === 200) {
      const parsed = parseJsonBody(getRes.body);
      if (parsed && typeof parsed === 'object') {
        remoteSnapshot = parsed as CloudSyncSnapshot;
      }
    } else if (getRes.statusCode === 401 || getRes.statusCode === 403) {
      return { ok: false, message: 'WebDAV 认证失败（401/403），请检查账号与应用密码' };
    } else if (getRes.statusCode !== 404) {
      return { ok: false, message: `读取云端文件失败（HTTP ${getRes.statusCode}）` };
    }

    const parsedLastMod = Date.parse(getRes.headers['last-modified'] || '');
    const remoteUpdatedAt =
      (Number.isFinite(parsedLastMod) ? parsedLastMod : 0) ||
      Number(remoteSnapshot?.clientUpdatedAt) ||
      Number(remoteSnapshot?.updatedAt) ||
      0;

    const decision = await evaluateAndPrepareSyncWrite(
      'webdav',
      remoteSnapshot,
      remoteUpdatedAt,
      silent,
      strategy
    );

    if (decision.status === 'conflict') {
      return {
        ok: false,
        conflict: true,
        message: '检测到 WebDAV 云端与本机存在并发修改，请在弹窗中选择合并策略'
      };
    }

    if (decision.status === 'use-remote-done') {
      const msg = `已以 WebDAV 云端版本为准恢复（历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
      saveMeta(msg, 'WebDAV', {
        revision: decision.revision,
        remoteUpdatedAt: decision.remoteUpdatedAt,
        localDigest: decision.localDigest
      });
      return { ok: true, message: msg, ...decision.counts };
    }

    const snapshotToUpload = decision.snapshotToUpload;
    const putRes = await nativeAwareRequest({
      url: fileUrl,
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(snapshotToUpload),
      timeout: 25000
    });

    if (![200, 201, 204].includes(putRes.statusCode)) {
      return { ok: false, message: `上传到 WebDAV 失败（HTTP ${putRes.statusCode}）` };
    }

    const syncedLocalDigest = computeSyncSnapshotDigest(await buildLocalSnapshot());
    const uploadedLastMod = Date.parse(putRes.headers['last-modified'] || '');
    const uploadedRemoteAt =
      (Number.isFinite(uploadedLastMod) ? uploadedLastMod : 0) ||
      snapshotToUpload.clientUpdatedAt ||
      Date.now();
    const msg = `WebDAV 同步完成（v${snapshotToUpload.revision} · 历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
    saveMeta(msg, 'WebDAV', {
      revision: snapshotToUpload.revision,
      remoteUpdatedAt: uploadedRemoteAt,
      localDigest: syncedLocalDigest
    });
    return { ok: true, message: msg, ...decision.counts };
  };

  // ==================== 极客方案 B：GitHub 私有 Gist ====================

  const getGithubHeaders = () => ({
    Authorization: `Bearer ${config.value.github.token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  });

  const testGithubConnection = async (): Promise<CloudSyncResult> => {
    if (!config.value.github.token.trim()) {
      return { ok: false, message: '请先填写 GitHub Personal Access Token（勾选 gist 权限）' };
    }
    testing.value = true;
    try {
      const resp = await nativeAwareRequest({
        url: 'https://api.github.com/user',
        method: 'GET',
        headers: getGithubHeaders(),
        timeout: 15000
      });
      if (resp.statusCode === 200) {
        const user = parseJsonBody(resp.body);
        const login = user?.login || 'GitHub 用户';
        return { ok: true, message: `GitHub 连接成功！当前账号：@${login}` };
      }
      if (resp.statusCode === 401) {
        return { ok: false, message: 'Token 无效或已过期（401），请重新生成' };
      }
      return { ok: false, message: `GitHub 验证失败（HTTP ${resp.statusCode}）` };
    } catch (err: any) {
      return { ok: false, message: `连接 GitHub 失败：${err?.message || '网络异常'}` };
    } finally {
      testing.value = false;
    }
  };

  const syncGithubGist = async (
    silent = false,
    strategy?: ConflictResolutionStrategy
  ): Promise<CloudSyncResult> => {
    if (!isGithubConfigured.value) {
      return { ok: false, message: '请先填写 GitHub Token' };
    }
    const headers = getGithubHeaders();
    let gistId = config.value.github.gistId.trim();
    let gistObj: any = null;

    if (gistId) {
      const res = await nativeAwareRequest({
        url: `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
        method: 'GET',
        headers,
        timeout: 20000
      });
      if (res.statusCode === 200) {
        gistObj = parseJsonBody(res.body);
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        return { ok: false, message: 'GitHub Token 认证失败或缺少 gist 权限' };
      } else if (res.statusCode === 404) {
        gistId = '';
      } else {
        return { ok: false, message: `读取 Gist 失败（HTTP ${res.statusCode}）` };
      }
    }

    if (!gistObj) {
      const listRes = await nativeAwareRequest({
        url: 'https://api.github.com/gists?per_page=30',
        method: 'GET',
        headers,
        timeout: 20000
      });
      if (listRes.statusCode === 401 || listRes.statusCode === 403) {
        return { ok: false, message: 'GitHub Token 认证失败或缺少 gist 权限' };
      }
      if (listRes.statusCode === 200) {
        const list = parseJsonBody(listRes.body);
        if (Array.isArray(list)) {
          const matched = list.find((g: any) => g?.files && g.files[GIST_FILENAME]);
          if (matched?.id) {
            gistId = String(matched.id);
            const detailRes = await nativeAwareRequest({
              url: `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
              method: 'GET',
              headers,
              timeout: 20000
            });
            if (detailRes.statusCode === 200) {
              gistObj = parseJsonBody(detailRes.body);
            }
          }
        }
      }
    }

    let remoteSnapshot: CloudSyncSnapshot | null = null;
    const remoteFile = gistObj?.files?.[GIST_FILENAME];
    if (remoteFile) {
      if (remoteFile.truncated && remoteFile.raw_url) {
        const rawRes = await nativeAwareRequest({
          url: remoteFile.raw_url,
          method: 'GET',
          headers,
          timeout: 25000
        });
        if (rawRes.statusCode === 200) {
          remoteSnapshot = parseJsonBody(rawRes.body);
        }
      } else if (typeof remoteFile.content === 'string') {
        remoteSnapshot = parseJsonBody(remoteFile.content);
      }
    }

    const parsedGistUpdatedAt = Date.parse(gistObj?.updated_at || '');
    const remoteUpdatedAt =
      (Number.isFinite(parsedGistUpdatedAt) ? parsedGistUpdatedAt : 0) ||
      Number(remoteSnapshot?.clientUpdatedAt) ||
      Number(remoteSnapshot?.updatedAt) ||
      0;

    const decision = await evaluateAndPrepareSyncWrite(
      'github',
      remoteSnapshot,
      remoteUpdatedAt,
      silent,
      strategy
    );

    if (decision.status === 'conflict') {
      return {
        ok: false,
        conflict: true,
        message: '检测到 GitHub 云端与本机存在并发修改，请在弹窗中选择合并策略'
      };
    }

    if (decision.status === 'use-remote-done') {
      if (gistId && config.value.github.gistId !== gistId) {
        config.value.github.gistId = gistId;
        saveConfig();
      }
      const msg = `已以 GitHub 云端版本为准恢复（历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
      saveMeta(msg, 'GitHub Gist', {
        revision: decision.revision,
        remoteUpdatedAt: decision.remoteUpdatedAt,
        localDigest: decision.localDigest
      });
      return { ok: true, message: msg, ...decision.counts };
    }

    const snapshotToUpload = decision.snapshotToUpload;
    const contentStr = JSON.stringify(snapshotToUpload);
    let updatedGistResp: any = null;

    if (gistId && gistObj) {
      const patchRes = await nativeAwareRequest({
        url: `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: { content: contentStr }
          }
        }),
        timeout: 25000
      });
      if (patchRes.statusCode !== 200) {
        return { ok: false, message: `更新 GitHub Gist 失败（HTTP ${patchRes.statusCode}）` };
      }
      updatedGistResp = parseJsonBody(patchRes.body);
    } else {
      const createRes = await nativeAwareRequest({
        url: 'https://api.github.com/gists',
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          description: '小庞奶娃音乐 - 个人云端同步（播放历史 / 收藏 / 听歌时长）',
          public: false,
          files: {
            [GIST_FILENAME]: { content: contentStr }
          }
        }),
        timeout: 25000
      });
      if (createRes.statusCode !== 201 && createRes.statusCode !== 200) {
        return { ok: false, message: `创建私有 Gist 失败（HTTP ${createRes.statusCode}）` };
      }
      updatedGistResp = parseJsonBody(createRes.body);
      if (updatedGistResp?.id) {
        gistId = String(updatedGistResp.id);
      }
    }

    if (gistId && config.value.github.gistId !== gistId) {
      config.value.github.gistId = gistId;
      saveConfig();
    }

    const syncedLocalDigest = computeSyncSnapshotDigest(await buildLocalSnapshot());
    const uploadedGistTs = Date.parse(updatedGistResp?.updated_at || '');
    const uploadedRemoteAt =
      (Number.isFinite(uploadedGistTs) ? uploadedGistTs : 0) ||
      snapshotToUpload.clientUpdatedAt ||
      Date.now();
    const msg = `GitHub 私有云同步完成（v${snapshotToUpload.revision} · 历史 ${decision.counts.songsCount} 首 · 喜欢 ${decision.counts.favoritesCount} 首）`;
    saveMeta(msg, 'GitHub Gist', {
      revision: snapshotToUpload.revision,
      remoteUpdatedAt: uploadedRemoteAt,
      localDigest: syncedLocalDigest
    });
    return { ok: true, message: msg, ...decision.counts };
  };

  // ==================== 统一同步入口 & 本地备份 ====================

  const syncNow = async (
    silent = false,
    strategy?: ConflictResolutionStrategy
  ): Promise<CloudSyncResult> => {
    if (syncing.value) {
      return { ok: false, message: '正在同步中，请稍候...' };
    }
    if (!isConfigured.value) {
      return { ok: false, message: '尚未开启云同步，点一下即可生成专属同步口令' };
    }

    syncing.value = true;
    try {
      if (config.value.provider === 'quick') return await syncQuickCode(silent, strategy);
      if (config.value.provider === 'github') return await syncGithubGist(silent, strategy);
      return await syncWebdav(silent, strategy);
    } catch (err: any) {
      const errMsg = String(err?.message || err || '同步异常');
      if (!silent) {
        console.error('[CloudSync] sync failed:', err);
      }
      if (
        !isAndroid() &&
        config.value.provider === 'webdav' &&
        /Failed to fetch|NetworkError|CORS|Load failed/i.test(errMsg)
      ) {
        return {
          ok: false,
          message: '浏览器跨域限制拦截了 WebDAV，建议使用顶部的「一键同步口令」'
        };
      }
      return { ok: false, message: `云同步失败：${errMsg}` };
    } finally {
      syncing.value = false;
    }
  };

  const resolvePendingConflict = async (
    strategy: ConflictResolutionStrategy
  ): Promise<CloudSyncResult> => {
    const conflict = pendingConflict.value;
    pendingConflict.value = null;
    if (conflict && conflict.provider !== config.value.provider) {
      config.value.provider = conflict.provider;
      saveConfig();
    }
    return syncNow(false, strategy);
  };

  const dismissPendingConflict = () => {
    pendingConflict.value = null;
  };

  const testConnection = async (): Promise<CloudSyncResult> => {
    if (config.value.provider === 'quick') return testQuickSyncConnection();
    if (config.value.provider === 'github') return testGithubConnection();
    return testWebdavConnection();
  };

  const exportBackupJsonString = async (): Promise<string> => {
    const snapshot = await buildLocalSnapshot();
    return JSON.stringify(snapshot, null, 2);
  };

  const importBackupJsonString = async (
    rawText: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<CloudSyncResult> => {
    try {
      const parsed = JSON.parse(rawText.trim());
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, message: '无效的备份 JSON 格式' };
      }
      if (!parsed.playHistory && !parsed.favoriteList && !parsed.listeningStats) {
        return { ok: false, message: '内容中未找到播放历史、收藏或听歌统计数据' };
      }
      const counts = await applyRemoteSnapshot(parsed as CloudSyncSnapshot, mode);
      const modeLabel = mode === 'replace' ? '覆盖恢复' : '智能合并';
      const msg = `${modeLabel}成功（历史 ${counts.songsCount} 首 · 喜欢 ${counts.favoritesCount} 首）`;
      saveMeta(msg, '本地备份');
      return { ok: true, message: msg, ...counts };
    } catch (err: any) {
      return { ok: false, message: `解析备份失败：${err?.message || 'JSON 语法错误'}` };
    }
  };

  const runAutoSyncOnLaunch = () => {
    if (!isConfigured.value || !config.value.autoSyncOnLaunch) return;
    window.setTimeout(() => {
      syncNow(true).catch(() => {});
    }, 2800);
  };

  const scheduleAutoSyncAfterPlay = () => {
    if (!isConfigured.value || !config.value.autoSyncOnPlay) return;
    const now = Date.now();
    const cooldownMs = 45000;
    const delay = Math.max(5000, cooldownMs - (now - lastPlaySyncAt));
    if (playSyncTimer !== null) {
      window.clearTimeout(playSyncTimer);
    }
    playSyncTimer = window.setTimeout(() => {
      playSyncTimer = null;
      lastPlaySyncAt = Date.now();
      syncNow(true).catch(() => {});
    }, delay);
  };

  return {
    config,
    lastSyncAt,
    lastSyncMsg,
    lastSyncProvider,
    lastSyncedRevision,
    pendingConflict,
    syncing,
    testing,
    hasQuickSyncEndpoint,
    isBuiltinQuickSyncReady,
    isQuickSyncConfigured,
    isWebdavConfigured,
    isGithubConfigured,
    isConfigured,
    providerDisplayName,
    saveConfig,
    testConnection,
    testQuickSyncConnection,
    enableQuickSyncWithCode,
    disconnectQuickSync,
    syncNow,
    resolvePendingConflict,
    dismissPendingConflict,
    exportBackupJsonString,
    importBackupJsonString,
    runAutoSyncOnLaunch,
    scheduleAutoSyncAfterPlay
  };
});
