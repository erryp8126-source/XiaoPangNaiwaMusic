<template>
  <button
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs md:text-sm font-semibold transition-all duration-200 select-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
    :class="variantClass"
    @click="$emit('click', $event)"
  >
    <i v-if="loading" class="ri-loader-4-line animate-spin text-sm" />
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SBtn' });

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'danger' | 'ghost';
    disabled?: boolean;
    loading?: boolean;
  }>(),
  {
    variant: 'default',
    disabled: false,
    loading: false
  }
);

defineEmits<{ click: [event: MouseEvent] }>();

const variantClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-naiwa-glow';
    case 'danger':
      return 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300';
    case 'ghost':
      return 'bg-transparent text-slate-500 hover:bg-sky-50 dark:text-slate-400 dark:hover:bg-slate-800';
    default:
      return 'bg-sky-50 text-slate-700 hover:bg-sky-100 border border-sky-100/80 dark:bg-slate-700/70 dark:text-slate-200 dark:border-white/10';
  }
});
</script>
