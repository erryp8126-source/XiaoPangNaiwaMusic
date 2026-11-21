<template>
  <div class="history-page h-full flex flex-col">
    <!-- Header Section -->
    <div
      class="flex flex-col gap-3 px-4 md:px-6 pt-4 pb-2 flex-shrink-0"
      :class="setAnimationClass('animate__fadeInRight')"
    >
      <div v-if="!isMobile" class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">{{ t('history.title') }}</h2>

        <button
          class="h-8 px-3 rounded-full bg-sky-50 dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5"
          @click="handleNavigateToHeatmap"
        >
          <i class="ri-calendar-2-line"></i>
          {{ t('history.heatmapTitle') }}
        </button>
      </div>

      <div class="flex items-center justify-between gap-2 flex-wrap">
        <!-- Category Tabs -->
        <div
          class="bg-sky-50/90 dark:bg-slate-800/80 p-1 rounded-full inline-flex h-9 items-center overflow-x-auto no-scrollbar max-w-full"
        >
          <div
            v-for="tab in ['songs', 'playlists', 'albums', 'podcasts']"
            :key="tab"
            class="px-3.5 h-7 rounded-full text-xs font-semibold cursor-pointer transition-all duration-200 flex items-center justify-center whitespace-nowrap"
            :class="
              currentCategory === tab
                ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
                : 'text-slate-500 dark:text-slate-400'
            "
            @click="handleCategoryChange(tab as any)"
          >
            {{ t(`history.categoryTabs.${tab}`) }}
          </div>
        </div>

        <!-- Source Tabs (Local/Cloud) + Personal Cloud Sync Quick Action -->
        <div class="flex items-center gap-2 flex-shrink-0">
          <div
            v-if="currentCategory !== 'podcasts'"
            class="flex items-center bg-sky-50/90 dark:bg-slate-800/80 rounded-full p-1 h-9 flex-shrink-0"
          >
            <button
              class="px-3 h-7 rounded-full text-xs font-semibold transition-all duration-200"
              :class="
                currentTab === 'local'
                  ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              "
              @click="handleTabChange('local')"
            >
              {{ t('history.tabs.local') }}
            </button>
            <button
              class="px-3 h-7 rounded-full text-xs font-semibold transition-all duration-200"
              :class="
                currentTab === 'cloud'
                  ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              "
              @click="handleTabChange('cloud')"
            >
              {{ t('history.tabs.cloud') }}
            </button>
          </div>

          <button
            type="button"
            class="h-9 px-3 rounded-full text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 border"
            :class="
              cloudSyncStore.isConfigured
                ? 'bg-sky-50 border-sky-200/90 text-sky-700 dark:bg-sky-500/15 dark:border-sky-400/30 dark:text-sky-300'
                : 'bg-amber-50 border-amber-200/90 text-amber-700 dark:bg-amber-500/15 dark:border-amber-400/30 dark:text-amber-300'
            "
            :disabled="cloudSyncStore.syncing"
            @click="handleQuickCloudSync"
          >
            <i
              class="text-sm"
              :class="
                cloudSyncStore.syncing
                  ? 'ri-loader-4-line animate-spin'
                  : cloudSyncStore.isConfigured
                    ? 'ri-cloud-line'
                    : 'ri-upload-cloud-2-line'
              "
            ></i>
            <span>{{
              cloudSyncStore.syncing
                ? '同步中'
                : cloudSyncStore.isConfigured
                  ? '同步'
                  : '口令云同步'
            }}</span>
          </button>

          <button
            v-if="cloudSyncStore.isConfigured"
            type="button"
            class="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 flex items-center justify-center active:scale-95 transition-transform"
            title="云同步设置"
            @click="handleOpenCloudSyncSettings"
          >
            <i class="ri-settings-3-line text-sm"></i>
          </button>
        </div>
      </div>

      <!-- 云端模式状态条（扫码/UID 提示 & 刷新） -->
      <div
        v-if="currentTab === 'cloud' && currentCategory !== 'podcasts' && userStore.user?.userId"
        class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-sky-50/80 dark:bg-slate-800/70 text-[11.5px] text-slate-600 dark:text-slate-300"
      >
        <div class="flex items-center gap-1.5 truncate">
          <i class="ri-cloud-line text-sky-500 flex-shrink-0"></i>
          <span class="truncate">{{ cloudStatusText }}</span>
        </div>
        <button
          type="button"
          class="text-sky-600 dark:text-sky-400 font-bold flex items-center gap-1 flex-shrink-0 active:opacity-70"
          :disabled="loading"
          @click="handleRefreshCloud"
        >
          <i class="ri-refresh-line" :class="{ 'animate-spin': loading }"></i>
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- List Content -->
    <div class="flex-grow min-h-0 px-2 mt-1" :class="setAnimationClass('animate__bounceInLeft')">
      <n-scrollbar ref="scrollbarRef" class="h-full pr-1 md:pr-4" :size="100" @scroll="handleScroll">
        <div class="pb-40 space-y-1">
          <!-- 歌曲列表 -->
          <template v-if="currentCategory === 'songs'">
            <div
              v-for="(item, index) in displayList"
              :key="item.id"
              class="group flex items-center justify-between rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors p-1"
              :class="setAnimationClass('animate__bounceInRight')"
              :style="setAnimationDelay(index, 30)"
            >
              <song-item
                class="flex-1 !bg-transparent hover:!bg-transparent"
                :item="item"
                @play="handlePlay"
              />
              <template v-if="!isMobile">
                <div
                  class="px-4 text-xs text-gray-400 dark:text-gray-600 font-medium min-w-[60px] text-right"
                  v-show="currentTab === 'local'"
                >
                  {{ t('history.playCount', { count: item.count }) }}
                </div>
                <div
                  class="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                  v-show="currentTab === 'local'"
                  @click="handleDelMusic(item)"
                >
                  <i class="ri-close-line text-lg"></i>
                </div>
              </template>
            </div>
          </template>

          <!-- 歌单列表 -->
          <template v-if="currentCategory === 'playlists'">
            <playlist-item
              v-for="(item, index) in displayList"
              :key="item.id"
              :item="item"
              :show-count="currentTab === 'local'"
              :show-delete="currentTab === 'local'"
              class="rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
              :class="setAnimationClass('animate__bounceInRight')"
              :style="setAnimationDelay(index, 30)"
              @click="handlePlaylistClick(item)"
              @delete="handleDelPlaylist(item)"
            />
          </template>

          <!-- 专辑列表 -->
          <template v-if="currentCategory === 'albums'">
            <album-item
              v-for="(item, index) in displayList"
              :key="item.id"
              :item="item"
              :show-count="currentTab === 'local'"
              :show-delete="currentTab === 'local'"
              class="rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
              :class="setAnimationClass('animate__bounceInRight')"
              :style="setAnimationDelay(index, 30)"
              @click="handleAlbumClick(item)"
              @delete="handleDelAlbum(item)"
            />
          </template>

          <!-- 播客列表 -->
          <template v-if="currentCategory === 'podcasts'">
            <div class="mb-4 px-2">
              <div
                class="flex items-center bg-gray-100 dark:bg-neutral-800 rounded-full p-1 w-fit h-8"
              >
                <button
                  class="px-3 h-6 rounded-full text-xs font-medium transition-all duration-300"
                  :class="
                    currentPodcastSubTab === 'episodes'
                      ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  "
                  @click="
                    currentPodcastSubTab = 'episodes';
                    loadHistoryData();
                  "
                >
                  {{ t('history.podcastTabs.episodes') }}
                </button>
                <button
                  class="px-3 h-6 rounded-full text-xs font-medium transition-all duration-300"
                  :class="
                    currentPodcastSubTab === 'radios'
                      ? 'bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  "
                  @click="
                    currentPodcastSubTab = 'radios';
                    loadHistoryData();
                  "
                >
                  {{ t('history.podcastTabs.radios') }}
                </button>
              </div>
            </div>

            <div v-if="currentPodcastSubTab === 'episodes'">
              <div
                v-for="(item, index) in displayList"
                :key="item.id"
                class="group flex items-center justify-between rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors p-1"
                :class="setAnimationClass('animate__bounceInRight')"
                :style="setAnimationDelay(index, 30)"
              >
                <song-item
                  class="flex-1 !bg-transparent hover:!bg-transparent"
                  :item="mapDjProgramToSong(item)"
                  @play="handlePlayPodcast(item)"
                />
                <div
                  class="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                  @click="handleDelPodcast(item)"
                >
                  <i class="ri-close-line text-lg"></i>
                </div>
              </div>
            </div>

            <div v-else>
              <div
                v-for="(item, index) in displayList"
                :key="item.id"
                class="group flex items-center justify-between rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                :class="setAnimationClass('animate__bounceInRight')"
                :style="setAnimationDelay(index, 30)"
              >
                <playlist-item
                  class="flex-1 !bg-transparent hover:!bg-transparent"
                  :item="mapPodcastRadioToPlaylistItem(item)"
                  @click="handlePodcastRadioClick(item)"
                />
                <div
                  class="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-all opacity-0 group-hover:opacity-100 mr-2"
                  @click="handleDelPodcastRadio(item)"
                >
                  <i class="ri-close-line text-lg"></i>
                </div>
              </div>
            </div>
          </template>

          <div
            v-if="displayList.length === 0 && !loading"
            class="text-center py-10 px-4 text-gray-400"
          >
            <div
              class="w-18 h-18 mx-auto rounded-full bg-gray-100 dark:bg-neutral-800 flex items-center justify-center mb-3.5"
            >
              <i
                class="text-3xl text-gray-300 dark:text-gray-600"
                :class="currentTab === 'cloud' ? 'ri-cloud-off-line' : 'ri-history-line'"
              ></i>
            </div>
            <p class="text-sm font-medium text-slate-600 dark:text-slate-300">
              {{ currentTab === 'cloud' && cloudEmptyHint ? cloudEmptyHint : t('history.noData') }}
            </p>
            <div
              v-if="currentTab === 'cloud'"
              class="mt-4 flex items-center justify-center gap-2.5 flex-wrap"
            >
              <button
                v-if="!userStore.hasNeteaseAuth"
                type="button"
                class="px-4 py-2 rounded-full text-xs font-bold bg-amber-500 text-white shadow-sm active:scale-95 transition-transform"
                @click="router.push('/login')"
              >
                <i class="ri-qr-code-line mr-1"></i>扫码 / UID 登录网易云
              </button>
              <button
                type="button"
                class="px-4 py-2 rounded-full text-xs font-bold bg-sky-500 text-white shadow-sm active:scale-95 transition-transform"
                @click="handleOpenCloudSyncSettings"
              >
                <i class="ri-upload-cloud-2-line mr-1"></i>一键口令云同步（免登录）
              </button>
            </div>
          </div>

          <div v-if="loading" class="space-y-2 pt-2">
            <div
              v-for="i in 8"
              :key="i"
              class="flex items-center gap-4 rounded-xl p-2 animate-pulse"
            >
              <div class="h-12 w-12 rounded-xl bg-gray-200 dark:bg-neutral-800"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 w-1/3 rounded bg-gray-200 dark:bg-neutral-800"></div>
                <div class="h-3 w-1/4 rounded bg-gray-200 dark:bg-neutral-800"></div>
              </div>
            </div>
          </div>

          <div
            v-if="noMore && displayList.length > 0"
            class="text-center py-8 text-sm text-gray-400 dark:text-gray-500"
          >
            {{ t('common.noMore') }}
          </div>
        </div>
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getMusicDetail } from '@/api/music';
import {
  getRecentAlbums,
  getRecentPlaylists,
  getRecentSongs,
  getUserPlaylist,
  getUserRecord
} from '@/api/user';
import AlbumItem from '@/components/common/AlbumItem.vue';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import PlaylistItem from '@/components/common/PlaylistItem.vue';
import SongItem from '@/components/common/SongItem.vue';
import { useCloudSyncStore } from '@/store/modules/cloudSync';
import { usePlayerStore } from '@/store/modules/player';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useUserStore } from '@/store/modules/user';
import type { SongResult } from '@/types/music';
import { isMobile, setAnimationClass, setAnimationDelay } from '@/utils';
import { mapDjProgramToSongResult } from '@/utils/podcastUtils';

