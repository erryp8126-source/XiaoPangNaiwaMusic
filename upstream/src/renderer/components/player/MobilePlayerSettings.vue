<template>
  <Teleport to="body">
    <Transition name="settings-drawer">
      <div
        v-if="visible"
        class="fixed inset-0 z-[99999] flex items-end justify-center"
        @click.self="close"
      >
        <!-- 遮罩层 -->
        <div class="absolute inset-0 bg-black/65" @click="close"></div>

        <!-- 弹窗内容 - 高对比度暗夜实底磨砂面板 -->
        <div
          class="relative w-full max-w-lg bg-[#111827]/[0.97] backdrop-blur-2xl rounded-t-[28px] overflow-hidden max-h-[85vh] flex flex-col border-t border-slate-700/80 shadow-2xl"
        >
          <!-- 顶部拖拽条 -->
          <div class="flex justify-center pt-3 pb-2 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-slate-500"></div>
          </div>

          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 pb-4 flex-shrink-0">
            <h2 class="text-lg font-bold text-white tracking-tight">
              {{ t('player.settings.title') }}
            </h2>
            <button
              @click="close"
              class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-800 border border-slate-700 text-slate-200 active:scale-90 transition-all"
            >
              <i class="ri-close-line text-xl"></i>
            </button>
          </div>

          <!-- 内容区域 -->
          <div
            class="flex-1 overflow-y-auto px-5 pb-6"
            :style="{ paddingBottom: `calc(24px + var(--safe-area-inset-bottom, 0px))` }"
          >
            <!-- Android / iOS 原生快捷操作 -->
            <div v-if="isAndroid" class="mb-6">
              <div
                class="grid gap-2.5"
                :class="
                  nativeCapabilities.supportsFloatingLyric && nativeCapabilities.supportsEq
                    ? 'grid-cols-3'
                    : 'grid-cols-2'
                "
              >
                <button
                  @click="handleDownloadCurrent"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-slate-800/95 border border-slate-700 text-slate-100 active:scale-95 transition-all"
                >
                  <i class="ri-download-cloud-2-line text-xl text-amber-400"></i>
                  <span class="text-xs font-semibold">下载歌曲</span>
                </button>
                <button
                  v-if="nativeCapabilities.supportsFloatingLyric"
                  @click="toggleAndroidFloatingLyric"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl transition-all active:scale-95 border"
                  :class="
                    floatingLyricOn
                      ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                      : 'bg-slate-800/95 border-slate-700 text-slate-100'
                  "
                >
                  <i class="ri-closed-captioning-line text-xl" :class="floatingLyricOn ? 'text-amber-300' : 'text-emerald-400'"></i>
                  <span class="text-xs font-semibold">{{ floatingLyricOn ? '关闭桌面词' : '桌面歌词' }}</span>
                </button>
                <button
                  v-if="nativeCapabilities.supportsEq"
                  @click="openEqModal"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl transition-all active:scale-95 border"
                  :class="
                    eqEnabled
                      ? 'bg-sky-500/25 border-sky-400/60 text-sky-200'
                      : 'bg-slate-800/95 border-slate-700 text-slate-100'
                  "
                >
                  <i class="ri-equalizer-line text-xl text-sky-400"></i>
                  <span class="text-xs font-semibold">{{ eqEnabled ? '均衡器 · 开' : '均衡器 EQ' }}</span>
                </button>
                <button
                  v-if="!nativeCapabilities.supportsFloatingLyric && !nativeCapabilities.supportsEq"
                  @click="handleOpenLibrary"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-slate-800/95 border border-slate-700 text-slate-100 active:scale-95 transition-all"
                >
                  <i class="ri-folder-music-line text-xl text-sky-400"></i>
                  <span class="text-xs font-semibold">我的音乐库</span>
                </button>
              </div>
              <div class="h-px bg-slate-800 my-5"></div>
            </div>

            <!-- 音源详情与缓存清理（统一收入播放页二级抽屉） -->
            <div class="mb-5 space-y-2.5">
              <div class="px-4 py-3 rounded-2xl bg-slate-800/90 border border-slate-700/80 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-white">当前音源详情</span>
                  <span
                    class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/30"
                  >
                    {{ currentMetaSummary.badge }}
                  </span>
                </div>
                <div class="text-xs text-slate-400 flex items-center justify-between gap-2 flex-wrap">
                  <span>来源：{{ currentMetaSummary.sourceLabel }} · 音质：{{ currentMetaSummary.qualityLabel }}</span>
                  <button
                    type="button"
                    class="text-sky-300 hover:text-sky-200 font-semibold"
                    @click="handleOpenSourceSettings"
                  >
                    音源设置 <i class="ri-arrow-right-s-line"></i>
                  </button>
                </div>
              </div>

              <div
                v-if="nativeCapabilities.supportsAudioCache"
                class="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-800/90 border border-slate-700/80"
              >
                <div class="pr-3">
                  <div class="text-sm font-semibold text-white">音频边听缓存</div>
                  <div class="text-xs text-slate-400 mt-0.5">
                    当前占用 {{ audioCacheSizeText }} / {{ audioCacheMaxLabel }}（清理不影响已下载与收藏）
                  </div>
                </div>
                <button
                  type="button"
                  class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-100 active:scale-95 transition-all flex-shrink-0"
                  @click="handleClearCacheInDrawer"
                >
                  清理缓存
                </button>
              </div>
            </div>

            <!-- 封面动态弥散背景开关 -->
            <div class="mb-5">
              <div
                class="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-800/90 border border-slate-700/80"
              >
                <div class="pr-3">
                  <div class="text-sm font-semibold text-white">动态背景</div>
                  <div class="text-xs text-slate-400 mt-0.5">
                    随专辑封面主色调平滑渐变播放页与迷你播放条背景
                  </div>
                </div>
                <n-switch
                  :value="dynamicBackgroundEnabled"
                  @update:value="toggleDynamicBackground"
                />
              </div>
            </div>

            <!-- 播放速度 -->
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-white">
                  {{ t('player.settings.playbackSpeed') }}
                </span>
                <span class="text-sm text-amber-300 font-bold">{{ playbackRate }}x</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="option in speedOptions"
                  :key="option"
                  @click="setSpeed(option)"
                  class="px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 border"
                  :class="
                    playbackRate === option
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 border-amber-400/50 text-white shadow-lg shadow-amber-600/25'
                      : 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                  "
                >
                  {{ option }}x
                </button>
              </div>
            </div>

            <!-- 分隔线 -->
            <div class="h-px bg-slate-800 my-5"></div>

            <!-- 定时关闭 -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-white">
                  {{ t('player.sleepTimer.title') }}
                </span>
                <span v-if="hasTimerActive" class="text-sm text-amber-300 font-bold">
                  {{ timerStatusText }}
                </span>
              </div>

              <!-- 已激活状态 -->
              <div v-if="hasTimerActive" class="space-y-3">
                <div class="p-4 rounded-2xl bg-amber-500/20 border border-amber-400/40">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <i class="ri-timer-line text-amber-300 text-xl"></i>
                      <span class="text-amber-200 font-semibold">
                        {{ timerDisplayText }}
                      </span>
                    </div>
                    <button
                      @click="cancelTimer"
                      class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-rose-500/30 border border-rose-400/40 text-rose-100 hover:bg-rose-500/40"
                    >
                      {{ t('player.sleepTimer.cancel') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 未激活状态 - 设置选项 -->
              <div v-else class="space-y-4">
                <!-- 按时间 -->
                <div>
                  <p class="text-xs font-medium text-slate-300 mb-2">
                    {{ t('player.sleepTimer.timeMode') }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="minutes in [15, 30, 60, 90]"
                      :key="minutes"
                      @click="setTimeTimer(minutes)"
                      class="px-4 py-2 rounded-full text-sm font-medium bg-slate-800 border border-slate-700 text-slate-100 active:scale-95 transition-all"
                    >
                      {{ minutes }}{{ t('player.sleepTimer.minutes') }}
                    </button>
                  </div>
                  <!-- 自定义时间 -->
                  <div class="flex items-center gap-2 mt-3">
                    <div class="flex items-center flex-1 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                      <button
                        @click="decreaseMinutes"
                        class="w-10 h-10 flex items-center justify-center text-slate-200 active:bg-slate-700"
                      >
                        <i class="ri-subtract-line text-lg"></i>
                      </button>
                      <input
                        v-model="customMinutes"
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        placeholder="分钟"
                        class="flex-1 px-2 py-2 text-sm text-center bg-transparent text-white border-0 outline-none placeholder-slate-400"
                        @input="handleMinutesInput"
                      />
                      <button
                        @click="increaseMinutes"
                        class="w-10 h-10 flex items-center justify-center text-slate-200 active:bg-slate-700"
                      >
                        <i class="ri-add-line text-lg"></i>
                      </button>
                    </div>
                    <button
                      @click="setCustomTimeTimer"
                      :disabled="!customMinutes || Number(customMinutes) < 1"
                      class="px-5 py-2.5 rounded-full text-sm font-semibold bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md shadow-amber-600/25 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
                    >
                      {{ t('player.sleepTimer.set') }}
                    </button>
                  </div>
                </div>

                <!-- 按歌曲数 -->
                <div>
                  <p class="text-xs font-medium text-slate-300 mb-2">
                    {{ t('player.sleepTimer.songsMode') }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="songs in [1, 3, 5, 10]"
                      :key="songs"
                      @click="setSongsTimer(songs)"
                      class="px-4 py-2 rounded-full text-sm font-medium bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700"
                    >
                      {{ songs }}{{ t('player.sleepTimer.songs') }}
                    </button>
                  </div>
                </div>

                <!-- 播放列表结束 -->
                <button
                  @click="setPlaylistEndTimer"
                  class="w-full py-3 rounded-2xl text-sm font-semibold bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700"
                >
                  {{ t('player.sleepTimer.playlistEnd') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 独立高优先级 EQ 抽屉（避免 Naive UI n-modal 默认 z-index=2000 被 z-[99999] 遮挡） -->
    <Transition name="settings-drawer">
      <div
        v-if="isAndroid && nativeCapabilities.supportsEq && showEqModal"
        class="fixed inset-0 z-[100001] flex items-end justify-center"
        @click.self="closeEqModal"
      >
        <div class="absolute inset-0 bg-black/70" @click="closeEqModal"></div>
        <div
          class="relative w-full max-w-lg bg-[#0f172a]/[0.98] backdrop-blur-2xl rounded-t-[28px] overflow-hidden max-h-[88vh] flex flex-col border-t border-slate-700/80 shadow-2xl"
        >
          <div class="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-slate-500"></div>
          </div>
          <div class="flex items-center justify-between px-5 pb-3 flex-shrink-0">
            <div class="flex items-center gap-2">
              <button
                @click="closeEqModal"
                class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-800 border border-slate-700 text-slate-200 active:scale-90 transition-all"
                aria-label="返回"
              >
                <i class="ri-arrow-left-s-line text-xl"></i>
              </button>
              <h2 class="text-lg font-bold text-white tracking-tight">均衡器 (EQ)</h2>
            </div>
            <button
              @click="closeEqModal"
              class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-800 border border-slate-700 text-slate-200 active:scale-90 transition-all"
              aria-label="关闭"
            >
              <i class="ri-close-line text-xl"></i>
            </button>
          </div>
          <div
            class="flex-1 overflow-y-auto px-4 pb-6"
            :style="{ paddingBottom: `calc(24px + var(--safe-area-inset-bottom, 0px))` }"
          >
            <eq-control :dark-panel="true" @change-enabled="eqEnabled = $event" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useRouter } from 'vue-router';

import EqControl from '@/components/EQControl.vue';
import { useDownload } from '@/hooks/useDownload';
import { audioService } from '@/services/audioService';
import { usePlayerStore } from '@/store/modules/player';
import { useSettingsStore } from '@/store/modules/settings';
import { isAndroid } from '@/utils';
import {
  formatAudioCacheLimitMb,
  getNativeAudioCacheMaxMb,
  getNativeCapabilities,
  offAndroidEvent,
  onAndroidEvent,
  registerAndroidBackHandler,
  triggerHaptic
} from '@/utils/androidBridge';
import { formatPlaybackBadgeText, inferPlaybackMetaFromUrl } from '@/utils/playbackMeta';
import { showBottomToast } from '@/utils/shortcutToast';

const { t } = useI18n();
const router = useRouter();
const playerStore = usePlayerStore();
const settingsStore = useSettingsStore();
const { sleepTimer, playbackRate } = storeToRefs(playerStore);
const { downloadMusic } = useDownload();
const nativeCapabilities = getNativeCapabilities();

const dynamicBackgroundEnabled = computed(
  () => settingsStore.setData?.enableDynamicBackground !== false
);

const toggleDynamicBackground = (val: boolean) => {
  triggerHaptic('selection');
  settingsStore.setSetData({ enableDynamicBackground: val });
};

const handleOpenLibrary = () => {
  close();
  playerStore.setMusicFull(false);
  router.push('/library');
};

const handleOpenSourceSettings = () => {
  close();
  playerStore.setMusicFull(false);
  router.push('/set?section=playback');
};

const currentMetaSummary = computed(() => {
  const song = playerStore.playMusic;
  const meta = inferPlaybackMetaFromUrl(song?.playMusicUrl, {
    isDownloaded: Boolean(song?.isDownloadedTrack),
    fallbackQuality: settingsStore.setData?.musicQuality || 'higher',
    existing: song?.playbackMeta
  });
  return {
    sourceLabel: meta.sourceLabel,
    qualityLabel: meta.qualityLabel,
    badge: formatPlaybackBadgeText(meta)
  };
});

const audioCacheBytes = ref<number>(0);
const audioCacheMaxMb = ref<number>(
  nativeCapabilities.supportsAudioCache ? getNativeAudioCacheMaxMb() : 500
);
const refreshAudioCacheSize = () => {
  if (nativeCapabilities.supportsAudioCache) {
    audioCacheBytes.value = Number((window as any).AlgerAndroid?.getAudioCacheSize?.() || 0);
    audioCacheMaxMb.value = getNativeAudioCacheMaxMb();
  }
};
const audioCacheSizeText = computed(() => {
  const b = audioCacheBytes.value;
  if (!b || b <= 0) return '0 MB';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
});
const audioCacheMaxLabel = computed(() => formatAudioCacheLimitMb(audioCacheMaxMb.value));
const handleClearCacheInDrawer = () => {
  if (!nativeCapabilities.supportsAudioCache) return;
  const ok = Boolean((window as any).AlgerAndroid?.clearAudioCache?.());
  refreshAudioCacheSize();
  showBottomToast(ok ? '已清理音频缓存' : '缓存清理失败');
};

const showEqModal = ref(false);
const eqEnabled = ref<boolean>(nativeCapabilities.supportsEq ? audioService.isEQEnabled() : false);
const openEqModal = () => {
  if (!nativeCapabilities.supportsEq) return;
  eqEnabled.value = audioService.isEQEnabled();
  showEqModal.value = true;
};
const closeEqModal = () => {
  eqEnabled.value = nativeCapabilities.supportsEq ? audioService.isEQEnabled() : false;
  showEqModal.value = false;
};
const floatingLyricOn = ref<boolean>(
  nativeCapabilities.supportsFloatingLyric
    ? Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.())
    : false
);

const toggleAndroidFloatingLyric = () => {
  if (!nativeCapabilities.supportsFloatingLyric) return;
  floatingLyricOn.value = Boolean(
    (window as any).AlgerAndroid?.setFloatingLyricEnabled?.(!floatingLyricOn.value)
  );
};

const handleFloatingLyricStateChanged = (_: any, payload: any) => {
  floatingLyricOn.value = Boolean(payload?.enabled);
};

const handleFloatingLyricClosed = () => {
  floatingLyricOn.value = false;
};

const handleDownloadCurrent = async () => {
  const song = playerStore.playMusic;
  if (song && song.id) {
    await downloadMusic(song);
  }
};

// Props & Emits
const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

watch(
  () => props.visible,
  (val) => {
    if (val) {
      eqEnabled.value = nativeCapabilities.supportsEq ? audioService.isEQEnabled() : false;
      refreshAudioCacheSize();
      if (nativeCapabilities.supportsFloatingLyric) {
        floatingLyricOn.value = Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.());
      }
    } else {
      showEqModal.value = false;
    }
  }
);

// 播放速度选项
const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// 自定义时间
const customMinutes = ref<number | string>(30);

// 定时器相关
const refreshTrigger = ref(0);
let timerInterval: number | null = null;

const hasTimerActive = computed(() => playerStore.hasSleepTimerActive);

const timerStatusText = computed(() => {
  if (sleepTimer.value.type === 'time') return t('player.sleepTimer.timeMode');
  if (sleepTimer.value.type === 'songs') return t('player.sleepTimer.songsMode');
  if (sleepTimer.value.type === 'end') return t('player.sleepTimer.afterPlaylist');
  return '';
});

const timerDisplayText = computed(() => {
  void refreshTrigger.value;

  if (sleepTimer.value.type === 'time' && sleepTimer.value.endTime) {
    const remaining = Math.max(0, sleepTimer.value.endTime - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  if (sleepTimer.value.type === 'songs') {
    return t('player.sleepTimer.songsRemaining', { count: sleepTimer.value.remainingSongs || 0 });
  }

  if (sleepTimer.value.type === 'end') {
    return t('player.sleepTimer.afterPlaylist');
  }

  return '';
});

// 方法
const close = () => {
  emit('update:visible', false);
};

const setSpeed = (speed: number) => {
  playerStore.setPlaybackRate(speed);
};

const setTimeTimer = (minutes: number) => {
  playerStore.setSleepTimerByTime(minutes);
};

const setCustomTimeTimer = () => {
  const minutes =
    typeof customMinutes.value === 'number'
      ? customMinutes.value
      : parseInt(String(customMinutes.value) || '0', 10);
  if (minutes >= 1) {
    playerStore.setSleepTimerByTime(minutes);
    customMinutes.value = 30;
  }
};

const increaseMinutes = () => {
  const current = Number(customMinutes.value) || 0;
  customMinutes.value = Math.min(300, current + 1);
};

const decreaseMinutes = () => {
  const current = Number(customMinutes.value) || 0;
  customMinutes.value = Math.max(1, current - 1);
};

const handleMinutesInput = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const value = input.value.replace(/[^0-9]/g, '');
  if (value) {
    customMinutes.value = Math.min(300, Math.max(1, parseInt(value, 10)));
  } else {
    customMinutes.value = '';
  }
};

const setSongsTimer = (songs: number) => {
  playerStore.setSleepTimerBySongs(songs);
};

const setPlaylistEndTimer = () => {
  playerStore.setSleepTimerAtPlaylistEnd();
};

const cancelTimer = () => {
  playerStore.clearSleepTimer();
};

// 定时刷新倒计时
const startTimerUpdate = () => {
  if (timerInterval) return;
  timerInterval = window.setInterval(() => {
    refreshTrigger.value = Date.now();
  }, 500);
};

const stopTimerUpdate = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

watch(
  () => [hasTimerActive.value, sleepTimer.value.type],
  ([active, type]) => {
    if (active && type === 'time') {
      startTimerUpdate();
    } else {
      stopTimerUpdate();
    }
  },
  { immediate: true }
);

let unregisterBack: (() => void) | null = null;

onMounted(() => {
  if (hasTimerActive.value && sleepTimer.value.type === 'time') {
    startTimerUpdate();
  }
  if (nativeCapabilities.supportsFloatingLyric) {
    onAndroidEvent('floating-lyric-state-changed', handleFloatingLyricStateChanged);
    onAndroidEvent('floating-lyric-closed', handleFloatingLyricClosed);
  }
  unregisterBack = registerAndroidBackHandler(() => {
    if (showEqModal.value) {
      closeEqModal();
      return true;
    }
    if (props.visible) {
      close();
      return true;
    }
    return false;
  }, 100);
});

onUnmounted(() => {
  stopTimerUpdate();
  if (nativeCapabilities.supportsFloatingLyric) {
    offAndroidEvent('floating-lyric-state-changed', handleFloatingLyricStateChanged);
    offAndroidEvent('floating-lyric-closed', handleFloatingLyricClosed);
  }
  unregisterBack?.();
  unregisterBack = null;
});
</script>

<style scoped>
/* 弹窗动画 */
.settings-drawer-enter-active,
.settings-drawer-leave-active {
  transition: opacity 0.3s ease;
}

.settings-drawer-enter-active > div:last-child,
.settings-drawer-leave-active > div:last-child {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}

.settings-drawer-enter-from,
.settings-drawer-leave-to {
  opacity: 0;
}

.settings-drawer-enter-from > div:last-child,
.settings-drawer-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
