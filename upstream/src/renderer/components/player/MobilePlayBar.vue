<template>
  <div
    ref="playBarRef"
    class="mobile-play-bar"
    :class="[
      setAnimationClass('animate__fadeInUp'),
      playerStore.musicFull ? 'play-bar-expanded' : 'play-bar-mini',
      shouldShowMobileMenu ? 'is-menu-show' : 'is-menu-hide'
    ]"
  >
    <!-- Mini模式 - 奶娃悬浮磨砂胶囊播控条 -->
    <div
      v-if="!playerStore.musicFull"
      class="mobile-mini-controls"
      :class="{ 'has-dynamic-bg': dynamicBackgroundEnabled }"
      :style="miniDynamicStyle"
    >
      <!-- 封面动态弥散渐变层 -->
      <div class="mini-dynamic-bg" aria-hidden="true">
        <span class="mini-orb-primary"></span>
        <span class="mini-orb-secondary"></span>
      </div>

      <!-- 底部实时进度细线 -->
      <div class="mini-progress-track">
        <div class="mini-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
      </div>

      <!-- 歌曲信息（点击展开全屏播放器） -->
      <div class="mini-song-info" @click="setMusicFull">
        <div class="mini-cover-ring" :class="{ 'is-playing': play }">
          <n-image
            :src="getImgUrl(playMusic?.picUrl, '120y120')"
            class="mini-song-cover"
            lazy
            preview-disabled
          />
          <span class="mini-cover-center"></span>
        </div>
        <div class="mini-song-text">
          <div class="mini-song-title-row">
            <span class="mini-song-title">{{ playMusic.name }}</span>
            <span v-if="play" class="mini-eq">
              <i></i><i></i><i></i>
            </span>
          </div>
          <div class="mini-song-artist">
            <template v-for="(artists, artistsindex) in artistList" :key="artistsindex">
              {{ artists.name }}{{ artistsindex < artistList.length - 1 ? ' / ' : '' }}
            </template>
          </div>
        </div>
      </div>

      <!-- 右侧播控按钮 -->
      <div class="mini-playback-controls">
        <button type="button" class="mini-play-btn" @click.stop="playMusicEvent">
          <i :class="play ? 'ri-pause-fill' : 'ri-play-fill ml-0.5'"></i>
        </button>
        <button type="button" class="mini-list-btn" @click.stop="openPlayListDrawer">
          <i class="ri-play-list-2-fill"></i>
        </button>
      </div>
    </div>

    <!-- 全屏播放器 -->
    <music-full-wrapper
      ref="MusicFullRef"
      v-model="playerStore.musicFull"
      :background="background"
    />
  </div>
</template>

<script lang="ts" setup>
import { useSwipe } from '@vueuse/core';
import type { Ref } from 'vue';
import { computed, inject, onMounted, ref, watch } from 'vue';

import MusicFullWrapper from '@/components/lyric/MusicFullWrapper.vue';
import { allTime, artistList, nowTime, playMusic } from '@/hooks/MusicHook';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';
import { getImgUrl, setAnimationClass } from '@/utils';
import { triggerHaptic } from '@/utils/androidBridge';
import {
  DEFAULT_DYNAMIC_PALETTE,
  type DynamicCoverPalette,
  extractCoverPalette
} from '@/utils/coverColorExtractor';

const shouldShowMobileMenu = inject('shouldShowMobileMenu') as Ref<boolean>;

const playerStore = usePlayerStore();
const settingsStore = useSettingsStore();

const play = computed(() => playerStore.isPlay);
const background = ref('#131926');

const dynamicBackgroundEnabled = computed(
  () => settingsStore.setData?.enableDynamicBackground !== false
);
const dynamicPalette = ref<DynamicCoverPalette>(DEFAULT_DYNAMIC_PALETTE);
let miniPaletteSeq = 0;

watch(
  [() => playMusic.value?.picUrl, dynamicBackgroundEnabled],
  async ([picUrl, enabled]) => {
    const seq = ++miniPaletteSeq;
    if (!enabled || !picUrl) {
      dynamicPalette.value = DEFAULT_DYNAMIC_PALETTE;
      return;
    }
    const palette = await extractCoverPalette(getImgUrl(picUrl, '120y120'));
    if (seq === miniPaletteSeq) {
      dynamicPalette.value = palette;
    }
  },
  { immediate: true }
);

