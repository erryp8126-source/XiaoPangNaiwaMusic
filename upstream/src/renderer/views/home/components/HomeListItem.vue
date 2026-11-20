<template>
  <div
    class="home-list-card group cursor-pointer active:scale-[0.97] transition-transform duration-200"
    :style="{ animationDelay }"
    @click="$emit('click')"
  >
    <!-- Cover -->
    <div
      class="relative aspect-square overflow-hidden rounded-[20px] bg-sky-100/70 dark:bg-slate-800/90 shadow-naiwa-sm ring-1 ring-white/80 dark:ring-white/10 transition-all duration-300 ease-out group-hover:shadow-xl"
    >
      <img
        ref="coverRef"
        :src="getImgUrl(cover, '512y512')"
        class="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        loading="lazy"
        :alt="title"
        crossorigin="anonymous"
        @load="extractColor"
      />

      <!-- Hover Overlay with Song Preview (Desktop) -->
      <div
        v-if="showHoverTracks"
        class="absolute inset-0 flex items-end opacity-0 transition-all duration-500 ease-out group-hover:opacity-100"
        :style="overlayStyle"
      >
        <div class="flex w-full items-end justify-between gap-3 p-4">
          <div
            class="min-w-0 flex-1 translate-y-3 space-y-1.5 transition-all duration-500 ease-out group-hover:translate-y-0"
          >
            <div
              v-for="(track, idx) in displayTracks"
              :key="idx"
              class="flex items-center gap-2.5 text-white/95"
            >
              <span class="w-5 flex-shrink-0 text-center text-xs font-bold text-white/50">{{
                idx + 1
              }}</span>
              <span class="truncate text-sm font-semibold tracking-wide">{{ track.name }}</span>
            </div>
            <div v-if="tracks.length === 0" class="py-4 text-center text-xs text-white/50">
              {{ t('comp.homeListItem.loading') }}
            </div>
          </div>

          <button
            class="flex h-11 w-11 flex-shrink-0 translate-y-2 items-center justify-center rounded-full text-white shadow-xl transition-all duration-500 ease-out hover:scale-110 group-hover:translate-y-0 active:scale-95"
            style="background: linear-gradient(135deg, #ffd147 0%, #f09000 100%)"
            @click.stop="$emit('play')"
          >
            <i class="ri-play-fill ml-0.5 text-lg" />
          </button>
        </div>
      </div>

      <!-- 移动端快捷播放悬浮圆标 -->
      <button
        v-if="!showHoverTracks"
        type="button"
        class="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-amber-600 shadow-lg backdrop-blur-md active:scale-90 transition-transform dark:bg-slate-900/85 dark:text-amber-300"
        @click.stop="$emit('play')"
      >
        <i class="ri-play-fill ml-0.5 text-base" />
      </button>

      <!-- Badge -->
      <div
        v-if="badge"
        class="absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white shadow-md backdrop-blur-md"
        :class="badgeClass"
      >
        {{ badge }}
      </div>

      <!-- Play Count (for playlists) -->
      <div
        v-if="playCount"
        class="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-slate-950/45 px-2.5 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-md"
      >
        <i class="ri-headphone-fill text-[10px] text-amber-300" />
        <span>{{ formatNumber(playCount) }}</span>
      </div>
    </div>

    <!-- Info -->
    <div class="mt-2.5 px-1">
      <h3
        class="line-clamp-2 text-[13.5px] md:text-[15px] font-bold leading-snug tracking-tight text-slate-800 transition-colors duration-200 group-hover:text-primary dark:text-slate-100"
      >
        {{ title }}
      </h3>
      <p
        v-if="subtitle"
        class="mt-1 truncate text-xs font-medium text-slate-400 dark:text-slate-400"
      >
        {{ subtitle }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatNumber, getImgUrl } from '@/utils';
import { getImageBackground } from '@/utils/linearColor';

interface Track {
  id: number;
  name: string;
}

const props = withDefaults(
  defineProps<{
    cover: string;
    title: string;
    subtitle?: string;
    tracks?: Track[];
    badge?: string;
    badgeType?: 'new' | 'hot' | 'recommend';
    playCount?: number;
    animationDelay?: string;
    showHoverTracks?: boolean;
  }>(),
  {
    tracks: () => [],
    animationDelay: '0s',
    showHoverTracks: true
  }
);

defineEmits<{
  (e: 'click'): void;
  (e: 'play'): void;
}>();

const { t } = useI18n();
const coverRef = ref<HTMLImageElement | null>(null);
const backgroundGradient = ref(
  'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)'
);

const displayTracks = computed(() => props.tracks.slice(0, 3));

const badgeClass = computed(() => {
  switch (props.badgeType) {
    case 'new':
      return 'bg-gradient-to-r from-orange-500 to-rose-500';
    case 'hot':
      return 'bg-gradient-to-r from-rose-500 to-pink-500';
    case 'recommend':
      return 'bg-gradient-to-r from-primary to-blue-500';
    default:
      return 'bg-gradient-to-r from-primary to-blue-500';
  }
});

const overlayStyle = computed(() => ({
  background: backgroundGradient.value
}));

const extractColor = async () => {
  const img = coverRef.value;
  if (!img) return;

  try {
    const { primaryColor } = await getImageBackground(img);
    if (primaryColor) {
      // 使用 tinycolor 来创建更自然的渐变效果
      const tinycolor = (await import('tinycolor2')).default;
      const baseColor = tinycolor(primaryColor);
      const hsl = baseColor.toHsl();

      // 创建深色渐变，确保文字可读性
      const darkColor = tinycolor({
        h: hsl.h,
        s: Math.min(hsl.s * 1.3, 1),
        l: Math.max(hsl.l * 0.15, 0.05)
      }).setAlpha(0.95);

      const midColor = tinycolor({
        h: hsl.h,
        s: Math.min(hsl.s * 1.1, 1),
        l: Math.max(hsl.l * 0.4, 0.1)
      }).setAlpha(0.85);

      const topColor = tinycolor({
        h: hsl.h,
        s: hsl.s * 0.8,
        l: Math.min(hsl.l * 0.6, 0.2)
      }).setAlpha(0.3);

      backgroundGradient.value = `linear-gradient(to top, ${darkColor.toRgbString()} 0%, ${midColor.toRgbString()} 60%, ${topColor.toRgbString()} 100%)`;
    }
  } catch (error) {
    console.debug('Color extraction failed:', error);
    // 使用深色fallback
    backgroundGradient.value =
      'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.75) 60%, rgba(0,0,0,0.3) 100%)';
  }
};
</script>

<style scoped>
.home-list-card {
  animation: itemFadeIn 0.5s ease-out backwards;
}

@keyframes itemFadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
