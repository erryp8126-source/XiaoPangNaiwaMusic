<template>
  <div class="h-full w-full bg-[#F1F5F9] dark:bg-[#0D131C] transition-colors duration-300 flex flex-col">
    <!-- 顶部导航区（移动端已由顶栏显示返回与「设置」标题，这里仅保留高对比度分类切换条） -->
    <div
      class="flex-shrink-0 border-b border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#131B28]/95 backdrop-blur-xl z-10 page-padding pt-3 md:pt-4 pb-2.5"
    >
      <div class="hidden md:flex items-center gap-2.5 mb-3.5">
        <span class="h-6 w-1.5 rounded-full bg-gradient-to-b from-amber-500 to-sky-500" />
        <h1 class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white">
          {{ t('common.settings') }}
        </h1>
      </div>

      <n-scrollbar x-scrollable class="w-full">
        <div class="flex items-center gap-2 pb-1 whitespace-nowrap">
          <button
            v-for="section in navSections"
            :key="section.id"
            type="button"
            class="py-1.5 px-4 inline-flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 text-[13.5px] font-bold select-none active:scale-95"
            :class="
              currentSection === section.id
                ? 'text-white shadow-md shadow-amber-600/25'
                : 'bg-slate-100 text-slate-700 border border-slate-200/90 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
            "
            :style="
              currentSection === section.id
                ? 'background: linear-gradient(135deg, #D97706 0%, #EA580C 100%)'
                : undefined
            "
            @click="currentSection = section.id"
          >
            {{ section.title }}
          </button>
        </div>
      </n-scrollbar>
    </div>

    <!-- 内容区域 -->
    <n-scrollbar class="flex-1">
      <div class="w-full mx-auto pb-40 pt-4 page-padding">
        <div v-show="currentSection === 'basic'" class="animate-fade-in">
          <basic-tab />
        </div>

        <div v-show="currentSection === 'playback'" class="animate-fade-in">
          <playback-tab />
        </div>

        <div v-show="currentSection === 'application'" class="animate-fade-in">
          <application-tab />
        </div>

        <div v-show="currentSection === 'network'" class="animate-fade-in">
          <network-tab />
        </div>

        <div v-show="currentSection === 'system'" class="animate-fade-in">
          <system-tab />
        </div>

        <div v-show="currentSection === 'about'" class="animate-fade-in">
          <about-tab />
        </div>

        <div v-show="currentSection === 'donation'" class="animate-fade-in">
          <donation-tab />
        </div>

        <div class="h-20"></div>
        <play-bottom />
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { useDialog, useMessage } from 'naive-ui';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import PlayBottom from '@/components/common/PlayBottom.vue';
import { useSettingsStore } from '@/store/modules/settings';
import { isElectron, isNative } from '@/utils';

import config from '../../../../package.json';
import { createDefaultAppUpdateState } from '../../../shared/appUpdate';
import { SETTINGS_DATA_KEY, SETTINGS_DIALOG_KEY, SETTINGS_MESSAGE_KEY } from './keys';
import AboutTab from './tabs/AboutTab.vue';
import ApplicationTab from './tabs/ApplicationTab.vue';
import BasicTab from './tabs/BasicTab.vue';
import DonationTab from './tabs/DonationTab.vue';
import NetworkTab from './tabs/NetworkTab.vue';
import PlaybackTab from './tabs/PlaybackTab.vue';
import SystemTab from './tabs/SystemTab.vue';

const settingsStore = useSettingsStore();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();

// ==================== 设置数据管理 ====================
const saveSettings = useDebounceFn((data) => {
  settingsStore.setSetData(data);
}, 500);

const localSetData = ref({ ...settingsStore.setData });

const setData = computed({
  get: () => localSetData.value,
  set: (newData) => {
    localSetData.value = newData;
  }
});

watch(
  () => localSetData.value,
  (newValue) => saveSettings(newValue),
  { deep: true }
);

watch(
  () => settingsStore.setData,
  (newValue) => {
    if (JSON.stringify(localSetData.value) !== JSON.stringify(newValue)) {
      localSetData.value = { ...newValue };
    }
  },
  { deep: true, immediate: true }
);

onUnmounted(() => {
  settingsStore.setSetData(localSetData.value);
});

// ==================== Provide ====================
provide(SETTINGS_DATA_KEY, setData);
provide(SETTINGS_MESSAGE_KEY, message);
provide(SETTINGS_DIALOG_KEY, dialog);

// ==================== 导航相关 ====================
type SettingSectionConfig = {
  id: string;
  electron?: boolean;
  native?: boolean;
};

const settingSections: SettingSectionConfig[] = [
  { id: 'basic' },
  { id: 'playback' },
  { id: 'application', electron: true },
  { id: 'network', native: true },
  { id: 'system', electron: true },
  { id: 'about' },
  { id: 'donation' }
];

const navSections = computed(() => {
  return settingSections
    .filter((section) => {
      if (section.native) return isNative;
      return !section.electron || isElectron;
    })
    .map((section) => ({
      id: section.id,
      title: t(`settings.sections.${section.id}`)
    }));
});

const currentSection = ref('basic');

// ==================== 初始化 ====================
onMounted(() => {
  if (isElectron && settingsStore.appUpdateState.currentVersion === '') {
    settingsStore.setAppUpdateState(createDefaultAppUpdateState(config.version));
  }
  if (setData.value.proxyConfig) {
    // proxy form init moved to NetworkTab
  }
  if (setData.value.enableRealIP === undefined) {
    setData.value = { ...setData.value, enableRealIP: false };
  }
  if (setData.value.enableDiskCache === undefined) {
    setData.value = { ...setData.value, enableDiskCache: true };
  }
  if (!setData.value.diskCacheMaxSizeMB) {
    setData.value = { ...setData.value, diskCacheMaxSizeMB: 4096 };
  }
  if (!['lru', 'fifo'].includes(setData.value.diskCacheCleanupPolicy)) {
    setData.value = { ...setData.value, diskCacheCleanupPolicy: 'lru' };
  }
});
</script>

<style scoped>
:deep(.n-select .n-base-selection) {
  border-radius: 10px;
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
