<template>
  <div class="h-full w-full bg-transparent transition-colors duration-300">
    <n-scrollbar ref="scrollbarRef" class="h-full" :size="100" @scroll="handleScroll">
      <div class="w-full pb-44">
        <!-- Page Header (scrolls away) -->
        <div ref="headerRef" class="page-padding pt-4 pb-2">
          <div class="flex items-center gap-2.5 mb-1">
            <span class="h-6 w-1.5 rounded-full bg-gradient-to-b from-amber-400 to-sky-400" />
            <h1 class="text-2xl font-extrabold tracking-tight text-slate-800 md:text-3xl dark:text-slate-100">
              {{ title }}
            </h1>
          </div>
          <p v-if="description" class="text-xs md:text-sm text-slate-500 dark:text-slate-400 pl-4">
            {{ description }}
          </p>
        </div>

        <!-- Tabs (sticky on scroll) -->
        <div
          class="sticky-tabs z-10 transition-all duration-200"
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
        <div class="page-padding pt-4">
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
.sticky-tabs {
  background: transparent;
}
.sticky-tabs.is-stuck {
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  background: rgba(246, 250, 253, 0.85);
  box-shadow: 0 4px 16px rgba(82, 134, 168, 0.08);
}
:global(.dark) .sticky-tabs.is-stuck {
  background: rgba(15, 20, 28, 0.85);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}
</style>
