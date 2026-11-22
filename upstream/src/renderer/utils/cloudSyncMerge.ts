/**
 * 云同步版本冲突检测与智能合并纯算法模块（零 DOM / 零 Store 依赖，可直接单测）
 * - 支持 revision（单调递增版本）与 clientUpdatedAt
 * - 收藏列表 / 自建歌单 / 播放历史按歌曲 ID 去重并集，避免两台设备同时新增数据互相覆盖丢失
 * - 配置项按较新修改时间戳保留最新一侧
 */

export interface SyncListeningSongStat {
  id: string;
  name: string;
  artist: string;
  cover: string;
  seconds: number;
  plays: number;
}

export interface SyncListeningStatsData {
  totalSeconds: number;
  dailySeconds: Record<string, number>;
  hourlySeconds: number[];
  songs: Record<string, SyncListeningSongStat>;
  artists: Record<string, number>;
}

export interface SyncCustomPlaylist {
  id: string | number;
  name: string;
  tracks: any[];
  updatedAt?: number;
  [key: string]: any;
}

export interface SyncPreferencesBlock {
  updatedAt: number;
  data: Record<string, any>;
}

export interface CloudSyncSnapshot {
  schema: 'xiaopang-music-sync-v1';
  revision: number;
  clientUpdatedAt: number;
  updatedAt: number;
  deviceId?: string;
  deviceName: string;
  playHistory?: {
    musicHistory?: any[];
    playlistHistory?: any[];
    albumHistory?: any[];
    podcastHistory?: any[];
    podcastRadioHistory?: any[];
  };
  favoriteList?: Array<number | string>;
  dislikeList?: Array<number | string>;
  customPlaylists?: SyncCustomPlaylist[];
  listeningStats?: SyncListeningStatsData;
  preferences?: SyncPreferencesBlock;
}

export interface ConflictDetectionInput {
  localSnapshot: CloudSyncSnapshot;
  remoteSnapshot: Partial<CloudSyncSnapshot> | null;
  remoteUpdatedAt: number;
  lastRemoteUpdatedAt: number;
  lastSyncedRevision: number;
  lastSyncedLocalDigest: string;
  currentDeviceId?: string;
}

export interface ConflictDetectionResult {
  hasConflict: boolean;
  remoteChanged: boolean;
  localChanged: boolean;
  localRevision: number;
  remoteRevision: number;
  reason: string;
}

function dedupeIdList(
  primary: Array<number | string> = [],
  secondary: Array<number | string> = []
): Array<number | string> {
  const seen = new Set<string>();
  const out: Array<number | string> = [];
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item === null || item === undefined || item === '') continue;
      const key = String(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
}

function mergeItemListById<T extends Record<string, any>>(
  localList: T[] = [],
  remoteList: T[] = [],
  maxItems = 500
): T[] {
  const map = new Map<string, { item: T; order: number }>();

  const ingest = (list: T[], baseOrder: number) => {
    if (!Array.isArray(list)) return;
    list.forEach((raw, idx) => {
      if (!raw || raw.id === undefined || raw.id === null) return;
      const key = String(raw.id);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { item: { ...raw }, order: baseOrder + idx });
      } else {
        const mergedCount = Math.max(Number(prev.item.count) || 0, Number(raw.count) || 0);
        const prevTime = Number(prev.item.lastPlayTime) || 0;
        const nextTime = Number(raw.lastPlayTime) || 0;
        const mergedTime = Math.max(prevTime, nextTime);
        const newer = nextTime > prevTime ? raw : prev.item;
        const older = nextTime > prevTime ? prev.item : raw;
        map.set(key, {
          item: {
            ...older,
            ...newer,
            ...(newer.picUrl ? {} : older.picUrl ? { picUrl: older.picUrl } : {}),
            count: mergedCount || 1,
            ...(mergedTime > 0 ? { lastPlayTime: mergedTime } : {})
          },
          order: Math.min(prev.order, baseOrder + idx)
        });
      }
    });
  };

  ingest(localList, 0);
  ingest(remoteList, 100000);

  return Array.from(map.values())
    .sort((a, b) => {
      const ta = Number(a.item.lastPlayTime) || 0;
      const tb = Number(b.item.lastPlayTime) || 0;
      if (ta !== tb) return tb - ta;
      return a.order - b.order;
    })
    .slice(0, maxItems)
    .map((entry) => entry.item);
}