// 扩展历史记录类型以包含 playTime
interface HistoryRecord extends Partial<SongResult> {
  id: string | number;
  playTime?: number;
  score?: number;
  source?: 'netease';
  count?: number;
  recordSource?: 'local' | 'cloud';
  sources?: ('local' | 'cloud')[];
}

const { t } = useI18n();
const message = useMessage();
const router = useRouter();
const playHistoryStore = usePlayHistoryStore();
const userStore = useUserStore();
const cloudSyncStore = useCloudSyncStore();
const scrollbarRef = ref();
const loading = ref(false);
const noMore = ref(false);
const displayList = ref<any[]>([]);
const playerStore = usePlayerStore();
const hasLoaded = ref(false);
const currentCategory = ref<'songs' | 'playlists' | 'albums' | 'podcasts'>('songs');
const currentTab = ref<'local' | 'cloud'>('local');
const cloudRecords = ref<HistoryRecord[]>([]);
const cloudPlaylists = ref<any[]>([]);
const cloudAlbums = ref<any[]>([]);
const currentPodcastSubTab = ref<'episodes' | 'radios'>('episodes');
const cloudModeUsed = ref<'recent' | 'uid-record' | 'none'>('none');
const cloudEmptyHint = ref('');

const cloudStatusText = computed(() => {
  if (userStore.hasNeteaseAuth) {
    if (cloudModeUsed.value === 'uid-record') {
      return '已从网易云听歌排行拉取云端记录（扫码/账号登录，无需手动抓 Cookie）';
    }
    return '已同步网易云云端最近播放（扫码/账号均支持，听歌会自动打卡同步）';
  }
  if (userStore.user?.userId) {
    return 'UID 免 Cookie 模式：已拉取网易云公开听歌排行与歌单';
  }
  return '';
});

