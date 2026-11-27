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

/**
 * 格式化上次同步的轻量相对时间文案（如「刚刚 / 15 分钟前 / 2 小时前」，从未同步返回「尚未同步」）
 */
export function formatRelativeSyncTime(
  ts: number | null | undefined,
  nowMs: number = Date.now()
): string {
  const numericTs = Number(ts);
  if (!Number.isFinite(numericTs) || numericTs <= 0) {
    return '尚未同步';
  }
  const safeNow = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
  const diffSec = Math.max(0, Math.floor((safeNow - numericTs) / 1000));
  if (diffSec < 60) {
    return '刚刚';
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)} 分钟前`;
  }
  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)} 小时前`;
  }
  if (diffSec < 86400 * 30) {
    return `${Math.floor(diffSec / 86400)} 天前`;
  }
  const date = new Date(numericTs);
  const nowDate = new Date(safeNow);
  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface SyncMergeDiffEntry {
  id: string;
  title: string;
  subtitle: string;
  source: 'local' | 'remote' | 'both';
  kind: 'favorite' | 'history' | 'playlist';
}

export interface SyncMergePreview {
  hasRemote: boolean;
  hasChanges: boolean;
  localOnlyFavorites: number;
  remoteOnlyFavorites: number;
  addedFavorites: number;
  localOnlyHistory: number;
  remoteOnlyHistory: number;
  addedHistory: number;
  localOnlyPlaylists: number;
  remoteOnlyPlaylists: number;
  updatedPlaylists: number;
  addedPlaylists: number;
  summaryText: string;
  diffItems: {
    favorites: SyncMergeDiffEntry[];
    history: SyncMergeDiffEntry[];
    playlists: SyncMergeDiffEntry[];
  };
}

function formatSongArtistLabel(song: any): string {
  if (!song || typeof song !== 'object') return '';
  if (Array.isArray(song.ar) && song.ar.length > 0) {
    return song.ar
      .map((a: any) => a?.name)
      .filter(Boolean)
      .join(' / ');
  }
  if (typeof song.artist === 'string') return song.artist;
  return '';
}

function buildSongTitleLookup(
  local?: Partial<CloudSyncSnapshot> | null,
  remote?: Partial<CloudSyncSnapshot> | null
): Map<string, { name: string; artist: string }> {
  const map = new Map<string, { name: string; artist: string }>();
  const registerSong = (song: any) => {
    if (!song || song.id === undefined || song.id === null || song.id === '') return;
    const id = String(song.id);
    const name = String(song.name || '').trim();
    if (!name || map.has(id)) return;
    map.set(id, { name, artist: formatSongArtistLabel(song) });
  };
  for (const snap of [local, remote]) {
    if (!snap) continue;
    for (const s of snap.playHistory?.musicHistory || []) registerSong(s);
    for (const pl of snap.customPlaylists || []) {
      for (const t of pl?.tracks || []) registerSong(t);
    }
    if (snap.listeningStats?.songs) {
      for (const [key, stat] of Object.entries(snap.listeningStats.songs)) {
        const id = String(stat?.id || key || '').trim();
        const name = String(stat?.name || '').trim();
        if (id && name && !map.has(id)) {
          map.set(id, { name, artist: String(stat?.artist || '') });
        }
      }
    }
  }
  return map;
}

/**
 * 同步前计算本地与云端变更预览：
 * 返回预计合并的收藏/历史/歌单数量、人类可读摘要以及可展开差异列表
 */
