<template>
  <div class="history-fav-page flex flex-col gap-3 h-full pb-4 page-padding pt-3 bg-transparent">
    <!-- 移动端顶部：我喜欢 / 最近播放 磨砂胶囊切换 -->
    <div v-if="isMobile" class="mobile-seg-wrap">
      <div class="mobile-seg-rail">
        <button
          type="button"
          class="mobile-seg-btn"
          :class="{ active: mobileTab === 'favorite' }"
          @click="mobileTab = 'favorite'"
        >
          <i class="ri-heart-3-fill"></i>
          <span>{{ t('favorite.title') }}</span>
        </button>
        <button
          type="button"
          class="mobile-seg-btn"
          :class="{ active: mobileTab === 'history' }"
          @click="mobileTab = 'history'"
        >
          <i class="ri-history-line"></i>
          <span>{{ t('history.title') }}</span>
        </button>
        <button
          type="button"
          class="mobile-seg-btn"
          :class="{ active: mobileTab === 'stats' }"
          @click="mobileTab = 'stats'"
        >
          <i class="ri-bar-chart-2-fill"></i>
          <span>听歌统计</span>
        </button>
      </div>
    </div>

    <div class="flex gap-6 flex-1 min-h-0">
      <favorite v-if="!isMobile || mobileTab === 'favorite'" class="flex-item" />
      <history-list v-if="!isMobile || mobileTab === 'history'" class="flex-item" />
      <n-scrollbar v-if="isMobile && mobileTab === 'stats'" class="flex-1">
        <listening-stats-panel class="px-0.5 pt-1" />
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ListeningStatsPanel from '@/components/stats/ListeningStatsPanel.vue';
import { isMobile } from '@/utils';
import Favorite from '@/views/favorite/index.vue';
import HistoryList from '@/views/history/index.vue';

defineOptions({
  name: 'History'
});

const { t } = useI18n();
const mobileTab = ref<'favorite' | 'history' | 'stats'>('favorite');
</script>

<style scoped lang="scss">
.mobile-seg-wrap {
  @apply flex-shrink-0;
}

.mobile-seg-rail {
  @apply flex p-1 rounded-2xl;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(186, 218, 238, 0.45);
  box-shadow: 0 4px 14px rgba(82, 134, 168, 0.08);
}

.mobile-seg-btn {
  @apply flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-slate-500 transition-all duration-200 active:scale-95;

  &.active {
    background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(232, 146, 0, 0.28);
  }
}

.flex-item {
  @apply flex-1 rounded-[26px] overflow-hidden transition-all duration-300;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(186, 218, 238, 0.42);
  box-shadow: 0 8px 24px rgba(82, 134, 168, 0.07);
}

:global(.dark) {
  .mobile-seg-rail,
  .flex-item {
    background: rgba(23, 30, 42, 0.74);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .mobile-seg-btn:not(.active) {
    color: #94a3b8;
  }
}
</style>
