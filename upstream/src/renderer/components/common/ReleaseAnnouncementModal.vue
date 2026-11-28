<template>
  <Teleport to="body">
    <Transition name="announcement-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[999985] flex items-center justify-center bg-black/60 backdrop-blur-md px-4 py-6"
        @click.self="dismissModal"
      >
        <div
          class="w-full max-w-lg max-h-[84vh] flex flex-col rounded-[28px] overflow-hidden bg-white dark:bg-[#131316] border border-slate-200/80 dark:border-white/[0.08] shadow-2xl"
        >
          <!-- 顶部暖阳渐变装饰条 -->
          <div class="h-1.5 flex-shrink-0 bg-gradient-to-r from-amber-400 via-orange-500 to-sky-400"></div>

          <!-- 头部信息 -->
          <div
            class="px-5 pt-4 pb-3.5 flex items-start justify-between gap-3 border-b border-slate-200/70 dark:border-white/[0.06] flex-shrink-0"
          >
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-white shadow-sm"
                  style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)"
                >
                  <i class="ri-sparkling-2-fill text-xs"></i>
                  更新公告
                </span>
                <span
                  class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-[#1C1C22] text-slate-700 dark:text-zinc-200 border border-slate-200/80 dark:border-white/[0.08]"
                >
                  v{{ activeAnnouncement.version }} · {{ activeAnnouncement.date }}
                </span>
              </div>
              <h2 class="text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                {{ activeAnnouncement.title }}
              </h2>
              <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                {{ activeAnnouncement.subtitle }}
              </p>
            </div>

            <button
              type="button"
              aria-label="关闭更新公告"
              class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-slate-100 dark:bg-[#1C1C22] text-slate-500 dark:text-zinc-300 hover:bg-slate-200/80 dark:hover:bg-[#24242C] transition-colors"
              @click="dismissModal"
            >
              <i class="ri-close-line text-lg"></i>
            </button>
          </div>

          <!-- 多版本切换条（预留历史公告切换） -->
          <div
            v-if="RELEASE_ANNOUNCEMENTS.length > 1"
            class="px-5 pt-2.5 pb-1 flex items-center gap-2 overflow-x-auto flex-shrink-0"
          >
            <button
              v-for="item in RELEASE_ANNOUNCEMENTS"
              :key="item.id"
              type="button"
              class="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
              :class="
                selectedAnnouncementId === item.id
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-[#1C1C22] text-slate-600 dark:text-zinc-300'
              "
              @click="selectedAnnouncementId = item.id"
            >
              v{{ item.version }} ({{ item.date }})
            </button>
          </div>

          <!-- 分组更新内容列表 -->
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3.5">
            <section
              v-for="section in activeAnnouncement.sections"
              :key="section.id"
              class="rounded-2xl p-3.5 bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/70 dark:border-white/[0.06] space-y-2.5"
            >
              <div class="flex items-center gap-2.5">
                <div
                  class="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                  :class="getAccentBadgeClass(section.accent)"
                >
                  <i :class="section.icon" class="text-sm"></i>
                </div>
                <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">
                  {{ section.title }}
                </h3>
              </div>

              <ul class="space-y-2 pl-0.5">
                <li
                  v-for="(entry, idx) in section.items"
                  :key="`${section.id}-${idx}`"
                  class="flex items-start gap-2 text-xs leading-relaxed"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                    :class="getAccentDotClass(section.accent)"
                  ></span>
                  <div class="min-w-0 flex-1">
                    <span class="font-bold text-slate-800 dark:text-zinc-100">
                      {{ entry.title }}
                    </span>
                    <span class="text-slate-500 dark:text-zinc-400">
                      ：{{ entry.detail }}
                    </span>
                  </div>
                </li>
              </ul>
            </section>
          </div>

          <!-- 底部确认区 -->
          <div
            class="px-5 pt-3 pb-4 border-t border-slate-200/70 dark:border-white/[0.06] bg-white/95 dark:bg-[#131316] flex-shrink-0 space-y-2"
          >
            <button
              type="button"
              class="w-full py-3 rounded-full text-sm font-extrabold text-white shadow-md active:scale-[0.98] transition-all"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="dismissModal"
            >
              知道了
            </button>
            <p class="text-[11px] text-center text-slate-400 dark:text-zinc-500">
              可随时在「设置 → 关于 → 查看更新公告」中再次查阅
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import {
  LATEST_ANNOUNCEMENT,
  RELEASE_ANNOUNCEMENTS,
  type ReleaseAnnouncement,
  type ReleaseAnnouncementSection
} from '@/constants/releaseAnnouncements';
import { isLyricWindow } from '@/utils';
import { registerAndroidBackHandler, triggerHaptic } from '@/utils/androidBridge';
import {
  ANNOUNCEMENT_SEEN_ID_KEY,
  evaluateAnnouncementPopup,
  markAnnouncementSeen,
  ONBOARDING_COMPLETED_EVENT,
  ONBOARDING_STATE_EVENT,
  OPEN_RELEASE_ANNOUNCEMENT_EVENT
} from '@/utils/announcementPolicy';

const DISCLAIMER_KEY = 'disclaimer_agreed_timestamp';

const visible = ref(false);
const selectedAnnouncementId = ref(LATEST_ANNOUNCEMENT.id);
const onboardingActive = ref(
  typeof window !== 'undefined' && Boolean((window as any).__xiaopangOnboardingActive)
);

let autoCheckTimer: number | null = null;
let unregisterBackHandler: (() => void) | null = null;

const activeAnnouncement = computed<ReleaseAnnouncement>(() => {
  return (
    RELEASE_ANNOUNCEMENTS.find((item) => item.id === selectedAnnouncementId.value) ||
    LATEST_ANNOUNCEMENT
  );
});

const getAccentBadgeClass = (accent: ReleaseAnnouncementSection['accent']): string => {
  switch (accent) {
    case 'amber':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
    case 'sky':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300';
    case 'emerald':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
    case 'indigo':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300';
  }
};

const getAccentDotClass = (accent: ReleaseAnnouncementSection['accent']): string => {
  switch (accent) {
    case 'amber':
      return 'bg-amber-500 dark:bg-amber-400';
    case 'sky':
      return 'bg-sky-500 dark:bg-sky-400';
    case 'emerald':
      return 'bg-emerald-500 dark:bg-emerald-400';
    case 'indigo':
      return 'bg-indigo-500 dark:bg-indigo-400';
  }
};

const clearAutoCheckTimer = () => {
  if (autoCheckTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(autoCheckTimer);
    autoCheckTimer = null;
  }
};

const persistSeen = () => {
  if (typeof window === 'undefined') return;
  try {
    markAnnouncementSeen(window.localStorage, LATEST_ANNOUNCEMENT);
  } catch {
    // ignore
  }
};

const dismissModal = () => {
  triggerHaptic('light');
  persistSeen();
  visible.value = false;
};

const tryAutoShowAnnouncement = (justCompletedFreshOnboarding = false) => {
  if (typeof window === 'undefined') return;
  try {
    const disclaimerAgreed = Boolean(window.localStorage.getItem(DISCLAIMER_KEY));
    const seenAnnouncementId = window.localStorage.getItem(ANNOUNCEMENT_SEEN_ID_KEY);
    const isOnboardingActive =
      onboardingActive.value || Boolean((window as any).__xiaopangOnboardingActive);

    const decision = evaluateAnnouncementPopup({
      isLyricWindow: isLyricWindow.value,
      disclaimerAgreed,
      isOnboardingActive,
      justCompletedFreshOnboarding,
      seenAnnouncementId,
      latestAnnouncementId: LATEST_ANNOUNCEMENT.id
    });

    if (decision.shouldMarkSeenSilently) {
      persistSeen();
      return;
    }

    if (!decision.shouldShow) return;

    selectedAnnouncementId.value = LATEST_ANNOUNCEMENT.id;
    visible.value = true;
  } catch {
    // ignore storage errors
  }
};

const scheduleAutoCheck = (delayMs = 300) => {
  if (typeof window === 'undefined' || isLyricWindow.value) return;
  clearAutoCheckTimer();
  autoCheckTimer = window.setTimeout(() => {
    autoCheckTimer = null;
    tryAutoShowAnnouncement(false);
  }, delayMs);
};

const handleDisclaimerAgreed = () => {
  // OnboardingGuideModal schedules at 180ms; wait 320ms so onboarding opens first if applicable.
  scheduleAutoCheck(320);
};

const handleOnboardingState = (event: Event) => {
  const detail = (event as CustomEvent<{ active?: boolean }>).detail;
  const active = Boolean(detail?.active);
  onboardingActive.value = active;
  if (active) {
    clearAutoCheckTimer();
  }
};

const handleOnboardingCompleted = (event: Event) => {
  onboardingActive.value = false;
  clearAutoCheckTimer();
  const detail = (event as CustomEvent<{ freshUser?: boolean }>).detail;
  if (detail?.freshUser) {
    tryAutoShowAnnouncement(true);
  }
};

const handleManualOpen = () => {
  if (isLyricWindow.value) return;
  clearAutoCheckTimer();
  selectedAnnouncementId.value = LATEST_ANNOUNCEMENT.id;
  visible.value = true;
  triggerHaptic('light');
};

onMounted(() => {
  scheduleAutoCheck(300);
  window.addEventListener('xiaopang-disclaimer-agreed', handleDisclaimerAgreed);
  window.addEventListener(ONBOARDING_STATE_EVENT, handleOnboardingState);
  window.addEventListener(ONBOARDING_COMPLETED_EVENT, handleOnboardingCompleted);
  window.addEventListener(OPEN_RELEASE_ANNOUNCEMENT_EVENT, handleManualOpen);
  unregisterBackHandler = registerAndroidBackHandler(() => {
    if (!visible.value) return false;
    dismissModal();
    return true;
  }, 110);
});

onBeforeUnmount(() => {
  clearAutoCheckTimer();
  unregisterBackHandler?.();
  unregisterBackHandler = null;
  window.removeEventListener('xiaopang-disclaimer-agreed', handleDisclaimerAgreed);
  window.removeEventListener(ONBOARDING_STATE_EVENT, handleOnboardingState);
  window.removeEventListener(ONBOARDING_COMPLETED_EVENT, handleOnboardingCompleted);
  window.removeEventListener(OPEN_RELEASE_ANNOUNCEMENT_EVENT, handleManualOpen);
});
</script>

<style scoped>
.announcement-fade-enter-active,
.announcement-fade-leave-active {
  transition: opacity 0.22s ease;
}

.announcement-fade-enter-from,
.announcement-fade-leave-to {
  opacity: 0;
}
</style>
