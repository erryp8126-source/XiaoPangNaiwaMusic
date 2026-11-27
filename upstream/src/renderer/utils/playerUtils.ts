import type { SongResult } from '@/types/music';

/**
 * 从 localStorage 获取项目，带类型安全和错误处理
 */
export function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * 设置 localStorage 项目，自动序列化
 */
export function setLocalStorageItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
  }
}

/**
 * 比较B站视频ID的辅助函数
 */
export const isBilibiliIdMatch = (id1: string | number, id2: string | number): boolean => {
  const str1 = String(id1);
  const str2 = String(id2);

  // 如果两个ID都不包含--分隔符，直接比较
  if (!str1.includes('--') && !str2.includes('--')) {
    return str1 === str2;
  }

  // 处理B站视频ID
  if (str1.includes('--') || str2.includes('--')) {
    // 尝试从ID中提取bvid和cid
    const extractBvIdAndCid = (str: string) => {
      if (!str.includes('--')) return { bvid: '', cid: '' };
      const parts = str.split('--');
      if (parts.length >= 3) {
        // bvid--pid--cid格式
        return { bvid: parts[0], cid: parts[2] };
      } else if (parts.length === 2) {
        // 旧格式或其他格式
        return { bvid: '', cid: parts[1] };
      }
      return { bvid: '', cid: '' };
    };

    const { bvid: bvid1, cid: cid1 } = extractBvIdAndCid(str1);
    const { bvid: bvid2, cid: cid2 } = extractBvIdAndCid(str2);

    // 如果两个ID都有bvid，比较bvid和cid
    if (bvid1 && bvid2) {
      return bvid1 === bvid2 && cid1 === cid2;
    }

    // 其他情况，只比较cid部分
    if (cid1 && cid2) {
      return cid1 === cid2;
    }
  }

  // 默认情况，直接比较完整ID
  return str1 === str2;
};

/**
 * Fisher-Yates 洗牌算法
 * @param list 歌曲列表
 * @param currentSong 当前歌曲（会被放在第一位）
 */
export const performShuffle = (list: SongResult[], currentSong?: SongResult): SongResult[] => {
  if (list.length <= 1) return [...list];

  const result: SongResult[] = [];
  const remainingSongs = [...list];

  // 如果指定了当前歌曲，先把它放在第一位
  if (currentSong && currentSong.id) {
    const currentSongIndex = remainingSongs.findIndex((song) => song.id === currentSong.id);
    if (currentSongIndex !== -1) {
      // 把当前歌曲放在第一位
      result.push(remainingSongs.splice(currentSongIndex, 1)[0]);
    }
  }

  // 对剩余歌曲进行洗牌
  if (remainingSongs.length > 0) {
    // Fisher-Yates 洗牌算法
    for (let i = remainingSongs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingSongs[i], remainingSongs[j]] = [remainingSongs[j], remainingSongs[i]];
    }

    // 把洗牌后的歌曲添加到结果中
    result.push(...remainingSongs);
  }

  return result;
};

const MAX_PRELOADED_COVER_URLS = 64;
const preloadedCoverUrls = new Set<string>();
const inFlightCoverUrls = new Map<string, HTMLImageElement>();

const markCoverPreloaded = (imageUrl: string) => {
  if (!imageUrl) return;
  if (preloadedCoverUrls.has(imageUrl)) {
    preloadedCoverUrls.delete(imageUrl);
  }
  preloadedCoverUrls.add(imageUrl);
  while (preloadedCoverUrls.size > MAX_PRELOADED_COVER_URLS) {
    const oldest = preloadedCoverUrls.values().next().value;
    if (!oldest) break;
    preloadedCoverUrls.delete(oldest);
  }
};

export const isCoverImagePreloaded = (resolvedUrl?: string | null): boolean => {
  return Boolean(resolvedUrl && preloadedCoverUrls.has(resolvedUrl));
};

/**
 * 预加载封面图片（带内存上限去重缓存，避免重复请求同一张图）
 */
export const preloadCoverImage = (
  picUrl: string,
  getImgUrl: (url: string, size: string) => string,
  size: string = '500y500'
): string | null => {
  if (!picUrl || typeof Image === 'undefined') return null;

  try {
    const imageUrl = getImgUrl(picUrl, size);
    if (!imageUrl) return null;

    if (preloadedCoverUrls.has(imageUrl) || inFlightCoverUrls.has(imageUrl)) {
      return imageUrl;
    }

    const img = new Image();
    img.decoding = 'async';
    inFlightCoverUrls.set(imageUrl, img);

    const handleLoaded = () => {
      inFlightCoverUrls.delete(imageUrl);
      markCoverPreloaded(imageUrl);
    };
    const handleFailed = () => {
      inFlightCoverUrls.delete(imageUrl);
    };

    img.onload = handleLoaded;
    img.onerror = handleFailed;
    img.src = imageUrl;

    if (img.complete && img.naturalWidth > 0) {
      handleLoaded();
    }

    return imageUrl;
  } catch (error) {
    console.error('预加载封面图片出错:', error);
    return null;
  }
};

/**
 * 计算播放列表中的下一首曲目
 */
export const getNextTrackInQueue = (
  list: SongResult[],
  currentIndex: number,
  currentSongId?: string | number | null
): SongResult | null => {
  if (!Array.isArray(list) || list.length <= 1) return null;

  let resolvedIndex = -1;
  if (
    currentIndex >= 0 &&
    currentIndex < list.length &&
    (currentSongId == null ||
      currentSongId === '' ||
      String(list[currentIndex]?.id) === String(currentSongId))
  ) {
    resolvedIndex = currentIndex;
  } else if (currentSongId != null && currentSongId !== '') {
    resolvedIndex = list.findIndex((item) => String(item?.id) === String(currentSongId));
  }

  if (resolvedIndex === -1) {
    resolvedIndex = Math.max(0, Math.min(list.length - 1, currentIndex || 0));
  }

  const nextIndex = (resolvedIndex + 1) % list.length;
  return list[nextIndex] ?? null;
};

/**
 * 在当前曲目起播或队列变化时提前预加载下一首封面图（500y500 主图 + 120y120 缩略图）
 */
export const preloadNextTrackCover = (
  list: SongResult[],
  currentIndex: number,
  currentSongId: string | number | null | undefined,
  getImgUrl: (url: string, size: string) => string
): string | null => {
  const nextTrack = getNextTrackInQueue(list, currentIndex, currentSongId);
  const nextPic = nextTrack?.picUrl || nextTrack?.al?.picUrl || '';
  if (!nextPic) return null;

  const mainUrl = preloadCoverImage(nextPic, getImgUrl, '500y500');
  preloadCoverImage(nextPic, getImgUrl, '120y120');
  return mainUrl;
};
