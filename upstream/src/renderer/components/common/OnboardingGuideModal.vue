<template>
  <Teleport to="body">
    <Transition name="onboarding-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[999990] flex items-center justify-center bg-black/60 backdrop-blur-md px-4"
        @click.self="skipOnboarding"
      >
        <div
          class="w-full max-w-md rounded-[28px] overflow-hidden bg-white dark:bg-[#131316] border border-slate-200/80 dark:border-white/[0.08] shadow-2xl"
        >
          <!-- 顶部进度指示与全程跳过按钮（新用户极简 3 问引导） -->
          <div class="px-5 pt-4 pb-2 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <span
                v-for="s in totalSteps"
                :key="s"
                class="h-1.5 rounded-full transition-all duration-300"
                :class="
                  step === s
                    ? 'w-7 bg-gradient-to-r from-amber-400 to-orange-500'
                    : step > s
                      ? 'w-3 bg-amber-400/60'
                      : 'w-3 bg-slate-200 dark:bg-[#1C1C22]'
                "
              ></span>
              <span class="ml-1.5 text-[11px] font-bold text-slate-400 dark:text-zinc-400">
                {{ step }} / {{ totalSteps }}
              </span>
            </div>

            <button
              type="button"
              class="px-3.5 py-1 rounded-full text-xs font-extrabold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 border border-amber-200/80 dark:border-amber-400/30 transition-colors"
              @click="skipOnboarding"
            >
              跳过
            </button>
          </div>

          <!-- 第 1 问：偏好主题（浅色 / 深色） -->
          <div v-if="step === 1" class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-sky-400 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-sun-cloudy-fill text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                选择偏好的外观主题
              </h2>
              <p class="text-xs text-slate-500 dark:text-zinc-400">
                随时可在设置中自由切换
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <button
                v-for="opt in themeChoices"
                :key="opt.id"
                type="button"
                class="p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all active:scale-95"
                :class="
                  selectedThemeChoice === opt.id
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-500/15'
                    : 'border-slate-200 dark:border-white/[0.08] bg-slate-50/60 dark:bg-[#1C1C22]'
                "
                @click="applyThemeChoice(opt.id)"
              >
                <i :class="opt.icon" class="text-2xl" :style="{ color: opt.color }"></i>
                <span class="text-sm font-bold text-slate-800 dark:text-zinc-100">{{ opt.label }}</span>
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

          <!-- 第 2 问：是否开启云同步 -->
          <div v-else-if="step === 2" class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-cloud-line text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                是否开启云同步？
              </h2>
              <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                加密保存红心收藏、播放历史与歌单，换设备也能快速恢复
              </p>
            </div>

            <div class="space-y-2.5">
              <button
                type="button"
                class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
                style="background: linear-gradient(135deg, #0ea5e9 0%, #4f46e5 100%)"
                @click="goConfigureCloudSync"
              >
                <i class="ri-sparkling-2-fill mr-1.5"></i>立即前往设置
              </button>
              <button
                type="button"
                class="w-full py-2.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-[#1C1C22] text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 dark:hover:bg-[#24242C] transition-colors"
                @click="handleSkipCloudSync"
              >
                暂不开启
              </button>
            </div>
          </div>

          <!-- 第 3 问（仅 Android 显示）：是否导入本地音乐 -->
          <div v-else class="px-6 py-5 space-y-5">
            <div class="text-center space-y-1.5">
              <div
                class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center shadow-lg"
              >
                <i class="ri-folder-music-fill text-3xl"></i>
              </div>
              <h2 class="text-xl font-extrabold text-slate-900 dark:text-white">
                是否导入本地音乐？
              </h2>
              <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                扫描手机里的 MP3 / FLAC / M4A 歌曲加入「我的音乐」
              </p>
            </div>

            <div class="space-y-2.5">
              <button
                type="button"
                class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
                style="background: linear-gradient(135deg, #10b981 0%, #0d9488 100%)"
                @click="goImportLocalMusic"
              >
                <i class="ri-folder-add-line mr-1.5"></i>一键扫描
              </button>
              <button
                type="button"
                class="w-full py-2.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-[#1C1C22] text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 dark:hover:bg-[#24242C] transition-colors"
                @click="completeOnboarding"
              >
                暂不导入
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useFavoriteStore } from '@/store/modules/favorite';
import { usePlayHistoryStore } from '@/store/modules/playHistory';
import { useSettingsStore } from '@/store/modules/settings';
import { isLyricWindow, isRealAndroid } from '@/utils';
import { triggerHaptic } from '@/utils/androidBridge';
import {
  ONBOARDING_COMPLETED_EVENT,
  ONBOARDING_STATE_EVENT
} from '@/utils/announcementPolicy';
import {
  detectExistingUserCustomConfig,
  evaluateOnboardingEligibility
} from '@/utils/onboardingPolicy';

