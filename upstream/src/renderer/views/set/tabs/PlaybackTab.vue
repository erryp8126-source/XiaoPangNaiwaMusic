<template>
  <div>
    <setting-section v-if="showCommon" :title="t('settings.sections.playback')">
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

      <setting-item
        v-if="nativeCapabilities.supportsAudioCache"
        title="音频边听边缓存"
        :description="`已缓存 ${audioCacheSizeText} / ${audioCacheMaxLabel}（常听歌曲自动秒开、省流量）`"
      >
        <div class="flex items-center gap-2 max-md:w-full">
          <s-select
            :model-value="audioCacheMaxMb"
            :options="audioCacheMaxOptions"
            width="w-28 max-md:flex-1"
            @update:model-value="handleSelectAudioCacheMaxMb"
          />
          <s-btn @click="handleClearAudioCache">清理缓存</s-btn>
        </div>
      </setting-item>

      <setting-item
        v-if="isAndroid"
        inline
        title="桌面歌词"
        :description="
          nativeCapabilities.supportsFloatingLyric
            ? '在手机桌面及其他应用上方悬浮显示双行逐字歌词，配色与字号可在「高级设置」微调'
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
        v-if="isAndroid && nativeCapabilities.supportsFloatingLyric"
        inline
        title="横屏时自动隐藏桌面歌词"
        description="看视频或玩游戏进入横屏时临时隐藏悬浮歌词，切回竖屏自动恢复（默认关闭，不会关闭桌面歌词总开关）"
      >
        <n-switch
          v-model:value="floatingLyricHideInLandscape"
          @update:value="handleToggleFloatingLyricHideInLandscape"
        >
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
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
        title="启动首页模式"
        description="选择移动端打开 App 时默认进入全屏沉浸黑胶页或经典发现首页"
      >
        <s-select
          v-model="launchHomeMode"
          :options="launchHomeModeOptions"
          width="w-48 max-md:w-full"
        />
      </setting-item>

      <setting-item
        title="打开 App 自动播放"
        description="冷启动进入应用时按策略自动续播上次曲目或首曲推荐；网页端受浏览器策略限制时将静默停在待播态"
      >
        <s-select
          v-model="launchAutoPlayMode"
          :options="launchAutoPlayModeOptions"
          width="w-56 max-md:w-full"
        />
      </setting-item>

      <setting-item
        v-if="isRealAndroid"
        inline
        title="蓝牙耳机 / 车机连接时自动续播"
        description="蓝牙音频设备重新连接且当前存在暂停中的曲目时自动恢复播放（默认关闭，通话或被其他应用打断时不触发）"
      >
        <n-switch
          v-model:value="autoResumeOnBluetoothConnect"
          @update:value="handleToggleAutoResumeOnBluetoothConnect"
        >
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>
    </setting-section>

    <setting-section v-if="showAdvanced" title="音源解析、音效与桌面歌词样式">
      <setting-item
        v-if="isNative"
        inline
        title="自动选择最佳音源"
        description="当官方音源受限或不可用时，自动匹配并切换至可用备用音源，无需手动干预"
      >
        <n-switch v-model:value="setData.enableMusicUnblock">
          <template #checked>{{ t('common.on') }}</template>
          <template #unchecked>{{ t('common.off') }}</template>
        </n-switch>
      </setting-item>

      <!-- 默认折叠的高级音源设置（收起 migu/kuwo/gdmusic 等技术名、单源开关与测速） -->
      <div
        v-if="isNative && setData.enableMusicUnblock"
        class="mx-3 my-2.5 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#1C1C22]/70 overflow-hidden"
      >
        <button
          type="button"
          class="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-100/70 dark:hover:bg-[#1C1C22] transition-colors"
          @click="showAdvancedSources = !showAdvancedSources"
        >
          <div class="flex items-center gap-2 min-w-0">
            <i class="ri-equalizer-2-line text-slate-500 dark:text-zinc-400 text-sm"></i>
            <span class="text-xs font-bold text-slate-700 dark:text-zinc-200">高级音源设置</span>
            <span class="text-[11px] text-slate-400 dark:text-zinc-500">
              （已启用 {{ musicSources.length }} 个备用通道）
            </span>
          </div>
          <i
            class="ri-arrow-down-s-line text-base text-slate-400 transition-transform duration-200"
            :class="{ 'rotate-180': showAdvancedSources }"
          ></i>
        </button>

        <div
          v-if="showAdvancedSources"
          class="px-3.5 pb-3.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06] space-y-3"
        >
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-[11px] text-slate-500 dark:text-zinc-400">
              可按需开关单个备用解析通道或执行连通性测速
            </span>
            <div class="flex items-center gap-2">
              <s-btn :disabled="speedTesting" @click="runSourceSpeedTest">
                <i
                  class="mr-1"
                  :class="speedTesting ? 'ri-loader-4-line animate-spin' : 'ri-speed-up-line'"
                ></i>
                {{ speedTesting ? '测速中...' : '通道测速' }}
              </s-btn>
              <s-btn @click="showMusicSourcesModal = true">
                LX 脚本 / 自定义源
              </s-btn>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div
              v-for="item in advancedSourceOptions"
              :key="item.key"
              class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.08]"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">
                    {{ item.label }}
                  </span>
                  <span
                    class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#1C1C22] text-slate-500 dark:text-zinc-400"
                  >
                    {{ item.key }}
                  </span>
                </div>
                <div
                  v-if="sourceLatencies[item.key] !== undefined"
                  class="text-[10px] mt-0.5 font-mono"
                  :class="
                    sourceLatencies[item.key] > 0 && sourceLatencies[item.key] < 1500
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  "
                >
                  {{
                    sourceLatencies[item.key] > 0
                      ? `响应 ${sourceLatencies[item.key]} ms`
                      : '连接超时'
                  }}
                </div>
              </div>
              <n-switch
                size="small"
                :value="musicSources.includes(item.key)"
                @update:value="(val: boolean) => toggleSingleSource(item.key, val)"
              />
            </div>
          </div>
        </div>
      </div>

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

      <!-- Android 桌面歌词细项样式调节 -->
      <setting-item
        v-if="isAndroid && nativeCapabilities.supportsFloatingLyric"
        title="桌面歌词细项样式"
        description="自定义悬浮歌词高亮配色、字号（14–26sp）、译文显示与防误触锁定"
      >
        <template #action>
          <div class="flex flex-col items-end gap-2.5 max-md:w-full">
            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-for="preset in floatingColorPresets"
                :key="preset.hex"
                type="button"
                :aria-label="preset.label"
                class="w-6 h-6 rounded-full border-2 transition-transform active:scale-90"
                :class="
                  floatingStyle.color.toUpperCase() === preset.hex
                    ? 'border-slate-900 dark:border-white scale-110'
                    : 'border-transparent opacity-80 hover:opacity-100'
                "
                :style="{ backgroundColor: preset.hex }"
                @click="updateFloatingColor(preset.hex)"
              ></button>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <div
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-slate-100 dark:bg-[#1C1C22] border border-slate-200/80 dark:border-white/[0.08]"
              >
                <button
                  type="button"
                  class="w-6 h-6 rounded-full text-xs font-bold text-slate-700 dark:text-zinc-200"
                  :disabled="floatingStyle.textSizeSp <= 14"
                  @click="adjustFloatingTextSize(-2)"
                >
                  A-
                </button>
                <span class="text-xs font-mono font-bold px-1 text-slate-800 dark:text-zinc-100">
                  {{ Math.round(floatingStyle.textSizeSp) }}sp
                </span>
                <button
                  type="button"
                  class="w-6 h-6 rounded-full text-xs font-bold text-slate-700 dark:text-zinc-200"
                  :disabled="floatingStyle.textSizeSp >= 26"
                  @click="adjustFloatingTextSize(2)"
                >
                  A+
                </button>
              </div>
              <button
                type="button"
                class="px-2.5 py-1 rounded-full text-xs font-bold border transition-colors"
                :class="
                  floatingStyle.showTranslation
                    ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-500/20 dark:border-amber-400/40 dark:text-amber-300'
                    : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-[#1C1C22] dark:border-white/[0.08] dark:text-zinc-400'
                "
                @click="toggleFloatingTranslation"
              >
                {{ floatingStyle.showTranslation ? '译文：开' : '译文：关' }}
              </button>
              <s-btn
                v-if="floatingLyricEnabled"
                @click="toggleFloatingLock"
              >
                {{ floatingLyricLocked ? '解锁位置' : '锁定位置' }}
              </s-btn>
            </div>
          </div>
        </template>
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
      v-if="showAdvanced"
      class="mt-5 p-4 rounded-[20px] bg-white dark:bg-[#131316] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
    >
      <div class="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1.5">支持正版</div>
      <div class="text-sm text-slate-700 dark:text-zinc-200 leading-relaxed mb-3.5">
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
      v-if="isNative && showAdvanced"
      v-model:show="showMusicSourcesModal"
      v-model:sources="musicSources"
    />

    <n-modal v-if="isAndroid && nativeCapabilities.supportsEq && showAdvanced" v-model:show="showEqModal" preset="card" :z-index="12000" style="width: 94vw; max-width: 680px" title="均衡器 (EQ)">
      <eq-control />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import EqControl from '@/components/EQControl.vue';
import AudioDeviceSettings from '@/components/settings/AudioDeviceSettings.vue';
import MusicSourceSettings from '@/components/settings/MusicSourceSettings.vue';
import { type Platform } from '@/types/music';
import { isAndroid, isElectron, isNative, isRealAndroid } from '@/utils';
import {
  AUDIO_CACHE_MAX_MB_OPTIONS,
  type FloatingLyricStyleConfig,
  formatAudioCacheLimitMb,
  getAutoResumeOnBluetoothConnect,
  getFloatingLyricHideInLandscape,
  getFloatingLyricStyle,
  getNativeAudioCacheMaxMb,
  getNativeCapabilities,
  offAndroidEvent,
  onAndroidEvent,
  setAutoResumeOnBluetoothConnect,
  setFloatingLyricHideInLandscape,
  setFloatingLyricStyle,
  setNativeAudioCacheMaxMb
} from '@/utils/androidBridge';
import {
  getEffectiveLaunchAutoPlayMode,
  getEffectiveLaunchHomeMode,
  type LaunchAutoPlayMode,
  type LaunchHomeMode
} from '@/utils/launchPolicy';
import { showBottomToast } from '@/utils/shortcutToast';

import { SETTINGS_DATA_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SSelect from '../SSelect.vue';

const ALL_PLATFORMS: Platform[] = ['pyncmd', 'gdmusic', 'migu', 'kugou', 'kuwo'];

const memberLinks = [
  { name: '网易云音乐会员', url: 'https://music.163.com/store/vip' },
  { name: 'QQ音乐会员', url: 'https://y.qq.com/portal/vipportal/' },
  { name: '酷狗音乐会员', url: 'https://vip.kugou.com/' }
];

const props = withDefaults(
  defineProps<{
    mode?: 'common' | 'advanced' | 'all';
  }>(),
  { mode: 'all' }
);

const showCommon = computed(() => props.mode !== 'advanced');
const showAdvanced = computed(() => props.mode !== 'common');

const { t } = useI18n();
const setData = inject(SETTINGS_DATA_KEY)!;
const platform = window.electron ? window.electron.ipcRenderer.sendSync('get-platform') : 'web';
const nativeCapabilities = getNativeCapabilities();

const floatingColorPresets = [
  { hex: '#E84C3D', label: '绯红' },
  { hex: '#56A8E8', label: '晴空蓝' },
  { hex: '#5CC47A', label: '翡翠绿' },
  { hex: '#E8A838', label: '奶娃金' },
  { hex: '#8E5CF6', label: '丁香紫' }
];
const floatingStyle = ref<FloatingLyricStyleConfig>(
  nativeCapabilities.supportsFloatingLyric
    ? getFloatingLyricStyle()
    : { color: '#56A8E8', textSizeSp: 18, showTranslation: true, locked: false }
);

const updateFloatingColor = (hex: string) => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  floatingStyle.value = setFloatingLyricStyle({ color: hex });
};

const adjustFloatingTextSize = (delta: number) => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  const nextSize = Math.max(14, Math.min(26, Math.round(floatingStyle.value.textSizeSp + delta)));
  floatingStyle.value = setFloatingLyricStyle({ textSizeSp: nextSize });
};

const toggleFloatingTranslation = () => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  floatingStyle.value = setFloatingLyricStyle({ showTranslation: !floatingStyle.value.showTranslation });
};

