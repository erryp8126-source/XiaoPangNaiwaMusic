<template>
  <transition name="offline-slide">
    <div
      v-if="offlineStore.isOffline"
      class="offline-banner flex items-center justify-between gap-2 px-3.5 py-2 text-xs flex-shrink-0"
      :class="
        immersive
          ? 'is-immersive mx-4 mb-1 rounded-2xl text-amber-100'
          : 'bg-amber-50/90 border-b border-amber-200/75 text-amber-900 dark:bg-[#181512]/95 dark:border-amber-400/20 dark:text-amber-200'
      "
      role="status"
    >
      <div class="flex items-center gap-2 min-w-0">
        <i
          class="ri-wifi-off-line text-sm flex-shrink-0"
          :class="immersive ? 'text-amber-300' : 'text-amber-600 dark:text-amber-300'"
        ></i>
        <span class="truncate font-medium">
          {{ PLAYBACK_FEEDBACK_COPY.OFFLINE_BANNER }}
        </span>
      </div>
      <button
        type="button"
        class="offline-jump-btn px-3 py-1 rounded-full font-bold text-[11px] flex-shrink-0 active:scale-95 transition-all"
        :class="
          immersive
            ? 'bg-amber-400/20 text-amber-200 border border-amber-300/35 hover:bg-amber-400/30'
            : 'bg-amber-500/90 hover:bg-amber-600 text-white shadow-sm'
        "
        @click="goOfflinePlayable"
      >
        离线曲目
      </button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { triggerHaptic } from '@/utils/androidBridge';
import { PLAYBACK_FEEDBACK_COPY } from '@/utils/playbackFeedback';

withDefaults(
  defineProps<{
    immersive?: boolean;
  }>(),
  {
    immersive: false
  }
);

const router = useRouter();
const offlineStore = useOfflineAvailabilityStore();

onMounted(() => {
  offlineStore.ensureInitialized();
});

const goOfflinePlayable = () => {
  triggerHaptic('light');
  if (offlineStore.downloadedIds.size === 0 && offlineStore.localIds.size > 0) {
    router.push('/library?tab=local');
    return;
  }
  router.push('/library?tab=downloaded');
};
</script>

<style scoped lang="scss">
.offline-banner.is-immersive {
  background: rgba(18, 22, 32, 0.62);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 209, 71, 0.24);
  z-index: 15;
}

.offline-slide-enter-active,
.offline-slide-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.offline-slide-enter-from,
.offline-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
