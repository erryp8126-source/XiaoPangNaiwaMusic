<template>
  <div>
    <!-- 移动端：奶娃悬浮磨砂玻璃胶囊底栏（沉浸黑胶首页自动切深色透明态） -->
    <nav
      v-if="isMobile"
      class="mobile-dock"
      :class="{ 'is-immersive-dark': isImmersiveHomeActive }"
      aria-label="主导航"
    >
      <router-link
        v-for="(item, index) in menus"
        :key="item.path"
        :to="item.path"
        class="dock-item"
        :class="{ 'is-active': isChecked(index) }"
        @click="handleMobileDockClick(item.path)"
      >
        <div class="dock-pill">
          <i class="dock-icon" :class="getMobileIcon(item.path, isChecked(index))"></i>
          <span class="dock-label">{{ getMobileLabel(item) }}</span>
        </div>
      </router-link>
    </nav>

    <!-- 桌面/平板端侧边菜单（保持完整兼容，统一奶娃暖阳配色） -->
    <div v-else class="app-menu" :class="{ 'app-menu-expanded': settingsStore.setData.isMenuExpanded }">
      <div class="app-menu-header">
        <div class="app-menu-logo" @click="toggleMenu">
          <img :src="icon" class="w-9 h-9 rounded-xl shadow-sm" alt="logo" />
        </div>
      </div>
      <div class="app-menu-list">
        <div v-for="(item, index) in menus" :key="item.path" class="app-menu-item">
          <n-tooltip
            :delay="200"
            :disabled="settingsStore.setData.isMenuExpanded || isMobile"
            placement="bottom"
          >
            <template #trigger>
              <router-link class="app-menu-item-link" :to="item.path">
                <i
                  class="iconfont app-menu-item-icon"
                  :style="iconStyle(index)"
                  :class="item.meta.icon"
                ></i>
                <span
                  v-if="settingsStore.setData.isMenuExpanded"
                  class="app-menu-item-text ml-3"
                  :class="isChecked(index) ? 'text-primary font-semibold' : ''"
                  >{{ t(item.meta.title) }}</span
                >
              </router-link>
            </template>
            <div v-if="!settingsStore.setData.isMenuExpanded">{{ t(item.meta.title) }}</div>
          </n-tooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Ref } from 'vue';
import { inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import icon from '@/assets/icon.png';
import { useSettingsStore } from '@/store';
import { isMobile } from '@/utils';

const props = defineProps({
  size: {
    type: String,
    default: '26px'
  },
  color: {
    type: String,
    default: '#94a3b8'
  },
  selectColor: {
    type: String,
    default: '#E89200'
  },
  menus: {
    type: Array as any,
    default: () => []
  }
});

const route = useRoute();
const path = ref(route.path);
const settingsStore = useSettingsStore();
const isImmersiveHomeActive = inject<Ref<boolean>>('isImmersiveHomeActive', ref(false));

const handleMobileDockClick = (menuPath: string) => {
  // 在沉浸黑胶首页点击底部「发现」Tab，直接切回经典发现浏览页
  if (menuPath === '/' && isImmersiveHomeActive.value) {
    settingsStore.setHomeDisplayMode('classic');
  }
};

watch(
  () => route.path,
  async (newParams) => {
    path.value = newParams;
  }
);

const { t } = useI18n();

const isChecked = (index: number) => {
  return path.value === props.menus[index]?.path;
};

const iconStyle = (index: number) => {
  return {
    fontSize: props.size,
    color: isChecked(index) ? props.selectColor : props.color
  };
};

// 移动端精致双态图标映射
const MOBILE_ICON_MAP: Record<string, { normal: string; active: string; shortLabel?: string }> = {
  '/': { normal: 'ri-compass-3-line', active: 'ri-compass-3-fill', shortLabel: '发现' },
  '/list': { normal: 'ri-play-list-2-line', active: 'ri-play-list-2-fill', shortLabel: '歌单' },
  '/toplist': { normal: 'ri-trophy-line', active: 'ri-trophy-fill', shortLabel: '排行' },
  '/history': { normal: 'ri-heart-3-line', active: 'ri-heart-3-fill', shortLabel: '收藏' },
  '/user': { normal: 'ri-user-smile-line', active: 'ri-user-smile-fill', shortLabel: '我的' },
  '/album': { normal: 'ri-album-line', active: 'ri-album-fill', shortLabel: '新碟' }
};

const getMobileIcon = (menuPath: string, active: boolean) => {
  const entry = MOBILE_ICON_MAP[menuPath];
  if (entry) {
    return active ? entry.active : entry.normal;
  }
  return active ? 'ri-disc-fill' : 'ri-disc-line';
};

const getMobileLabel = (item: any) => {
  const entry = MOBILE_ICON_MAP[item.path];
  if (entry?.shortLabel) return entry.shortLabel;
  return t(item.meta?.title || '');
};

const toggleMenu = () => {
  settingsStore.setSetData({
    isMenuExpanded: !settingsStore.setData.isMenuExpanded
  });
};
</script>

<style lang="scss" scoped>
/* ===== 移动端悬浮磨砂胶囊导航栏 ===== */
.mobile-dock {
  @apply flex items-center justify-around w-full px-2 py-1.5;
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.92);
  box-shadow:
    0 10px 32px rgba(72, 126, 162, 0.14),
    0 2px 6px rgba(232, 146, 0, 0.06);
}