const miniDynamicStyle = computed(() => {
  const palette = dynamicPalette.value;
  return {
    '--mini-dark-primary': palette.primaryCss,
    '--mini-dark-secondary': palette.secondaryCss,
    '--mini-orb-primary': palette.orbPrimaryCss,
    '--mini-orb-secondary': palette.orbSecondaryCss,
    '--mini-light-primary': palette.lightTintPrimaryCss,
    '--mini-light-secondary': palette.lightTintSecondaryCss
  };
});

const progressPercent = computed(() => {
  if (!allTime.value || allTime.value <= 0) return 0;
  return Math.min(100, Math.max(0, (nowTime.value / allTime.value) * 100));
});

function handleNext() {
  triggerHaptic('medium');
  playerStore.nextPlay();
}

function handlePrev() {
  triggerHaptic('medium');
  playerStore.prevPlay();
}

const MusicFullRef = ref<any>(null);

const setMusicFull = () => {
  triggerHaptic('light');
  playerStore.setMusicFull(!playerStore.musicFull);
  if (playerStore.musicFull) {
    settingsStore.showArtistDrawer = false;
  }
};

const openPlayListDrawer = () => {
  triggerHaptic('selection');
  playerStore.setPlayListDrawerVisible(true);
};

const playMusicEvent = async () => {
  if (!playMusic.value?.id) return;
  triggerHaptic('light');
  try {
    await playerStore.setPlay({ ...playMusic.value });
  } catch (error) {
    console.error('播放出错:', error);
    playerStore.nextPlay();
  }
};

// 滑动切歌
const playBarRef = ref<HTMLElement | null>(null);
onMounted(() => {
  if (playBarRef.value) {
    const { direction } = useSwipe(playBarRef, {
      onSwipeEnd: () => {
        if (playerStore.musicFull) return;
        if (direction.value === 'left') handleNext();
        if (direction.value === 'right') handlePrev();
      },
      threshold: 35
    });
  }
});

watch(
  () => playerStore.playMusic,
  async () => {
    background.value = (playMusic.value.backgroundColor as string) || '#131926';
  },
  { immediate: true, deep: true }
);
</script>