const toggleFloatingLock = () => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  const nextLocked = !floatingLyricLocked.value;
  (window as any).AlgerAndroid?.setFloatingLyricLocked?.(nextLocked);
  floatingLyricLocked.value = nextLocked;
};

const showMusicSourcesModal = ref(false);
const showAdvancedSources = ref(false);
const speedTesting = ref(false);
const sourceLatencies = ref<Record<string, number>>({});
const showEqModal = ref(false);

const advancedSourceOptions: Array<{ key: Platform; label: string }> = [
  { key: 'pyncmd', label: '云端聚合通道' },
  { key: 'gdmusic', label: 'GD 聚合通道' },
  { key: 'migu', label: '咪咕通道' },
  { key: 'kugou', label: '酷狗通道' },
  { key: 'kuwo', label: '酷我通道' }
];

const toggleSingleSource = (key: Platform, enabled: boolean) => {
  const current = [...musicSources.value];
  if (enabled) {
    if (!current.includes(key)) current.push(key);
    musicSources.value = current;
  } else {
    const next = current.filter((k) => k !== key);
    if (next.length === 0) {
      showBottomToast('至少保留一个可用备用音源通道');
      return;
    }
    musicSources.value = next;
  }
};

const runSourceSpeedTest = async () => {
  if (speedTesting.value) return;
  speedTesting.value = true;
  const nextLatencies: Record<string, number> = {};
  try {
    const basePort = setData.value.musicApiPort || 30488;
    const probeUrl = isAndroid
      ? `http://127.0.0.1:${basePort}/__alger_health`
      : '/api/health';
    for (const item of advancedSourceOptions) {
      const started = performance.now();
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 3000);
        await fetch(probeUrl, { method: 'GET', signal: controller.signal }).catch(() => null);
        window.clearTimeout(timer);
        nextLatencies[item.key] = Math.max(1, Math.round(performance.now() - started));
      } catch {
        nextLatencies[item.key] = -1;
      }
    }
    sourceLatencies.value = nextLatencies;
  } finally {
    speedTesting.value = false;
  }
};
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
const floatingLyricHideInLandscape = ref<boolean>(
  nativeCapabilities.supportsFloatingLyric ? getFloatingLyricHideInLandscape() : false
);
const autoResumeOnBluetoothConnect = ref<boolean>(
  isRealAndroid ? getAutoResumeOnBluetoothConnect() : false
);

