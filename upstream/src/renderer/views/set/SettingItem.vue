<template>
  <div
    class="setting-item flex items-center justify-between px-4 py-3.5 transition-colors bg-transparent text-slate-900 dark:text-zinc-100 border-b border-slate-100 dark:border-white/[0.06] last:border-b-0"
    :class="[
      // 移动端垂直布局
      { 'max-md:flex-col max-md:items-stretch max-md:gap-3': !inline },
      // 可点击样式
      {
        'cursor-pointer active:bg-slate-100 active:dark:bg-[#1C1C22]': clickable
      },
      customClass
    ]"
    @click="handleClick"
  >
    <!-- 左侧：标题和描述 -->
    <div class="flex-1 min-w-0" :class="inline ? 'mr-3' : 'md:mr-4'">
      <div class="text-[15px] font-semibold text-slate-900 dark:text-white leading-snug">
        <slot name="title">{{ title }}</slot>
      </div>
      <div
        v-if="description || $slots.description"
        class="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1"
      >
        <slot name="description">{{ description }}</slot>
      </div>
      <!-- 额外内容插槽 -->
      <div v-if="$slots.extra" class="mt-2">
        <slot name="extra"></slot>
      </div>
    </div>

    <!-- 右侧：操作区 -->
    <div
      v-if="$slots.action || $slots.default"
      class="flex items-center gap-2 flex-shrink-0"
      :class="{ 'max-md:w-full max-md:justify-end': !inline }"
    >
      <slot name="action">
        <slot></slot>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: 'SettingItem'
});

interface Props {
  /** 设置项标题 */
  title?: string;
  /** 设置项描述 */
  description?: string;
  /** 是否可点击 */
  clickable?: boolean;
  /** 是否保持水平布局（不响应移动端） */
  inline?: boolean;
  /** 自定义类名 */
  customClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  description: '',
  clickable: false,
  inline: false,
  customClass: ''
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const handleClick = (event: MouseEvent) => {
  if (props.clickable) {
    emit('click', event);
  }
};
</script>