const handleOpenCloudSyncSettings = () => {
  router.push({ path: '/set', query: { section: 'sync' } });
};

const handleQuickCloudSync = async () => {
  if (!cloudSyncStore.isConfigured) {
    handleOpenCloudSyncSettings();
    return;
  }
  const res = await cloudSyncStore.syncNow(false);
  if (res.ok) {
    message.success(res.message);
    if (currentTab.value === 'local') {
      currentPage.value = 1;
      noMore.value = false;
      await loadHistoryData();
    }
  } else {
    message.error(res.message);
  }
};

const handleRefreshCloud = async () => {
  if (currentCategory.value === 'songs') cloudRecords.value = [];
  else if (currentCategory.value === 'playlists') cloudPlaylists.value = [];
  else if (currentCategory.value === 'albums') cloudAlbums.value = [];
  await handleTabChange('cloud');
};

// 无限滚动相关配置
const pageSize = 100;
const currentPage = ref(1);

// 通过公开 /user/record 接口免 Cookie 拉取网易云听歌排行（先最近一周，再全部兜底）
const fetchUidPublicRecords = async (uid: number): Promise<HistoryRecord[]> => {
  for (const recordType of [1, 0]) {
    try {
      const res = await getUserRecord(uid, recordType);
      const list = recordType === 1 ? res.data?.weekData : res.data?.allData;
      if (Array.isArray(list) && list.length > 0) {
        cloudModeUsed.value = 'uid-record';
        return list
          .filter((item: any) => item?.song?.id)
          .map((item: any) => ({
            id: item.song.id,
            score: item.score,
            source: 'netease' as const,
            count: item.playCount || 1,
            data: item.song
          }));
      }
    } catch {
      // 尝试下一个 type
    }
  }
  return [];
};

