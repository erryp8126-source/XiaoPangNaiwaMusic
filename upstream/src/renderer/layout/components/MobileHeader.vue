<template>
  <header class="mobile-header" :class="{ 'safe-area-top': hasSafeArea }">
    <!-- 左侧区域 -->
    <div class="header-left">
      <button v-if="showBack" type="button" class="header-pill-btn" @click="goBack">
        <i class="ri-arrow-left-s-line text-[22px]"></i>
      </button>
      <div v-else class="header-brand" @click="goHome">
        <div class="brand-avatar-wrap">
          <img :src="mascotIcon" alt="小庞奶娃音乐" class="brand-avatar" />
        </div>
        <div class="brand-meta">
          <span class="brand-title">小庞奶娃音乐</span>
          <span class="brand-sub">NAIWA MUSIC</span>
        </div>
      </div>
    </div>

    <!-- 中间标题（子页面显示） -->
    <div v-if="showBack" class="header-title">
      <span v-if="title">{{ t(title) }}</span>
    </div>

    <!-- 右侧快捷操作 -->
    <div class="header-right">
      <button
        type="button"
        class="header-pill-btn theme-btn"
        :title="isDark ? '切换浅色模式' : '切换暗黑模式'"
        @click="handleToggleTheme"
      >
        <i :class="isDark ? 'ri-sun-fill text-amber-300' : 'ri-moon-clear-fill text-sky-500'"></i>
      </button>
      <button type="button" class="header-pill-btn" @click="openSearch">
        <i class="ri-search-2-line"></i>
      </button>
      <button type="button" class="header-pill-btn" @click="openSettings">
        <i class="ri-settings-4-line"></i>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import mascotIcon from '@/assets/icon.png';
import { useSettingsStore } from '@/store/modules/settings';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const settingsStore = useSettingsStore();

const hasSafeArea = inject('hasSafeArea', false);

const showBack = computed(() => route.meta.back === true);
const title = computed(() => (route.meta.title as string) || '');
const isDark = computed(() => settingsStore.theme === 'dark');

const goBack = () => {
  router.back();
};

const goHome = () => {
  if (route.path !== '/') {
    router.push('/');
  }
};

const handleToggleTheme = () => {
  settingsStore.toggleTheme();
};

const openSearch = () => {
  router.push('/mobile-search');
};

const openSettings = () => {
  router.push('/set');
};
</script>

<style lang="scss" scoped>
.mobile-header {
  @apply flex items-center justify-between px-4 py-2.5 flex-shrink-0 z-30;
  min-height: 58px;
  background: rgba(246, 250, 253, 0.78);
  backdrop-filter: blur(22px) saturate(165%);
  -webkit-backdrop-filter: blur(22px) saturate(165%);
  border-bottom: 1px solid rgba(186, 218, 238, 0.28);
  transition: background-color 0.3s ease, border-color 0.3s ease;

  &.safe-area-top {
    padding-top: calc(var(--safe-area-inset-top, 0px) + 10px);
  }
}

html.dark .mobile-header {
  background: rgba(15, 15, 19, 0.94);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.header-left {
  @apply flex items-center flex-shrink-0;
}

.header-brand {
  @apply flex items-center gap-2.5 cursor-pointer select-none active:scale-95 transition-transform;

  .brand-avatar-wrap {
    @apply relative w-9 h-9 rounded-[12px] overflow-hidden flex-shrink-0;
    box-shadow:
      0 4px 12px rgba(232, 146, 0, 0.24),
      0 0 0 2px rgba(255, 198, 56, 0.55);
    background: #d7eff9;
  }

  .brand-avatar {
    @apply w-full h-full object-cover;
  }

  .brand-meta {
    @apply flex flex-col leading-none;
  }

  .brand-title {
    @apply text-[16px] font-extrabold tracking-tight;
    background: linear-gradient(125deg, #c77600 0%, #f09700 52%, #0284c7 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .brand-sub {
    @apply text-[9px] font-bold tracking-[0.18em] text-slate-400 dark:text-slate-500 mt-0.5;
  }
}

html.dark .header-brand .brand-title {
  background: linear-gradient(125deg, #ffe066 0%, #ffb81c 58%, #ffc533 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.header-title {
  @apply flex-1 text-center px-3 min-w-0;

  span {
    @apply block truncate text-[16px] font-bold text-slate-800 dark:text-slate-100;
  }
}

.header-right {
  @apply flex items-center gap-2 flex-shrink-0;
}

.header-pill-btn {
  @apply flex items-center justify-center w-9 h-9 rounded-full text-[18px];
  @apply text-slate-700 dark:text-slate-200;
  @apply transition-all duration-200 active:scale-90;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(186, 218, 238, 0.45);
  box-shadow: 0 3px 10px rgba(82, 134, 168, 0.08);
}

html.dark .header-pill-btn {
  background: #1c1c22;
  color: #fafafa;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.36);
}

.theme-btn:active i {
  transform: rotate(25deg);
}
</style>
