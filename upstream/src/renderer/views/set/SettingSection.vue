<template>
  <div :id="id" :ref="setRef" class="mb-6 scroll-mt-20">
    <!-- 分组标题 -->
    <div class="flex items-center gap-2 text-base md:text-lg font-extrabold mb-3 text-slate-800 dark:text-slate-100 px-1">
      <span class="h-4 w-1 rounded-full bg-gradient-to-b from-amber-400 to-sky-400" />
      <slot name="title">{{ title }}</slot>
    </div>

    <!-- 设置项列表容器（奶娃玻璃圆角卡） -->
    <div
      class="bg-white/82 dark:bg-slate-800/65 backdrop-blur-xl rounded-[22px] overflow-hidden border border-sky-100/80 dark:border-white/10 shadow-naiwa-sm"
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