// 获取云端播放记录（支持扫码/手机号/Cookie 全量接口，并支持仅 UID 免 Cookie 降级拉取）
const getCloudRecords = async () => {
  cloudEmptyHint.value = '';
  const uid = userStore.user?.userId;
  if (!uid) {
    cloudModeUsed.value = 'none';
    cloudEmptyHint.value = '未登录网易云：可扫码/填 UID 免 Cookie 查看网易云记录，或直接启用个人云同步';
    return [];
  }

  // 1. 扫码 / 手机号 / Cookie 任意有效登录：直接拉网易云最近播放，不再强卡 loginType === 'cookie'
  if (userStore.hasNeteaseAuth) {
    try {
      const res = await getRecentSongs(1000);
      if (Array.isArray(res.data?.data?.list) && res.data.data.list.length > 0) {
        cloudModeUsed.value = 'recent';
        return res.data.data.list.map((item: any) => ({
          id: item.data?.id,
          playTime: item.playTime,
          source: 'netease' as const,
          count: 1,
          data: item.data
        }));
      }
    } catch (error: any) {
      console.warn('getRecentSongs 失败，自动回退 /user/record:', error);
    }
  }

  // 2. UID 免 Cookie 模式（或 recent 接口返回空时的自动兜底）
  const fallbackList = await fetchUidPublicRecords(uid);
  if (fallbackList.length > 0) {
    return fallbackList;
  }

  cloudEmptyHint.value = userStore.hasNeteaseAuth
    ? '暂未获取到网易云云端最近播放记录，可以先听几首歌或开启个人云同步'
    : '未获取到该 UID 的公开听歌排行（可能网易云隐私已设为私密），建议改用「扫码登录」或开启免登录个人云同步';
  return [];
};

