<template>
  <transition name="offline-slide">
    <div
      v-if="!offlineStore.isOnline"
      class="offline-banner flex items-center justify-between gap-2 px-3.5 py-2 text-xs bg-amber-50/95 dark:bg-amber-500/15 border-b border-amber-200/80 dark:border-amber-400/25 text-amber-900 dark:text-amber-200 flex-shrink-0"
      role="status"
    >
      <div class="flex items-center gap-2 min-w-0">
        <i class="ri-wifi-off-line text-sm text-amber-600 dark:text-amber-300 flex-shrink-0"></i>
        <span class="truncate font-medium">
          当前处于离线状态，仅可播放已下载或已缓存曲目
        </span>
      </div>
      <button
        type="button"
        class="px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] flex-shrink-0 active:scale-95 transition-all shadow-sm"
        @click="goOfflinePlayable"
      >
        离线可播
      </button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { triggerHaptic } from '@/utils/androidBridge';

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
.offline-slide-enter-active,
.offline-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.offline-slide-enter-from,
.offline-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
