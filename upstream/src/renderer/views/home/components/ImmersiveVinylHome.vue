<template>
  <section class="immersive-vinyl-home" :style="backdropStyle">
    <!-- 封面动态弥散深色背景（复用 coverColorExtractor.ts） -->
    <div
      class="immersive-backdrop"
      :class="{ 'dynamic-disabled': !dynamicBackgroundEnabled }"
      aria-hidden="true"
    >
      <div
        v-if="coverUrl && dynamicBackgroundEnabled"
        class="backdrop-cover-blur"
        :style="{ backgroundImage: `url(${getImgUrl(coverUrl, '300y300')})` }"
      ></div>
      <div class="backdrop-base-glow"></div>
      <div class="backdrop-orb-primary"></div>
      <div class="backdrop-orb-secondary"></div>
      <div class="backdrop-scrim"></div>
    </div>

    <!-- 1. 顶部极简栏（安全区下方：心动 / 发现 / 音乐库 + 搜索） -->
    <header class="immersive-top-bar">
      <div class="top-spacer" aria-hidden="true"></div>
      <nav class="top-mode-tabs" aria-label="首页模式切换">
        <button
          type="button"
          class="top-tab-btn is-active"
          @click="handleHeartbeatTabClick"
        >
          <span>心动</span>
          <span class="tab-indicator"></span>
        </button>
        <button
          type="button"
          class="top-tab-btn"
          @click="handleSwitchToDiscover"
        >
          <span>发现</span>
        </button>
        <button
          type="button"
          class="top-tab-btn"
          @click="handleGoLibrary"
        >
          <span>音乐库</span>
        </button>
      </nav>
      <button
        type="button"
        class="top-search-btn"
        aria-label="搜索音乐"
        @click="handleOpenSearch"
      >
        <i class="ri-search-2-line"></i>
      </button>
    </header>

    <!-- 2. 中央黑胶唱片 / 歌词沉浸舞台 -->
    <main
      class="immersive-stage"
      @touchstart="handleStageTouchStart"
      @touchmove="handleStageTouchMove"
      @touchend="handleStageTouchEnd"
    >
      <transition name="vinyl-lyric-fade" mode="out-in">
        <!-- 黑胶唱片视图 -->
        <div
          v-if="!showLyrics"
          key="vinyl-view"
          class="vinyl-stage"
          :style="stageSwipeStyle"
          @click="handleVinylTap"
        >
          <!-- 动态金属唱针摆臂 -->
          <div class="tonearm-anchor" :class="{ 'is-playing': isPlaying }" aria-hidden="true">
            <svg class="tonearm-svg" viewBox="0 0 110 156" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="armMetal" x1="0" y1="0" x2="110" y2="156" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#f8fafc" />
                  <stop offset="48%" stop-color="#cbd5e1" />
                  <stop offset="100%" stop-color="#64748b" />
                </linearGradient>
                <linearGradient id="headShell" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#475569" />
                  <stop offset="100%" stop-color="#0f172a" />
                </linearGradient>
              </defs>
              <!-- 唱臂主体 -->
              <path
                d="M24 24 L24 72 C24 85 30 95 41 103 L79 131"
                stroke="url(#armMetal)"
                stroke-width="6.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- 高光边 -->
              <path
                d="M23 26 L23 72 C23 84 29 94 40 102 L77 129"
                stroke="rgba(255,255,255,0.55)"
                stroke-width="1.5"
                stroke-linecap="round"
              />
              <!-- 唱头外壳 -->
              <g transform="translate(70, 121) rotate(36)">
                <rect x="0" y="0" width="22" height="12" rx="3.5" fill="url(#headShell)" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
                <rect x="16" y="3.5" width="4" height="5" rx="1" fill="#ffd147" />
              </g>
              <!-- 转轴底座 -->
              <circle cx="24" cy="24" r="16" fill="rgba(15,23,42,0.72)" stroke="rgba(255,255,255,0.24)" stroke-width="1.5" />
              <circle cx="24" cy="24" r="9.5" fill="url(#armMetal)" />
              <circle cx="24" cy="24" r="3.5" fill="#ffd147" />
            </svg>
          </div>

          <!-- 大尺寸黑胶唱片与封面圆盘 -->
          <div class="vinyl-disc-shell" :class="{ 'is-loading': isSeeding && !hasSong }">
            <div class="vinyl-outer-halo"></div>
            <div class="vinyl-platter" :class="{ 'is-paused': !isPlaying }">
              <div class="vinyl-grooves"></div>
              <div class="vinyl-glint"></div>
              <div class="vinyl-cover-wrap">
                <img
                  v-if="coverUrl"
                  :src="getImgUrl(coverUrl, '500y500')"
                  alt=""
                  class="vinyl-cover-img"
                />
                <div v-else class="vinyl-cover-placeholder">
                  <i class="ri-disc-fill"></i>
                </div>
              </div>
              <div class="vinyl-spindle"></div>
            </div>
          </div>

          <!-- 黑胶下方轻量歌词预览 / 首次加载态 -->
          <div class="vinyl-lyric-teaser">
            <template v-if="hasSong">
              <p class="teaser-current-line">{{ activeLyricText }}</p>
              <p v-if="activeLyricSubText" class="teaser-sub-line">{{ activeLyricSubText }}</p>
              <p v-else class="teaser-hint-line">轻点黑胶切歌词 · 滑动切歌</p>
            </template>
            <template v-else-if="isSeeding">
              <p class="teaser-current-line">正在为你挑选心动好歌…</p>
              <p class="teaser-hint-line">拉取每日推荐与私人 FM</p>
            </template>
            <template v-else>
              <p class="teaser-current-line">暂未加载推荐曲目</p>
              <div class="empty-actions" @click.stop>
                <button type="button" class="empty-action-pill" @click="retrySeedTrack">
                  <i class="ri-refresh-line"></i>
                  <span>加载心动推荐</span>
                </button>
                <button type="button" class="empty-action-pill secondary" @click="handleGoLibrary">
                  <i class="ri-folder-music-line"></i>
                  <span>离线音乐库</span>
                </button>
              </div>
            </template>
          </div>
        </div>

        <!-- 歌词沉浸视图 -->
        <div v-else key="lyric-view" class="lyrics-stage" @click="handleLyricsBackgroundTap">
          <div class="lyrics-stage-header" @click.stop="toggleLyricsView(false)">
            <span class="back-vinyl-pill">
              <i class="ri-disc-line"></i>
              <span>黑胶唱片</span>
            </span>
          </div>

          <div
            ref="lyricsScrollerRef"
            class="immersive-lyrics-scroller"
            @touchstart="handleLyricScrollTouchStart"
            @touchend="handleLyricScrollTouchEnd"
            @scroll="handleLyricScroll"
          >
            <div class="lyrics-pad"></div>
            <div v-if="lrcArray.length === 0" class="lyric-empty">
              <span>{{ t('player.lrc.noLrc') }}</span>
            </div>
            <div
              v-for="(item, idx) in lrcArray"
              :key="idx"
              :id="`immersive-lyric-line-${idx}`"
              class="immersive-lyric-line"
              :class="{
                'is-active': idx === nowIndex,
                'is-clickable': item.text && item.startTime !== -1
              }"
              @click.stop="handleLyricLineTap(idx, item.startTime)"
            >
              <div
                v-if="item.hasWordByWord && item.words && item.words.length > 0"
                class="word-lyric-row"
              >
                <template v-for="(word, wIdx) in item.words" :key="wIdx">
                  <span class="lyric-word">{{ word.text }}</span>
                  <span v-if="word.space">&nbsp;</span>
                </template>
              </div>
              <span v-else>{{ item.text }}</span>
              <div v-if="item.trText" class="lyric-tr-line">{{ item.trText }}</div>
            </div>
            <div class="lyrics-pad"></div>
          </div>
        </div>
      </transition>
    </main>

    <!-- 3. 底部播控区（位于深色透明导航栏正上方） -->
    <footer class="immersive-controls">
      <!-- 歌名 / 歌手 + 红心收藏 + 更多设置抽屉 -->
      <div class="track-meta-row">
        <div class="track-text-col">
          <h1 class="track-title">
            {{ hasSong ? playMusic.name : isSeeding ? '心动准备中…' : '小庞奶娃音乐' }}
          </h1>
          <div class="track-artists">
            <template v-if="artistList && artistList.length > 0">
              <button
                v-for="(artist, idx) in artistList"
                :key="artist.id || idx"
                type="button"
                class="artist-chip"
                @click="handleArtistClick(artist.id)"
              >
                {{ artist.name }}{{ idx < artistList.length - 1 ? ' / ' : '' }}
              </button>
            </template>
            <span v-else class="artist-placeholder">
              {{ isSeeding ? '自动为你匹配第一首好歌' : '打开即播 · 沉浸听歌' }}
            </span>
          </div>
        </div>

        <div class="track-action-btns">
          <button
            type="button"
            class="icon-action-btn heart-btn"
            :class="{ 'is-favorite': isFavorite }"
            aria-label="收藏歌曲"
            @click="handleToggleFavorite"
          >
            <i :class="isFavorite ? 'ri-heart-3-fill' : 'ri-heart-3-line'"></i>
          </button>
          <button
            type="button"
            class="icon-action-btn"
            aria-label="更多播放设置"
            @click="openSettingsDrawer"
          >
            <i class="ri-more-2-fill"></i>
            <span v-if="playerStore.hasSleepTimerActive" class="timer-dot"></span>
          </button>
        </div>
      </div>

      <!-- 带当前音质/音源文字的进度条 -->
      <div class="progress-block">
        <div
          class="immersive-progress-hit"
          :class="{ dragging: isDraggingProgress }"
          @pointerdown="handleProgressPointerDown"
          @pointermove="handleProgressPointerMove"
          @pointerup="handleProgressPointerUp"
          @pointercancel="handleProgressPointerCancel"
        >
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${displayProgressPercent}%` }"></div>
            <div
              class="progress-thumb"
              :class="{ active: isDraggingProgress }"
              :style="{ left: `${displayProgressPercent}%` }"
            >
              <div v-if="isDraggingProgress" class="thumb-time-bubble">
                {{ secondToMinute(displayTime) }}
              </div>
            </div>
          </div>
        </div>

        <div class="progress-meta-row">
          <span class="time-text">{{ secondToMinute(displayTime) }}</span>
          <span
            v-if="playbackBadgeText"
            class="quality-source-pill"
            :class="`source-${currentPlaybackMeta?.sourceCategory || 'official'}`"
            @click="openSettingsDrawer"
          >
            <i :class="playbackSourceIcon"></i>
            <span>{{ playbackBadgeText }}</span>
          </span>
          <span class="time-text">{{ secondToMinute(allTime) }}</span>
        </div>
      </div>

      <!-- 播放模式 / 上一首 / 播放暂停 / 下一首 / 播放列表 -->
      <div class="transport-row">
        <button
          type="button"
          class="transport-btn secondary"
          :title="playModeText"
          aria-label="切换播放模式"
          @click="handleTogglePlayMode"
        >
          <i class="iconfont" :class="playModeIcon"></i>
        </button>

        <button
          type="button"
          class="transport-btn"
          aria-label="上一首"
          @click="handlePrevTrack"
        >
          <i class="ri-skip-back-fill"></i>
        </button>

        <button
          type="button"
          class="transport-play-btn"
          aria-label="播放或暂停"
          @click="handleTogglePlay"
        >
          <i v-if="playMusic?.playLoading || playerStore.isBuffering" class="ri-loader-4-line animate-spin"></i>
          <i v-else :class="isPlaying ? 'ri-pause-fill' : 'ri-play-fill ml-0.5'"></i>
        </button>

        <button
          type="button"
          class="transport-btn"
          aria-label="下一首"
          @click="handleNextTrack"
        >
          <i class="ri-skip-forward-fill"></i>
        </button>

        <button
          type="button"
          class="transport-btn secondary"
          aria-label="播放列表"
          @click="handleOpenQueue"
        >
          <i class="ri-play-list-2-fill"></i>
        </button>
      </div>
    </footer>

    <!-- 更多设置抽屉（复用 MobilePlayerSettings：EQ / 定时关闭 / 音源详情 / 下载 / 缓存清理） -->
    <mobile-player-settings v-model:visible="showPlayerSettings" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import MobilePlayerSettings from '@/components/player/MobilePlayerSettings.vue';
import {
  allTime,
  artistList,
  lrcArray,
  nowIndex,
  nowTime,
  playMusic,
  setAudioTime,
  setUserSeeking
} from '@/hooks/MusicHook';
import { useArtist } from '@/hooks/useArtist';
import { usePlayMode } from '@/hooks/usePlayMode';
import { audioService } from '@/services/audioService';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';
import { getImgUrl, secondToMinute } from '@/utils';
import { registerAndroidBackHandler, triggerHaptic } from '@/utils/androidBridge';
import {
  DEFAULT_DYNAMIC_PALETTE,
  type DynamicCoverPalette,
  extractCoverPalette
} from '@/utils/coverColorExtractor';
import { formatPlaybackBadgeText, inferPlaybackMetaFromUrl } from '@/utils/playbackMeta';
import { showBottomToast } from '@/utils/shortcutToast';

const emit = defineEmits<{
  (e: 'switch-discover'): void;
}>();

const { t } = useI18n();
const router = useRouter();
const playerStore = usePlayerStore();
const settingsStore = useSettingsStore();
const { navigateToArtist } = useArtist();
const { playModeIcon, playModeText, togglePlayMode } = usePlayMode();

// ==================== 基础播放状态 ====================
const hasSong = computed(() => Boolean(playMusic.value && playMusic.value.id));
const isPlaying = computed(() => Boolean(playerStore.isPlay));
const isSeeding = computed(() => Boolean(playerStore.isSeedingLaunchTrack));
const coverUrl = computed(() => playMusic.value?.picUrl || playMusic.value?.al?.picUrl || '');

// 封面动态弥散深色背景
const dynamicBackgroundEnabled = computed(
  () => settingsStore.setData?.enableDynamicBackground !== false
);
const dynamicPalette = ref<DynamicCoverPalette>(DEFAULT_DYNAMIC_PALETTE);
let paletteSeq = 0;

watch(
  [coverUrl, dynamicBackgroundEnabled],
  async ([url, enabled]) => {
    const seq = ++paletteSeq;
    if (!enabled || !url) {
      dynamicPalette.value = DEFAULT_DYNAMIC_PALETTE;
      return;
    }
    const palette = await extractCoverPalette(getImgUrl(url, '120y120'));
    if (seq === paletteSeq) {
      dynamicPalette.value = palette;
    }
  },
  { immediate: true }
);

const backdropStyle = computed(() => {
  const p = dynamicPalette.value;
  if (!dynamicBackgroundEnabled.value) {
    return {
      '--imm-primary': '#0e1420',
      '--imm-secondary': '#161f33',
      '--imm-orb-primary': 'rgba(255, 197, 51, 0.22)',
      '--imm-orb-secondary': 'rgba(91, 196, 240, 0.16)'
    };
  }
  return {
    '--imm-primary': p.primaryCss,
    '--imm-secondary': p.secondaryCss,
    '--imm-orb-primary': p.orbPrimaryCss,
    '--imm-orb-secondary': p.orbSecondaryCss
  };
});

// 音源与音质标签（复用 playbackMeta.ts）
const currentPlaybackMeta = computed(() => {
  const song = playMusic.value;
  if (!song || !song.id) return null;
  if (song.playbackMeta) return song.playbackMeta;
  return inferPlaybackMetaFromUrl(song.playMusicUrl, {
    isDownloaded: Boolean(song.isDownloadedTrack),
    fallbackQuality: settingsStore.setData?.musicQuality || 'higher'
  });
});

const playbackBadgeText = computed(() => formatPlaybackBadgeText(currentPlaybackMeta.value));

const playbackSourceIcon = computed(() => {
  switch (currentPlaybackMeta.value?.sourceCategory) {
    case 'local':
      return 'ri-folder-music-line';
    case 'downloaded':
      return 'ri-download-cloud-2-line';
    case 'cache':
      return 'ri-hard-drive-2-line';
    case 'lx':
      return 'ri-sparkling-2-line';
    case 'unblock':
    case 'custom':
      return 'ri-route-line';
    default:
      return 'ri-hq-line';
  }
});

// ==================== 顶部导航操作 ====================
const handleHeartbeatTabClick = () => {
  if (showLyrics.value) {
    triggerHaptic('selection');
    showLyrics.value = false;
  }
};

const handleSwitchToDiscover = () => {
  triggerHaptic('selection');
  emit('switch-discover');
};

const handleGoLibrary = () => {
  triggerHaptic('selection');
  router.push('/library');
};

const handleOpenSearch = () => {
  triggerHaptic('selection');
  router.push('/mobile-search');
};

// ==================== 歌词与黑胶切换 ====================
const showLyrics = ref(false);
const showPlayerSettings = ref(false);
const lyricsScrollerRef = ref<HTMLElement | null>(null);
const isTouchScrollingLyrics = ref(false);
let lyricAutoScrollTimer: number | null = null;

const activeLyricText = computed(() => {
  const list = lrcArray.value;
  if (!Array.isArray(list) || list.length === 0) return '纯音乐，静享旋律';
  const cur = list[nowIndex.value];
  return cur?.text?.trim() || list.find((item) => item?.text?.trim())?.text?.trim() || '静享黑胶时光';
});

const activeLyricSubText = computed(() => {
  const list = lrcArray.value;
  if (!Array.isArray(list) || list.length === 0) return '';
  const cur = list[nowIndex.value];
  if (cur?.trText?.trim()) return cur.trText.trim();
  const next = list[nowIndex.value + 1];
  return next?.text?.trim() || '';
});

const scrollToCurrentLyric = (instant: boolean = false) => {
  const container = lyricsScrollerRef.value;
  if (!container) return;
  const activeEl = container.querySelector(`#immersive-lyric-line-${nowIndex.value}`) as HTMLElement | null;
  if (!activeEl) return;
  const targetTop = Math.max(0, activeEl.offsetTop - container.clientHeight * 0.42 + activeEl.offsetHeight / 2);
  container.scrollTo({
    top: targetTop,
    behavior: instant ? 'auto' : 'smooth'
  });
};