const handleToggleFloatingLyricHideInLandscape = (val: boolean) => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  floatingLyricHideInLandscape.value = setFloatingLyricHideInLandscape(val);
};

const handleToggleAutoResumeOnBluetoothConnect = (val: boolean) => {
  if (!isRealAndroid) return;
  autoResumeOnBluetoothConnect.value = setAutoResumeOnBluetoothConnect(val);
};

const handleFloatingLyricLandscapeSettingChanged = (_: any, payload: any) => {
  floatingLyricHideInLandscape.value = Boolean(payload?.enabled);
};

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

const handleFloatingLyricStateChanged = (_: any, payload: any) => {
  const nextEnabled = Boolean(payload?.enabled);
  floatingLyricEnabled.value = nextEnabled;
  if (!nextEnabled) {
    floatingLyricLocked.value = false;
  }
};

const handleFloatingLyricClosed = () => {
  floatingLyricEnabled.value = false;
  floatingLyricLocked.value = false;
};

onMounted(() => {
  if (isRealAndroid) {
    autoResumeOnBluetoothConnect.value = getAutoResumeOnBluetoothConnect();
  }
  if (nativeCapabilities.supportsFloatingLyric) {
    floatingLyricEnabled.value = Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.());
    floatingLyricLocked.value = Boolean((window as any).AlgerAndroid?.isFloatingLyricLocked?.());
    floatingLyricHideInLandscape.value = getFloatingLyricHideInLandscape();
    floatingStyle.value = getFloatingLyricStyle();
    onAndroidEvent('floating-lyric-state-changed', handleFloatingLyricStateChanged);
    onAndroidEvent('floating-lyric-closed', handleFloatingLyricClosed);
    onAndroidEvent(
      'floating-lyric-landscape-setting-changed',
      handleFloatingLyricLandscapeSettingChanged
    );
  }
});