// 获取云端歌单播放记录（支持扫码/账号登录 + UID 免 Cookie 歌单兜底）
const getCloudPlaylists = async () => {
  cloudEmptyHint.value = '';
  const uid = userStore.user?.userId;
  if (!uid) {
    cloudEmptyHint.value = '未登录网易云：可扫码/填 UID 免 Cookie 查看歌单，或启用个人云同步';
    return [];
  }

  if (userStore.hasNeteaseAuth) {
    try {
      const res = await getRecentPlaylists(100);
      if (Array.isArray(res.data?.data?.list) && res.data.data.list.length > 0) {
        return res.data.data.list.map((item: any) => ({
          id: item.data?.id,
          name: item.data?.name,
          coverImgUrl: item.data?.coverImgUrl,
          picUrl: item.data?.picUrl,
          trackCount: item.data?.trackCount,
          playCount: item.data?.playCount,
          creator: item.data?.creator,
          playTime: item.playTime
        }));
      }
    } catch (error: any) {
      console.warn('getRecentPlaylists 失败，尝试 /user/playlist 兜底:', error);
    }
  }

  // UID 免 Cookie 兜底：拉取用户公开歌单
  try {
    const res = await getUserPlaylist(uid, 100, 0);
    if (Array.isArray(res.data?.playlist) && res.data.playlist.length > 0) {
      return res.data.playlist.map((pl: any) => ({
        id: pl.id,
        name: pl.name,
        coverImgUrl: pl.coverImgUrl,
        picUrl: pl.coverImgUrl,
        trackCount: pl.trackCount,
        playCount: pl.playCount,
        creator: pl.creator
      }));
    }
  } catch (error: any) {
    console.error(t('history.getCloudRecordFailed'), error);
  }
  cloudEmptyHint.value = '暂无云端歌单记录，可尝试刷新或启用个人云同步';
  return [];
};

// 获取云端专辑播放记录（支持扫码/手机号/Cookie，不再强制手动抓 Cookie）
const getCloudAlbums = async () => {
  cloudEmptyHint.value = '';
  const uid = userStore.user?.userId;
  if (!uid) {
    cloudEmptyHint.value = '未登录网易云：可扫码登录查看云端专辑记录，或直接开启个人云同步';
    return [];
  }
  if (!userStore.hasNeteaseAuth) {
    cloudEmptyHint.value =
      '网易云最近播放专辑需扫码登录查看；也可不登录网易云，直接启用下方个人云同步来跨设备同步本地专辑历史';
    return [];
  }

  try {
    const res = await getRecentAlbums(100);
    if (Array.isArray(res.data?.data?.list)) {
      return res.data.data.list.map((item: any) => ({
        id: item.data?.id,
        name: item.data?.name,
        picUrl: item.data?.picUrl,
        size: item.data?.size,
        artist: item.data?.artist,
        playTime: item.playTime
      }));
    }
    return [];
  } catch (error: any) {
    console.error(t('history.getCloudRecordFailed'), error);
    if (error?.response?.status !== 301 && error?.response?.data?.code !== -2) {
      message.error(t('history.getCloudRecordFailed'));
    }
    return [];
  }
};

