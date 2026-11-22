<template>
  <div class="mobile-search-result">
    <!-- 搜索结果头部 -->
    <div class="result-header" :class="{ 'safe-area-top': hasSafeArea }">
      <div class="header-back" @click="goBack">
        <i class="ri-arrow-left-s-line"></i>
      </div>
      <div class="header-keyword">{{ keyword }}</div>
      <div class="header-actions">
        <div class="action-btn" @click="openSearch">
          <i class="ri-search-line"></i>
        </div>
      </div>
    </div>

    <!-- 搜索类型标签 -->
    <div class="search-types">
      <div
        v-for="type in searchTypes"
        :key="type.key"
        class="type-tag"
        :class="{ active: searchType === type.key }"
        @click="selectType(type.key)"
      >
        {{ type.label }}
      </div>
      <div
        v-if="searchType === SEARCH_TYPE.MUSIC"
        class="type-tag offline-filter-tag"
        :class="{ 'offline-active': onlyOfflinePlayable }"
        @click="toggleOnlyOffline"
      >
        <i class="ri-download-cloud-2-line mr-1"></i>仅看离线可播
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div class="result-content" @scroll="handleScroll">
      <!-- 加载中 -->
      <div v-if="loading && !results.length" class="loading-state">
        <n-spin size="medium" />
        <span class="ml-2">{{ t('search.loading.searching') }}</span>
      </div>

      <!-- 搜索结果 -->
      <div v-else-if="displayedResults.length" class="result-list">
        <!-- 歌曲搜索 -->
        <template v-if="searchType === SEARCH_TYPE.MUSIC">
          <song-item
            v-for="item in displayedResults"
            :key="item.id"
            :item="item"
            :is-next="true"
            @play="handlePlay"
          />
        </template>

        <!-- 专辑/歌单/MV 搜索 -->
        <template v-else>
          <search-item v-for="item in displayedResults" :key="item.id" :item="item" class="mb-3" />
        </template>

        <!-- 加载更多 -->
        <div v-if="isLoadingMore" class="loading-more">
          <n-spin size="small" />
          <span class="ml-2">{{ t('search.loading.more') }}</span>
        </div>

        <!-- 没有更多 -->
        <div v-if="!hasMore && displayedResults.length" class="no-more">
          {{ t('search.noMore') }}
        </div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="!loading" class="empty-state">
        <i :class="onlyOfflinePlayable ? 'ri-wifi-off-line' : 'ri-search-line'"></i>
        <span>{{
          onlyOfflinePlayable ? '当前搜索结果暂无离线可播歌曲' : t('comp.musicList.noSearchResults')
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { getSearch } from '@/api/search';
import SearchItem from '@/components/common/SearchItem.vue';
import SongItem from '@/components/common/SongItem.vue';
import { SEARCH_TYPE, SEARCH_TYPES } from '@/const/bar-const';
import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { usePlayerStore } from '@/store/modules/player';
import { useSearchStore } from '@/store/modules/search';
import { triggerHaptic } from '@/utils/androidBridge';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const searchStore = useSearchStore();
const offlineStore = useOfflineAvailabilityStore();
offlineStore.ensureInitialized();

const onlyOfflinePlayable = ref(false);
const toggleOnlyOffline = () => {
  triggerHaptic('selection');
  onlyOfflinePlayable.value = !onlyOfflinePlayable.value;
  if (onlyOfflinePlayable.value) {
    void offlineStore.refresh();
  }
};

// 注入是否有安全区域
const hasSafeArea = inject('hasSafeArea', false);

// 搜索关键词
const keyword = ref((route.query.keyword as string) || '');

// 搜索类型
const searchType = ref(Number(route.query.type) || searchStore.searchType || 1);
const searchTypes = computed(() => {
  locale.value;
  return SEARCH_TYPES.map((type) => ({
    label: t(type.label),
    key: type.key
  }));
});

// 搜索结果
const results = ref<any[]>([]);
const loading = ref(false);

const displayedResults = computed(() => {
  if (searchType.value !== SEARCH_TYPE.MUSIC || !onlyOfflinePlayable.value) {
    return results.value;
  }
  return results.value.filter((item) => offlineStore.isOfflinePlayable(item));
});

// 分页
const ITEMS_PER_PAGE = 30;
const page = ref(1);
const hasMore = ref(true);
const isLoadingMore = ref(false);

// 执行搜索
const performSearch = async (isLoadMore = false) => {
  if (!keyword.value) return;

  if (isLoadMore) {
    if (!hasMore.value || isLoadingMore.value) return;
    isLoadingMore.value = true;
  } else {
    loading.value = true;
    results.value = [];
    page.value = 1;
    hasMore.value = true;
  }

  try {
    // 歌曲搜索
    if (searchType.value === SEARCH_TYPE.MUSIC) {
      const { data } = await getSearch({
        keywords: keyword.value,
        type: searchType.value,
        limit: ITEMS_PER_PAGE,
        offset: (page.value - 1) * ITEMS_PER_PAGE
      });

      const songs = (data.result.songs || []).map((item: any) => ({
        ...item,
        picUrl: item.al?.picUrl,
        artists: item.ar,
        source: 'netease'
      }));

      if (isLoadMore) {
        results.value = [...results.value, ...songs];
      } else {
        results.value = songs;
      }

      hasMore.value = songs.length === ITEMS_PER_PAGE;
    }
    // 专辑搜索
    else if (searchType.value === SEARCH_TYPE.ALBUM) {
      const { data } = await getSearch({
        keywords: keyword.value,
        type: searchType.value,
        limit: ITEMS_PER_PAGE,
        offset: (page.value - 1) * ITEMS_PER_PAGE
      });

      const albums = (data.result.albums || []).map((item: any) => ({
        ...item,
        desc: `${item.artist?.name || ''} ${item.company || ''}`,
        type: 'album'
      }));

      if (isLoadMore) {
        results.value = [...results.value, ...albums];
      } else {
        results.value = albums;
      }

      hasMore.value = albums.length === ITEMS_PER_PAGE;
    }
    // 歌单搜索
    else if (searchType.value === SEARCH_TYPE.PLAYLIST) {
      const { data } = await getSearch({
        keywords: keyword.value,
        type: searchType.value,
        limit: ITEMS_PER_PAGE,
        offset: (page.value - 1) * ITEMS_PER_PAGE
      });

      const playlists = (data.result.playlists || []).map((item: any) => ({
        ...item,
        picUrl: item.coverImgUrl,
        playCount: item.playCount,
        desc: item.creator?.nickname || '',
        type: 'playlist'
      }));

      if (isLoadMore) {
        results.value = [...results.value, ...playlists];
      } else {
        results.value = playlists;
      }

      hasMore.value = playlists.length === ITEMS_PER_PAGE;
    }
    // MV 搜索
    else if (searchType.value === SEARCH_TYPE.MV) {
      const { data } = await getSearch({
        keywords: keyword.value,
        type: searchType.value,
        limit: ITEMS_PER_PAGE,
        offset: (page.value - 1) * ITEMS_PER_PAGE
      });

      const mvs = (data.result.mvs || []).map((item: any) => ({
        ...item,
        picUrl: item.cover,
        playCount: item.playCount,
        desc: item.artists?.map((artist: any) => artist.name).join('/') || '',
        type: 'mv'
      }));

      if (isLoadMore) {
        results.value = [...results.value, ...mvs];
      } else {
        results.value = mvs;
      }

      hasMore.value = mvs.length === ITEMS_PER_PAGE;
    }

    page.value++;
  } catch (error) {
    console.error('搜索失败:', error);
  } finally {
    loading.value = false;
    isLoadingMore.value = false;
  }
};

// 选择搜索类型
const selectType = (type: number) => {
  if (searchType.value === type) return;

  searchType.value = type;
  searchStore.searchType = type;

  // 更新路由查询参数
  router.replace({
    query: {
      ...route.query,
      type: type.toString()
    }
  });

  performSearch();
};

// 滚动加载更多
const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  const { scrollTop, scrollHeight, clientHeight } = target;

  if (scrollTop + clientHeight >= scrollHeight - 100) {
    performSearch(true);
  }
};

// 播放音乐：将当前搜索歌曲列表设为播放队列，保证播完自动连播下一首
const handlePlay = (item: any) => {
  if (searchType.value === SEARCH_TYPE.MUSIC && results.value.length > 0) {
    playerStore.setPlayList(results.value);
  } else {
    playerStore.addToNextPlay(item);
  }
};

// 返回
const goBack = () => {
  router.back();
};

// 打开搜索
const openSearch = () => {
  router.push('/mobile-search');
};

// 监听路由变化
watch(
  () => route.query,
  (query) => {
    if (route.path === '/mobile-search-result' && query.keyword) {
      keyword.value = query.keyword as string;
      searchType.value = Number(query.type) || searchStore.searchType || 1;
      performSearch();
    }
  }
);

onMounted(() => {
  if (keyword.value) {
    performSearch();
  }
});
</script>

<style lang="scss" scoped>
.mobile-search-result {
  @apply fixed inset-0 flex flex-col;
  background-color: var(--bg-color);
  background-image:
    radial-gradient(circle at 12% 0%, var(--naiwa-sky-glow) 0%, transparent 48%),
    radial-gradient(circle at 92% 6%, var(--naiwa-sun-glow) 0%, transparent 44%);
}

.result-header {
  @apply flex items-center gap-3 px-4 py-3;
  background: rgba(246, 250, 253, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(186, 218, 238, 0.32);

  &.safe-area-top {
    padding-top: calc(var(--safe-area-inset-top, 0px) + 12px);
  }
}

.header-back,
.action-btn {
  @apply flex items-center justify-center w-9 h-9 rounded-full text-xl text-slate-700 active:scale-90 transition-transform;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(186, 218, 238, 0.45);
}

.header-keyword {
  @apply flex-1 text-[16px] font-bold text-slate-800 truncate;
}

.header-actions {
  @apply flex items-center gap-2;
}

.search-types {
  @apply flex gap-2 px-4 py-3 overflow-x-auto;
  border-bottom: 1px solid rgba(186, 218, 238, 0.28);

  &::-webkit-scrollbar {
    display: none;
  }
}

.type-tag {
  @apply px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 active:scale-95;
  background: rgba(255, 255, 255, 0.78);
  color: #475569;
  border: 1px solid rgba(186, 218, 238, 0.45);

  &.active {
    background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
    color: #ffffff;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(232, 146, 0, 0.26);
  }

  &.offline-active {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
    color: #ffffff !important;
    border-color: transparent !important;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.28);
  }
}

.result-content {
  @apply flex-1 overflow-y-auto px-3 pt-2;
}

.loading-state {
  @apply flex flex-col items-center justify-center py-20 text-slate-500;
}

.result-list {
  @apply pb-36 space-y-1;
}

.loading-more {
  @apply flex justify-center items-center py-4 text-slate-500;
}

.no-more {
  @apply text-center py-4 text-xs text-slate-400;
}

.empty-state {
  @apply flex flex-col items-center justify-center py-20 text-slate-400;

  i {
    @apply text-6xl mb-4 opacity-40;
  }
}

:global(.dark) {
  .result-header {
    background: rgba(15, 20, 28, 0.82);
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }

  .header-back,
  .action-btn,
  .type-tag:not(.active) {
    background: rgba(23, 30, 42, 0.78);
    border-color: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }

  .header-keyword {
    color: #f8fafc;
  }
}
</style>
