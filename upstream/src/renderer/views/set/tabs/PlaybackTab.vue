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
        title="桌面悬浮歌词"
        description="在手机其他应用上方悬浮显示当前歌词（需授予悬浮窗权限）"
      >
        <n-switch v-model:value="floatingLyricEnabled" @update:value="handleToggleFloatingLyric">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <setting-item
        v-if="isAndroid"
        inline
        title="均衡器 (EQ)"
        description="使用手机原生硬件音效均衡器调节 10 段频响"
      >
        <s-btn @click="showEqModal = true">{{ t('common.configure') }}</s-btn>
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

    <n-modal v-if="isAndroid" v-model:show="showEqModal" preset="card" style="width: 94vw; max-width: 680px" title="均衡器 (EQ)">
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

import { SETTINGS_DATA_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SSelect from '../SSelect.vue';

const ALL_PLATFORMS: Platform[] = ['migu', 'kugou', 'kuwo', 'pyncmd'];

const memberLinks = [
  { name: '网易云音乐会员', url: 'https://music.163.com/store/vip' },
  { name: 'QQ音乐会员', url: 'https://y.qq.com/portal/vipportal/' },
  { name: '酷狗音乐会员', url: 'https://vip.kugou.com/' }
];

const { t } = useI18n();
const setData = inject(SETTINGS_DATA_KEY)!;
const platform = window.electron ? window.electron.ipcRenderer.sendSync('get-platform') : 'web';

const showMusicSourcesModal = ref(false);
const showEqModal = ref(false);
const floatingLyricEnabled = ref<boolean>(
  isAndroid ? Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.()) : false
);

const handleToggleFloatingLyric = (val: boolean) => {
  if (!isAndroid) return;
  const actual = Boolean((window as any).AlgerAndroid?.setFloatingLyricEnabled?.(val));
  floatingLyricEnabled.value = actual;
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
</script>
