import { useMessage } from 'naive-ui';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePlayerStore, useRecommendStore } from '@/store';
import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { triggerHaptic } from '@/utils/androidBridge';
import { getImageBackground } from '@/utils/linearColor';

import { dislikeRecommendedSong } from '../api/music';
import { useArtist } from './useArtist';
import { useDownload } from './useDownload';

export function useSongItem(props: { item: SongResult; canRemove?: boolean }) {
  const { t } = useI18n();
  const playerStore = usePlayerStore();
  const recommendStore = useRecommendStore();
  const offlineStore = useOfflineAvailabilityStore();
  const message = useMessage();
  const { downloadMusic, downloadLyric } = useDownload();
  const { navigateToArtist } = useArtist();
  offlineStore.ensureInitialized();

  const offlineBadge = computed(() => offlineStore.getOfflineBadge(props.item));
  const trackOrigin = computed(() => offlineStore.getTrackOrigin(props.item));
  const isOffline = computed(() => offlineStore.isOffline);
  const isOfflineUnavailable = computed(() => offlineStore.isTrackUnavailableOffline(props.item));

  // 状态变量
  const showDropdown = ref(false);
  const dropdownX = ref(0);
  const dropdownY = ref(0);
  const isHovering = ref(false);

  // 计算属性
  const play = computed(() => playerStore.isPlay);
  const playMusic = computed(() => playerStore.playMusic);
  const playLoading = computed(
    () => playMusic.value.id === props.item.id && playMusic.value.playLoading
  );
  const isPlaying = computed(() => playMusic.value.id === props.item.id);

  // 收藏与不喜欢状态
  const isFavorite = computed(() => {
    const numericId =
      typeof props.item.id === 'string' ? parseInt(props.item.id, 10) : props.item.id;
    return playerStore.favoriteList.includes(numericId);
  });

  const isDislike = computed(() => {
    const numericId =
      typeof props.item.id === 'string' ? parseInt(props.item.id, 10) : props.item.id;
    return playerStore.dislikeList.includes(numericId);
  });

  // 获取艺术家列表
  const artists = computed(() => {
    return (props.item.ar || props.item.song?.artists)?.slice(0, 4) || [];
  });

  // 处理图片加载
  const handleImageLoad = async (imageElement: HTMLImageElement) => {
    if (!imageElement) return;

    const { backgroundColor, primaryColor } = await getImageBackground(imageElement);
    props.item.backgroundColor = backgroundColor;
    props.item.primaryColor = primaryColor;
  };

  // 播放音乐
  const playMusicEvent = async (item: SongResult) => {
    try {
      const result = await playerStore.setPlay(item);
      if (!result) {
        throw new Error('播放失败');
      }
      return true;
    } catch (error) {
      console.error('播放出错:', error);
      return false;
    }
  };

  // 切换收藏状态
  const toggleFavorite = async (e: Event) => {
    e && e.stopPropagation();
    const numericId =
      typeof props.item.id === 'string' ? parseInt(props.item.id, 10) : props.item.id;

    if (isFavorite.value) {
      triggerHaptic('selection');
      playerStore.removeFromFavorite(numericId);
    } else {
      triggerHaptic('success');
      playerStore.addToFavorite(numericId);
    }
  };

  // 判断当前歌曲是否为每日推荐歌曲
  const isDailyRecommendSong = computed(() => {
    return recommendStore.dailyRecommendSongs.some((song) => song.id === props.item.id);
  });

  // 切换不喜欢状态
  const toggleDislike = async (e: Event) => {
    e && e.stopPropagation();

    if (isDislike.value) {
      playerStore.removeFromDislikeList(props.item.id);
      return;
    }

    playerStore.addToDislikeList(props.item.id);

    // 只有当前歌曲是每日推荐歌曲时才调用接口
    if (!isDailyRecommendSong.value) {
      return;
    }
    try {
      console.log('发送不感兴趣请求，歌曲ID:', props.item.id);
      const numericId = typeof props.item.id === 'string' ? parseInt(props.item.id) : props.item.id;
      const response = await dislikeRecommendedSong(numericId);
      if (response.data.data) {
        console.log(response);
        const newSongData = response.data.data;
        const newSong: SongResult = {
          ...newSongData,
          name: newSongData.name,
          id: newSongData.id,
          picUrl: newSongData.al?.picUrl || newSongData.album?.picUrl,
          ar: newSongData.ar || newSongData.artists,
          al: newSongData.al || newSongData.album,
          song: {
            ...newSongData.song,
            id: newSongData.id,
            name: newSongData.name,
            artists: newSongData.ar || newSongData.artists,
            album: newSongData.al || newSongData.album
          },
          source: 'netease',
          count: 0
        };
        recommendStore.replaceSongInDailyRecommend(props.item.id, newSong);
      } else {
        console.warn('标记不感兴趣API成功，但未返回新歌曲。', response.data);
      }
    } catch (error) {
      console.error('发送不感兴趣请求时出错:', error);
    }
  };

  // 添加到下一首播放
  const handlePlayNext = () => {
    playerStore.addToNextPlay(props.item);
    message.success(t('songItem.message.addedToNextPlay'));
  };

  // 获取歌曲时长
  const getDuration = (item: SongResult): number => {
    if (item.duration) return item.duration;
    if (typeof item.dt === 'number') return item.dt;
    return 0;
  };

  // 格式化时长
  const formatDuration = (ms: number): string => {
    if (!ms) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // 移动端长按手势触发操作菜单（兼容 iOS WKWebView 与 Android WebView）
  let longPressTimer: number | null = null;
  let longPressStartX = 0;
  let longPressStartY = 0;
  let lastLongPressAt = 0;

  const clearLongPressTimer = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const handleLongPressTouchStart = (e: TouchEvent) => {
    clearLongPressTimer();
    if (!e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    longPressStartX = touch.clientX;
    longPressStartY = touch.clientY;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      lastLongPressAt = Date.now();
      triggerHaptic('medium');
      dropdownX.value = longPressStartX;
      dropdownY.value = longPressStartY;
      showDropdown.value = true;
    }, 480);
  };

  const handleLongPressTouchMove = (e: TouchEvent) => {
    if (longPressTimer === null || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    if (
      Math.abs(touch.clientX - longPressStartX) > 10 ||
      Math.abs(touch.clientY - longPressStartY) > 10
    ) {
      clearLongPressTimer();
    }
  };

  const handleLongPressTouchEnd = () => {
    clearLongPressTimer();
  };

  const consumeLongPressClickGuard = (): boolean => {
    return Date.now() - lastLongPressAt < 650;
  };

  onBeforeUnmount(() => {
    clearLongPressTimer();
  });

  // 处理右键/系统长按菜单
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (Date.now() - lastLongPressAt < 650) {
      return;
    }
    triggerHaptic('medium');
    showDropdown.value = true;
    dropdownX.value = e.clientX;
    dropdownY.value = e.clientY;
  };

  // 处理菜单点击
  const handleMenuClick = (e: MouseEvent) => {
    e.preventDefault();
    triggerHaptic('light');
    showDropdown.value = true;
    dropdownX.value = e.clientX;
    dropdownY.value = e.clientY;
  };

  // 处理艺术家点击
  const handleArtistClick = (id: number) => {
    navigateToArtist(id);
  };

  // 鼠标悬停处理
  const handleMouseEnter = () => {
    isHovering.value = true;
  };

  const handleMouseLeave = () => {
    isHovering.value = false;
  };

  return {
    t,
    play,
    playMusic,
    playLoading,
    isPlaying,
    isFavorite,
    isDislike,
    offlineBadge,
    trackOrigin,
    isOffline,
    isOfflineUnavailable,
    artists,
    showDropdown,
    dropdownX,
    dropdownY,
    isHovering,
    playerStore,
    message,
    getImgUrl,
    handleImageLoad,
    playMusicEvent,
    toggleFavorite,
    toggleDislike,
    handlePlayNext,
    getDuration,
    formatDuration,
    handleContextMenu,
    handleMenuClick,
    handleLongPressTouchStart,
    handleLongPressTouchMove,
    handleLongPressTouchEnd,
    consumeLongPressClickGuard,
    handleArtistClick,
    handleMouseEnter,
    handleMouseLeave,
    downloadMusic,
    downloadLyric
  };
}
