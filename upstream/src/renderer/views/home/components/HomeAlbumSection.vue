<template>
  <section class="album-section">
    <!-- Section Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="h-5 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-orange-400" />
        <h2 class="text-[19px] font-extrabold tracking-tight text-slate-800 md:text-2xl dark:text-slate-100">
          {{ title }}
        </h2>
      </div>
      <button
        type="button"
        class="group flex items-center gap-0.5 rounded-full bg-white/75 dark:bg-[#1C2638] border border-sky-100 dark:border-white/[0.08] px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-200 transition-all active:scale-95 hover:text-primary"
        @click="$emit('more')"
      >
        <span>{{ t('comp.more') }}</span>
        <i class="ri-arrow-right-s-line text-sm transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 md:gap-6">
      <div v-for="i in displayCount" :key="i" class="space-y-2.5">
        <div class="aspect-square skeleton-shimmer rounded-[20px]" />
        <div class="h-4 w-3/4 skeleton-shimmer rounded-lg" />
        <div class="h-3 w-1/2 skeleton-shimmer rounded-lg" />
      </div>
    </div>

    <!-- Album Grid -->
    <div
      v-else-if="displayAlbums.length > 0"
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 md:gap-6"
    >
      <home-list-item
        v-for="(album, index) in displayAlbums"
        :key="album.id"
        :cover="album.picUrl"
        :title="album.name"
        :subtitle="getArtistNames(album)"
        :tracks="albumTracksMap[album.id] || []"
        :show-hover-tracks="!isMobile"
        :animation-delay="calculateAnimationDelay(index, 0.04)"
        @click="handleAlbumClick(album)"
        @play="playAlbum(album)"
      />
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-neutral-400">
      <i class="ri-album-line mb-4 text-5xl opacity-20" />
      <p class="text-sm font-medium">{{ t('comp.newAlbum.empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getTopAlbum } from '@/api/home';
import { getAlbum } from '@/api/list';
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
    limit: 10,
    columns: 5,
    rows: 2
  }
);

defineEmits<{
  (e: 'more'): void;
}>();

const { t } = useI18n();
const router = useRouter();
const albums = ref<any[]>([]);
const loading = ref(true);
const albumTracksMap = reactive<Record<number, any[]>>({});

// Calculate display count to fill exactly N rows
const displayCount = computed(() => {
  if (isMobile.value) {
    return 6;
  }
  return props.columns * props.rows;
});

const displayAlbums = computed(() => {
  const count = displayCount.value;
  return albums.value.slice(0, count);
});

const fetchAlbums = async () => {
  try {
    const { data } = await getTopAlbum({ limit: props.limit || displayCount.value + 5 });
    if (data.code === 200) {
      albums.value = data.weekData || data.monthData || data.albums || [];
      // Preload tracks for displayed albums (Electron only)
      if (isElectron && !isMobile.value) {
        preloadAllTracks();
      }
    }
  } catch (error) {
    console.error('Failed to fetch albums:', error);
  } finally {
    loading.value = false;
  }
};

const preloadAllTracks = async () => {
  const albumsToLoad = displayAlbums.value;

  // Load tracks in parallel with concurrency limit
  const batchSize = 4;
  for (let i = 0; i < albumsToLoad.length; i += batchSize) {
    const batch = albumsToLoad.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (album) => {
        if (albumTracksMap[album.id]) return;
        try {
          const { data } = await getAlbum(album.id);
          if (data.code === 200 && data.songs) {
            albumTracksMap[album.id] = data.songs.slice(0, 3).map((s: any) => ({
              id: s.id,
              name: s.name
            }));
          }
        } catch (error) {
          console.debug('Failed to load tracks for album:', album.id, error);
        }
      })
    );
  }
};

const getArtistNames = (album: any) => {
  if (album.artists) {
    return album.artists.map((ar: any) => ar.name).join(' / ');
  }
  if (album.artist) {
    return album.artist.name;
  }
  return '';
};

const handleAlbumClick = async (album: any) => {
  try {
    navigateToMusicList(router, {
      id: album.id,
      type: 'album',
      name: album.name,
      listInfo: {
        ...album,
        coverImgUrl: album.picUrl
      },
      canRemove: false
    });
  } catch (error) {
    console.error('Failed to navigate to album:', error);
  }
};

const playAlbum = async (album: any) => {
  try {
    const { data } = await getAlbum(album.id);
    if (data.code === 200 && data.songs?.length > 0) {
      const playerCore = usePlayerCoreStore();
      const playlistStore = usePlaylistStore();

      const albumCover = data.album?.picUrl || album.picUrl;
      const playlist = data.songs.map((s: any) => ({
        id: s.id,
        name: s.name,
        source: 'netease',
        song: s,
        ...s,
        picUrl: s.al?.picUrl || albumCover,
        playLoading: false
      }));

      playlistStore.setPlayList(playlist, false, false);
      await playerCore.handlePlayMusic(playlist[0], true);
    }
  } catch (error) {
    console.error('Failed to play album:', error);
  }
};

onMounted(() => {
  fetchAlbums();
});
</script>