<style lang="scss" scoped>
.mobile-play-bar {
  @apply fixed left-0 w-full flex flex-col;
  z-index: 9500;
  animation-duration: 0.28s !important;
  transition: bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1);

  &.is-menu-show {
    bottom: calc(var(--safe-area-inset-bottom, 10px) + 74px);
  }

  &.is-menu-hide {
    bottom: calc(var(--safe-area-inset-bottom, 10px) + 12px);
  }

  &.play-bar-mini {
    @apply px-3.5;
  }

  .mobile-mini-controls {
    @apply relative flex items-center justify-between pl-2 pr-2.5 h-[58px] overflow-hidden;
    border-radius: 24px;
    background-color: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.94);
    box-shadow:
      0 10px 30px rgba(72, 126, 162, 0.16),
      0 2px 8px rgba(232, 146, 0, 0.09);
    transition: background-color 0.75s ease, border-color 0.6s ease;

    &.has-dynamic-bg {
      background-color: var(--mini-light-primary, rgba(255, 255, 255, 0.9));

      .mini-dynamic-bg {
        opacity: 1;
      }
    }
  }

  .mini-dynamic-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.5s ease;

    .mini-orb-primary {
      position: absolute;
      left: -10%;
      top: -65%;
      width: 58%;
      height: 220%;
      border-radius: 9999px;
      background-color: var(--mini-light-primary, rgba(255, 240, 200, 0.45));
      filter: blur(24px);
      opacity: 0.7;
      transition: background-color 0.75s ease;
    }

    .mini-orb-secondary {
      position: absolute;
      right: -8%;
      bottom: -65%;
      width: 52%;
      height: 220%;
      border-radius: 9999px;
      background-color: var(--mini-light-secondary, rgba(210, 236, 252, 0.45));
      filter: blur(26px);
      opacity: 0.7;
      transition: background-color 0.75s ease;
    }
  }

  .mini-progress-track {
    position: absolute;
    z-index: 2;
    left: 20px;
    right: 20px;
    bottom: 0;
    height: 2.5px;
    background: rgba(148, 185, 212, 0.22);
    border-radius: 9999px;
    overflow: hidden;
    pointer-events: none;

    .mini-progress-fill {
      height: 100%;
      border-radius: 9999px;
      background: linear-gradient(90deg, #ffb800 0%, #f09000 65%, #38bdf8 100%);
      transition: width 0.25s linear;
    }
  }

  .mini-song-info {
    @apply relative z-[1] flex items-center flex-1 min-w-0 cursor-pointer py-1;

    .mini-cover-ring {
      @apply relative w-[44px] h-[44px] rounded-full flex-shrink-0 p-[2.5px];
      background: linear-gradient(135deg, #ffd147 0%, #f09000 55%, #7dd3fc 100%);
      box-shadow: 0 4px 12px rgba(232, 146, 0, 0.28);
      animation: miniSpin 18s linear infinite;
      animation-play-state: paused;

      &.is-playing {
        animation-play-state: running;
      }

      .mini-song-cover {
        @apply w-full h-full rounded-full overflow-hidden block;
      }

      .mini-cover-center {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.35);
        pointer-events: none;
      }
    }

    .mini-song-text {
      @apply ml-3 min-w-0 flex-1 flex flex-col justify-center;

      .mini-song-title-row {
        @apply flex items-center gap-1.5 min-w-0;
      }

      .mini-song-title {
        @apply text-[14px] font-bold text-slate-800 truncate leading-snug;
      }

      .mini-song-artist {
        @apply text-[11.5px] font-medium text-slate-500 truncate leading-tight mt-0.5;
      }
    }
  }

  .mini-eq {
    @apply inline-flex items-end gap-[2px] h-3 flex-shrink-0;

    i {
      display: block;
      width: 2.5px;
      border-radius: 9999px;
      background: linear-gradient(to top, #f09000, #ffd147);
      animation: miniEq 0.75s ease-in-out infinite alternate;

      &:nth-child(1) {
        height: 5px;
        animation-delay: 0s;
      }
      &:nth-child(2) {
        height: 10px;
        animation-delay: 0.2s;
      }
      &:nth-child(3) {
        height: 7px;
        animation-delay: 0.38s;
      }
    }
  }

  .mini-playback-controls {
    @apply relative z-[1] flex items-center gap-1.5 ml-2 flex-shrink-0;

    .mini-play-btn {
      @apply w-9 h-9 rounded-full flex items-center justify-center text-white text-[19px];
      @apply transition-transform duration-150 active:scale-90;
      background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
      box-shadow: 0 4px 12px rgba(232, 146, 0, 0.36);
    }

    .mini-list-btn {
      @apply w-9 h-9 rounded-full flex items-center justify-center text-[19px] text-slate-600;
      @apply transition-all duration-150 active:scale-90;
      background: rgba(238, 245, 250, 0.9);
    }
  }
}

:global(.dark) .mobile-play-bar {
  .mobile-mini-controls {
    background-color: rgba(23, 31, 45, 0.9);
    border-color: rgba(255, 255, 255, 0.12);
    box-shadow:
      0 12px 34px rgba(0, 0, 0, 0.52),
      0 0 0 0.5px rgba(255, 197, 51, 0.12);

    &.has-dynamic-bg {
      background-color: var(--mini-dark-primary, rgba(23, 31, 45, 0.9));
    }
  }

  .mini-dynamic-bg {
    .mini-orb-primary {
      background-color: var(--mini-orb-primary, rgba(64, 96, 160, 0.55));
      opacity: 0.34;
    }

    .mini-orb-secondary {
      background-color: var(--mini-dark-secondary, rgba(28, 38, 56, 0.85));
      opacity: 0.52;
    }
  }

  .mini-progress-track {
    background: rgba(255, 255, 255, 0.1);
  }

  .mini-song-title {
    color: #f8fafc;
  }

  .mini-song-artist {
    color: #94a3b8;
  }

  .mini-list-btn {
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.08);
  }
}

@keyframes miniSpin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes miniEq {
  0% {
    transform: scaleY(0.45);
  }
  100% {
    transform: scaleY(1.15);
  }
}
</style>
