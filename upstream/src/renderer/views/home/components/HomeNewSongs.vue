<template>
  <section class="new-songs-section">
    <!-- Section Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="h-5 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-sky-400" />
        <h2 class="text-[19px] font-extrabold tracking-tight text-slate-800 md:text-2xl dark:text-slate-100">
          {{ title }}
        </h2>
      </div>
      <button
        type="button"
        class="play-all-btn flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-all active:scale-95"
        style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
        @click="playAll"
      >
        <i class="ri-play-fill text-sm"></i>
        <span>{{ t('common.playAll') }}</span>
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="songs-grid grid gap-3" :class="gridClass">
      <div v-for="i in 10" :key="i" class="h-20 skeleton-shimmer rounded-xl md:rounded-2xl" />
    </div>

    <!-- Songs Grid (Even columns: 1→2→3→4→5) -->
    <div v-else class="songs-grid grid gap-2 md:gap-3" :class="gridClass">
      <song-item
        v-for="(song, index) in songs"
        :key="song.id"
        :item="song"
        home
        :favorite="false"
        :style="{ animationDelay: calculateAnimationDelay(index % 5, 0.05) }"
        class="animate-item"
        @play="playSong(song)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { getRecommendMusic } from '@/api/home';
import SongItem from '@/components/common/SongItem.vue';
import { usePlayerStore } from '@/store';
import { SongResult } from '@/types/music';
import { calculateAnimationDelay, isMobile } from '@/utils';

const props = defineProps<{
  title: string;
  limit?: number;
}>();

const { t } = useI18n();
const playerStore = usePlayerStore();
const songs = ref<SongResult[]>([]);
const loading = ref(true);
const gridClass = computed(() =>
  isMobile.value
    ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
);

const fetchSongs = async () => {
  try {
    const { data } = await getRecommendMusic({ limit: props.limit || 12 });
    if (data.code === 200) {
      // 转换数据格式为 SongResult
      songs.value = data.result.slice(0, props.limit || 12).map((item: any) => ({
        ...item,
        source: 'netease',
        picUrl: item.picUrl,
        al: {
          picUrl: item.picUrl,
          name: item.name,
          id: item.id
        },
        ar: item.song.artists
      })) as SongResult[];
    }
  } catch (error) {
    console.error('Failed to fetch new songs:', error);
  } finally {
    loading.value = false;
  }
};

const playSong = (song: SongResult) => {
  playerStore.setPlay(song);
};

const playAll = () => {
  if (songs.value.length > 0) {
    playerStore.setPlayList(songs.value);
    playerStore.setPlay(songs.value[0]);
  }
};

onMounted(() => {
  fetchSongs();
});
</script>

<style scoped>
/* 网格 */
.songs-grid {
  grid-auto-rows: auto;
}
</style>
