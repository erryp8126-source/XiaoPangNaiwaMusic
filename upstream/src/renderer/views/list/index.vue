<template>
  <sticky-tab-page
    ref="pageRef"
    :title="listTitle"
    :description="t('comp.pages.list.desc')"
    :model-value="currentType"
    :categories="playlistCategory?.sub || []"
    label-key="name"
    value-key="name"
    @change="handleTypeChange"
    @scroll="handleScroll"
  >
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5 md:gap-5">
      <!-- Loading State -->
      <template v-if="loading && page === 0">
        <div
          v-for="i in 12"
          :key="`loading-${i}`"
          class="rounded-[20px] overflow-hidden bg-white dark:bg-[#17202e] border border-slate-200/80 dark:border-slate-700/60 shadow-sm"
        >
          <div class="aspect-square skeleton-shimmer" />
          <div class="p-3 space-y-2">
            <div class="h-3.5 w-5/6 skeleton-shimmer rounded-md" />
            <div class="h-3 w-1/2 skeleton-shimmer rounded-md" />
          </div>
        </div>
      </template>

      <!-- Content State -->
      <template v-else>
        <div
          v-for="(item, index) in recommendList"
          :key="item.id"
          class="list-card group cursor-pointer active:scale-[0.98] transition-all duration-200 rounded-[20px] overflow-hidden bg-white dark:bg-[#17202e] border border-slate-200/80 dark:border-slate-700/60 shadow-[0_6px_18px_rgba(15,23,42,0.06)] dark:shadow-[0_8px_22px_rgba(0,0,0,0.35)] flex flex-col"
          :class="{ 'animate-item': !animatedIds.has(item.id) }"
          :style="{
            animationDelay: !animatedIds.has(item.id)
              ? calculateAnimationDelay(index % TOTAL_ITEMS, 0.03)
              : '0s'
          }"
          @click.stop="openPlaylist(item)"
          @animationend="animatedIds.add(item.id)"
        >
          <!-- Cover Image -->
          <div
            class="relative aspect-square overflow-hidden bg-gradient-to-br from-sky-100 via-amber-50 to-orange-100 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900"
          >
            <playlist-cover
              :src="item.picUrl || item.coverImgUrl"
              size="400y400"
              :alt="item.name"
              :seed="item.id || item.name"
              img-class="transition-transform duration-500 group-hover:scale-105"
            />

            <!-- 底部轻渐变，保证角落角标清晰 -->
            <div
              class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-slate-950/45 via-slate-950/15 to-transparent"
            />

            <!-- Play Count Badge -->
            <div
              class="absolute top-2 right-2 px-2.5 py-0.5 rounded-full bg-slate-950/65 backdrop-blur-md text-white text-[10.5px] font-semibold flex items-center gap-1 shadow-sm"
            >
              <i class="ri-headphone-fill text-[10px] text-amber-300"></i>
              <span>{{ formatNumber(item.playCount) }}</span>
            </div>

            <!-- 右下角音乐播放标识 -->
            <div
              class="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/95 dark:bg-slate-900/90 text-amber-500 dark:text-amber-300 flex items-center justify-center shadow-md ring-1 ring-black/5 dark:ring-white/10"
            >
              <i class="ri-play-fill text-base ml-0.5"></i>
            </div>
          </div>

          <!-- Info Footer（高对比度实底卡片信息区，任何背景都清晰锐利） -->
          <div class="p-2.5 md:p-3 flex-1 flex flex-col justify-between bg-white dark:bg-[#17202e]">
            <h3
              class="text-[13.5px] md:text-[15px] font-bold text-slate-900 dark:text-slate-50 line-clamp-2 leading-[1.38] group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors"
            >
              {{ item.name }}
            </h3>
            <div
              v-if="item.creator?.nickname || (item.tags && item.tags.length)"
              class="mt-1.5 flex items-center justify-between gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400"
            >
              <span class="truncate">
                {{ item.creator?.nickname || item.tags?.[0] }}
              </span>
              <span
                v-if="item.trackCount"
                class="flex-shrink-0 text-[10.5px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                {{ item.trackCount }}首
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 加载更多 -->
    <div v-if="isLoadingMore" class="flex justify-center items-center py-8">
      <n-spin size="small" />
      <span class="ml-2 text-sm font-medium text-slate-500 dark:text-slate-400">{{ t('common.loading') }}</span>
    </div>
    <div v-if="!hasMore && recommendList.length > 0" class="text-center py-8 text-xs font-medium text-slate-400 dark:text-slate-500">
      {{ t('common.noMore') }}
    </div>
  </sticky-tab-page>
