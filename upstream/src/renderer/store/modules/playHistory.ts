import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { SongResult } from '@/types/music';
import type { DjProgram } from '@/types/podcast';

// ==================== 类型定义 ====================

// 歌单历史记录
export type PlaylistHistoryItem = {
  id: number;
  name: string;
  coverImgUrl?: string;
  picUrl?: string;
  trackCount?: number;
  playCount?: number;
  creator?: {
    nickname: string;
    userId: number;
  };
  count?: number;
  lastPlayTime?: number;
};

// 专辑历史记录
export type AlbumHistoryItem = {
  id: number;
  name: string;
  picUrl?: string;
  size?: number;
  artist?: {
    name: string;
    id: number;
  };
  count?: number;
  lastPlayTime?: number;
};

// 播客电台历史记录
export type PodcastRadioHistoryItem = {
  id: number;
  name: string;
  picUrl: string;
  desc?: string;
  dj?: {
    nickname: string;
    userId: number;
  };
  count?: number;
  lastPlayTime?: number;
  type?: string;
};

// 历史记录最大条数
const MAX_HISTORY_SIZE = 500;

/**
 * 播放记录统一管理 Store
 * 使用 Pinia 单例模式，解决多实例不同步问题
 * 适配：音乐、播客、本地音乐、歌单、专辑
 */
