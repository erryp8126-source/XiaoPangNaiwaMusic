<template>
  <div class="h-full w-full bg-[#F1F5F9] dark:bg-[#09090B] transition-colors duration-300 flex flex-col">
    <!-- 顶部层级切换栏（常用设置 / 高级设置） -->
    <div
      class="settings-header-bar flex-shrink-0 border-b border-slate-200/90 dark:border-white/[0.08] bg-white/95 dark:bg-[#131316]/95 backdrop-blur-xl z-10 page-padding pt-3 md:pt-4 pb-3"
    >
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="hidden md:flex items-center gap-2.5">
          <span class="h-6 w-1.5 rounded-full bg-gradient-to-b from-amber-500 to-sky-500" />
          <h1 class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white">
            {{ t('common.settings') }}
          </h1>
        </div>

        <!-- 常用 / 高级 两层架构切换器 -->
        <div
          class="inline-flex items-center gap-1 p-1 rounded-full bg-slate-100 dark:bg-[#1C1C22] border border-slate-200/80 dark:border-white/[0.08]"
          role="tablist"
          aria-label="设置分层"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="activeTier === 'common'"
            class="py-1.5 px-4 rounded-full cursor-pointer transition-all duration-200 text-[13.5px] font-bold select-none active:scale-95"
            :class="
              activeTier === 'common'
                ? 'text-white shadow-md shadow-amber-600/25'
                : 'text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white'
            "
            :style="
              activeTier === 'common'
                ? 'background: linear-gradient(135deg, #D97706 0%, #EA580C 100%)'
                : undefined
            "
            @click="switchTier('common')"
          >
            常用设置
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTier === 'advanced'"
            class="py-1.5 px-4 rounded-full cursor-pointer transition-all duration-200 text-[13.5px] font-bold select-none active:scale-95"
            :class="
              activeTier === 'advanced'
                ? 'text-white shadow-md shadow-amber-600/25'
                : 'text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white'
            "
            :style="
              activeTier === 'advanced'
                ? 'background: linear-gradient(135deg, #D97706 0%, #EA580C 100%)'
                : undefined
            "
            @click="switchTier('advanced')"
          >
            高级设置
          </button>
        </div>

        <!-- 轻量云同步新鲜度胶囊，点击直达云同步 -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/80 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-400/25 hover:opacity-85 transition-opacity"
          @click="jumpToSection('common', 'settings-sync')"
        >
          <i class="ri-cloud-line text-xs"></i>
          <span>{{ headerSyncStatusText }}</span>
        </button>
      </div>

      <!-- 二级快捷锚点条 -->
      <n-scrollbar x-scrollable class="w-full mt-2.5">
        <div class="flex items-center gap-1.5 pb-0.5 whitespace-nowrap">
          <button
            v-for="pill in currentAnchorPills"
            :key="pill.anchorId"
            type="button"
            class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100/90 text-slate-600 border border-slate-200/80 hover:bg-slate-200/70 dark:bg-[#1C1C22] dark:text-zinc-300 dark:border-white/[0.08] transition-colors active:scale-95"
            @click="scrollToAnchor(pill.anchorId)"
          >
            {{ pill.label }}
          </button>
        </div>
      </n-scrollbar>
    </div>

    <!-- 内容区域（v-if 保证常用/高级面板不重复挂载监听器与弹窗） -->
    <n-scrollbar ref="scrollbarRef" class="flex-1">
      <div class="w-full mx-auto pb-40 pt-4 page-padding">
        <!-- 1. 常用设置（默认直接展示：外观/省电、音质/缓存/播放偏好/蓝牙/桌面歌词、云同步） -->
        <div v-if="activeTier === 'common'" class="space-y-6 animate-fade-in">
          <basic-tab id="settings-basic" mode="common" />
          <playback-tab id="settings-playback" mode="common" />
          <cloud-sync-tab id="settings-sync" mode="common" />

          <!-- 前往高级设置折叠/引导卡 -->
          <button
            type="button"
            class="w-full p-4 rounded-[20px] bg-white dark:bg-[#131316] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.05)] flex items-center justify-between gap-3 text-left hover:border-amber-400/60 transition-colors active:scale-[0.99]"
            @click="switchTier('advanced')"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-[#1C1C22] text-slate-600 dark:text-zinc-300 flex items-center justify-center flex-shrink-0"
              >
                <i class="ri-tools-line text-xl"></i>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 dark:text-white">
                  高级设置
                </div>
                <div class="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
                  自定义音源 / LX 脚本、网络代理、WebDAV / GitHub 同步、桌面歌词配色字号、崩溃日志与诊断
                </div>
              </div>
            </div>
            <i class="ri-arrow-right-s-line text-xl text-slate-400 flex-shrink-0"></i>
          </button>
        </div>

        <!-- 2. 高级设置 -->
        <div v-else class="space-y-6 animate-fade-in">
          <playback-tab id="settings-sources" mode="advanced" />
          <network-tab id="settings-network" />
          <cloud-sync-tab id="settings-sync-advanced" mode="advanced" />
          <basic-tab id="settings-basic-advanced" mode="advanced" />
          <application-tab v-if="isElectron" id="settings-application" />
          <system-tab v-if="isElectron" id="settings-system" />
          <about-tab id="settings-about" />
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
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import PlayBottom from '@/components/common/PlayBottom.vue';
import { useCloudSyncStore } from '@/store/modules/cloudSync';
import { useSettingsStore } from '@/store/modules/settings';
import { isElectron } from '@/utils';
import { formatRelativeSyncTime } from '@/utils/cloudSyncMerge';

import config from '../../../../package.json';
import { createDefaultAppUpdateState } from '../../../shared/appUpdate';
import { SETTINGS_DATA_KEY, SETTINGS_DIALOG_KEY, SETTINGS_MESSAGE_KEY } from './keys';
import AboutTab from './tabs/AboutTab.vue';
import ApplicationTab from './tabs/ApplicationTab.vue';
import BasicTab from './tabs/BasicTab.vue';
import CloudSyncTab from './tabs/CloudSyncTab.vue';
import NetworkTab from './tabs/NetworkTab.vue';
import PlaybackTab from './tabs/PlaybackTab.vue';
import SystemTab from './tabs/SystemTab.vue';

const settingsStore = useSettingsStore();
const cloudSyncStore = useCloudSyncStore();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();
const route = useRoute();

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

// ==================== 常用 / 高级 分层导航 ====================
type SettingsTier = 'common' | 'advanced';
const activeTier = ref<SettingsTier>('common');
const scrollbarRef = ref<any>(null);
const nowTick = ref(Date.now());
let syncTickTimer: number | null = null;

const headerSyncStatusText = computed(() => {
  if (!cloudSyncStore.lastSyncAt) {
    return '云同步：尚未同步';
  }
  return `上次同步：${formatRelativeSyncTime(cloudSyncStore.lastSyncAt, nowTick.value)}`;
});

const currentAnchorPills = computed(() => {
  if (activeTier.value === 'common') {
    return [
      { anchorId: 'settings-basic', label: '外观与账号' },
      { anchorId: 'settings-playback', label: '播放与音质' },
      { anchorId: 'settings-sync', label: '云同步' }
    ];
  }
  const pills = [
    { anchorId: 'settings-sources', label: '音源与歌词样式' },
    { anchorId: 'settings-network', label: '接口与网络' },
    { anchorId: 'settings-sync-advanced', label: '加密备份 / WebDAV' },
    { anchorId: 'settings-basic-advanced', label: '界面与 Token' }
  ];
  if (isElectron) {
    pills.push(
      { anchorId: 'settings-application', label: '桌面应用' },
      { anchorId: 'settings-system', label: '磁盘缓存' }
    );
  }
  pills.push({ anchorId: 'settings-about', label: '关于与崩溃日志' });
  return pills;
});

const scrollToAnchor = (anchorId: string) => {
  nextTick(() => {
    const el = document.getElementById(anchorId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
};

const switchTier = (tier: SettingsTier) => {
  activeTier.value = tier;
  nextTick(() => {
    scrollbarRef.value?.scrollTo?.({ top: 0, behavior: 'smooth' });
  });
};

const jumpToSection = (tier: SettingsTier, anchorId: string) => {
  activeTier.value = tier;
  scrollToAnchor(anchorId);
};

const SECTION_ROUTE_MAP: Record<string, { tier: SettingsTier; anchorId: string }> = {
  basic: { tier: 'common', anchorId: 'settings-basic' },
  playback: { tier: 'common', anchorId: 'settings-playback' },
  sync: { tier: 'common', anchorId: 'settings-sync' },
  sources: { tier: 'advanced', anchorId: 'settings-sources' },
  advanced: { tier: 'advanced', anchorId: 'settings-sources' },
  network: { tier: 'advanced', anchorId: 'settings-network' },
  application: { tier: 'advanced', anchorId: 'settings-application' },
  system: { tier: 'advanced', anchorId: 'settings-system' },
  about: { tier: 'advanced', anchorId: 'settings-about' }
};

watch(
  () => route.query.section,
  (sec) => {
    const val = typeof sec === 'string' ? sec : '';
    const mapped = SECTION_ROUTE_MAP[val];
    if (mapped) {
      jumpToSection(mapped.tier, mapped.anchorId);
    }
  },
  { immediate: true }
);

// ==================== 初始化 ====================
onMounted(() => {
  if (isElectron && settingsStore.appUpdateState.currentVersion === '') {
    settingsStore.setAppUpdateState(createDefaultAppUpdateState(config.version));
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
  syncTickTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 30000);
});

onUnmounted(() => {
  if (syncTickTimer !== null) {
    window.clearInterval(syncTickTimer);
    syncTickTimer = null;
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
