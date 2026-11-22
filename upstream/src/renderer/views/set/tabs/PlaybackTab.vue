<template>
  <div>
    <setting-section :title="t('settings.sections.playback')">
      <setting-item
        :title="t('settings.playback.quality')"
        :description="t('settings.playback.qualityDesc')"
      >
        <s-select
          v-model="setData.musicQuality"
          :options="qualityOptions"
          width="w-40 max-md:w-full"
        />
      </setting-item>

      <setting-item v-if="isNative" :title="t('settings.playback.musicSources')">
        <template #description>
          <div class="flex items-center gap-2.5 flex-wrap">
            <n-switch v-model:value="setData.enableMusicUnblock">
              <template #checked>{{ t('common.on') }}</template>
              <template #unchecked>{{ t('common.off') }}</template>
            </n-switch>
            <span class="text-[13px] text-slate-600 dark:text-slate-300">{{ t('settings.playback.musicUnblockEnableDesc') }}</span>
          </div>
          <div v-if="setData.enableMusicUnblock" class="mt-2 text-[13px]">
            <span class="text-slate-600 dark:text-slate-300">{{ t('settings.playback.selectedMusicSources') }}</span>
            <span v-if="musicSources.length > 0" class="font-medium text-slate-800 dark:text-slate-100">{{
              musicSources.join(', ')
            }}</span>
            <span v-else class="text-rose-600 dark:text-rose-400 text-xs font-medium">{{
              t('settings.playback.noMusicSources')
            }}</span>
          </div>
        </template>
        <s-btn :disabled="!setData.enableMusicUnblock" @click="showMusicSourcesModal = true">
          {{ t('settings.playback.configureMusicSources') }}
        </s-btn>
      </setting-item>

      <setting-item
        v-if="isAndroid"
        inline
        title="桌面歌词"
        :description="
          nativeCapabilities.supportsFloatingLyric
            ? '在手机桌面及其他应用上方悬浮显示双行逐字歌词，支持锁定防误触、切歌、翻译、配色与字号调节'
            : '仅 Android 支持（iOS 系统不开放全局悬浮窗权限）'
        "
      >
        <div v-if="nativeCapabilities.supportsFloatingLyric" class="flex items-center gap-2.5">
          <s-btn v-if="floatingLyricEnabled && floatingLyricLocked" variant="primary" @click="handleUnlockFloatingLyric">
            解锁歌词
          </s-btn>
          <n-switch v-model:value="floatingLyricEnabled" @update:value="handleToggleFloatingLyric">
            <template #checked>{{ t('common.on') }}</template>
            <template #unchecked>{{ t('common.off') }}</template>
          </n-switch>
        </div>
        <div v-else class="flex items-center gap-2 opacity-65">
          <n-tag size="small" round>仅 Android 支持</n-tag>
          <n-switch :value="false" disabled />
        </div>
      </setting-item>

      <setting-item
        v-if="isAndroid"
        inline
        title="均衡器 (EQ)"
        :description="
          nativeCapabilities.supportsEq
            ? '使用手机原生硬件音效均衡器调节 10 段频响'
            : '仅 Android 支持（iOS 端 AVPlayer 暂未启用均衡器）'
        "
      >
        <s-btn v-if="nativeCapabilities.supportsEq" @click="showEqModal = true">{{ t('common.configure') }}</s-btn>
        <div v-else class="flex items-center gap-2 opacity-65">
          <n-tag size="small" round>仅 Android 支持</n-tag>
          <s-btn disabled>{{ t('common.configure') }}</s-btn>
        </div>
      </setting-item>

      <setting-item
        v-if="nativeCapabilities.supportsAudioCache"
        inline
        title="音频边听边缓存"
        :description="`已缓存 ${audioCacheSizeText} / 上限 200 MB（常听歌曲自动秒开、省流量）`"
      >
        <s-btn @click="handleClearAudioCache">清理缓存</s-btn>
      </setting-item>

      <setting-item
        v-if="platform === 'darwin'"
        inline
        :title="t('settings.playback.showStatusBar')"
        :description="t('settings.playback.showStatusBarContent')"
      >
        <n-switch v-model:value="setData.showTopAction">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        inline
        title="动态背景"
        description="根据当前歌曲封面自动提取主色调，为全屏播放页与底部迷你播放条渲染平滑弥散渐变背景"
      >
        <n-switch v-model:value="dynamicBackgroundEnabled">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        title="切歌淡入淡出 (Crossfade)"
        description="切歌与暂停/恢复播放时平滑过渡音量，减少突兀切音感"
      >
        <s-select
          v-model="crossfadeMode"
          :options="crossfadeOptions"
          width="w-40 max-md:w-full"
        />
      </setting-item>

      <setting-item
        inline
        title="音量平滑（响度均衡）"
        description="自动平衡官方源与备用音源间的响度差异，防止切歌时声音忽大忽小或破音"
      >
        <n-switch v-model:value="volumeNormalizationEnabled">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        inline
        :title="t('settings.playback.autoPlay')"
        :description="t('settings.playback.autoPlayDesc')"
      >
        <n-switch v-model:value="setData.autoPlay">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        v-if="isElectron"
        :title="t('settings.playback.audioDevice')"
        :description="t('settings.playback.audioDeviceDesc')"
      >
        <audio-device-settings />
      </setting-item>
    </setting-section>

    <div
      class="mt-5 p-4 rounded-[20px] bg-white dark:bg-[#192231] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_2px_12px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      <div class="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1.5">支持正版</div>
      <div class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mb-3.5">
        大家还是需要支持正版，本软件只做开源探讨。各大音乐会员购买链接：
      </div>
      <div class="flex gap-2 flex-wrap">
        <a
          v-for="link in memberLinks"
          :key="link.url"
          class="px-3.5 py-2 rounded-full bg-amber-50 text-amber-800 border border-amber-200/90 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/25 text-xs md:text-sm font-semibold hover:opacity-85 transition-opacity"
          :href="link.url"
          target="_blank"
        >
          {{ link.name }} <i class="ri-external-link-line ml-1"></i>
        </a>
      </div>
    </div>

    <music-source-settings
      v-if="isNative"
      v-model:show="showMusicSourcesModal"
      v-model:sources="musicSources"
    />

    <n-modal v-if="isAndroid && nativeCapabilities.supportsEq" v-model:show="showEqModal" preset="card" style="width: 94vw; max-width: 680px" title="均衡器 (EQ)">
      <eq-control />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import EqControl from '@/components/EQControl.vue';