const toggleLyricsView = (nextVal?: boolean) => {
  const target = typeof nextVal === 'boolean' ? nextVal : !showLyrics.value;
  if (target === showLyrics.value) return;
  triggerHaptic('selection');
  showLyrics.value = target;
  if (target) {
    nextTick(() => {
      scrollToCurrentLyric(true);
    });
  }
};

watch(nowIndex, () => {
  if (showLyrics.value && !isTouchScrollingLyrics.value && !isDraggingProgress.value) {
    nextTick(() => scrollToCurrentLyric(false));
  }
});

const handleLyricScrollTouchStart = () => {
  isTouchScrollingLyrics.value = true;
  if (lyricAutoScrollTimer !== null) {
    window.clearTimeout(lyricAutoScrollTimer);
    lyricAutoScrollTimer = null;
  }
};

const handleLyricScroll = () => {
  if (!isTouchScrollingLyrics.value) return;
  if (lyricAutoScrollTimer !== null) {
    window.clearTimeout(lyricAutoScrollTimer);
  }
  lyricAutoScrollTimer = window.setTimeout(() => {
    isTouchScrollingLyrics.value = false;
    lyricAutoScrollTimer = null;
    if (showLyrics.value) scrollToCurrentLyric(false);
  }, 2800);
};

const handleLyricScrollTouchEnd = () => {
  if (lyricAutoScrollTimer !== null) {
    window.clearTimeout(lyricAutoScrollTimer);
  }
  lyricAutoScrollTimer = window.setTimeout(() => {
    isTouchScrollingLyrics.value = false;
    lyricAutoScrollTimer = null;
  }, 2800);
};