// 根据当前分类和tab获取要显示的列表
const getCurrentList = (): any[] => {
  if (currentCategory.value === 'songs') {
    switch (currentTab.value) {
      case 'local':
        return playHistoryStore.musicHistory;
      case 'cloud':
        return cloudRecords.value.filter((item) => item.id);
    }
  } else if (currentCategory.value === 'playlists') {
    switch (currentTab.value) {
      case 'local':
        return playHistoryStore.playlistHistory;
      case 'cloud':
        return cloudPlaylists.value;
    }
  } else if (currentCategory.value === 'albums') {
    switch (currentTab.value) {
      case 'local':
        return playHistoryStore.albumHistory;
      case 'cloud':
        return cloudAlbums.value;
    }
  } else if (currentCategory.value === 'podcasts') {
    if (currentPodcastSubTab.value === 'episodes') {
      return playHistoryStore.podcastHistory;
    } else {
      return playHistoryStore.podcastRadioHistory;
    }
  }
  return [];
};

// 处理分类切换
const handleCategoryChange = async (value: 'songs' | 'playlists' | 'albums' | 'podcasts') => {
  currentCategory.value = value;
  currentPage.value = 1;
  noMore.value = false;
  displayList.value = [];

  if (value === 'podcasts') {
    currentTab.value = 'local';
  }

  // 如果切换到云端，且还没有加载对应的云端数据，则加载
  if (currentTab.value === 'cloud') {
    loading.value = true;
    if (value === 'songs' && cloudRecords.value.length === 0) {
      cloudRecords.value = await getCloudRecords();
    } else if (value === 'playlists' && cloudPlaylists.value.length === 0) {
      cloudPlaylists.value = await getCloudPlaylists();
    } else if (value === 'albums' && cloudAlbums.value.length === 0) {
      cloudAlbums.value = await getCloudAlbums();
    }
    loading.value = false;
  }

  await loadHistoryData();
};

// 处理歌单点击
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
    console.error('打开歌单失败:', error);
    message.error('打开歌单失败');
  }
};

// 处理专辑点击
const handleAlbumClick = async (item: any) => {
  try {
    navigateToMusicList(router, {
      id: item.id,
      type: 'album',
      name: item.name,
      listInfo: {
        ...item,
        coverImgUrl: item.picUrl || item.coverImgUrl
      },
      canRemove: false
    });
  } catch (error) {
    console.error('打开专辑失败:', error);
    message.error('打开专辑失败');
  }
};

// 删除歌单记录
const handleDelPlaylist = (item: any) => {
  playHistoryStore.delPlaylist(item);
  displayList.value = displayList.value.filter((playlist) => playlist.id !== item.id);
};

// 删除专辑记录
const handleDelAlbum = (item: any) => {
  playHistoryStore.delAlbum(item);
  displayList.value = displayList.value.filter((album) => album.id !== item.id);
};

// 播客相关处理
const mapDjProgramToSong = (program: any): SongResult => {
  return mapDjProgramToSongResult(program);
};

const mapPodcastRadioToPlaylistItem = (radio: any) => {
  return {
    id: radio.id,
    name: radio.name,
    picUrl: radio.picUrl,
    coverImgUrl: radio.picUrl,
    desc: radio.dj?.nickname || radio.desc,
    type: 'podcast'
  };
};

const handlePlayPodcast = (item: any) => {
  const song = mapDjProgramToSong(item);
  if (displayList.value.length > 0) {
    playerStore.setPlayList(displayList.value.map(mapDjProgramToSong));
  }
  playerStore.setPlay(song);
};

const handlePodcastRadioClick = (item: any) => {
  router.push({
    name: 'podcastRadio',
    params: { id: item.id }
  });
};

const handleDelPodcast = (item: any) => {
  playHistoryStore.delPodcast(item);
  displayList.value = displayList.value.filter((p) => p.id !== item.id);
};

const handleDelPodcastRadio = (item: any) => {
  playHistoryStore.delPodcastRadio(item);
  displayList.value = displayList.value.filter((r) => r.id !== item.id);
};

