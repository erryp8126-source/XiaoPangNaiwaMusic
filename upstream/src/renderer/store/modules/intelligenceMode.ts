import { createDiscreteApi } from 'naive-ui';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import i18n from '@/../i18n/renderer';
import { getLikedList } from '@/api/music';
import type { Platform } from '@/types/music';
import { getLocalStorageItem, setLocalStorageItem } from '@/utils/playerUtils';

const { message } = createDiscreteApi(['message']);

/**
 * 心动模式管理 Store
 * 负责：心动模式的播放和状态管理
 */
export const useIntelligenceModeStore = defineStore('intelligenceMode', () => {
  // ==================== 状态 ====================
  const isIntelligenceMode = ref(getLocalStorageItem('isIntelligenceMode', false));
  const intelligenceModeInfo = ref<{
    playlistId: number;
    seedSongId: number;
  } | null>(getLocalStorageItem('intelligenceModeInfo', null));

  // ==================== Actions ====================

  /**
   * 播放心动模式
   */
  const playIntelligenceMode = async () => {
    const { useUserStore } = await import('./user');
    const { usePlayerCoreStore } = await import('./playerCore');
    const { usePlaylistStore } = await import('./playlist');

    const userStore = useUserStore();
    const playerCore = usePlayerCoreStore();
    const playlistStore = usePlaylistStore();
    const { t } = i18n.global;

    // 检查是否已具备有效网易云登录凭证（扫码/手机号/Cookie 均可，仅 UID 不可）
    if (!userStore.hasNeteaseAuth) {
      message.warning(t('player.playBar.intelligenceMode.needCookieLogin'));
      return;
    }

    try {
      // 获取用户歌单列表
      if (userStore.playList.length === 0) {
        await userStore.initializePlaylist();
      }

      // 找到"我喜欢的音乐"歌单
      const favoritePlaylist = userStore.playList.find(
        (pl: any) => pl.userId === userStore.user?.userId && pl.specialType === 5
      );

      if (!favoritePlaylist) {
        message.warning(t('player.playBar.intelligenceMode.noFavoritePlaylist'));
        return;
      }

      // 获取喜欢的歌曲列表
      const likedListRes = await getLikedList(userStore.user.userId);
      const likedIds = likedListRes.data?.ids || [];

      if (likedIds.length === 0) {
        message.warning(t('player.playBar.intelligenceMode.noLikedSongs'));
        return;
      }

      // 随机选择一首歌曲
      const randomSongId = likedIds[Math.floor(Math.random() * likedIds.length)];

      // 调用心动模式API
      const { getIntelligenceList } = await import('@/api/music');
      const res = await getIntelligenceList({
        id: randomSongId,
        pid: favoritePlaylist.id
      });

      if (res.data?.data && res.data.data.length > 0) {
        const intelligenceSongs = res.data.data.map((item: any) => ({
          id: item.id,
          name: item.songInfo.name,
          picUrl: item.songInfo.al?.picUrl,
          source: 'netease' as Platform,
          song: item.songInfo,
          ...item.songInfo,
          playLoading: false
        }));

        // 设置心动模式状态
        isIntelligenceMode.value = true;
        intelligenceModeInfo.value = {
          playlistId: favoritePlaylist.id,
          seedSongId: randomSongId
        };
        playlistStore.playMode = 3; // 设置播放模式为心动模式

        setLocalStorageItem('isIntelligenceMode', true);
        setLocalStorageItem('intelligenceModeInfo', intelligenceModeInfo.value);

        // 替换播放列表并开始播放
        playlistStore.setPlayList(intelligenceSongs, false, true);
        await playerCore.handlePlayMusic(intelligenceSongs[0], true);
      } else {
        message.error(t('player.playBar.intelligenceMode.failed'));
      }
    } catch (error) {
      console.error('心动模式播放失败:', error);
      message.error(t('player.playBar.intelligenceMode.error'));
    }
  };

  /**
   * 清除心动模式状态
   * @param skipPlayModeChange 是否跳过播放模式切换
   */
  const clearIntelligenceMode = (skipPlayModeChange: boolean = false) => {
    console.log(
      '[IntelligenceMode] clearIntelligenceMode 被调用，skipPlayModeChange:',
      skipPlayModeChange
    );

    isIntelligenceMode.value = false;
    intelligenceModeInfo.value = null;
    setLocalStorageItem('isIntelligenceMode', false);
    localStorage.removeItem('intelligenceModeInfo');

    console.log(
      '[IntelligenceMode] 心动模式状态已清除，isIntelligenceMode:',
      isIntelligenceMode.value
    );

    // 自动切换播放模式为顺序播放 (playMode = 0)
    if (!skipPlayModeChange) {
      (async () => {
        const { usePlaylistStore } = await import('./playlist');
        const playlistStore = usePlaylistStore();

        if (playlistStore.playMode === 3) {
          console.log('[IntelligenceMode] 退出心动模式，自动切换播放模式为顺序播放');
          playlistStore.playMode = 0;
        }
      })();
    }
  };

  let refillingIntelligence = false;

  /**
   * 当心动模式队列即将耗尽时（如 iOS/Android 原生切歌触发 intelligence-refill），拉取新一批心动推荐并追加到列表
   */
  const refillIntelligenceQueue = async (
    seedSongIdOverride?: string | number,
    playlistIdOverride?: string | number
  ): Promise<number> => {
    if (refillingIntelligence) return 0;
    const { usePlaylistStore } = await import('./playlist');
    const playlistStore = usePlaylistStore();
    if (playlistStore.playMode !== 3) return 0;

    const pid = Number(playlistIdOverride || intelligenceModeInfo.value?.playlistId || 0);
    const sid = Number(
      seedSongIdOverride ||
        playlistStore.playList[playlistStore.playListIndex]?.id ||
        intelligenceModeInfo.value?.seedSongId ||
        0
    );
    if (!pid || !sid) return 0;

    refillingIntelligence = true;
    try {
      const { getIntelligenceList } = await import('@/api/music');
      const res = await getIntelligenceList({ id: sid, pid });
      const rawList = Array.isArray(res.data?.data) ? res.data.data : [];
      if (rawList.length === 0) return 0;

      const existingIds = new Set(playlistStore.playList.map((s: any) => String(s.id)));
      const appended = rawList
        .map((item: any) => {
          const songInfo = item.songInfo || item;
          return {
            id: item.id || songInfo.id,
            name: songInfo.name,
            picUrl: songInfo.al?.picUrl || songInfo.album?.picUrl,
            source: 'netease' as Platform,
            song: songInfo,
            ...songInfo,
            playLoading: false
          };
        })
        .filter((s: any) => s.id && !existingIds.has(String(s.id)));

      if (appended.length > 0) {
        playlistStore.playList = [...playlistStore.playList, ...appended];
      }
      return appended.length;
    } catch (error) {
      console.warn('[IntelligenceMode] 追加心动推荐列表失败:', error);
      return 0;
    } finally {
      refillingIntelligence = false;
    }
  };

  return {
    // 状态
    isIntelligenceMode,
    intelligenceModeInfo,

    // Actions
    playIntelligenceMode,
    refillIntelligenceQueue,
    clearIntelligenceMode
  };
});
