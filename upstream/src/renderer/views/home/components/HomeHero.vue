<template>
  <div class="hero-section mb-7 md:mb-10">
    <!-- Skeleton Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="flex gap-3 overflow-hidden md:hidden">
        <div v-for="i in 5" :key="i" class="flex flex-col items-center gap-1.5 flex-shrink-0">
          <div class="h-12 w-12 skeleton-shimmer rounded-2xl" />
          <div class="h-3 w-10 skeleton-shimmer rounded-full" />
        </div>
      </div>
      <div class="hero-grid grid gap-3.5">
        <div class="skeleton-shimmer rounded-[24px]" style="height: 168px" />
        <div class="skeleton-shimmer rounded-[24px]" style="height: 144px" />
      </div>
    </div>

    <!-- Main Content -->
    <div v-else class="space-y-4">
      <!-- 奶娃萌趣快捷入口（移动端横向磨砂方圆图标条） -->
      <nav class="scrollbar-hide flex gap-3 overflow-x-auto pb-1 pt-0.5 md:hidden">
        <button
          v-for="(item, index) in quickNavItems"
          :key="item.key"
          type="button"
          class="quick-tile nav-chip flex flex-shrink-0 flex-col items-center gap-1.5 select-none active:scale-90 transition-transform"
          :style="{ animationDelay: `${index * 0.03}s` }"
          @click="item.action"
        >
          <div
            class="quick-tile-icon flex h-12 w-12 items-center justify-center rounded-[18px] text-[20px] shadow-sm transition-all"
            :class="[item.active ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-amber-400/40' : item.tintClass]"
          >
            <i :class="item.icon" />
          </div>
          <span
            class="text-[11px] font-semibold whitespace-nowrap"
            :class="item.active ? 'text-primary' : 'text-slate-600 dark:text-slate-300'"
          >
            {{ item.label }}
          </span>
        </button>
      </nav>

      <!-- Hero Cards -->
      <div class="hero-grid grid gap-3.5">
        <!-- ===== 每日推荐 (主视觉暖阳卡片) ===== -->
        <div class="hero-card" :style="{ animationDelay: '0.08s' }">
          <div
            class="daily-card group relative cursor-pointer overflow-hidden rounded-[24px] shadow-naiwa-md transition-all duration-300 ease-out active:scale-[0.985]"
            :style="{ background: dailyCardBg }"
            @click="showDayRecommend"
          >
            <!-- Background Image -->
            <img
              v-if="dayRecommendCover"
              ref="dailyCoverRef"
              :src="getImgUrl(dayRecommendCover, '512y512')"
              alt=""
              class="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              crossorigin="anonymous"
              @load="extractDailyColor"
            />
            <!-- Warm Atmospheric Gradient Overlay -->
            <div class="absolute inset-0 bg-gradient-to-tr from-slate-950/85 via-slate-900/45 to-amber-500/20" />

            <!-- Content -->
            <div class="relative flex h-full flex-col justify-between p-5">
              <!-- Top: Title + Badge -->
              <div class="flex items-start justify-between gap-2">
                <div>
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-amber-400/25 border border-amber-200/30 px-2.5 py-0.5 text-[11px] font-bold text-amber-100 backdrop-blur-md"
                  >
                    <i class="ri-sun-fill text-amber-300" />
                    今日精选 · {{ dayRecommendSongs.length }} {{ t('comp.homeHero.songs') }}
                  </span>
                  <h3 class="mt-2 text-[22px] font-black leading-tight tracking-tight text-white md:text-3xl">
                    {{ t('comp.homeHero.dailyRecommend') }}
                  </h3>
                </div>
                <button
                  type="button"
                  class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 active:scale-90"
                  style="background: linear-gradient(135deg, #ffd147 0%, #f09000 100%)"
                  @click.stop="playDayRecommend"
                >
                  <i class="ri-play-fill ml-0.5 text-xl" />
                </button>
              </div>
              <!-- Bottom: Song Preview List (mobile + desktop visible!) -->
              <div v-if="dayRecommendSongs.length > 0" class="mt-3 flex flex-col gap-1">
                <div
                  v-for="(song, idx) in dayRecommendSongs.slice(0, 2)"
                  :key="song.id"
                  class="flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1 backdrop-blur-md"
                >
                  <span class="w-4 flex-shrink-0 text-center text-[11px] font-bold text-amber-300 tabular-nums">
                    0{{ idx + 1 }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-xs font-semibold text-white/95">
                    {{ song.name }}
                  </span>
                  <span class="max-w-[34%] flex-shrink-0 truncate text-[11px] text-white/60">
                    {{ song.ar?.[0]?.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== 已登录: 私人FM (暖光沉浸卡片) ===== -->
        <div v-if="isLoggedIn" class="hero-card" :style="{ animationDelay: '0.16s' }">
          <div
            class="fm-card group relative cursor-pointer overflow-hidden rounded-[24px] shadow-naiwa-md transition-all duration-300 ease-out active:scale-[0.985]"
            :style="{ background: fmCardBg }"
            @click="handleFmPlay"
          >
            <!-- Background blur image — flows when playing -->
            <img
              v-if="fmCurrentCover"
              ref="fmCoverRef"
              :src="getImgUrl(fmCurrentCover, '512y512')"
              alt=""
              class="absolute inset-0 h-full w-full scale-150 object-cover opacity-35 blur-2xl"
              :class="isFmPlaying ? 'fm-bg-flow' : ''"
              crossorigin="anonymous"
              @load="extractFmColor"
            />
            <div class="absolute inset-0 bg-gradient-to-br from-slate-950/35 to-slate-950/65" />

            <!-- Content -->
            <div class="relative flex h-full items-center gap-4 p-4 md:p-5">
              <!-- Album Cover -->
              <div
                class="fm-cover relative aspect-square h-[96px] w-[96px] flex-shrink-0 overflow-hidden rounded-2xl shadow-lg ring-2 ring-white/25 transition-transform duration-500 group-hover:scale-[1.03]"
              >
                <img
                  v-if="fmCurrentCover"
                  :src="getImgUrl(fmCurrentCover, '256y256')"
                  alt=""
                  class="h-full w-full object-cover"
                />
                <div v-else class="flex h-full w-full items-center justify-center bg-white/15">
                  <i class="ri-radio-fill text-3xl text-white/60" />
                </div>
                <!-- Playing equalizer overlay on cover -->
                <div v-if="isFmPlaying" class="absolute bottom-2 right-2 flex items-end gap-[2px]">
                  <span
                    v-for="i in 3"
                    :key="i"
                    class="eq-bar"
                    :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
                  />
                </div>
              </div>

              <!-- Song Info & Controls -->
              <div class="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
                <div class="min-w-0">
                  <span class="inline-flex items-center gap-1 text-[11px] font-bold text-amber-200/90">
                    <i class="ri-radio-fill" />
                    {{ t('comp.homeHero.personalFm') }}
                  </span>
                  <h3 class="mt-0.5 truncate text-base font-bold text-white md:text-lg">
                    {{ fmCurrentSong?.name || t('comp.homeHero.discoverMusic') }}
                  </h3>
                  <p class="mt-0.5 truncate text-xs text-white/70">
                    {{ fmCurrentArtist }}
                  </p>
                </div>
                <div class="mt-2 flex items-center gap-2.5">
                  <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white/80 active:scale-90 transition-all"
                    :title="t('comp.homeHero.fmTrash')"
                    @click.stop="handleFmTrash"
                  >
                    <i class="ri-thumb-down-line text-base" />
                  </button>
                  <button
                    type="button"
                    class="flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md active:scale-90 transition-all"
                    style="background: linear-gradient(135deg, #ffd147 0%, #f09000 100%)"
                    @click.stop="handleFmPlay"
                  >
                    <i
                      :class="isFmPlaying ? 'ri-pause-fill' : 'ri-play-fill ml-0.5'"
                      class="text-lg"
                    />
                  </button>
                  <button
                    type="button"
                    class="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white/80 active:scale-90 transition-all"
                    :title="t('comp.homeHero.fmNext')"
                    @click.stop="handleFmNext"
                  >
                    <i class="ri-skip-forward-fill text-base" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== 未登录: 推荐歌单 (晴空四格玻璃卡片) ===== -->
        <div
          v-if="!isLoggedIn"
          class="hero-card group cursor-pointer"
          :style="{ animationDelay: '0.16s' }"
          @click="router.push('/list')"
        >
          <div
            class="fm-card relative overflow-hidden rounded-[24px] bg-sky-100/80 shadow-naiwa-md transition-all duration-300 ease-out active:scale-[0.985] dark:bg-slate-800"
          >
            <!-- 2x2 Cover Grid -->
            <div class="absolute inset-0 grid grid-cols-4 md:grid-cols-2 md:grid-rows-2">
              <template v-if="hotPlaylists.length > 0">
                <div
                  v-for="(pl, idx) in hotPlaylists.slice(0, 4)"
                  :key="idx"
                  class="overflow-hidden"
                >
                  <img
                    :src="getImgUrl(pl.picUrl, '256y256')"
                    alt=""
                    class="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                </div>
              </template>
              <template v-else>
                <div
                  v-for="i in 4"
                  :key="`empty-${i}`"
                  class="flex items-center justify-center bg-sky-100/80 dark:bg-slate-700/60"
                >
                  <i class="ri-play-list-2-line text-lg text-sky-400/60 dark:text-slate-500" />
                </div>
              </template>
            </div>
            <!-- Overlay -->
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950/75 via-slate-900/45 to-sky-900/35" />
            <!-- Content -->
            <div class="relative flex h-full items-center justify-between gap-4 p-5">
              <div>
                <span
                  class="inline-flex w-fit items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold text-white backdrop-blur-md"
                >
                  <i class="ri-sparkling-2-fill text-amber-300" />
                  歌单广场
                </span>
                <h3 class="mt-2 text-lg font-extrabold text-white">
                  {{ t('comp.homeHero.hotPlaylists') }}
                </h3>
                <p class="mt-0.5 text-xs text-white/75">
                  {{ t('comp.homeHero.discoverNewReleases') }}
                </p>
              </div>
              <div
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/25 text-white backdrop-blur-md"
              >
                <i class="ri-arrow-right-s-line text-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getHotSinger, getPersonalFM, getPersonalizedPlaylist } from '@/api/home';
import { fmTrash } from '@/api/music';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import {
  useIntelligenceModeStore,
  usePlayerCoreStore,
  useRecommendStore,
  useUserStore
} from '@/store';
import { getImgUrl, isAndroid } from '@/utils';
import { getImageBackground } from '@/utils/linearColor';

const { t } = useI18n();
const router = useRouter();
const recommendStore = useRecommendStore();
const intelligenceModeStore = useIntelligenceModeStore();
const userStore = useUserStore();
const playerCoreStore = usePlayerCoreStore();

const loading = ref(false);

// FM state — current + preloaded next (YesPlayMusic pattern)
const fmCurrentSong = ref<any>(null);
const fmNextSong = ref<any>(null);
const fmLoading = ref(false);

const hotPlaylists = ref<any[]>([]);
const hotArtistsList = ref<any[]>([]);
const dailyCoverRef = ref<HTMLImageElement | null>(null);
const fmCoverRef = ref<HTMLImageElement | null>(null);
const dailyCardBg = ref('linear-gradient(135deg, #f59e0b 0%, #38bdf8 100%)');
const fmCardBg = ref('linear-gradient(135deg, #fb923c 0%, #0ea5e9 100%)');

const isLoggedIn = computed(() => !!userStore.user);
const dayRecommendSongs = computed(() => recommendStore.dailyRecommendSongs);
const dayRecommendCover = computed(() => dayRecommendSongs.value[0]?.al?.picUrl || '');

const fmCurrentCover = computed(
  () => fmCurrentSong.value?.album?.picUrl || fmCurrentSong.value?.al?.picUrl || ''
);
const fmCurrentArtist = computed(() => {
  const song = fmCurrentSong.value;
  if (!song) return t('comp.homeHero.personalFmDesc');
  const artists = song.artists || song.ar;
  return artists?.map((a: any) => a.name).join(' / ') || '';
});

const isIntelligenceMode = computed(() => intelligenceModeStore.isIntelligenceMode);
const isFmPlaying = computed(
  () =>
    !!fmCurrentSong.value &&
    playerCoreStore.currentSong?.id === fmCurrentSong.value.id &&
    playerCoreStore.isPlaying
);

// ==================== Color extraction ====================

const extractDailyColor = async () => {
  const img = dailyCoverRef.value;
  if (!img) return;
  try {
    const { primaryColor } = await getImageBackground(img);
    if (primaryColor) {
      const tinycolor = (await import('tinycolor2')).default;
      const base = tinycolor(primaryColor);
      const hsl = base.toHsl();
      const c1 = tinycolor({ h: hsl.h, s: Math.min(hsl.s * 1.2, 1), l: 0.35 });
      const c2 = tinycolor({ h: (hsl.h + 30) % 360, s: Math.min(hsl.s * 1.1, 1), l: 0.25 });
      dailyCardBg.value = `linear-gradient(135deg, ${c1.toHexString()} 0%, ${c2.toHexString()} 100%)`;
    }
  } catch {
    // keep default gradient
  }
};

const extractFmColor = async () => {
  const img = fmCoverRef.value;
  if (!img) return;
  try {
    const { primaryColor } = await getImageBackground(img);
    if (primaryColor) {
      const tinycolor = (await import('tinycolor2')).default;
      const base = tinycolor(primaryColor);
      const hsl = base.toHsl();
      const c1 = tinycolor({ h: hsl.h, s: Math.min(hsl.s * 1.3, 1), l: 0.4 });
      const c2 = tinycolor({ h: (hsl.h + 20) % 360, s: Math.min(hsl.s * 1.1, 1), l: 0.3 });
      fmCardBg.value = `linear-gradient(135deg, ${c1.toHexString()} 0%, ${c2.toHexString()} 100%)`;
    }
  } catch {
    // keep default gradient
  }
};

// ==================== FM logic (YesPlayMusic pattern) ====================

/** Fetch FM songs from API, with retry */
const fetchFmSongs = async (retries = 3): Promise<any[]> => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await getPersonalFM();
      // axios response: res.data = { data: [...], code: 200 }
      const songs = res.data?.data;
      if (Array.isArray(songs) && songs.length > 0) return songs;
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return [];
};

/** Load current + preload next FM song */
const loadFmSongs = async () => {
  if (fmLoading.value) return;
  fmLoading.value = true;
  try {
    const songs = await fetchFmSongs();
    if (songs.length > 0) {
      fmCurrentSong.value = songs[0];
      fmNextSong.value = songs[1] || null;
    }
  } finally {
    fmLoading.value = false;
  }
};

/** Preload next FM song in background */
const preloadNextFm = async () => {
  if (fmNextSong.value) return; // already have next
  try {
    const songs = await fetchFmSongs(1);
    if (songs.length > 0) {
      fmNextSong.value = songs[0];
    }
  } catch {
    // silent
  }
};

/** Play/pause current FM song */
const handleFmPlay = async () => {
  if (!fmCurrentSong.value) return;
  // Toggle play/pause if this FM song is already loaded
  if (playerCoreStore.currentSong?.id === fmCurrentSong.value.id) {
    const { usePlaylistStore } = await import('@/store/modules/playlist');
    const playlistStore = usePlaylistStore();
    await playlistStore.setPlay(playerCoreStore.currentSong);
    return;
  }
  try {
    const { usePlayerCoreStore } = await import('@/store/modules/playerCore');
    const { usePlaylistStore } = await import('@/store/modules/playlist');
    const playerCore = usePlayerCoreStore();
    const playlistStore = usePlaylistStore();
    const song = fmCurrentSong.value;
    const playlist = [
      {
        id: song.id,
        name: song.name,
        picUrl: song.al?.picUrl || song.album?.picUrl,
        ar: song.artists || song.ar,
        al: song.al || song.album,
        source: 'netease' as const,
        song,
        ...song,
        playLoading: false
      }
    ];
    playlistStore.setPlayList(playlist, false, false);
    playerCore.isFmPlaying = true;
    await playerCore.handlePlayMusic(playlist[0], true);
  } catch (error) {
    console.error('Failed to play Personal FM:', error);
  }
};

/** Next FM track — promote preloaded, fetch new one in background */
const handleFmNext = async () => {
  if (fmLoading.value) return;
  if (fmNextSong.value) {
    fmCurrentSong.value = fmNextSong.value;
    fmNextSong.value = null;
    preloadNextFm();
  } else {
    await loadFmSongs();
  }
  await handleFmPlay();
};

/** Trash/dislike current FM song — call API then skip to next */
const handleFmTrash = async () => {
  const song = fmCurrentSong.value;
  if (!song) return;
  try {
    await fmTrash(song.id);
  } catch {
    // even if trash API fails, still skip
  }
  await handleFmNext();
};

// ==================== Quick Nav ====================

const quickNavItems = computed(() => {
  const items = [
    {
      key: 'intelligence',
      label: t('comp.homeHero.intelligenceMode'),
      icon: 'ri-heart-pulse-fill',
      tintClass: 'bg-rose-100/90 text-rose-500 dark:bg-rose-500/20 dark:text-rose-300',
      active: isIntelligenceMode.value,
      action: toggleIntelligenceMode,
      show: isLoggedIn.value
    },
    {
      key: 'favorite',
      label: t('comp.homeHero.quickNav.myFavorite'),
      icon: 'ri-heart-3-fill',
      tintClass: 'bg-pink-100/90 text-pink-500 dark:bg-pink-500/20 dark:text-pink-300',
      active: false,
      action: () => router.push('/favorite'),
      show: true
    },
    {
      key: 'localMusic',
      label: t('comp.localMusic'),
      icon: 'ri-folder-music-fill',
      tintClass: 'bg-amber-100/90 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
      active: false,
      action: () => router.push('/local-music'),
      show: isAndroid
    },
    {
      key: 'downloads',
      label: t('download.title'),
      icon: 'ri-download-cloud-2-fill',
      tintClass: 'bg-sky-100/90 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
      active: false,
      action: () => router.push('/downloads'),
      show: isAndroid
    },
    {
      key: 'album',
      label: t('comp.newAlbum.title'),
      icon: 'ri-album-fill',
      tintClass: 'bg-orange-100/90 text-orange-500 dark:bg-orange-500/20 dark:text-orange-300',
      active: false,
      action: () => router.push('/album'),
      show: true
    },
    {
      key: 'podcast',
      label: t('podcast.podcast'),
      icon: 'ri-radio-2-fill',
      tintClass: 'bg-teal-100/90 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300',
      active: false,
      action: () => router.push('/podcast'),
      show: true
    },
    {
      key: 'mv',
      label: t('comp.mv'),
      icon: 'ri-movie-2-fill',
      tintClass: 'bg-indigo-100/90 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-300',
      active: false,
      action: () => router.push('/mv'),
      show: true
    },
    {
      key: 'toplist',
      label: t('comp.toplist'),
      icon: 'ri-trophy-fill',
      tintClass: 'bg-yellow-100/90 text-amber-600 dark:bg-yellow-500/20 dark:text-yellow-300',
      active: false,
      action: () => router.push('/toplist'),
      show: true
    },
    {
      key: 'playlist',
      label: t('comp.list'),
      icon: 'ri-play-list-2-fill',
      tintClass: 'bg-cyan-100/90 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300',
      active: false,
      action: () => router.push('/list'),
      show: true
    },
    {
      key: 'history',
      label: t('comp.history'),
      icon: 'ri-history-fill',
      tintClass: 'bg-violet-100/90 text-violet-500 dark:bg-violet-500/20 dark:text-violet-300',
      active: false,
      action: () => router.push('/history'),
      show: true
    }
  ];
  return items.filter((item) => item.show);
});

// ==================== Data fetching ====================

const fetchHeroData = async () => {
  try {
    loading.value = true;
    const promises: Promise<any>[] = [];

    promises.push(recommendStore.refreshIfStale());

    promises.push(
      getPersonalizedPlaylist(8)
        .then((res: any) => {
          const list = res.result || res.data;
          if (list && !isLoggedIn.value) hotPlaylists.value = list;
        })
        .catch(() => {})
    );

    if (isLoggedIn.value) {
      promises.push(loadFmSongs());
    } else {
      promises.push(
        getHotSinger({ offset: 0, limit: 6 })
          .then((res: any) => {
            if (res.artists) hotArtistsList.value = res.artists;
          })
          .catch(() => {})
      );
    }

    await Promise.all(promises);
  } catch (error) {
    console.error('Failed to fetch hero data:', error);
  } finally {
    loading.value = false;
  }
};

// ==================== Daily recommend actions ====================

const showDayRecommend = () => {
  if (dayRecommendSongs.value.length === 0) return;
  navigateToMusicList(router, {
    type: 'dailyRecommend',
    name: t('comp.recommendSinger.songlist'),
    songList: dayRecommendSongs.value,
    canRemove: false
  });
};

const playDayRecommend = async () => {
  if (dayRecommendSongs.value.length === 0) return;
  try {
    const { usePlayerCoreStore } = await import('@/store/modules/playerCore');
    const { usePlaylistStore } = await import('@/store/modules/playlist');
    const playerCore = usePlayerCoreStore();
    const playlistStore = usePlaylistStore();
    const songs = dayRecommendSongs.value.map((s: any) => ({
      id: s.id,
      name: s.name,
      picUrl: s.al?.picUrl,
      source: 'netease',
      song: s,
      ...s,
      playLoading: false
    }));
    playlistStore.setPlayList(songs, false, false);
    await playerCore.handlePlayMusic(songs[0], true);
  } catch (error) {
    console.error('Failed to play daily recommend:', error);
  }
};

const toggleIntelligenceMode = () => {
  if (isIntelligenceMode.value) {
    intelligenceModeStore.clearIntelligenceMode();
  } else {
    intelligenceModeStore.playIntelligenceMode();
  }
};

// ==================== Lifecycle ====================

onMounted(() => {
  fetchHeroData();
});

onActivated(() => {
  recommendStore.refreshIfStale();
});
</script>

<style scoped>
/* Scrollbar hide */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Nav chip animation */
.nav-chip {
  animation: chipIn 0.4s ease both;
}
@keyframes chipIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Hero grid — 移动端单列舒展排布，平板/桌面 3:2 并排 */
.hero-grid {
  grid-template-columns: 1fr;
}

@media (min-width: 768px) {
  .hero-grid {
    grid-template-columns: 3fr 2fr;
  }
}

.hero-grid > .hero-card {
  height: 100%;
}
.hero-grid > .hero-card > .daily-card {
  height: 100%;
  min-height: 170px;
}
.hero-grid > .hero-card > .fm-card {
  height: 100%;
  min-height: 128px;
}

.quick-tile-icon {
  border: 1px solid rgba(255, 255, 255, 0.75);
}

:global(.dark) .quick-tile-icon {
  border-color: rgba(255, 255, 255, 0.08);
}

/* Card animation */
.hero-card {
  animation: cardUp 0.5s ease both;
}
@keyframes cardUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* FM background flow animation when playing */
.fm-bg-flow {
  animation: bgFlow 8s ease-in-out infinite alternate;
}
@keyframes bgFlow {
  0% {
    transform: scale(1.5) translate(0, 0);
  }
  33% {
    transform: scale(1.6) translate(-3%, 2%);
  }
  66% {
    transform: scale(1.55) translate(2%, -2%);
  }
  100% {
    transform: scale(1.5) translate(-1%, 1%);
  }
}

/* FM cover — sized relative to card, leaving padding space */
.fm-cover {
  height: calc(100% - 6px);
}

/* FM equalizer bars */
.eq-bar {
  width: 3px;
  border-radius: 9999px;
  background-color: #ffd147;
  animation: eqPulse 0.8s ease-in-out infinite;
}
.eq-bar:nth-child(1) {
  height: 6px;
}
.eq-bar:nth-child(2) {
  height: 12px;
}
.eq-bar:nth-child(3) {
  height: 8px;
}
@keyframes eqPulse {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(1.6);
  }
}

/* Skeleton shimmer */
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    theme('colors.neutral.200') 25%,
    theme('colors.neutral.100') 50%,
    theme('colors.neutral.200') 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
:deep(.dark) .skeleton-shimmer,
.dark .skeleton-shimmer {
  background: linear-gradient(
    90deg,
    theme('colors.neutral.800') 25%,
    theme('colors.neutral.700') 50%,
    theme('colors.neutral.800') 75%
  );
  background-size: 200% 100%;
}
@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
