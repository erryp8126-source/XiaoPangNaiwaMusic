<template>
  <div class="toplist-page h-full w-full bg-transparent transition-colors duration-300">
    <n-scrollbar class="h-full">
      <div class="toplist-content w-full pb-44 pt-4 page-padding">
        <!-- Hero Section -->
        <div class="mb-6">
          <div class="flex items-center gap-2.5 mb-1">
            <span class="h-6 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-sky-400" />
            <h1
              class="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100"
            >
              {{ t('comp.toplist') }}
            </h1>
          </div>
          <p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 pl-4">
            {{ t('comp.pages.toplist.desc') }}
          </p>
        </div>

        <!-- Toplist Grid -->
        <div class="toplist-grid-container">
          <!-- Loading State -->
          <div v-if="loading" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5 md:gap-6">
            <div v-for="i in 15" :key="i" class="space-y-2.5">
              <div class="aspect-square skeleton-shimmer rounded-[20px]" />
              <div class="h-4 w-3/4 skeleton-shimmer rounded-lg" />
              <div class="h-3 w-1/2 skeleton-shimmer rounded-lg" />
            </div>
          </div>

          <!-- Content State -->
          <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5 md:gap-5">
            <div
              v-for="(item, index) in topList"
              :key="item.id"
              class="toplist-card group cursor-pointer animate-item active:scale-[0.98] transition-all duration-200 rounded-[20px] overflow-hidden bg-white dark:bg-[#17202e] border border-slate-200/80 dark:border-slate-700/60 shadow-[0_6px_18px_rgba(15,23,42,0.06)] dark:shadow-[0_8px_22px_rgba(0,0,0,0.35)] flex flex-col"
              :style="{ animationDelay: calculateAnimationDelay(index, 0.03) }"
              @click.stop="openToplist(item)"
            >
              <!-- Cover Image -->
              <div
                class="relative aspect-square overflow-hidden bg-gradient-to-br from-sky-100 via-amber-50 to-orange-100 dark:from-slate-800 dark:to-slate-900"
              >
                <playlist-cover
                  :src="item.coverImgUrl"
                  size="400y400"
                  :alt="item.name"
                  :seed="item.id || item.name"
                  img-class="transition-transform duration-500 group-hover:scale-105"
                />

                <!-- Update Frequency Badge -->
                <div
                  class="absolute bottom-2 left-2 px-2.5 py-0.5 rounded-full bg-slate-950/65 backdrop-blur-md text-white text-[10px] font-semibold flex items-center gap-1"
                  v-if="item.updateFrequency"
                >
                  {{ item.updateFrequency }}
                </div>

                <!-- Play Count Badge -->
                <div
                  class="absolute top-2 right-2 px-2.5 py-0.5 rounded-full bg-slate-950/65 backdrop-blur-md text-white text-[10px] font-semibold flex items-center gap-1"
                >
                  <i class="ri-headphone-fill text-amber-300"></i>
                  {{ formatNumber(item.playCount) }}
                </div>
              </div>

              <!-- Info -->
              <div class="p-2.5 md:p-3 flex-1 bg-white dark:bg-[#17202e] space-y-1">
                <h3
                  class="text-[13.5px] md:text-[15px] font-bold text-slate-900 dark:text-slate-50 line-clamp-1 group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors"
                >
                  {{ item.name }}
                </h3>
                <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-1">
                  {{ item.updateFrequency }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </n-scrollbar>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getToplist } from '@/api/list';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import PlaylistCover from '@/components/common/PlaylistCover.vue';
import { calculateAnimationDelay, formatNumber } from '@/utils';

defineOptions({
  name: 'Toplist'
});

const { t } = useI18n();
const router = useRouter();
const topList = ref<any[]>([]);
const loading = ref(false);

const openToplist = async (item: any) => {
  try {
    navigateToMusicList(router, {
      id: item.id,
      type: 'playlist',
      name: item.name,
      listInfo: item,
      canRemove: false
    });
  } catch (error) {
    console.error('获取榜单详情失败:', error);
  }
};

const loadToplist = async () => {
  loading.value = true;
  try {
    const { data } = await getToplist();
    topList.value = data.list || [];
  } catch (error) {
    console.error('加载排行榜列表失败:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadToplist();
});
</script>

<style lang="scss" scoped>
.toplist-page {
  position: relative;
}

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

.toplist-card {
  &:hover {
    .play-icon {
      @apply opacity-100 scale-100;
    }
  }
}
</style>
