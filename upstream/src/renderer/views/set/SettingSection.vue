<template>
  <div :id="id" :ref="setRef" class="mb-5 scroll-mt-20">
    <!-- 分组标题 -->
    <div class="flex items-center gap-2 text-[15px] md:text-base font-bold mb-2.5 text-slate-800 dark:text-slate-100 px-1">
      <span class="h-4 w-1 rounded-full bg-gradient-to-b from-amber-500 to-sky-500" />
      <slot name="title">{{ title }}</slot>
    </div>

    <!-- 设置项列表容器（高对比度实底圆角卡片，不裁剪下拉菜单） -->
    <div
      class="bg-white dark:bg-[#131316] rounded-[20px] border border-slate-200/90 dark:border-white/[0.08] shadow-[0_2px_12px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.35)] [&>*:first-child]:rounded-t-[20px] [&>*:last-child]:rounded-b-[20px]"
    >
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance } from 'vue';

defineOptions({
  name: 'SettingSection'
});

interface Props {
  /** 分组 ID，用于导航定位 */
  id?: string;
  /** 分组标题 */
  title?: string;
}

withDefaults(defineProps<Props>(), {
  id: '',
  title: ''
});

const emit = defineEmits<{
  ref: [el: Element | null];
}>();

// 暴露 ref 给父组件
const setRef = (el: Element | ComponentPublicInstance | null) => {
  emit('ref', el as Element | null);
};
</script>
