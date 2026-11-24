<template>
  <section class="playlist-section">
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
        class="group flex items-center gap-0.5 rounded-full bg-white/75 dark:bg-[#1C1C22] border border-sky-100 dark:border-white/[0.08] px-3 py-1 text-xs font-semibold text-slate-500 dark:text-[#FAFAFA] transition-all active:scale-95 hover:text-primary"
        @click="$emit('more')"
      >
        <span>{{ t('comp.more') }}</span>
        <i class="ri-arrow-right-s-line text-sm transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="grid gap-3.5 md:gap-6" :style="gridStyle">
      <div v-for="i in displayCount" :key="i" class="space-y-2.5">
        <div class="aspect-square skeleton-shimmer rounded-[20px]" />
        <div class="h-4 w-3/4 skeleton-shimmer rounded-lg" />
        <div class="h-3 w-1/2 skeleton-shimmer rounded-lg" />
      </div>
    </div>

    <!-- Playlist Grid -->
    <div v-else-if="displayPlaylists.length > 0" class="grid gap-3.5 md:gap-6" :style="gridStyle">
      <home-list-item
        v-for="(item, index) in displayPlaylists"
        :key="item.id"
        :cover="item.picUrl"
        :title="item.name"
        :subtitle="item.copywriter"
        :tracks="isElectron ? playlistTracksMap[item.id] || [] : []"
        :show-hover-tracks="isElectron"
        :play-count="item.playCount"
        :animation-delay="calculateAnimationDelay(index, 0.04)"
        @click="handlePlaylistClick(item)"
        @play="playPlaylist(item)"
        @mouseenter="isElectron && loadTracksOnHover(item.id)"
      />
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-neutral-400">
      <i class="ri-play-list-2-line mb-4 text-5xl opacity-20" />
      <p class="text-sm font-medium">{{ t('comp.recommendSonglist.empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getPersonalizedPlaylist } from '@/api/home';
import { getListDetail } from '@/api/list';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import { usePlayerCoreStore } from '@/store/modules/playerCore';
import { usePlaylistStore } from '@/store/modules/playlist';
import { calculateAnimationDelay, isElectron, isMobile } from '@/utils';

import HomeListItem from './HomeListItem.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    limit?: number;
    columns?: number;
    rows?: number;
  }>(),
  {
    limit: 15,
    columns: 5,
    rows: 3
  }
);

defineEmits<{
  (e: 'more'): void;
}>();

const { t } = useI18n();
const router = useRouter();
const playlists = ref<any[]>([]);
const loading = ref(true);
const playlistTracksMap = reactive<Record<number, any[]>>({});

const effectiveColumns = computed(() =>
  isMobile.value ? Math.min(2, props.columns) : props.columns
);
const effectiveRows = computed(() => (isMobile.value ? 2 : props.rows));

// Calculate display count to fill exactly N rows
const displayCount = computed(() => effectiveColumns.value * effectiveRows.value);

const displayPlaylists = computed(() => {
  const count = displayCount.value;
  return playlists.value.slice(0, count);
});

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${effectiveColumns.value}, minmax(0, 1fr))`
}));

const fetchPlaylists = async () => {
  try {
    const { data } = await getPersonalizedPlaylist(props.limit || displayCount.value + 5);
    if (data.code === 200) {
      playlists.value = data.result || [];
    }
  } catch (error) {
    console.error('Failed to fetch playlists:', error);
  } finally {
    loading.value = false;
  }
};

/** Lazy load tracks for a single playlist on hover */
const loadTracksOnHover = async (id: number) => {
  if (playlistTracksMap[id]) return;
  try {
    const { data } = await getListDetail(id);
    if (data.playlist?.tracks) {
      playlistTracksMap[id] = data.playlist.tracks.slice(0, 3).map((s: any) => ({
        id: s.id,
        name: s.name
      }));
    }
  } catch {
    // silent — user can retry by hovering again
  }
};

const handlePlaylistClick = async (item: any) => {
  try {
    navigateToMusicList(router, {
      id: item.id,
      type: 'playlist',
      name: item.name,
      listInfo: item,
      canRemove: false
    });
  } catch (error) {
    console.error('Failed to navigate to playlist:', error);
  }
};

const playPlaylist = async (item: any) => {
  try {
    const { data } = await getListDetail(item.id);
    if (data.playlist?.tracks?.length > 0) {
      const playerCore = usePlayerCoreStore();
      const playlistStore = usePlaylistStore();

      const playlist = data.playlist.tracks.map((s: any) => ({
        id: s.id,
        name: s.name,
        picUrl: s.al?.picUrl || item.picUrl,
        source: 'netease',
        song: s,
        ...s,
        playLoading: false
      }));

      playlistStore.setPlayList(playlist, false, false);
      await playerCore.handlePlayMusic(playlist[0], true);
    }
  } catch (error) {
    console.error('Failed to play playlist:', error);
  }
};

onMounted(() => {
  fetchPlaylists();
});
</script>
