<template>
  <div
    id="layout-main"
    class="mobile-layout mobile naiwa-canvas"
    :class="{ 'has-safe-area': isPhone, 'is-immersive-home': isImmersiveHomeActive }"
  >
    <!-- 顶部头部（沉浸黑胶首页激活时隐藏，由沉浸页内置极简顶栏接管） -->
    <mobile-header v-if="!isImmersiveHomeActive" />

    <!-- 离线轻提示条 -->
    <offline-banner v-if="!isImmersiveHomeActive" />

    <!-- 主内容区域 -->
    <div
      class="mobile-content"
      :class="{
        'has-bottom-menu': shouldShowBottomMenu,
        'has-player': isPlay && !isImmersiveHomeActive,
        'is-immersive-content': isImmersiveHomeActive
      }"
    >
      <router-view v-slot="{ Component }" class="mobile-page">
        <keep-alive :include="keepAliveInclude">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>

    <!-- 底部悬浮播放条（沉浸黑胶首页激活时内部自动隐藏迷你条，仅保留全屏弹窗能力） -->
    <mobile-play-bar v-if="isPlay" />

    <!-- 底部悬浮磨砂胶囊导航栏（沉浸黑胶首页激活时自动切为深色透明风格） -->
    <div
      v-if="shouldShowBottomMenu"
      class="mobile-bottom-menu"
      :class="{ 'is-immersive-dark': isImmersiveHomeActive }"
    >
      <app-menu class="mobile-menu" :menus="menuStore.menus" />
    </div>
    <!-- 其他弹窗/抽屉 -->
    <playlist-drawer v-model="showPlaylistDrawer" :song-id="currentSongId" />
    <playing-list-drawer />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, provide, ref } from 'vue';
import { useRoute } from 'vue-router';

import OfflineBanner from '@/components/common/OfflineBanner.vue';
import homeRouter from '@/router/home';
import otherRouter from '@/router/other';
import { useMenuStore } from '@/store/modules/menu';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';

import AppMenu from './components/AppMenu.vue';
import MobileHeader from './components/MobileHeader.vue';
const MobilePlayBar = defineAsyncComponent(() => import('@/components/player/MobilePlayBar.vue'));
const PlayingListDrawer = defineAsyncComponent(
  () => import('@/components/player/PlayingListDrawer.vue')
);
const PlaylistDrawer = defineAsyncComponent(() => import('@/components/common/PlaylistDrawer.vue'));

const props = defineProps<{
  isPhone: boolean;
}>();

const route = useRoute();
const playerStore = usePlayerStore();
const menuStore = useMenuStore();
const settingsStore = useSettingsStore();

// 沉浸黑胶首页激活态（移动端在首页且处于沉浸模式、未覆盖全屏播放抽屉时生效）
const isImmersiveHomeActive = computed(
  () =>
    settingsStore.isMobile &&
    route.path === '/' &&
    settingsStore.homeDisplayMode === 'immersive' &&
    !playerStore.musicFull
);

// 提供给 MobilePlayBar / AppMenu 联动隐藏迷你条与深色透明底栏
provide('isImmersiveHomeActive', isImmersiveHomeActive);

// 提供是否有安全区域
provide('hasSafeArea', props.isPhone);

// 是否有播放的歌曲
const isPlay = computed(() => playerStore.playMusic && playerStore.playMusic.id);

// 是否显示底部菜单
const shouldShowBottomMenu = computed(() => {
  const menuPaths = menuStore.menus.map((item: any) => item.path);
  return menuPaths.includes(route.path) && !playerStore.musicFull;
});

// 提供给 MobilePlayBar 使用，用于调整播放栏位置
provide('shouldShowMobileMenu', shouldShowBottomMenu);

// Keep-alive 配置
const keepAliveInclude = computed(() => {
  const allRoutes = [...homeRouter, ...otherRouter];
  return allRoutes
    .filter((item) => item.meta?.keepAlive)
    .map((item) =>
      typeof item.name === 'string' ? item.name.charAt(0).toUpperCase() + item.name.slice(1) : ''
    )
    .filter(Boolean);
});

// 歌单抽屉
const showPlaylistDrawer = ref(false);
const currentSongId = ref<number | undefined>();

// 提供打开歌单抽屉的方法
const openPlaylistDrawer = (songId: number, isOpen: boolean = true) => {
  currentSongId.value = songId;
  showPlaylistDrawer.value = isOpen;
  playerStore.setMusicFull(false);
  playerStore.setPlayListDrawerVisible(!isOpen);
};

provide('openPlaylistDrawer', openPlaylistDrawer);
</script>

<style lang="scss" scoped>
.mobile-layout {
  @apply w-screen h-screen flex flex-col overflow-hidden;
  position: relative;
}

.mobile-content {
  @apply flex-1 overflow-auto;

  &.is-immersive-content {
    overflow: hidden;
  }
}

.mobile-page {
  @apply h-full;
}

// 底部悬浮胶囊导航容器
.mobile-bottom-menu {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9000;
  padding: 0 14px calc(var(--safe-area-inset-bottom, 10px) + 8px);
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(246, 250, 253, 0.92) 0%,
    rgba(246, 250, 253, 0.55) 55%,
    transparent 100%
  );

  &.is-immersive-dark {
    background: linear-gradient(
      to top,
      rgba(6, 9, 16, 0.88) 0%,
      rgba(6, 9, 16, 0.44) 60%,
      transparent 100%
    );
  }
}

html.dark .mobile-bottom-menu:not(.is-immersive-dark) {
  background: linear-gradient(
    to top,
    rgba(9, 9, 11, 0.96) 0%,
    rgba(9, 9, 11, 0.65) 55%,
    transparent 100%
  );
}

.mobile-menu {
  @apply w-full;
  pointer-events: auto;
}
</style>