export const usePlayHistoryStore = defineStore(
  'playHistory',
  () => {
    // ==================== 状态 ====================
    const musicHistory = ref<SongResult[]>([]);
    const podcastHistory = ref<DjProgram[]>([]);
    const playlistHistory = ref<PlaylistHistoryItem[]>([]);
    const albumHistory = ref<AlbumHistoryItem[]>([]);
    const podcastRadioHistory = ref<PodcastRadioHistoryItem[]>([]);

    // ==================== 音乐记录 ====================

    const addMusic = (music: SongResult): void => {
      const now = Date.now();
      const index = musicHistory.value.findIndex((item) => item.id === music.id);
      if (index !== -1) {
        const existing = musicHistory.value.splice(index, 1)[0] as SongResult & {
          lastPlayTime?: number;
        };
        existing.count = (existing.count || 0) + 1;
        existing.lastPlayTime = now;
        musicHistory.value.unshift(existing);
      } else {
        musicHistory.value.unshift({
          ...music,
          count: 1,
          lastPlayTime: now
        } as SongResult);
      }
      if (musicHistory.value.length > MAX_HISTORY_SIZE) {
        musicHistory.value.pop();
      }
    };

    const delMusic = (music: SongResult): void => {
      const index = musicHistory.value.findIndex((item) => item.id === music.id);
      if (index !== -1) {
        musicHistory.value.splice(index, 1);
      }
    };

    // ==================== 播客节目记录 ====================

    const addPodcast = (program: DjProgram): void => {
      const index = podcastHistory.value.findIndex((item) => item.id === program.id);
      if (index !== -1) {
        podcastHistory.value.unshift(podcastHistory.value.splice(index, 1)[0]);
      } else {
        podcastHistory.value.unshift(program);
      }
      if (podcastHistory.value.length > MAX_HISTORY_SIZE) {
        podcastHistory.value.pop();
      }
    };

    const delPodcast = (program: DjProgram): void => {
      const index = podcastHistory.value.findIndex((item) => item.id === program.id);
      if (index !== -1) {
        podcastHistory.value.splice(index, 1);
      }
    };

    // ==================== 歌单记录 ====================

    const addPlaylist = (playlist: PlaylistHistoryItem): void => {
      const index = playlistHistory.value.findIndex((item) => item.id === playlist.id);
      const now = Date.now();
      if (index !== -1) {
        playlistHistory.value[index].count = (playlistHistory.value[index].count || 0) + 1;
        playlistHistory.value[index].lastPlayTime = now;
        playlistHistory.value.unshift(playlistHistory.value.splice(index, 1)[0]);
      } else {
        playlistHistory.value.unshift({ ...playlist, count: 1, lastPlayTime: now });
      }
      if (playlistHistory.value.length > MAX_HISTORY_SIZE) {
        playlistHistory.value.pop();
      }
    };

    const delPlaylist = (playlist: PlaylistHistoryItem): void => {
      const index = playlistHistory.value.findIndex((item) => item.id === playlist.id);
      if (index !== -1) {
        playlistHistory.value.splice(index, 1);
      }
    };

    // ==================== 专辑记录 ====================

    const addAlbum = (album: AlbumHistoryItem): void => {
      const index = albumHistory.value.findIndex((item) => item.id === album.id);
      const now = Date.now();
      if (index !== -1) {
        albumHistory.value[index].count = (albumHistory.value[index].count || 0) + 1;
        albumHistory.value[index].lastPlayTime = now;
        albumHistory.value.unshift(albumHistory.value.splice(index, 1)[0]);
      } else {
        albumHistory.value.unshift({ ...album, count: 1, lastPlayTime: now });
      }
      if (albumHistory.value.length > MAX_HISTORY_SIZE) {
        albumHistory.value.pop();
      }
    };

    const delAlbum = (album: AlbumHistoryItem): void => {
      const index = albumHistory.value.findIndex((item) => item.id === album.id);
      if (index !== -1) {
        albumHistory.value.splice(index, 1);
      }
    };

    // ==================== 播客电台记录 ====================

    const addPodcastRadio = (radio: PodcastRadioHistoryItem): void => {
      const index = podcastRadioHistory.value.findIndex((item) => item.id === radio.id);
      const now = Date.now();
      if (index !== -1) {
        const existing = podcastRadioHistory.value.splice(index, 1)[0];
        existing.count = (existing.count || 0) + 1;
        existing.lastPlayTime = now;
        podcastRadioHistory.value.unshift(existing);
      } else {
        podcastRadioHistory.value.unshift({ ...radio, count: 1, lastPlayTime: now });
      }
      if (podcastRadioHistory.value.length > MAX_HISTORY_SIZE) {
        podcastRadioHistory.value.pop();
      }
    };

    const delPodcastRadio = (radio: PodcastRadioHistoryItem): void => {
      const index = podcastRadioHistory.value.findIndex((item) => item.id === radio.id);
      if (index !== -1) {
        podcastRadioHistory.value.splice(index, 1);
      }
    };

    // ==================== 清空操作 ====================

    const clearMusicHistory = (): void => {
      musicHistory.value = [];
    };

    const clearPodcastHistory = (): void => {
      podcastHistory.value = [];
    };

    const clearPlaylistHistory = (): void => {
      playlistHistory.value = [];
    };

    const clearAlbumHistory = (): void => {
      albumHistory.value = [];
    };

    const clearPodcastRadioHistory = (): void => {
      podcastRadioHistory.value = [];
    };

    const clearAll = (): void => {
      clearMusicHistory();
      clearPodcastHistory();
      clearPlaylistHistory();
      clearAlbumHistory();
      clearPodcastRadioHistory();
    };

    // ==================== 云同步精简导出与双向合并 ====================

    const stripHeavySongFields = (item: any) => {
      if (!item || typeof item !== 'object') return item;
      const { lyric, playMusicUrl, ...rest } = item;
      const isLocal = typeof playMusicUrl === 'string' && playMusicUrl.startsWith('local://');
      return isLocal ? { ...rest, playMusicUrl } : rest;
    };

    const mergeListById = <T extends Record<string, any>>(
      localList: T[],
      remoteList: T[],
      stripHeavy = false
    ): T[] => {
      const map = new Map<string, { item: T; order: number }>();
      const ingest = (list: T[], baseOrder: number) => {
        if (!Array.isArray(list)) return;
        list.forEach((raw, idx) => {
          if (!raw || raw.id === undefined || raw.id === null) return;
          const item = stripHeavy ? stripHeavySongFields(raw) : { ...raw };
          const key = String(item.id);
          const prev = map.get(key);
          if (!prev) {
            map.set(key, { item, order: baseOrder + idx });
          } else {
            const mergedCount = Math.max(Number(prev.item.count) || 0, Number(item.count) || 0);
            const prevTime = Number(prev.item.lastPlayTime) || 0;
            const nextTime = Number(item.lastPlayTime) || 0;
            const mergedTime = Math.max(prevTime, nextTime);
            // 保留字段更完整的条目元数据，再用更新的时间戳与更大的播放次数覆盖
            const mergedItem = {
              ...item,
              ...prev.item,
              ...(prev.item.picUrl ? {} : item.picUrl ? { picUrl: item.picUrl } : {}),
              ...(prev.item.al ? {} : item.al ? { al: item.al } : {}),
              ...(prev.item.ar ? {} : item.ar ? { ar: item.ar } : {}),
              ...(mergedCount > 0 ? { count: mergedCount } : {}),
              ...(mergedTime > 0 ? { lastPlayTime: mergedTime } : {})
            } as T;
            map.set(key, { item: mergedItem, order: Math.min(prev.order, baseOrder + idx) });
          }
        });
      };

      ingest(localList, 0);
      ingest(remoteList, 10000);

      return Array.from(map.values())
        .sort((a, b) => {
          const ta = Number(a.item.lastPlayTime) || 0;
          const tb = Number(b.item.lastPlayTime) || 0;
          if (ta !== tb) return tb - ta;
          return a.order - b.order;
        })
        .slice(0, MAX_HISTORY_SIZE)
        .map((entry) => entry.item);
    };

    const getCompactSnapshot = () => ({
      musicHistory: musicHistory.value.slice(0, MAX_HISTORY_SIZE).map(stripHeavySongFields),
      playlistHistory: playlistHistory.value.slice(0, MAX_HISTORY_SIZE),
      albumHistory: albumHistory.value.slice(0, MAX_HISTORY_SIZE),
      podcastHistory: podcastHistory.value.slice(0, MAX_HISTORY_SIZE),
      podcastRadioHistory: podcastRadioHistory.value.slice(0, MAX_HISTORY_SIZE)
    });

    const mergeRemoteHistory = (
      remote: {
        musicHistory?: any[];
        playlistHistory?: any[];
        albumHistory?: any[];
        podcastHistory?: any[];
        podcastRadioHistory?: any[];
      },
      mode: 'merge' | 'replace' = 'merge'
    ): void => {
      if (!remote || typeof remote !== 'object') return;
      if (mode === 'replace') {
        if (Array.isArray(remote.musicHistory)) {
          musicHistory.value = remote.musicHistory.slice(0, MAX_HISTORY_SIZE);
        }
        if (Array.isArray(remote.playlistHistory)) {
          playlistHistory.value = remote.playlistHistory.slice(0, MAX_HISTORY_SIZE);
        }
        if (Array.isArray(remote.albumHistory)) {
          albumHistory.value = remote.albumHistory.slice(0, MAX_HISTORY_SIZE);
        }
        if (Array.isArray(remote.podcastHistory)) {
          podcastHistory.value = remote.podcastHistory.slice(0, MAX_HISTORY_SIZE);
        }
        if (Array.isArray(remote.podcastRadioHistory)) {
          podcastRadioHistory.value = remote.podcastRadioHistory.slice(0, MAX_HISTORY_SIZE);
        }
        return;
      }

      if (Array.isArray(remote.musicHistory)) {
        musicHistory.value = mergeListById(musicHistory.value, remote.musicHistory, true);
      }
      if (Array.isArray(remote.playlistHistory)) {
        playlistHistory.value = mergeListById(playlistHistory.value, remote.playlistHistory);
      }
      if (Array.isArray(remote.albumHistory)) {
        albumHistory.value = mergeListById(albumHistory.value, remote.albumHistory);
      }
      if (Array.isArray(remote.podcastHistory)) {
        podcastHistory.value = mergeListById(podcastHistory.value, remote.podcastHistory);
      }
      if (Array.isArray(remote.podcastRadioHistory)) {
        podcastRadioHistory.value = mergeListById(
          podcastRadioHistory.value,
          remote.podcastRadioHistory
        );
      }
    };

    // ==================== 数据迁移 ====================

    /**
     * 从旧的 localStorage 数据迁移到 Pinia store
     * 只在首次启动时执行一次
     */
    const migrateFromLocalStorage = (): void => {
      const migrated = localStorage.getItem('playHistory-migrated');
      if (migrated) return;

      try {
        // 迁移音乐记录
        const oldMusic = localStorage.getItem('musicHistory');
        if (oldMusic) {
          const parsed = JSON.parse(oldMusic);
          if (Array.isArray(parsed) && parsed.length > 0 && musicHistory.value.length === 0) {
            musicHistory.value = parsed;
          }
        }

        // 迁移播客记录
        const oldPodcast = localStorage.getItem('podcastHistory');
        if (oldPodcast) {
          const parsed = JSON.parse(oldPodcast);
          if (Array.isArray(parsed) && parsed.length > 0 && podcastHistory.value.length === 0) {
            podcastHistory.value = parsed;
          }
        }

        // 迁移歌单记录
        const oldPlaylist = localStorage.getItem('playlistHistory');
        if (oldPlaylist) {
          const parsed = JSON.parse(oldPlaylist);
          if (Array.isArray(parsed) && parsed.length > 0 && playlistHistory.value.length === 0) {
            playlistHistory.value = parsed;
          }
        }

        // 迁移专辑记录
        const oldAlbum = localStorage.getItem('albumHistory');
        if (oldAlbum) {
          const parsed = JSON.parse(oldAlbum);
          if (Array.isArray(parsed) && parsed.length > 0 && albumHistory.value.length === 0) {
            albumHistory.value = parsed;
          }
        }

        // 迁移播客电台记录
        const oldRadio = localStorage.getItem('podcastRadioHistory');
        if (oldRadio) {
          const parsed = JSON.parse(oldRadio);
          if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            podcastRadioHistory.value.length === 0
          ) {
            podcastRadioHistory.value = parsed;
          }
        }

        localStorage.setItem('playHistory-migrated', '1');
        console.log('[PlayHistory] 数据迁移完成');
      } catch (error) {
        console.error('[PlayHistory] 数据迁移失败:', error);
      }
    };

    return {
      // 状态
      musicHistory,
      podcastHistory,
      playlistHistory,
      albumHistory,
      podcastRadioHistory,

      // 音乐
      addMusic,
      delMusic,
      clearMusicHistory,

      // 播客节目
      addPodcast,
      delPodcast,
      clearPodcastHistory,

      // 歌单
      addPlaylist,
      delPlaylist,
      clearPlaylistHistory,

      // 专辑
      addAlbum,
      delAlbum,
      clearAlbumHistory,

      // 播客电台
      addPodcastRadio,
      delPodcastRadio,
      clearPodcastRadioHistory,

      // 通用
      clearAll,
      migrateFromLocalStorage,
      getCompactSnapshot,
      mergeRemoteHistory
    };
  },
  {
    persist: {
      key: 'play-history-store',
      storage: localStorage,
      pick: [
        'musicHistory',
        'podcastHistory',
        'playlistHistory',
        'albumHistory',
        'podcastRadioHistory'
      ]
    }
  }
);