onUnmounted(() => {
  if (nativeCapabilities.supportsFloatingLyric) {
    offAndroidEvent('floating-lyric-state-changed', handleFloatingLyricStateChanged);
    offAndroidEvent('floating-lyric-closed', handleFloatingLyricClosed);
    offAndroidEvent(
      'floating-lyric-landscape-setting-changed',
      handleFloatingLyricLandscapeSettingChanged
    );
  }
});

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
const audioCacheMaxMb = ref<number>(
  nativeCapabilities.supportsAudioCache ? getNativeAudioCacheMaxMb() : 500
);
const audioCacheMaxOptions = AUDIO_CACHE_MAX_MB_OPTIONS.map((mb) => ({
  label: formatAudioCacheLimitMb(mb),
  value: mb
}));
const audioCacheMaxLabel = computed(() => formatAudioCacheLimitMb(audioCacheMaxMb.value));

const handleSelectAudioCacheMaxMb = (val: string | number | boolean) => {
  if (!nativeCapabilities.supportsAudioCache) return;
  const res = setNativeAudioCacheMaxMb(Number(val));
  audioCacheMaxMb.value = res.maxMb;
  showBottomToast(
    res.requiresRestart
      ? `缓存上限已设为 ${formatAudioCacheLimitMb(res.maxMb)}，重启应用后生效`
      : `缓存上限已设为 ${formatAudioCacheLimitMb(res.maxMb)}`
  );
};

