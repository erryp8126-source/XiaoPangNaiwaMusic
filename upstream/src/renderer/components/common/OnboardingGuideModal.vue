<template>
  <Teleport to="body">
    <Transition name="onboarding-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[999990] flex items-center justify-center bg-black/55 backdrop-blur-md px-4"
        @click.self="skipOnboarding"
      >
        <div
          class="w-full max-w-md rounded-[28px] overflow-hidden bg-white dark:bg-[#141c29] border border-slate-200/80 dark:border-slate-700/80 shadow-2xl"
        >
          <!-- 顶部进度条与右上角醒目跳过按钮 -->
          <div class="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <span
                v-for="s in 3"
                :key="s"
                class="h-1.5 rounded-full transition-all duration-300"
                :class="
                  step === s
                    ? 'w-7 bg-gradient-to-r from-amber-400 to-orange-500'
                    : step > s
                      ? 'w-3 bg-amber-400/60'
                      : 'w-3 bg-slate-200 dark:bg-slate-700'
                "
              ></span>
              <span class="ml-1.5 text-[11px] font-bold text-slate-400">{{ step }} / 3</span>
            </div>

            <button
              type="button"
              class="px-3.5 py-1 rounded-full text-xs font-extrabold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-200/80 dark:border-amber-400/30 transition-colors"
              @click="skipOnboarding"
            >
              跳过
            </button>
          </div>

          <!-- Step 1: 选择主题 -->
          <div v-if="step === 1" class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-sky-400 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-sun-cloudy-fill text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                欢迎来到小庞奶娃音乐
              </h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                先挑一个你喜欢的外观风格（随时可在设置中切换）
              </p>
            </div>

            <div class="grid grid-cols-3 gap-2.5">
              <button
                v-for="opt in themeChoices"
                :key="opt.id"
                type="button"
                class="p-3 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all active:scale-95"
                :class="
                  selectedThemeChoice === opt.id
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-500/15'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60'
                "
                @click="applyThemeChoice(opt.id)"
              >
                <i :class="opt.icon" class="text-2xl" :style="{ color: opt.color }"></i>
                <span class="text-xs font-bold text-slate-800 dark:text-slate-100">{{ opt.label }}</span>
              </button>
            </div>

            <button
              type="button"
              class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="step = 2"
            >
              下一步
            </button>
          </div>

          <!-- Step 2: 扫描 / 导入本地音乐 -->
          <div v-else-if="step === 2" class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-folder-music-fill text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                导入或扫描本地音乐
              </h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                把手机里现有的 MP3 / FLAC / M4A 歌曲收入「我的音乐库」，无网络也能秒开播放
              </p>
            </div>

            <div class="space-y-2.5">
              <button
                type="button"
                class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
                style="background: linear-gradient(135deg, #10b981 0%, #0d9488 100%)"
                @click="goImportLocalMusic"
              >
                <i class="ri-folder-add-line mr-1.5"></i>前往音乐库扫描 / 导入
              </button>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="py-2.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  @click="step = 1"
                >
                  上一步
                </button>
                <button
                  type="button"
                  class="py-2.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  @click="step = 3"
                >
                  暂不导入，下一步
                </button>
              </div>
            </div>
          </div>

          <!-- Step 3: 是否开启云同步 -->
          <div v-else class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-cloud-line text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                开启端到端加密云同步
              </h2>
              <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                一个专属同步口令，AES-256 加密同步收藏、播放历史与听歌统计，换手机 3 秒找回全部记录
              </p>
            </div>

            <div class="space-y-2.5">
              <button
                type="button"
                class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
                style="background: linear-gradient(135deg, #0ea5e9 0%, #4f46e5 100%)"
                @click="goConfigureCloudSync"
              >
                <i class="ri-sparkling-2-fill mr-1.5"></i>去开启一键口令云同步
              </button>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="py-2.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  @click="step = 2"
                >
                  上一步
                </button>
                <button
                  type="button"
                  class="py-2.5 rounded-full text-xs font-extrabold text-white"
                  style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
                  @click="completeOnboarding"
                >
                  直接开始听歌
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useSettingsStore } from '@/store/modules/settings';
import { isLyricWindow } from '@/utils';
import { triggerHaptic } from '@/utils/androidBridge';

const ONBOARDING_KEY = 'xiaopang_onboarding_completed_v1';
const DISCLAIMER_KEY = 'disclaimer_agreed_timestamp';

const router = useRouter();
const settingsStore = useSettingsStore();

const visible = ref(false);
const step = ref<1 | 2 | 3>(1);
const selectedThemeChoice = ref<'light' | 'dark' | 'auto'>(
  settingsStore.setData?.autoTheme
    ? 'auto'
    : settingsStore.theme === 'dark'
      ? 'dark'
      : 'light'
);

const themeChoices: Array<{ id: 'light' | 'dark' | 'auto'; label: string; icon: string; color: string }> = [
  { id: 'light', label: '晴空浅色', icon: 'ri-sun-fill', color: '#f59e0b' },
  { id: 'dark', label: '暖夜暗色', icon: 'ri-moon-clear-fill', color: '#38bdf8' },
  { id: 'auto', label: '跟随系统', icon: 'ri-contrast-2-fill', color: '#8b5cf6' }
];

const applyThemeChoice = (choice: 'light' | 'dark' | 'auto') => {
  triggerHaptic('selection');
  selectedThemeChoice.value = choice;
  if (choice === 'auto') {
    settingsStore.setSetData({ autoTheme: true });
    settingsStore.initializeTheme();
  } else {
    settingsStore.setSetData({ autoTheme: false, manualTheme: choice });
    if (settingsStore.theme !== choice) {
      settingsStore.toggleTheme();
    }
  }
};

const markCompleted = () => {
  try {
    localStorage.setItem(ONBOARDING_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  visible.value = false;
};

const skipOnboarding = () => {
  triggerHaptic('light');
  markCompleted();
};

const completeOnboarding = () => {
  triggerHaptic('success');
  markCompleted();
};

const goImportLocalMusic = () => {
  markCompleted();
  router.push('/library?tab=local&autoScan=1');
};

const goConfigureCloudSync = () => {
  markCompleted();
  router.push('/set?section=sync');
};

const maybeOpenOnboarding = () => {
  if (isLyricWindow.value) return;
  try {
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    if (!localStorage.getItem(DISCLAIMER_KEY)) return;
  } catch {
    return;
  }
  visible.value = true;
};

const handleDisclaimerAgreed = () => {
  window.setTimeout(() => {
    maybeOpenOnboarding();
  }, 180);
};

onMounted(() => {
  maybeOpenOnboarding();
  window.addEventListener('xiaopang-disclaimer-agreed', handleDisclaimerAgreed);
});

onBeforeUnmount(() => {
  window.removeEventListener('xiaopang-disclaimer-agreed', handleDisclaimerAgreed);
});
</script>

<style scoped>
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.25s ease;
}

.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}
</style>
