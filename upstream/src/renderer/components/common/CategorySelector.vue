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
  border-bottom: 1px solid rgba(186, 218, 238, 0.28);
}

:global(.dark) .category-bar {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.cat-pill.is-idle {
  background: rgba(255, 255, 255, 0.78);
  color: #475569;
  border: 1px solid rgba(186, 218, 238, 0.45);
}

.cat-pill.is-active {
  background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
  color: #ffffff;
  border: 1px solid rgba(255, 215, 102, 0.5);
  box-shadow: 0 5px 14px rgba(232, 146, 0, 0.28);
}

:global(.dark) .cat-pill.is-idle {
  background: rgba(30, 41, 59, 0.72);
  color: #cbd5e1;
  border-color: rgba(255, 255, 255, 0.08);
}
</style>