import AudioDeviceSettings from '@/components/settings/AudioDeviceSettings.vue';
import MusicSourceSettings from '@/components/settings/MusicSourceSettings.vue';
import { type Platform } from '@/types/music';
import { isAndroid, isElectron, isNative } from '@/utils';
import { getNativeCapabilities } from '@/utils/androidBridge';

import { SETTINGS_DATA_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SSelect from '../SSelect.vue';

const ALL_PLATFORMS: Platform[] = ['pyncmd', 'kuwo', 'kugou', 'migu', 'gdmusic'];

const memberLinks = [
  { name: '网易云音乐会员', url: 'https://music.163.com/store/vip' },
  { name: 'QQ音乐会员', url: 'https://y.qq.com/portal/vipportal/' },
  { name: '酷狗音乐会员', url: 'https://vip.kugou.com/' }
];

const { t } = useI18n();
const setData = inject(SETTINGS_DATA_KEY)!;
const platform = window.electron ? window.electron.ipcRenderer.sendSync('get-platform') : 'web';
const nativeCapabilities = getNativeCapabilities();

const showMusicSourcesModal = ref(false);
const showEqModal = ref(false);
const floatingLyricEnabled = ref<boolean>(
  nativeCapabilities.supportsFloatingLyric
    ? Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.())
    : false
);
const floatingLyricLocked = ref<boolean>(
  nativeCapabilities.supportsFloatingLyric
    ? Boolean((window as any).AlgerAndroid?.isFloatingLyricLocked?.())
    : false
);

