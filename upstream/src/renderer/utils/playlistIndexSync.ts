/**
 * 播放队列索引校准工具（纯函数实现，避免“首次启动切下一首再切上一首回不到原曲”）
 */

export interface QueueTrackLike {
  id?: string | number;
  source?: string;
  [key: string]: any;
}

export interface SyncQueueIndexResult<T extends QueueTrackLike> {
  playList: T[];
  playListIndex: number;
  mutated: boolean;
}

/**
 * 在切换下一首 / 上一首之前，根据当前正在播放的曲目校准队列与 playListIndex：
 * 1. 若当前曲目在队列中存在，同步 playListIndex 到真实下标；
 * 2. 若当前曲目不在队列中，则将其插入到当前合法索引位并指向该位，保证「下一首 → 上一首」严格回到原曲。
 */
export function syncPlaylistIndexWithCurrentTrack<T extends QueueTrackLike>(
  list: T[],
  currentIndex: number,
  currentTrack?: T | null
): SyncQueueIndexResult<T> {
  const safeList = Array.isArray(list) ? list : [];
  const safeIdx = Number.isFinite(currentIndex) ? Math.trunc(currentIndex) : 0;
  const trackId = currentTrack?.id;

  if (trackId === undefined || trackId === null || trackId === '') {
    const clamped = safeList.length > 0 ? Math.max(0, Math.min(safeIdx, safeList.length - 1)) : 0;
    return { playList: safeList, playListIndex: clamped, mutated: false };
  }

  const targetId = String(trackId);
  const exactIdx = safeList.findIndex(
    (item) =>
      String(item?.id) === targetId &&
      (!currentTrack?.source || !item?.source || item.source === currentTrack.source)
  );
  if (exactIdx !== -1) {
    return { playList: safeList, playListIndex: exactIdx, mutated: false };
  }

  const looseIdx = safeList.findIndex((item) => String(item?.id) === targetId);
  if (looseIdx !== -1) {
    return { playList: safeList, playListIndex: looseIdx, mutated: false };
  }

  const insertAt = safeList.length === 0 ? 0 : Math.max(0, Math.min(safeIdx, safeList.length));
  const nextList = [...safeList];
  nextList.splice(insertAt, 0, { ...currentTrack });
  return {
    playList: nextList,
    playListIndex: insertAt,
    mutated: true
  };
}

/**
 * 冷启动填充队列后选取首曲，并显式确保 playList[playListIndex].id === firstSong.id
 * （防止随机模式洗牌导致首曲与 playList[0] 脱节）
 */
export function resolveSeededFirstSong<T extends QueueTrackLike>(
  playList: T[],
  playListIndex: number,
  fallbackList: T[]
): { firstSong: T; playList: T[]; playListIndex: number; mutated: boolean } {
  const safeList = Array.isArray(playList) ? playList : [];
  const safeIdx =
    Number.isFinite(playListIndex) && playListIndex >= 0 && playListIndex < safeList.length
      ? Math.trunc(playListIndex)
      : 0;

  const firstSong = safeList[safeIdx] || safeList[0] || fallbackList[0];
  if (!firstSong || firstSong.id === undefined || firstSong.id === null) {
    return { firstSong, playList: safeList, playListIndex: safeIdx, mutated: false };
  }

  if (safeList[safeIdx] && String(safeList[safeIdx].id) === String(firstSong.id)) {
    return { firstSong, playList: safeList, playListIndex: safeIdx, mutated: false };
  }

  const foundIdx = safeList.findIndex((item) => String(item?.id) === String(firstSong.id));
  if (foundIdx !== -1) {
    return { firstSong, playList: safeList, playListIndex: foundIdx, mutated: false };
  }

  return {
    firstSong,
    playList: [{ ...firstSong }, ...safeList],
    playListIndex: 0,
    mutated: true
  };
}
