<template>
  <div class="category-bar z-10">
    <n-scrollbar ref="scrollbarRef" x-scrollable>
      <div
        class="flex items-center py-3 page-padding"
        style="white-space: nowrap"
        @wheel.prevent="handleWheel"
      >
        <span
          v-for="(category, index) in categories"
          :key="getItemKey(category, index)"
          class="cat-pill py-1.5 px-4 mr-2.5 inline-block rounded-full cursor-pointer transition-all duration-200 text-xs md:text-sm font-semibold active:scale-95"
          :class="[
            animationClass,
            index === 0 ? 'ml-0.5' : '',
            isActive(category) ? 'is-active' : 'is-idle'
          ]"
          :style="getAnimationDelay(index)"
          @click="handleClickCategory(category)"
        >
          {{ getItemLabel(category) }}
        </span>
      </div>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { NScrollbar } from 'naive-ui';
import { computed, ref } from 'vue';

import { setAnimationDelay } from '@/utils';

type Category = string | number | { [key: string]: any };

type CategorySelectorProps = {
  categories: Category[];
  modelValue: any;
  labelKey?: string;
  valueKey?: string;
  animationClass?: string;
};

const props = withDefaults(defineProps<CategorySelectorProps>(), {
  labelKey: 'label',
  valueKey: 'value',
  animationClass: 'animate__fadeIn'
});

const emit = defineEmits<{
  'update:modelValue': [value: any];
  change: [value: any];
}>();

const scrollbarRef = ref();

const getItemKey = (item: Category, index: number): string | number => {
  if (typeof item === 'object' && item !== null) {
    return item[props.valueKey] ?? item[props.labelKey] ?? index;
  }
  return item;
};

const getItemLabel = (item: Category): string => {
  if (typeof item === 'object' && item !== null) {
    return item[props.labelKey] ?? String(item);
  }
  return String(item);
};

const getItemValue = (item: Category): any => {
  if (typeof item === 'object' && item !== null) {
    return item[props.valueKey] ?? item;
  }
  return item;
};

const isActive = (item: Category): boolean => {
  const itemValue = getItemValue(item);
  return itemValue === props.modelValue;
};

const getAnimationDelay = computed(() => {
  return (index: number) => setAnimationDelay(index, 20);
});

const handleClickCategory = (item: Category) => {
  const value = getItemValue(item);
  if (value === props.modelValue) return;
  emit('change', value);
};

const handleWheel = (e: WheelEvent) => {
  const scrollbar = scrollbarRef.value;
  if (scrollbar) {
    const delta = e.deltaY || e.detail;
    scrollbar.scrollBy({ left: delta });
  }
};

defineExpose({
  scrollbarRef
});
</script>

<style scoped lang="scss">
.category-bar {
  background: transparent;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}

:global(.dark) .category-bar {
  border-bottom-color: rgba(148, 163, 184, 0.14);
}

.cat-pill.is-idle {
  background: #ffffff;
  color: #334155;
  border: 1px solid #d8e4ef;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
}

.cat-pill.is-active {
  background: linear-gradient(135deg, #ffc21c 0%, #e88900 100%);
  color: #ffffff;
  border: 1px solid rgba(255, 215, 102, 0.65);
  box-shadow: 0 6px 14px rgba(232, 137, 0, 0.3);
}

:global(.dark) .cat-pill.is-idle {
  background: #1b2433;
  color: #e2e8f0;
  border-color: #334155;
  box-shadow: none;
}
</style>