export function computeSyncMergePreview(
  local: Partial<CloudSyncSnapshot> | null | undefined,
  remote: Partial<CloudSyncSnapshot> | null | undefined
): SyncMergePreview {
  const hasRemote = Boolean(remote && typeof remote === 'object');
  const songLookup = buildSongTitleLookup(local, remote);

  const normalizeIds = (arr?: Array<number | string>): string[] => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      if (raw === null || raw === undefined || raw === '') continue;
      const id = String(raw);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };

  const localFavIds = normalizeIds(local?.favoriteList);
  const remoteFavIds = normalizeIds(remote?.favoriteList);
  const localFavSet = new Set(localFavIds);
  const remoteFavSet = new Set(remoteFavIds);

  const favoriteDiffs: SyncMergeDiffEntry[] = [];
  let localOnlyFavorites = 0;
  let remoteOnlyFavorites = 0;

  for (const id of remoteFavIds) {
    if (!localFavSet.has(id)) {
      remoteOnlyFavorites++;
      if (favoriteDiffs.length < 30) {
        const meta = songLookup.get(id);
        favoriteDiffs.push({
          id,
          title: meta?.name || `歌曲 #${id}`,
          subtitle: meta?.artist ? `${meta.artist} · 云端新增收藏` : '云端新增收藏',
          source: 'remote',
          kind: 'favorite'
        });
      }
    }
  }
  for (const id of localFavIds) {
    if (!remoteFavSet.has(id)) {
      localOnlyFavorites++;
      if (favoriteDiffs.length < 30) {
        const meta = songLookup.get(id);
        favoriteDiffs.push({
          id,
          title: meta?.name || `歌曲 #${id}`,
          subtitle: meta?.artist ? `${meta.artist} · 本机新增收藏` : '本机新增收藏',
          source: 'local',
          kind: 'favorite'
        });
      }
    }
  }

  const indexSongs = (list: any[] = []): Map<string, any> => {
    const m = new Map<string, any>();
    if (!Array.isArray(list)) return m;
    for (const s of list) {
      if (!s || s.id === undefined || s.id === null || s.id === '') continue;
      const id = String(s.id);
      if (!m.has(id)) m.set(id, s);
    }
    return m;
  };

  const localHistMap = indexSongs(local?.playHistory?.musicHistory || []);
  const remoteHistMap = indexSongs(remote?.playHistory?.musicHistory || []);
  const historyDiffs: SyncMergeDiffEntry[] = [];
  let localOnlyHistory = 0;
  let remoteOnlyHistory = 0;

  for (const [id, song] of remoteHistMap.entries()) {
    if (!localHistMap.has(id)) {
      remoteOnlyHistory++;
      if (historyDiffs.length < 30) {
        const artist = formatSongArtistLabel(song);
        historyDiffs.push({
          id,
          title: String(song?.name || `歌曲 #${id}`),
          subtitle: artist ? `${artist} · 云端新增历史` : '云端新增历史',
          source: 'remote',
          kind: 'history'
        });
      }
    }
  }
  for (const [id, song] of localHistMap.entries()) {
    if (!remoteHistMap.has(id)) {
      localOnlyHistory++;
      if (historyDiffs.length < 30) {
        const artist = formatSongArtistLabel(song);
        historyDiffs.push({
          id,
          title: String(song?.name || `歌曲 #${id}`),
          subtitle: artist ? `${artist} · 本机新增历史` : '本机新增历史',
          source: 'local',
          kind: 'history'
        });
      }
    }
  }

  const indexPlaylists = (list: SyncCustomPlaylist[] = []): Map<string, SyncCustomPlaylist> => {
    const m = new Map<string, SyncCustomPlaylist>();
    if (!Array.isArray(list)) return m;
    for (const pl of list) {
      if (!pl || pl.id === undefined || pl.id === null || pl.id === '') continue;
      const id = String(pl.id);
      if (!m.has(id)) m.set(id, pl);
    }
    return m;
  };

  const localPlaylistMap = indexPlaylists(local?.customPlaylists || []);
  const remotePlaylistMap = indexPlaylists(remote?.customPlaylists || []);
  const playlistDiffs: SyncMergeDiffEntry[] = [];
  let localOnlyPlaylists = 0;
  let remoteOnlyPlaylists = 0;
  let updatedPlaylists = 0;

  for (const [id, remotePl] of remotePlaylistMap.entries()) {
    const localPl = localPlaylistMap.get(id);
    const remoteTracks = Array.isArray(remotePl.tracks) ? remotePl.tracks : [];
    if (!localPl) {
      remoteOnlyPlaylists++;
      if (playlistDiffs.length < 20) {
        playlistDiffs.push({
          id,
          title: String(remotePl.name || '未命名歌单'),
          subtitle: `${remoteTracks.length} 首曲目 · 云端新建歌单`,
          source: 'remote',
          kind: 'playlist'
        });
      }
    } else {
      const localTracks = Array.isArray(localPl.tracks) ? localPl.tracks : [];
      const localTrackSig = [...new Set(localTracks.map((t: any) => String(t?.id || '')).filter(Boolean))]
        .sort()
        .join(',');
      const remoteTrackSig = [...new Set(remoteTracks.map((t: any) => String(t?.id || '')).filter(Boolean))]
        .sort()
        .join(',');
      if (String(localPl.name || '') !== String(remotePl.name || '') || localTrackSig !== remoteTrackSig) {
        updatedPlaylists++;
        if (playlistDiffs.length < 20) {
          playlistDiffs.push({
            id,
            title: String(localPl.name || remotePl.name || '未命名歌单'),
            subtitle: `本机 ${localTracks.length} 首 · 云端 ${remoteTracks.length} 首`,
            source: 'both',
            kind: 'playlist'
          });
        }
      }
    }
  }
  for (const [id, localPl] of localPlaylistMap.entries()) {
    if (!remotePlaylistMap.has(id)) {
      localOnlyPlaylists++;
      if (playlistDiffs.length < 20) {
        const localTracks = Array.isArray(localPl.tracks) ? localPl.tracks : [];
        playlistDiffs.push({
          id,
          title: String(localPl.name || '未命名歌单'),
          subtitle: `${localTracks.length} 首曲目 · 本机新建歌单`,
          source: 'local',
          kind: 'playlist'
        });
      }
    }
  }

  const addedFavorites = localOnlyFavorites + remoteOnlyFavorites;
  const addedHistory = localOnlyHistory + remoteOnlyHistory;
  const addedPlaylists = localOnlyPlaylists + remoteOnlyPlaylists + updatedPlaylists;

  const hasChanges = hasRemote
    ? addedFavorites > 0 ||
      addedHistory > 0 ||
      addedPlaylists > 0 ||
      computeSyncSnapshotDigest(local) !== computeSyncSnapshotDigest(remote)
    : addedFavorites > 0 || addedHistory > 0 || addedPlaylists > 0 || hasMeaningfulData(local);

  let summaryText = '本地与云端数据一致，暂无新增变更';
  if (hasChanges) {
    const parts: string[] = [];
    if (addedFavorites > 0) parts.push(`+${addedFavorites} 首收藏`);
    if (addedHistory > 0) parts.push(`+${addedHistory} 条历史`);
    if (addedPlaylists > 0) parts.push(`+${addedPlaylists} 个歌单`);
    if (parts.length > 0) {
      summaryText = `${hasRemote ? '预计合并：' : '首次备份到云端：'}${parts.join('、')}`;
    } else {
      summaryText = hasRemote ? '预计合并：听歌统计与偏好设置' : '首次备份到云端：听歌统计与偏好设置';
    }
  }

  return {
    hasRemote,
    hasChanges,
    localOnlyFavorites,
    remoteOnlyFavorites,
    addedFavorites,
    localOnlyHistory,
    remoteOnlyHistory,
    addedHistory,
    localOnlyPlaylists,
    remoteOnlyPlaylists,
    updatedPlaylists,
    addedPlaylists,
    summaryText,
    diffItems: {
      favorites: favoriteDiffs,
      history: historyDiffs,
      playlists: playlistDiffs
    }
  };
}