/**
 * 合并双方自建歌单：按歌单 ID 合并，同名/同 ID 歌单内曲目按歌曲 ID 去重并集
 */
export function mergeCustomPlaylists(
  localPlaylists: SyncCustomPlaylist[] = [],
  remotePlaylists: SyncCustomPlaylist[] = []
): SyncCustomPlaylist[] {
  const map = new Map<string, SyncCustomPlaylist>();

  const ingest = (list: SyncCustomPlaylist[]) => {
    if (!Array.isArray(list)) return;
    for (const pl of list) {
      if (!pl || pl.id === undefined || pl.id === null) continue;
      const key = String(pl.id);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...pl,
          tracks: mergeItemListById(Array.isArray(pl.tracks) ? pl.tracks : [], [], 1000)
        });
      } else {
        const existingTs = Number(existing.updatedAt) || 0;
        const incomingTs = Number(pl.updatedAt) || 0;
        const newerMeta = incomingTs > existingTs ? pl : existing;
        const mergedTracks = mergeItemListById(
          Array.isArray(existing.tracks) ? existing.tracks : [],
          Array.isArray(pl.tracks) ? pl.tracks : [],
          1000
        );
        map.set(key, {
          ...existing,
          ...newerMeta,
          tracks: mergedTracks,
          updatedAt: Math.max(existingTs, incomingTs) || Date.now()
        });
      }
    }
  };

  ingest(localPlaylists);
  ingest(remotePlaylists);
  return Array.from(map.values());
}

/**
 * 幂等最大值合并听歌统计数据
 */
export function mergeListeningStatsSnapshots(
  local?: SyncListeningStatsData,
  remote?: SyncListeningStatsData
): SyncListeningStatsData | undefined {
  if (!local && !remote) return undefined;
  const a = local || { totalSeconds: 0, dailySeconds: {}, hourlySeconds: Array(24).fill(0), songs: {}, artists: {} };
  const b = remote || { totalSeconds: 0, dailySeconds: {}, hourlySeconds: Array(24).fill(0), songs: {}, artists: {} };

  const dailySeconds: Record<string, number> = {};
  for (const day of new Set([...Object.keys(a.dailySeconds || {}), ...Object.keys(b.dailySeconds || {})])) {
    const val = Math.max(Number(a.dailySeconds?.[day]) || 0, Number(b.dailySeconds?.[day]) || 0);
    if (val > 0) dailySeconds[day] = val;
  }

  const hourlySeconds = Array.from({ length: 24 }, (_, i) =>
    Math.max(Number(a.hourlySeconds?.[i]) || 0, Number(b.hourlySeconds?.[i]) || 0)
  );

  const songs: Record<string, SyncListeningSongStat> = {};
  for (const key of new Set([...Object.keys(a.songs || {}), ...Object.keys(b.songs || {})])) {
    const sa = a.songs?.[key];
    const sb = b.songs?.[key];
    if (sa && sb) {
      songs[key] = {
        id: sa.id || sb.id || key,
        name: sa.name || sb.name || '未知歌曲',
        artist: sa.artist || sb.artist || '',
        cover: sa.cover || sb.cover || '',
        seconds: Math.max(Number(sa.seconds) || 0, Number(sb.seconds) || 0),
        plays: Math.max(Number(sa.plays) || 0, Number(sb.plays) || 0)
      };
    } else if (sa || sb) {
      songs[key] = { ...(sa || sb)! };
    }
  }

  const artists: Record<string, number> = {};
  for (const ar of new Set([...Object.keys(a.artists || {}), ...Object.keys(b.artists || {})])) {
    const val = Math.max(Number(a.artists?.[ar]) || 0, Number(b.artists?.[ar]) || 0);
    if (ar.trim() && val > 0) artists[ar] = val;
  }

  const dailySum = Object.values(dailySeconds).reduce((acc, v) => acc + v, 0);
  const totalSeconds = Math.max(Number(a.totalSeconds) || 0, Number(b.totalSeconds) || 0, dailySum);

  return { totalSeconds, dailySeconds, hourlySeconds, songs, artists };
}

