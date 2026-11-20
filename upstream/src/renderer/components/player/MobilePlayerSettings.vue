<template>
  <Teleport to="body">
    <Transition name="settings-drawer">
      <div
        v-if="visible"
        class="fixed inset-0 z-[99999] flex items-end justify-center"
        @click.self="close"
      >
        <!-- 遮罩层 -->
        <div class="absolute inset-0 bg-black/50" @click="close"></div>

        <!-- 弹窗内容 - 奶娃暗夜磨砂玻璃 -->
        <div
          class="relative w-full max-w-lg bg-[#131b29]/88 backdrop-blur-2xl rounded-t-[30px] overflow-hidden max-h-[85vh] flex flex-col border-t border-white/15 shadow-2xl"
        >
          <!-- 顶部拖拽条 -->
          <div class="flex justify-center pt-3 pb-2 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-white/30"></div>
          </div>

          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 pb-4 flex-shrink-0">
            <h2 class="text-lg font-bold text-white tracking-tight">
              {{ t('player.settings.title') }}
            </h2>
            <button
              @click="close"
              class="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-white/75 active:scale-90 transition-all"
            >
              <i class="ri-close-line text-xl"></i>
            </button>
          </div>

          <!-- 内容区域 -->
          <div
            class="flex-1 overflow-y-auto px-5 pb-6"
            :style="{ paddingBottom: `calc(24px + var(--safe-area-inset-bottom, 0px))` }"
          >
            <!-- Android 原生快捷操作 -->
            <div v-if="isAndroid" class="mb-6">
              <div class="grid grid-cols-3 gap-2.5">
                <button
                  @click="handleDownloadCurrent"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-white/10 border border-white/10 text-white/90 active:scale-95 transition-all"
                >
                  <i class="ri-download-cloud-2-line text-xl text-amber-300"></i>
                  <span class="text-xs font-semibold">下载歌曲</span>
                </button>
                <button
                  @click="toggleAndroidFloatingLyric"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl transition-all active:scale-95 border"
                  :class="
                    floatingLyricOn
                      ? 'bg-amber-400/20 border-amber-300/45 text-amber-200'
                      : 'bg-white/10 border-white/10 text-white/90'
                  "
                >
                  <i class="ri-subtitles-line text-xl"></i>
                  <span class="text-xs font-semibold">{{ floatingLyricOn ? '关闭悬浮词' : '悬浮歌词' }}</span>
                </button>
                <button
                  @click="showEqModal = true"
                  class="flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-white/10 border border-white/10 text-white/90 active:scale-95 transition-all"
                >
                  <i class="ri-equalizer-line text-xl text-sky-300"></i>
                  <span class="text-xs font-semibold">均衡器 EQ</span>
                </button>
              </div>
              <div class="h-px bg-white/10 my-5"></div>
            </div>

            <!-- 播放速度 -->
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-white/85">
                  {{ t('player.settings.playbackSpeed') }}
                </span>
                <span class="text-sm text-amber-300 font-bold">{{ playbackRate }}x</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="option in speedOptions"
                  :key="option"
                  @click="setSpeed(option)"
                  class="px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95"
                  :class="
                    playbackRate === option
                      ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/25'
                      : 'bg-white/10 text-white/75 hover:bg-white/15'
                  "
                >
                  {{ option }}x
                </button>
              </div>
            </div>

            <!-- 分隔线 -->
            <div class="h-px bg-white/10 my-5"></div>

            <!-- 定时关闭 -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-white/85">
                  {{ t('player.sleepTimer.title') }}
                </span>
                <span v-if="hasTimerActive" class="text-sm text-amber-300 font-bold">
                  {{ timerStatusText }}
                </span>
              </div>

              <!-- 已激活状态 -->
              <div v-if="hasTimerActive" class="space-y-3">
                <div class="p-4 rounded-2xl bg-amber-400/15 border border-amber-300/30">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <i class="ri-timer-line text-amber-300 text-xl"></i>
                      <span class="text-amber-200 font-semibold">
                        {{ timerDisplayText }}
                      </span>
                    </div>
                    <button
                      @click="cancelTimer"
                      class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-rose-500/25 text-rose-200 hover:bg-rose-500/35"
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
                  <p class="text-xs text-white/55 mb-2">
                    {{ t('player.sleepTimer.timeMode') }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="minutes in [15, 30, 60, 90]"
                      :key="minutes"
                      @click="setTimeTimer(minutes)"
                      class="px-4 py-2 rounded-full text-sm font-medium bg-white/10 text-white/80 active:scale-95 transition-all"
                    >
                      {{ minutes }}{{ t('player.sleepTimer.minutes') }}
                    </button>
                  </div>
                  <!-- 自定义时间 -->
                  <div class="flex items-center gap-2 mt-3">
                    <div class="flex items-center flex-1 bg-white/10 rounded-full overflow-hidden border border-white/10">
                      <button
                        @click="decreaseMinutes"
                        class="w-10 h-10 flex items-center justify-center text-white/75 active:bg-white/20"
                      >
                        <i class="ri-subtract-line text-lg"></i>
                      </button>
                      <input
                        v-model="customMinutes"
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        placeholder="分钟"
                        class="flex-1 px-2 py-2 text-sm text-center bg-transparent text-white border-0 outline-none placeholder-white/40"
                        @input="handleMinutesInput"
                      />
                      <button
                        @click="increaseMinutes"
                        class="w-10 h-10 flex items-center justify-center text-white/75 active:bg-white/20"
                      >
                        <i class="ri-add-line text-lg"></i>
                      </button>
                    </div>
                    <button
                      @click="setCustomTimeTimer"
                      :disabled="!customMinutes || Number(customMinutes) < 1"
                      class="px-5 py-2.5 rounded-full text-sm font-semibold bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
                    >
                      {{ t('player.sleepTimer.set') }}
                    </button>
                  </div>
                </div>

                <!-- 按歌曲数 -->
                <div>
                  <p class="text-xs text-white/50 mb-2">
                    {{ t('player.sleepTimer.songsMode') }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="songs in [1, 3, 5, 10]"
                      :key="songs"
                      @click="setSongsTimer(songs)"
                      class="px-4 py-2 rounded-full text-sm font-medium bg-white/10 text-white/70 hover:bg-white/15"
                    >
                      {{ songs }}{{ t('player.sleepTimer.songs') }}
                    </button>
                  </div>
                </div>

                <!-- 播放列表结束 -->
                <button
                  @click="setPlaylistEndTimer"
                  class="w-full py-3 rounded-2xl text-sm font-medium bg-white/10 text-white/70 hover:bg-white/15"
                >
                  {{ t('player.sleepTimer.playlistEnd') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <n-modal
      v-if="isAndroid"
      v-model:show="showEqModal"
      preset="card"
      style="width: 94vw; max-width: 680px"
      title="均衡器 (EQ)"
    >
      <eq-control />
    </n-modal>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import EqControl from '@/components/EQControl.vue';
import { useDownload } from '@/hooks/useDownload';
import { usePlayerStore } from '@/store/modules/player';
import { isAndroid } from '@/utils';

const { t } = useI18n();
const playerStore = usePlayerStore();
const { sleepTimer, playbackRate } = storeToRefs(playerStore);
const { downloadMusic } = useDownload();

const showEqModal = ref(false);
const floatingLyricOn = ref<boolean>(
  isAndroid ? Boolean((window as any).AlgerAndroid?.isFloatingLyricEnabled?.()) : false
);

const toggleAndroidFloatingLyric = () => {
  if (!isAndroid) return;
  floatingLyricOn.value = Boolean(
    (window as any).AlgerAndroid?.setFloatingLyricEnabled?.(!floatingLyricOn.value)
  );
};

const handleDownloadCurrent = async () => {
  const song = playerStore.playMusic;
  if (song && song.id) {
    await downloadMusic(song);
  }
};

// Props & Emits
defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

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

onMounted(() => {
  if (hasTimerActive.value && sleepTimer.value.type === 'time') {
    startTimerUpdate();
  }
});

onUnmounted(() => {
  stopTimerUpdate();
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