const handleToggleFloatingLyric = (val: boolean) => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  const actual = Boolean((window as any).AlgerAndroid?.setFloatingLyricEnabled?.(val));
  floatingLyricEnabled.value = actual;
  floatingLyricLocked.value = Boolean((window as any).AlgerAndroid?.isFloatingLyricLocked?.());
};

const handleUnlockFloatingLyric = () => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  (window as any).AlgerAndroid?.setFloatingLyricLocked?.(false);
  floatingLyricLocked.value = false;
};

const formatCacheBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const audioCacheBytes = ref<number>(
  nativeCapabilities.supportsAudioCache
    ? Number((window as any).AlgerAndroid?.getAudioCacheSize?.() || 0)
    : 0
);
const audioCacheSizeText = computed(() => formatCacheBytes(audioCacheBytes.value));

const handleClearAudioCache = () => {
  if (!nativeCapabilities.supportsAudioCache) return;
  const ok = Boolean((window as any).AlgerAndroid?.clearAudioCache?.());
  audioCacheBytes.value = Number((window as any).AlgerAndroid?.getAudioCacheSize?.() || 0);
  (window as any).AlgerAndroid?.showToast?.(ok ? '已清理音频缓存' : '缓存清理失败');
};

const qualityOptions = computed(() => [
  { label: t('settings.playback.qualityOptions.standard'), value: 'standard' },
  { label: t('settings.playback.qualityOptions.higher'), value: 'higher' },
  { label: t('settings.playback.qualityOptions.exhigh'), value: 'exhigh' },
  { label: t('settings.playback.qualityOptions.lossless'), value: 'lossless' },
  { label: t('settings.playback.qualityOptions.hires'), value: 'hires' },
  { label: t('settings.playback.qualityOptions.jyeffect'), value: 'jyeffect' },
  { label: t('settings.playback.qualityOptions.sky'), value: 'sky' },
  { label: t('settings.playback.qualityOptions.dolby'), value: 'dolby' },
  { label: t('settings.playback.qualityOptions.jymaster'), value: 'jymaster' }
]);

const musicSources = computed({
  get: () => {
    if (!setData.value.enabledMusicSources) return ALL_PLATFORMS;
    return setData.value.enabledMusicSources as Platform[];
  },
  set: (newValue: Platform[]) => {
    const valuesToSet = newValue.length > 0 ? [...new Set(newValue)] : ALL_PLATFORMS;
    setData.value = { ...setData.value, enabledMusicSources: valuesToSet };
  }
});

const dynamicBackgroundEnabled = computed({
  get: () => setData.value.enableDynamicBackground !== false,
  set: (val: boolean) => {
    setData.value = { ...setData.value, enableDynamicBackground: val };
  }
});

const crossfadeOptions = [
  { label: '关闭', value: '0' },
  { label: '1.5 秒（柔和）', value: '1.5' },
  { label: '3 秒（丝滑）', value: '3' }
];

const crossfadeMode = computed({
  get: () => {
    if (!setData.value.crossfadeEnabled) return '0';
    const sec = Number(setData.value.crossfadeDurationSec) || 1.5;
    return sec >= 2.5 ? '3' : '1.5';
  },
  set: (val: string) => {
    const sec = Number(val) || 0;
    setData.value = {
      ...setData.value,
      crossfadeEnabled: sec > 0,
      crossfadeDurationSec: sec > 0 ? sec : 1.5
    };
  }
});

const volumeNormalizationEnabled = computed({
  get: () => Boolean(setData.value.volumeNormalizationEnabled),
  set: (val: boolean) => {
    setData.value = { ...setData.value, volumeNormalizationEnabled: val };
  }
});
</script>
