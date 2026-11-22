<template>
  <Teleport to="body">
    <Transition name="app-floating-toast">
      <div
        v-if="floatingToastState.visible && floatingToastState.text"
        class="app-floating-toast-wrap"
        role="status"
        aria-live="polite"
      >
        <div
          class="app-floating-toast-capsule rounded-full px-4 py-2 flex items-center gap-1.5 max-w-[88vw] whitespace-nowrap"
        >
          <i
            v-if="floatingToastState.icon"
            :class="floatingToastState.icon"
            class="text-[14px] text-amber-300 flex-shrink-0 leading-none"
          ></i>
          <span class="text-[12.5px] leading-none font-medium text-white/95 tracking-wide truncate">
            {{ floatingToastState.text }}
          </span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { floatingToastState } from '@/utils/shortcutToast';
</script>

<style scoped>
.app-floating-toast-wrap {
  position: fixed;
  left: 50%;
  top: calc(env(safe-area-inset-top, 24px) + 56px);
  transform: translateX(-50%);
  z-index: 100050;
  pointer-events: none;
}

.app-floating-toast-capsule {
  background: rgba(18, 20, 26, 0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.app-floating-toast-enter-active,
.app-floating-toast-leave-active {
  transition:
    opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.app-floating-toast-enter-from,
.app-floating-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px) scale(0.96);
}

.app-floating-toast-enter-to,
.app-floating-toast-leave-from {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
</style>