/**
 * 计算快照核心数据指纹（忽略 revision/updatedAt 等易变元信息），用于判断本地是否有未同步改动
 */
export function computeSyncSnapshotDigest(snapshot: Partial<CloudSyncSnapshot> | null | undefined): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const favs = Array.isArray(snapshot.favoriteList)
    ? [...new Set(snapshot.favoriteList.map(String))].sort()
    : [];
  const dislikes = Array.isArray(snapshot.dislikeList)
    ? [...new Set(snapshot.dislikeList.map(String))].sort()
    : [];
  const musicHist = Array.isArray(snapshot.playHistory?.musicHistory)
    ? snapshot.playHistory!.musicHistory.map((s: any) => `${s?.id}:${s?.count || 0}`).sort()
    : [];
  const playlists = Array.isArray(snapshot.customPlaylists)
    ? snapshot.customPlaylists
        .map((p) => `${p.id}:${p.name}:${(p.tracks || []).map((t: any) => String(t?.id)).sort().join(',')}`)
        .sort()
    : [];
  const prefEntries = snapshot.preferences?.data
    ? Object.entries(snapshot.preferences.data)
        .sort(([k1], [k2]) => k1.localeCompare(k2))
    : [];
  const statsTotal = Number(snapshot.listeningStats?.totalSeconds) || 0;
  return JSON.stringify({ favs, dislikes, musicHist, playlists, prefEntries, statsTotal });
}

function hasMeaningfulData(snapshot: Partial<CloudSyncSnapshot> | null | undefined): boolean {
  if (!snapshot) return false;
  if ((snapshot.favoriteList?.length || 0) > 0) return true;
  if ((snapshot.playHistory?.musicHistory?.length || 0) > 0) return true;
  if ((snapshot.customPlaylists?.length || 0) > 0) return true;
  if ((snapshot.listeningStats?.totalSeconds || 0) > 0) return true;
  return false;
}

/**
 * 检测是否发生多端并发更新冲突：
 * 云端自上次同步后已被其他设备更新（updated_at / revision 前进），且本地也存在未同步改动并与云端不一致
 */
export function detectSyncConflict(input: ConflictDetectionInput): ConflictDetectionResult {
  const localRevision = Math.max(0, Number(input.localSnapshot.revision) || 0);
  const remoteRevision = Math.max(0, Number(input.remoteSnapshot?.revision) || 0);

  if (!input.remoteSnapshot) {
    return {
      hasConflict: false,
      remoteChanged: false,
      localChanged: true,
      localRevision,
      remoteRevision: 0,
      reason: 'no-remote'
    };
  }

  const localDigest = computeSyncSnapshotDigest(input.localSnapshot);
  const remoteDigest = computeSyncSnapshotDigest(input.remoteSnapshot);

  if (localDigest === remoteDigest) {
    return {
      hasConflict: false,
      remoteChanged: false,
      localChanged: false,
      localRevision,
      remoteRevision,
      reason: 'already-identical'
    };
  }

  const isDifferentDevice =
    Boolean(input.currentDeviceId && input.remoteSnapshot.deviceId) &&
    input.remoteSnapshot.deviceId !== input.currentDeviceId;

  const hasBaseline = input.lastRemoteUpdatedAt > 0 || input.lastSyncedRevision > 0;

  const remoteChanged = hasBaseline
    ? (input.remoteUpdatedAt > input.lastRemoteUpdatedAt && input.lastRemoteUpdatedAt > 0) ||
      (remoteRevision > input.lastSyncedRevision && input.lastSyncedRevision > 0)
    : hasMeaningfulData(input.remoteSnapshot);

  const localChanged = hasBaseline
    ? Boolean(input.lastSyncedLocalDigest) && localDigest !== input.lastSyncedLocalDigest
    : hasMeaningfulData(input.localSnapshot);

  // 若两台设备同时都有变更（或首次关联两端皆有不同非空数据），触发三选一冲突对话框
  const hasConflict = remoteChanged && localChanged && (isDifferentDevice || !hasBaseline || remoteRevision > input.lastSyncedRevision || input.remoteUpdatedAt > input.lastRemoteUpdatedAt);

  return {
    hasConflict,
    remoteChanged,
    localChanged,
    localRevision,
    remoteRevision,
    reason: hasConflict
      ? hasBaseline
        ? 'concurrent-modification'
        : 'initial-two-sided-divergence'
      : remoteChanged
        ? 'remote-only-updated'
        : 'local-only-updated'
  };
}