// 加载历史数据（根据当前分类）
const loadHistoryData = async () => {
  const currentList = getCurrentList();
  if (currentList.length === 0) {
    displayList.value = [];
    return;
  }

  loading.value = true;
  try {
    const startIndex = (currentPage.value - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const currentPageItems = currentList.slice(startIndex, endIndex);

    // 根据分类处理不同的数据
    if (currentCategory.value === 'songs') {
      // 区分本地歌曲和云歌曲
      const localItems: any[] = [];
      const neteaseItems: any[] = [];

      currentPageItems.forEach((item) => {
        if (item.playMusicUrl?.startsWith('local://') || typeof item.id === 'string') {
          localItems.push(item);
        } else if (item.source !== 'bilibili') {
          neteaseItems.push(item);
        }
      });

      // 获取歌曲详情
      let neteaseSongs: SongResult[] = [];
      if (neteaseItems.length > 0) {
        try {
          const currentIds = neteaseItems.map((item) => item.id as number);
          const res = await getMusicDetail(currentIds);
          if (res.data.songs) {
            neteaseSongs = res.data.songs.map((song: SongResult) => {
              const historyItem = neteaseItems.find((item) => item.id === song.id);
              return {
                ...song,
                picUrl: song.al?.picUrl || '',
                count: historyItem?.count || 0,
                source: 'netease'
              };
            });
          }
        } catch (error) {
          console.error('获取歌曲详情失败:', error);
        }
      }

      // 按原始顺序合并结果
      const newSongs = currentPageItems
        .map((item) => {
          if (item.playMusicUrl?.startsWith('local://') || typeof item.id === 'string') {
            // 本地歌曲直接使用历史记录中的数据
            return item as SongResult;
          }
          return neteaseSongs.find((song) => song.id === item.id);
        })
        .filter((song): song is SongResult => !!song);

      if (currentPage.value === 1) {
        displayList.value = newSongs;
      } else {
        displayList.value = [...displayList.value, ...newSongs];
      }
    } else {
      // 处理歌单、专辑、播客数据（直接显示，不需要额外请求）
      if (currentPage.value === 1) {
        displayList.value = currentPageItems;
      } else {
        displayList.value = [...displayList.value, ...currentPageItems];
      }
    }

    const totalLength = getCurrentList().length;
    noMore.value = displayList.value.length >= totalLength;
  } catch (error) {
    console.error(t('history.getHistoryFailed'), error);
  } finally {
    loading.value = false;
  }
};

// 处理滚动事件
const handleScroll = (e: any) => {
  const { scrollTop, scrollHeight, offsetHeight } = e.target;
  const threshold = 100;

  if (!loading.value && !noMore.value && scrollHeight - (scrollTop + offsetHeight) < threshold) {
    currentPage.value++;
    loadHistoryData();
  }
};

// 播放全部
const handlePlay = () => {
  playerStore.setPlayList(displayList.value);
};

// 处理 tab 切换
const handleTabChange = async (value: 'local' | 'cloud') => {
  currentTab.value = value;
  currentPage.value = 1;
  noMore.value = false;
  displayList.value = [];

  // 如果切换到云端，且还没有加载对应的云端数据，则加载
  if (value === 'cloud') {
    loading.value = true;
    if (currentCategory.value === 'songs' && cloudRecords.value.length === 0) {
      cloudRecords.value = await getCloudRecords();
    } else if (currentCategory.value === 'playlists' && cloudPlaylists.value.length === 0) {
      cloudPlaylists.value = await getCloudPlaylists();
    } else if (currentCategory.value === 'albums' && cloudAlbums.value.length === 0) {
      cloudAlbums.value = await getCloudAlbums();
    }
    loading.value = false;
  }

  await loadHistoryData();
};

onMounted(async () => {
  if (!hasLoaded.value) {
    await loadHistoryData();
    hasLoaded.value = true;
  }
});

// 监听历史列表变化，变化时重置并重新加载
watch(
  () => [
    playHistoryStore.musicHistory,
    playHistoryStore.playlistHistory,
    playHistoryStore.albumHistory,
    playHistoryStore.podcastHistory,
    playHistoryStore.podcastRadioHistory
  ],
  async () => {
    if (hasLoaded.value) {
      currentPage.value = 1;
      noMore.value = false;
      await loadHistoryData();
    }
  },
  { deep: true }
);

// 重写删除方法，需要同时更新 displayList
const handleDelMusic = async (item: SongResult) => {
  playHistoryStore.delMusic(item);
  displayList.value = displayList.value.filter((music) => music.id !== item.id);
};

// 跳转到热力图页面
const handleNavigateToHeatmap = () => {
  router.push('/heatmap');
};
</script>

<style scoped lang="scss">
/* Minimal scoped styles */
</style>
