<template>
  <Teleport to="body">
    <Transition name="disclaimer-modal">
      <div
        v-if="showDisclaimer"
        class="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-md px-4"
      >
        <div
          class="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-3xl shadow-2xl"
        >
          <div class="h-2 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500"></div>
          <h2 class="text-2xl font-bold text-center text-gray-900 dark:text-white px-6 mt-8">
            {{ t('comp.disclaimer.title') }}
          </h2>

          <div class="px-6 py-5">
            <div class="space-y-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              <div
                class="p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
              >
                <div class="flex items-start gap-3">
                  <i class="ri-alert-line text-amber-500 text-xl flex-shrink-0 mt-0.5"></i>
                  <p class="text-amber-700 dark:text-amber-300">
                    {{ t('comp.disclaimer.warning') }}
                  </p>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-start gap-3">
                  <div
                    class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5"
                  >
                    <i class="ri-book-2-line text-blue-500 text-sm"></i>
                  </div>
                  <p>{{ t('comp.disclaimer.item1') }}</p>
                </div>

                <div class="flex items-start gap-3">
                  <div
                    class="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5"
                  >
                    <i class="ri-time-line text-amber-500 text-sm"></i>
                  </div>
                  <p>{{ t('comp.disclaimer.item2') }}</p>
                </div>

                <div class="flex items-start gap-3">
                  <div
                    class="w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0 mt-0.5"
                  >
                    <i class="ri-shield-check-line text-sky-500 text-sm"></i>
                  </div>
                  <p>{{ t('comp.disclaimer.item3') }}</p>
                </div>
              </div>

              <p
                v-if="disagreeHint"
                class="text-xs text-center text-amber-600 dark:text-amber-400 pt-1"
              >
                {{ disagreeHint }}
              </p>
            </div>
          </div>

          <div class="px-6 pb-7 space-y-2.5">
            <button
              @click="handleAgree"
              class="w-full py-3.5 rounded-full text-base font-bold text-white bg-gradient-to-r from-amber-400 to-orange-500 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-amber-500/30"
            >
              <span class="flex items-center justify-center gap-2">
                <i class="ri-check-line text-lg"></i>
                {{ t('comp.disclaimer.agree') }}
              </span>
            </button>

            <button
              @click="handleDisagree"
              class="w-full py-3 rounded-2xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {{ t('comp.disclaimer.disagree') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { isElectron, isLyricWindow } from '@/utils';

const { t } = useI18n();

const DISCLAIMER_AGREED_KEY = 'disclaimer_agreed_timestamp';

const showDisclaimer = ref(false);
const disagreeHint = ref('');

const shouldShowDisclaimer = () => {
  try {
    return !localStorage.getItem(DISCLAIMER_AGREED_KEY);
  } catch {
    return true;
  }
};

const handleAgree = () => {
  try {
    localStorage.setItem(DISCLAIMER_AGREED_KEY, Date.now().toString());
  } catch {
    // ignore storage errors
  }
  disagreeHint.value = '';
  showDisclaimer.value = false;
  window.dispatchEvent(new CustomEvent('xiaopang-disclaimer-agreed'));
};

const handleDisagree = () => {
  if (isElectron) {
    window.api?.quitApp?.();
    return;
  }
  if (typeof window.AlgerAndroid?.exitApp === 'function') {
    window.AlgerAndroid.exitApp();
    return;
  }
  // iOS / Safari PWA：无法由脚本强退应用，保留弹窗并提示用户手动关闭
  try {
    window.AlgerAndroid?.showToast?.('需同意《使用须知》后方可使用，请直接上滑关闭应用');
  } catch {
    // ignore
  }
  disagreeHint.value = '需同意《使用须知》后方可使用，如需退出请直接关闭应用。';
  try {
    window.close();
  } catch {
    // ignore
  }
};

onMounted(() => {
  if (isLyricWindow.value) return;

  if (shouldShowDisclaimer()) {
    showDisclaimer.value = true;
  }
});
</script>

<style scoped>
.disclaimer-modal-enter-active,
.disclaimer-modal-leave-active {
  transition: opacity 0.25s ease;
}

.disclaimer-modal-enter-from,
.disclaimer-modal-leave-to {
  opacity: 0;
}
</style>