const handleClearAudioCache = () => {
  if (!nativeCapabilities.supportsAudioCache) return;
  const ok = Boolean((window as any).AlgerAndroid?.clearAudioCache?.());
  audioCacheBytes.value = Number((window as any).AlgerAndroid?.getAudioCacheSize?.() || 0);
  audioCacheMaxMb.value = getNativeAudioCacheMaxMb();
  showBottomToast(ok ? '已清理音频缓存' : '缓存清理失败');
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

const launchHomeModeOptions = [
  { label: '沉浸黑胶（默认）', value: 'immersive' },
  { label: '经典发现首页', value: 'classic' }
];

const launchHomeMode = computed<LaunchHomeMode>({
  get: () => getEffectiveLaunchHomeMode(setData.value),
  set: (val: LaunchHomeMode) => {
    setData.value = { ...setData.value, launchHomeMode: val };
  }
});

const launchAutoPlayModeOptions = [
  { label: '始终自动播放（原生端默认）', value: 'always' },
  { label: '仅连接耳机或蓝牙时', value: 'external-audio' },
  { label: '关闭', value: 'off' }
];

const launchAutoPlayMode = computed<LaunchAutoPlayMode>({
  get: () => getEffectiveLaunchAutoPlayMode(setData.value, isAndroid),
  set: (val: LaunchAutoPlayMode) => {
    setData.value = {
      ...setData.value,
      launchAutoPlayMode: val,
      autoPlay: val !== 'off'
    };
  }
});
</script>