/**
 * 智能合并本地与云端快照：
 * - favoriteList / dislikeList：按歌曲 ID 去重并集
 * - customPlaylists：按歌单 ID 与歌曲 ID 去重并集
 * - playHistory：按条目 ID 去重并集，保留更高播放次数与更新时间戳
 * - listeningStats：幂等最大值合并
 * - preferences：比较修改时间戳，保留较新修改时间的一侧配置
 * - revision：单调递增 max(local.revision, remote.revision) + 1
 */
export function smartMergeCloudSnapshots(
  local: CloudSyncSnapshot,
  remote: Partial<CloudSyncSnapshot> | null | undefined,
  nowMs: number = Date.now()
): CloudSyncSnapshot {
  if (!remote || typeof remote !== 'object') {
    return {
      ...local,
      revision: Math.max(1, (Number(local.revision) || 0) + 1),
      clientUpdatedAt: nowMs,
      updatedAt: nowMs
    };
  }

  const nextRevision = Math.max(Number(local.revision) || 0, Number(remote.revision) || 0) + 1;

  const mergedHistory = {
    musicHistory: mergeItemListById(
      local.playHistory?.musicHistory || [],
      remote.playHistory?.musicHistory || [],
      500
    ),
    playlistHistory: mergeItemListById(
      local.playHistory?.playlistHistory || [],
      remote.playHistory?.playlistHistory || [],
      200
    ),
    albumHistory: mergeItemListById(
      local.playHistory?.albumHistory || [],
      remote.playHistory?.albumHistory || [],
      200
    ),
    podcastHistory: mergeItemListById(
      local.playHistory?.podcastHistory || [],
      remote.playHistory?.podcastHistory || [],
      200
    ),
    podcastRadioHistory: mergeItemListById(
      local.playHistory?.podcastRadioHistory || [],
      remote.playHistory?.podcastRadioHistory || [],
      200
    )
  };

  const localPrefTs = Number(local.preferences?.updatedAt) || Number(local.clientUpdatedAt) || Number(local.updatedAt) || 0;
  const remotePrefTs = Number(remote.preferences?.updatedAt) || Number(remote.clientUpdatedAt) || Number(remote.updatedAt) || 0;

  let mergedPreferences: SyncPreferencesBlock | undefined;
  if (local.preferences && remote.preferences) {
    mergedPreferences =
      remotePrefTs > localPrefTs
        ? {
            updatedAt: remotePrefTs,
            data: { ...local.preferences.data, ...remote.preferences.data }
          }
        : {
            updatedAt: localPrefTs,
            data: { ...remote.preferences.data, ...local.preferences.data }
          };
  } else if (local.preferences) {
    mergedPreferences = { ...local.preferences, data: { ...local.preferences.data } };
  } else if (remote.preferences) {
    mergedPreferences = { ...remote.preferences, data: { ...remote.preferences.data } };
  }

  return {
    schema: 'xiaopang-music-sync-v1',
    revision: nextRevision,
    clientUpdatedAt: nowMs,
    updatedAt: nowMs,
    deviceId: local.deviceId,
    deviceName: local.deviceName,
    playHistory: mergedHistory,
    favoriteList: dedupeIdList(local.favoriteList || [], remote.favoriteList || []),
    dislikeList: dedupeIdList(local.dislikeList || [], remote.dislikeList || []),
    customPlaylists: mergeCustomPlaylists(local.customPlaylists || [], remote.customPlaylists || []),
    listeningStats: mergeListeningStatsSnapshots(local.listeningStats, remote.listeningStats),
    ...(mergedPreferences ? { preferences: mergedPreferences } : {})
  };
}