</template>

<script lang="ts" setup>
import { nextTick, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { getPlaylistCategory } from '@/api/home';
import { getListByCat } from '@/api/list';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import PlaylistCover from '@/components/common/PlaylistCover.vue';
import StickyTabPage from '@/components/common/StickyTabPage.vue';
import type { IPlayListSort } from '@/types/playlist';
import { calculateAnimationDelay, formatNumber } from '@/utils';

defineOptions({
  name: 'List'
});

const { t } = useI18n();
const TOTAL_ITEMS = 42;

const recommendList = ref<any[]>([]);
const page = ref(0);
const hasMore = ref(true);
const isLoadingMore = ref(false);
const animatedIds = reactive(new Set<number>());
const pageRef = ref();

const router = useRouter();

const openPlaylist = (item: any) => {
  navigateToMusicList(router, {
    id: item.id,
    type: 'playlist',
    name: item.name,
    listInfo: item,
    canRemove: false
  });
};

const route = useRoute();
const DEFAULT_CAT = '每日推荐';
const listTitle = ref((route.query.type as string) || t('comp.pages.list.dailyRecommend'));

const loading = ref(false);
const loadList = async (type: string, isLoadMore = false) => {
  if (!hasMore.value && isLoadMore) return;
  if (isLoadMore) {
    isLoadingMore.value = true;
  } else {
    loading.value = true;
    page.value = 0;
    recommendList.value = [];
    await nextTick();
    pageRef.value?.scrollTo({ top: 0 });
  }

  try {
    const params = {
      cat: type === DEFAULT_CAT ? '全部' : type,
      limit: TOTAL_ITEMS,
      offset: page.value * TOTAL_ITEMS
    };
    const { data } = await getListByCat(params);
    if (isLoadMore) {
      recommendList.value.push(...data.playlists);
    } else {
      recommendList.value = data.playlists;
    }
    hasMore.value = data.more;
    page.value++;
  } catch (error) {
    console.error('加载歌单列表失败:', error);
  } finally {
    loading.value = false;
    isLoadingMore.value = false;
  }
};

const handleScroll = (e: any) => {
  const { scrollTop, scrollHeight, clientHeight } = e.target;
  if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoadingMore.value && hasMore.value) {
    loadList(currentType.value, true);
  }
};

const playlistCategory = ref<IPlayListSort>();
const currentType = ref((route.query.type as string) || DEFAULT_CAT);

const loadPlaylistCategory = async () => {
  const { data } = await getPlaylistCategory();
  playlistCategory.value = {
    ...data,
    sub: [
      {
        name: DEFAULT_CAT,
        category: 0
      },
      ...data.sub
    ]
  };
};

const handleTypeChange = (type: string) => {
  router.replace({ query: { ...route.query, type } });
};

onMounted(() => {
  loadPlaylistCategory();
  currentType.value = (route.query.type as string) || currentType.value;
  loadList(currentType.value);
});

onDeactivated(() => {
  recommendList.value.forEach((item) => animatedIds.add(item.id));
});

watch(
  () => route.query,
  async (newParams) => {
    if (route.path !== '/list') return;
    const newType = (newParams.type as string) || DEFAULT_CAT;
    if (newType !== currentType.value) {
      listTitle.value = newType === DEFAULT_CAT ? t('comp.pages.list.dailyRecommend') : newType;
      currentType.value = newType;
      loading.value = true;
      loadList(newType);
    }
  }
);
</script>

<style lang="scss" scoped>
.animate-item {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