:global(.dark) .mobile-dock {
  background: rgba(21, 28, 40, 0.86);
  border-color: rgba(255, 255, 255, 0.09);
  box-shadow:
    0 12px 36px rgba(0, 0, 0, 0.5),
    0 0 0 0.5px rgba(255, 197, 51, 0.08);
}

.mobile-dock.is-immersive-dark {
  background: rgba(12, 16, 26, 0.58);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);

  .dock-item {
    .dock-pill {
      color: rgba(255, 255, 255, 0.6);
    }

    &.is-active .dock-pill {
      color: #ffd147;
      background: rgba(255, 209, 71, 0.14);
      box-shadow: inset 0 0 0 1px rgba(255, 209, 71, 0.24);
    }
  }
}

.dock-item {
  @apply flex-1 flex items-center justify-center no-underline select-none;
  -webkit-tap-highlight-color: transparent;

  .dock-pill {
    @apply flex flex-col items-center justify-center py-1.5 px-3 rounded-[18px] transition-all duration-200;
    min-width: 54px;
    color: #64748b;
  }

  .dock-icon {
    @apply text-[21px] leading-none transition-transform duration-200;
  }

  .dock-label {
    @apply text-[10.5px] font-semibold mt-1 leading-none tracking-tight;
  }

  &:active .dock-pill {
    transform: scale(0.9);
  }

  &.is-active {
    .dock-pill {
      color: #d97706;
      background: linear-gradient(135deg, rgba(255, 215, 102, 0.28) 0%, rgba(167, 224, 248, 0.26) 100%);
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.22);
    }

    .dock-icon {
      transform: translateY(-1px) scale(1.06);
    }

    .dock-label {
      @apply font-bold;
    }
  }
}

:global(.dark) .dock-item {
  .dock-pill {
    color: #94a3b8;
  }

  &.is-active .dock-pill {
    color: #ffc533;
    background: linear-gradient(135deg, rgba(255, 197, 51, 0.2) 0%, rgba(56, 189, 248, 0.14) 100%);
    box-shadow: inset 0 0 0 1px rgba(255, 197, 51, 0.24);
  }
}

/* ===== 桌面侧边栏样式 ===== */
.app-menu {
  @apply flex-col items-center justify-center transition-all duration-300 w-[100px] px-1;
}

.app-menu-list {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  padding-bottom: 20px;
}

.app-menu-expanded {
  @apply w-[160px];

  .app-menu-item {
    @apply hover:bg-amber-50 dark:hover:bg-slate-800 rounded-xl mr-4;
  }
}

.app-menu-item-link,
.app-menu-header {
  @apply flex items-center w-[200px] overflow-hidden ml-2 px-5;
}

.app-menu-header {
  @apply ml-1;
}

.app-menu-item-link {
  @apply mb-6 mt-6;
}

.app-menu-item-icon {
  @apply transition-all duration-200 text-slate-400 dark:text-slate-400;

  &:hover {
    color: #e89200 !important;
    transform: scale(1.06);
  }
}
</style>
