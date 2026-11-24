<template>
  <div class="sticky-tab-page h-full w-full transition-colors duration-300">
    <n-scrollbar ref="scrollbarRef" class="h-full" :size="100" @scroll="handleScroll">
      <div class="w-full pb-44">
        <!-- Page Header (scrolls away) -->
        <div ref="headerRef" class="page-padding pt-4 pb-2.5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-2.5">
                <span class="h-6 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-sky-400" />
                <h1 class="text-[22px] font-extrabold tracking-tight text-slate-900 md:text-3xl dark:text-white">
                  {{ title }}
                </h1>
              </div>
              <p v-if="description" class="text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 pl-4 mt-1">
                {{ description }}
              </p>
            </div>
            <slot name="header-extra" />
          </div>
        </div>

        <!-- Tabs (sticky on scroll) -->
        <div
          class="sticky-tabs z-20 transition-all duration-200"
          :class="isSticky ? 'sticky top-0 is-stuck' : ''"
        >
          <category-selector
            :model-value="modelValue"
            :categories="categories"
            :label-key="labelKey"
            :value-key="valueKey"
            @change="(val: any) => emit('change', val)"
          />
        </div>

        <!-- Content slot -->
        <div class="page-padding pt-3.5">
          <slot />
        </div>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import CategorySelector from '@/components/common/CategorySelector.vue';

type Category = string | number | { [key: string]: any };

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    modelValue: any;
    categories: Category[];
    labelKey?: string;
    valueKey?: string;
  }>(),
  {
    labelKey: 'label',
    valueKey: 'value'
  }
);

const emit = defineEmits<{
  change: [value: any];
  scroll: [e: any];
}>();

const scrollbarRef = ref();
const headerRef = ref<HTMLElement>();
const isSticky = ref(false);

const handleScroll = (e: any) => {
  if (headerRef.value) {
    const headerBottom = headerRef.value.offsetTop + headerRef.value.offsetHeight;
    isSticky.value = e.target.scrollTop >= headerBottom;
  }
  emit('scroll', e);
};

const scrollTo = (options: ScrollToOptions) => {
  scrollbarRef.value?.scrollTo(options);
};

defineExpose({ scrollbarRef, scrollTo });
</script>

<style scoped>
.sticky-tab-page {
  background-color: var(--bg-color, #f6fafd);
  background-image:
    radial-gradient(circle at 12% 0%, var(--naiwa-sky-glow) 0%, transparent 46%),
    radial-gradient(circle at 92% 4%, var(--naiwa-sun-glow) 0%, transparent 42%);
}
.sticky-tabs {
  background: transparent;
}
.sticky-tabs.is-stuck {
  backdrop-filter: blur(20px) saturate(165%);
  -webkit-backdrop-filter: blur(20px) saturate(165%);
  background: rgba(246, 250, 253, 0.94);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.07);
}
html.dark .sticky-tabs.is-stuck {
  background: rgba(15, 15, 19, 0.94);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
}
</style>