const handleLyricLineTap = (idx: number, startTime?: number) => {
  if (typeof startTime === 'number' && startTime !== -1) {
    triggerHaptic('selection');
    setAudioTime(idx);
  }
};

const handleLyricsBackgroundTap = () => {
  toggleLyricsView(false);
};

// ==================== 手势切歌（左右滑 + 上下滑） ====================
const swipeStartX = ref(0);
const swipeStartY = ref(0);
const swipeDeltaX = ref(0);
const swipeDeltaY = ref(0);
const isSwiping = ref(false);
const suppressNextTap = ref(false);

const stageSwipeStyle = computed(() => {
  if (!isSwiping.value || (Math.abs(swipeDeltaX.value) < 6 && Math.abs(swipeDeltaY.value) < 6)) {
    return {};
  }
  const dx = Math.max(-72, Math.min(72, swipeDeltaX.value * 0.45));
  const dy = Math.max(-56, Math.min(56, swipeDeltaY.value * 0.35));
  const distance = Math.hypot(dx, dy);
  const opacity = Math.max(0.72, 1 - distance / 240);
  return {
    transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`,
    opacity: String(opacity),
    transition: 'none'
  };
});

const handleStageTouchStart = (e: TouchEvent) => {
  if (e.touches.length !== 1) return;
  swipeStartX.value = e.touches[0].clientX;
  swipeStartY.value = e.touches[0].clientY;
  swipeDeltaX.value = 0;
  swipeDeltaY.value = 0;
  isSwiping.value = true;
};

const handleStageTouchMove = (e: TouchEvent) => {
  if (!isSwiping.value || e.touches.length !== 1) return;
  swipeDeltaX.value = e.touches[0].clientX - swipeStartX.value;
  swipeDeltaY.value = e.touches[0].clientY - swipeStartY.value;
};

const handleStageTouchEnd = () => {
  if (!isSwiping.value) return;
  const dx = swipeDeltaX.value;
  const dy = swipeDeltaY.value;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  isSwiping.value = false;
  swipeDeltaX.value = 0;
  swipeDeltaY.value = 0;

  // 水平滑动切歌（黑胶视图与歌词视图均支持）
  if (absX >= 56 && absX > absY * 1.15) {
    suppressNextTap.value = true;
    if (dx < 0) {
      handleNextTrack();
    } else {
      handlePrevTrack();
    }
    window.setTimeout(() => {
      suppressNextTap.value = false;
    }, 180);
    return;
  }

  // 竖向滑动切歌（仅在黑胶视图生效，避免与歌词滚动冲突）
  if (!showLyrics.value && absY >= 64 && absY > absX * 1.15) {
    suppressNextTap.value = true;
    if (dy < 0) {
      handleNextTrack();
    } else {
      handlePrevTrack();
    }
    window.setTimeout(() => {
      suppressNextTap.value = false;
    }, 180);
  }
};

const handleVinylTap = () => {
  if (suppressNextTap.value) return;
  if (!hasSong.value) return;
  toggleLyricsView(true);
};

// ==================== 底部播控与进度条拖拽 ====================
const isFavorite = computed(() =>
  hasSong.value ? playerStore.favoriteList.includes(playMusic.value.id as number) : false
);

const handleToggleFavorite = () => {
  if (!hasSong.value) return;
  if (isFavorite.value) {
    triggerHaptic('selection');
    playerStore.removeFromFavorite(playMusic.value.id as number);
  } else {
    triggerHaptic('success');
    playerStore.addToFavorite(playMusic.value.id as number);
  }
};

const openSettingsDrawer = () => {
  triggerHaptic('selection');
  showPlayerSettings.value = true;
};

const handleArtistClick = (artistId: number) => {
  if (!artistId) return;
  triggerHaptic('selection');
  navigateToArtist(artistId);
};

const handleTogglePlay = async () => {
  triggerHaptic('light');
  if (!hasSong.value) {
    await retrySeedTrack();
    return;
  }
  try {
    await playerStore.setPlay({ ...playMusic.value });
  } catch (err) {
    console.warn('[ImmersiveVinylHome] toggle play failed:', err);
  }
};

const handlePrevTrack = () => {
  triggerHaptic('light');
  if (playerStore.playList.length > 0) {
    playerStore.prevPlay();
  } else {
    void retrySeedTrack();
  }
};

const handleNextTrack = () => {
  triggerHaptic('light');
  if (playerStore.playList.length > 0) {
    playerStore.nextPlay();
  } else {
    void retrySeedTrack();
  }
};

const handleTogglePlayMode = () => {
  triggerHaptic('selection');
  togglePlayMode();
  showBottomToast(playModeText.value);
};

const handleOpenQueue = () => {
  triggerHaptic('selection');
  playerStore.setPlayListDrawerVisible(true);
};

const retrySeedTrack = async () => {
  const ok = await playerStore.seedInitialLaunchTrack(true);
  if (!ok && navigator.onLine === false) {
    showBottomToast('当前离线，请前往离线音乐库播放');
  }
};

// 进度条拖拽
const isDraggingProgress = ref(false);
const dragTime = ref(0);

const displayTime = computed(() => (isDraggingProgress.value ? dragTime.value : nowTime.value));
const displayProgressPercent = computed(() => {
  const total = allTime.value || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (displayTime.value / total) * 100));
});

const computeSeekTimeFromPointer = (e: PointerEvent): number => {
  const el = e.currentTarget as HTMLElement | null;
  if (!el || !allTime.value || allTime.value <= 0) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  return ratio * allTime.value;
};

const handleProgressPointerDown = (e: PointerEvent) => {
  if (!allTime.value || allTime.value <= 0) return;
  const el = e.currentTarget as HTMLElement | null;
  el?.setPointerCapture?.(e.pointerId);
  isDraggingProgress.value = true;
  setUserSeeking(true);
  dragTime.value = computeSeekTimeFromPointer(e);
  triggerHaptic('selection');
};

const handleProgressPointerMove = (e: PointerEvent) => {
  if (!isDraggingProgress.value) return;
  dragTime.value = computeSeekTimeFromPointer(e);
};

const finishProgressSeek = (commit: boolean) => {
  if (!isDraggingProgress.value) return;
  const target = dragTime.value;
  isDraggingProgress.value = false;
  setUserSeeking(false);
  if (commit && allTime.value > 0) {
    nowTime.value = target;
    audioService.seek(target);
  }
};

const handleProgressPointerUp = () => finishProgressSeek(true);
const handleProgressPointerCancel = () => finishProgressSeek(false);

// ==================== 生命周期与 Android 返回键栈 ====================
let unregisterBack: (() => void) | null = null;

const bindBackHandler = () => {
  if (unregisterBack) return;
  unregisterBack = registerAndroidBackHandler(() => {
    if (showLyrics.value) {
      showLyrics.value = false;
      return true;
    }
    return false;
  }, 60);
};

const unbindBackHandler = () => {
  unregisterBack?.();
  unregisterBack = null;
};

onMounted(() => {
  bindBackHandler();
});

onActivated(() => {
  bindBackHandler();
});

onDeactivated(() => {
  unbindBackHandler();
  showPlayerSettings.value = false;
});

onBeforeUnmount(() => {
  unbindBackHandler();
  if (lyricAutoScrollTimer !== null) {
    window.clearTimeout(lyricAutoScrollTimer);
    lyricAutoScrollTimer = null;
  }
});
</script>

<style lang="scss" scoped>
.immersive-vinyl-home {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  color: #ffffff;
  background-color: #0b101b;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* ==================== 动态封面弥散背景 ==================== */
.immersive-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;

  .backdrop-cover-blur {
    position: absolute;
    inset: -18%;
    background-size: cover;
    background-position: center;
    filter: blur(58px) saturate(1.25);
    opacity: 0.28;
    transform: scale(1.12);
    transition: background-image 0.8s ease, opacity 0.55s ease;
  }

  .backdrop-base-glow {
    position: absolute;
    inset: -20%;
    background: radial-gradient(
      circle at 50% 34%,
      var(--imm-primary, #172033) 0%,
      var(--imm-secondary, #0d1322) 58%,
      #070a12 100%
    );
    opacity: 0.88;
    transition: background 0.85s ease;
  }

  .backdrop-orb-primary {
    position: absolute;
    top: -10%;
    right: -14%;
    width: 72vw;
    height: 72vw;
    border-radius: 9999px;
    background-color: var(--imm-orb-primary, rgba(255, 197, 51, 0.24));
    filter: blur(72px);
    opacity: 0.42;
    transition: background-color 0.85s ease;
  }

  .backdrop-orb-secondary {
    position: absolute;
    bottom: 8%;
    left: -18%;
    width: 78vw;
    height: 78vw;
    border-radius: 9999px;
    background-color: var(--imm-orb-secondary, rgba(91, 196, 240, 0.2));
    filter: blur(78px);
    opacity: 0.36;
    transition: background-color 0.85s ease;
  }

  &.dynamic-disabled {
    .backdrop-cover-blur {
      opacity: 0;
    }
    .backdrop-orb-primary,
    .backdrop-orb-secondary {
      opacity: 0.14;
    }
  }

  .backdrop-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(6, 10, 18, 0.44) 0%,
      rgba(7, 11, 20, 0.52) 45%,
      rgba(6, 9, 16, 0.88) 100%
    );
  }
}

/* ==================== 顶部极简栏 ==================== */
.immersive-top-bar {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--safe-area-inset-top, 0px) + 12px) 18px 8px;
  flex-shrink: 0;
}

.top-spacer {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.top-mode-tabs {
  display: inline-flex;
  align-items: center;
  gap: 20px;
}

.top-tab-btn {
  position: relative;
  padding: 6px 4px 8px;
  font-size: 16px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.56);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.22s ease, transform 0.18s ease;

  &:active {
    transform: scale(0.94);
  }

  &.is-active {
    font-size: 17px;
    font-weight: 700;
    color: #ffffff;
  }

  .tab-indicator {
    position: absolute;
    left: 50%;
    bottom: 1px;
    transform: translateX(-50%);
    width: 18px;
    height: 3px;
    border-radius: 9999px;
    background: linear-gradient(90deg, #ffd147 0%, #fff1b8 100%);
    box-shadow: 0 0 10px rgba(255, 209, 71, 0.72);
  }
}

.top-search-btn {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.2s ease;

  &:active {
    transform: scale(0.9);
    background: rgba(255, 255, 255, 0.18);
  }
}

/* ==================== 中央黑胶 / 歌词舞台 ==================== */
.immersive-stage {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  overflow: hidden;
}

.vinyl-stage {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease;
}

/* 动态唱针摆臂 */
.tonearm-anchor {
  position: relative;
  z-index: 6;
  width: 96px;
  height: 118px;
  margin-bottom: -74px;
  margin-left: 56px;
  transform-origin: 21px 18px;
  transform: rotate(-28deg);
  transition: transform 0.56s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
  filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.52));

  &.is-playing {
    transform: rotate(0deg);
  }

  .tonearm-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
}

/* 大尺寸黑胶唱片 */
.vinyl-disc-shell {
  position: relative;
  width: clamp(224px, 64vw, 294px);
  height: clamp(224px, 64vw, 294px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.is-loading {
    animation: gentle-pulse 1.8s ease-in-out infinite;
  }
}

.vinyl-outer-halo {
  position: absolute;
  inset: -10px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 56px rgba(0, 0, 0, 0.55),
    inset 0 1px 1px rgba(255, 255, 255, 0.16);
}

.vinyl-platter {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  background: radial-gradient(
    circle at center,
    #1b1f27 0%,
    #12151c 48%,
    #0b0d12 72%,
    #191d26 88%,
    #0a0c10 100%
  );
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.08),
    0 12px 30px rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: vinyl-spin 22s linear infinite;
  animation-play-state: running;
  will-change: transform;

  &.is-paused {
    animation-play-state: paused;
  }
}

.vinyl-grooves {
  position: absolute;
  inset: 4%;
  border-radius: 9999px;
  background: repeating-radial-gradient(
    circle at center,
    rgba(255, 255, 255, 0.045) 0px,
    rgba(255, 255, 255, 0.045) 1px,
    transparent 1px,
    transparent 4px
  );
  pointer-events: none;
}

.vinyl-glint {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: conic-gradient(
    from 35deg,
    transparent 0deg,
    rgba(255, 255, 255, 0.11) 24deg,
    transparent 52deg,
    transparent 180deg,
    rgba(255, 255, 255, 0.08) 208deg,
    transparent 240deg,
    transparent 360deg
  );
  pointer-events: none;
}

.vinyl-cover-wrap {
  position: relative;
  z-index: 2;
  width: 64%;
  height: 64%;
  border-radius: 9999px;
  overflow: hidden;
  border: 3px solid rgba(12, 15, 22, 0.92);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.12),
    0 8px 20px rgba(0, 0, 0, 0.45);
  background: linear-gradient(135deg, #1f2937 0%, #0f172a 100%);
}

.vinyl-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.vinyl-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: rgba(255, 209, 71, 0.72);
}

.vinyl-spindle {
  position: absolute;
  z-index: 4;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  background: #0e131e;
  border: 2.5px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.65);
}

/* 黑胶下方轻量歌词预览 */
.vinyl-lyric-teaser {
  margin-top: 22px;
  width: 100%;
  max-width: 340px;
  text-align: center;
  padding: 0 8px;

  .teaser-current-line {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.92);
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .teaser-sub-line,
  .teaser-hint-line {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-actions {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .empty-action-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    color: #1c1404;
    background: linear-gradient(135deg, #ffd147 0%, #f59e0b 100%);
    border: none;
    cursor: pointer;

    &.secondary {
      color: rgba(255, 255, 255, 0.9);
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
    }
  }
}

/* 歌词沉浸视图 */
.lyrics-stage {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
}

.lyrics-stage-header {
  padding: 4px 0 8px;
  flex-shrink: 0;
}

.back-vinyl-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.immersive-lyrics-scroller {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  text-align: center;
  padding: 0 8px;
  -webkit-overflow-scrolling: touch;
  mask-image: linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%);

  &::-webkit-scrollbar {
    display: none;
  }
}

.lyrics-pad {
  height: 36%;
}

.lyric-empty {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.56);
  padding: 24px 0;
}

.immersive-lyric-line {
  padding: 10px 8px;
  font-size: 15px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.46);
  transition: color 0.25s ease, transform 0.25s ease, font-size 0.25s ease;

  &.is-clickable {
    cursor: pointer;
  }

  &.is-active {
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0 2px 14px rgba(255, 209, 71, 0.25);
  }

  .lyric-tr-line {
    margin-top: 4px;
    font-size: 12.5px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.58);
  }
}

/* ==================== 底部播控区 ==================== */
.immersive-controls {
  position: relative;
  z-index: 5;
  flex-shrink: 0;
  width: 100%;
  padding: 4px 24px calc(var(--safe-area-inset-bottom, 10px) + 84px);
}

.track-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.track-text-col {
  min-width: 0;
  flex: 1;
}

.track-title {
  font-size: 19px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-artists {
  margin-top: 3px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.66);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .artist-chip {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
    cursor: pointer;

    &:active {
      color: #ffd147;
    }
  }
}

.track-action-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.icon-action-btn {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  transition: transform 0.18s ease, color 0.2s ease, background-color 0.2s ease;

  &:active {
    transform: scale(0.88);
  }

  &.heart-btn.is-favorite {
    color: #ff4d6d;
    background: rgba(255, 77, 109, 0.16);
    border-color: rgba(255, 77, 109, 0.35);
  }

  .timer-dot {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #ffd147;
    box-shadow: 0 0 6px #ffd147;
  }
}

/* 带音质/音源文字的进度条 */
.progress-block {
  margin-bottom: 10px;
}

.immersive-progress-hit {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;

  .progress-track {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.2);
    transition: height 0.15s ease;
  }

  .progress-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    border-radius: 9999px;
    background: linear-gradient(90deg, #ffd147 0%, #fff4cc 68%, #ffffff 100%);
    box-shadow: 0 0 10px rgba(255, 209, 71, 0.45);
    pointer-events: none;
  }

  .progress-thumb {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 12px;
    height: 12px;
    border-radius: 9999px;
    background: #ffffff;
    box-shadow:
      0 0 0 3px rgba(255, 209, 71, 0.35),
      0 2px 8px rgba(0, 0, 0, 0.45);
    transition: transform 0.14s ease;
    pointer-events: none;

    &.active {
      transform: translate(-50%, -50%) scale(1.38);
    }

    .thumb-time-bubble {
      position: absolute;
      bottom: 22px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(255, 209, 71, 0.5);
      color: #fde68a;
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  }

  &.dragging .progress-track {
    height: 6px;
  }
}

.progress-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: -2px;
}

.time-text {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.56);
  min-width: 34px;

  &:last-child {
    text-align: right;
  }
}

.quality-source-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  cursor: pointer;

  i {
    font-size: 11.5px;
    color: #ffd147;
  }

  &.source-cache i,
  &.source-downloaded i,
  &.source-local i {
    color: #6ee7b7;
  }

  &.source-lx i,
  &.source-unblock i,
  &.source-custom i {
    color: #7dd3fc;
  }
}

/* 主播控按钮行 */
.transport-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 0;
}

.transport-btn {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: rgba(255, 255, 255, 0.92);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.16s ease, color 0.18s ease;

  &.secondary {
    font-size: 20px;
    color: rgba(255, 255, 255, 0.68);
  }

  &:active {
    transform: scale(0.88);
  }
}

.transport-play-btn {
  width: 60px;
  height: 60px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  color: #141821;
  background: linear-gradient(145deg, #ffffff 0%, #fff2c2 100%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow:
    0 10px 26px rgba(0, 0, 0, 0.42),
    0 0 20px rgba(255, 209, 71, 0.25);
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.2s ease;

  &:active {
    transform: scale(0.92);
  }
}

/* ==================== 动画 ==================== */
@keyframes vinyl-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes gentle-pulse {
  0%,
  100% {
    opacity: 0.9;
    transform: scale(0.985);
  }
  50% {
    opacity: 1;
    transform: scale(1.015);
  }
}

.vinyl-lyric-fade-enter-active,
.vinyl-lyric-fade-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.vinyl-lyric-fade-enter-from,
.vinyl-lyric-fade-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

/* 矮屏设备自适应微调 */
@media (max-height: 700px) {
  .tonearm-anchor {
    width: 82px;
    height: 100px;
    margin-bottom: -64px;
  }

  .vinyl-disc-shell {
    width: clamp(192px, 54vw, 236px);
    height: clamp(192px, 54vw, 236px);
  }

  .vinyl-lyric-teaser {
    margin-top: 14px;
  }

  .transport-play-btn {
    width: 54px;
    height: 54px;
    font-size: 27px;
  }
}
</style>