export interface SyncConflictDiffPreview {
  localOnlyFavorites: number;
  remoteOnlyFavorites: number;
  localOnlyHistory: number;
  remoteOnlyHistory: number;
  localAddedTotal: number;
  remoteAddedTotal: number;
}

function collectSnapshotSongIdSet(snapshot?: Partial<CloudSyncSnapshot> | null): Set<string> {
  const ids = new Set<string>();
  if (!snapshot) return ids;
  for (const fav of snapshot.favoriteList || []) {
    if (fav !== null && fav !== undefined && fav !== '') ids.add(String(fav));
  }
  for (const song of snapshot.playHistory?.musicHistory || []) {
    if (song?.id !== null && song?.id !== undefined && song?.id !== '') ids.add(String(song.id));
  }
  for (const pl of snapshot.customPlaylists || []) {
    for (const track of pl?.tracks || []) {
      if (track?.id !== null && track?.id !== undefined && track?.id !== '') {
        ids.add(String(track.id));
      }
    }
  }
  return ids;
}

/**
 * 计算冲突弹窗差异预览：「本机新增 X 首 / 云端新增 Y 首」
 */
export function computeSyncConflictDiff(
  local: Partial<CloudSyncSnapshot> | null | undefined,
  remote: Partial<CloudSyncSnapshot> | null | undefined
): SyncConflictDiffPreview {
  const localFavSet = new Set((local?.favoriteList || []).map(String));
  const remoteFavSet = new Set((remote?.favoriteList || []).map(String));
  let localOnlyFavorites = 0;
  let remoteOnlyFavorites = 0;
  for (const id of localFavSet) {
    if (!remoteFavSet.has(id)) localOnlyFavorites++;
  }
  for (const id of remoteFavSet) {
    if (!localFavSet.has(id)) remoteOnlyFavorites++;
  }

  const localHistSet = new Set((local?.playHistory?.musicHistory || []).map((s: any) => String(s?.id)));
  const remoteHistSet = new Set((remote?.playHistory?.musicHistory || []).map((s: any) => String(s?.id)));
  let localOnlyHistory = 0;
  let remoteOnlyHistory = 0;
  for (const id of localHistSet) {
    if (id && !remoteHistSet.has(id)) localOnlyHistory++;
  }
  for (const id of remoteHistSet) {
    if (id && !localHistSet.has(id)) remoteOnlyHistory++;
  }

  const localAll = collectSnapshotSongIdSet(local);
  const remoteAll = collectSnapshotSongIdSet(remote);
  let localAddedTotal = 0;
  let remoteAddedTotal = 0;
  for (const id of localAll) {
    if (!remoteAll.has(id)) localAddedTotal++;
  }
  for (const id of remoteAll) {
    if (!localAll.has(id)) remoteAddedTotal++;
  }

  return {
    localOnlyFavorites,
    remoteOnlyFavorites,
    localOnlyHistory,
    remoteOnlyHistory,
    localAddedTotal,
    remoteAddedTotal
  };
}

export type LocalBackupReason =
  | 'before-merge'
  | 'before-use-remote'
  | 'before-overwrite'
  | 'before-import'
  | 'before-rollback';

export interface LocalSyncBackupRecord {
  id: string;
  createdAt: number;
  reason: LocalBackupReason;
  revision: number;
  deviceName: string;
  favoritesCount: number;
  songsCount: number;
  snapshot: CloudSyncSnapshot;
}

/**
 * 仅保留最近 maxCount（默认 5）份本地快照，按时间倒序排列
 */
export function pruneBackupSnapshots(
  records: LocalSyncBackupRecord[],
  maxCount = 5
): LocalSyncBackupRecord[] {
  const limit = Math.max(1, Math.min(10, Math.floor(maxCount)));
  return [...records]
    .filter((r) => r && r.id && r.snapshot)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, limit);
}