const ONBOARDING_KEY = 'xiaopang_onboarding_completed_v1';
const DISCLAIMER_KEY = 'disclaimer_agreed_timestamp';

const router = useRouter();
const settingsStore = useSettingsStore();
const favoriteStore = useFavoriteStore();
const playHistoryStore = usePlayHistoryStore();

const visible = ref(false);
// Android 端 3 问（主题 -> 云同步 -> 本地扫描）；其他端 2 问（仅保留 Android 本地扫描）
const totalSteps = computed(() => (isRealAndroid ? 3 : 2));
const step = ref<1 | 2 | 3>(1);
const selectedThemeChoice = ref<'light' | 'dark'>(
  settingsStore.theme === 'dark' ? 'dark' : 'light'
);

const themeChoices: Array<{ id: 'light' | 'dark'; label: string; icon: string; color: string }> = [
  { id: 'light', label: '浅色', icon: 'ri-sun-fill', color: '#f59e0b' },
  { id: 'dark', label: '深色', icon: 'ri-moon-clear-fill', color: '#38bdf8' }
];

const applyThemeChoice = (choice: 'light' | 'dark') => {
  triggerHaptic('selection');
  selectedThemeChoice.value = choice;
  settingsStore.setSetData({ autoTheme: false, manualTheme: choice });
  if (settingsStore.theme !== choice) {
    settingsStore.toggleTheme();
  }
};

const notifyOnboardingState = (active: boolean) => {
  if (typeof window === 'undefined') return;
  (window as any).__xiaopangOnboardingActive = active;
  window.dispatchEvent(new CustomEvent(ONBOARDING_STATE_EVENT, { detail: { active } }));
};

const markCompleted = (options?: { completedInteractiveFreshUser?: boolean }) => {
  const wasInteractive = Boolean(options?.completedInteractiveFreshUser);
  try {
    localStorage.setItem(ONBOARDING_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  visible.value = false;
  notifyOnboardingState(false);
  if (wasInteractive && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(ONBOARDING_COMPLETED_EVENT, {
        detail: { freshUser: true }
      })
    );
  }
};

const skipOnboarding = () => {
  triggerHaptic('light');
  markCompleted({ completedInteractiveFreshUser: true });
};

const completeOnboarding = () => {
  triggerHaptic('success');
  markCompleted({ completedInteractiveFreshUser: true });
};

const handleSkipCloudSync = () => {
  triggerHaptic('light');
  if (isRealAndroid) {
    step.value = 3;
  } else {
    completeOnboarding();
  }
};

const goImportLocalMusic = () => {
  markCompleted({ completedInteractiveFreshUser: true });
  router.push('/library?tab=local&autoScan=1');
};

const goConfigureCloudSync = () => {
  markCompleted({ completedInteractiveFreshUser: true });
  router.push('/set?section=sync');
};

const maybeOpenOnboarding = () => {
  if (isLyricWindow.value) {
    notifyOnboardingState(false);
    return;
  }
  try {
    const rawPlaylists = localStorage.getItem('xiaopang_custom_playlists_v1');
    let customPlaylistsCount = 0;
    if (rawPlaylists) {
      try {
        const parsed = JSON.parse(rawPlaylists);
        if (Array.isArray(parsed)) customPlaylistsCount = parsed.length;
      } catch {
        customPlaylistsCount = 0;
      }
    }
    const hasCustomConfig = detectExistingUserCustomConfig({
      rawToken: localStorage.getItem('token'),
      rawCloudSyncConfigJson: localStorage.getItem('xiaopang_cloud_sync_config_v1'),
      rawCustomPlaylistsJson: rawPlaylists,
      rawPwaApiUrl: localStorage.getItem('alger_pwa_api_url'),
      rawDownloadedTracksJson: localStorage.getItem('downloaded_tracks'),
      rawAppSettingsJson: localStorage.getItem('appSettings')
    });

    const decision = evaluateOnboardingEligibility({
      isLyricWindow: isLyricWindow.value,
      alreadyCompleted: Boolean(localStorage.getItem(ONBOARDING_KEY)),
      disclaimerAgreed: Boolean(localStorage.getItem(DISCLAIMER_KEY)),
      favoritesCount: favoriteStore.favoriteList.length,
      playHistoryCount: playHistoryStore.musicHistory.length,
      customPlaylistsCount,
      hasCustomConfig
    });

    if (decision.shouldAutoMarkCompleted) {
      markCompleted({ completedInteractiveFreshUser: false });
      return;
    }
    if (!decision.shouldShow) {
      notifyOnboardingState(false);
      return;
    }
  } catch {
    notifyOnboardingState(false);
    return;
  }
  visible.value = true;
  notifyOnboardingState(true);
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
  if (visible.value) {
    notifyOnboardingState(false);
  }
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
