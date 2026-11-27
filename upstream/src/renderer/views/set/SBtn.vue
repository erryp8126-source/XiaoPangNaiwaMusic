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
      return 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-sm shadow-amber-600/25 hover:brightness-105';
    case 'danger':
      return 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/70';
    case 'ghost':
      return 'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-[#1C1C22]';
    default:
      return 'bg-slate-100 text-slate-800 border border-slate-200/90 hover:bg-slate-200/80 dark:bg-[#1C1C22] dark:text-zinc-100 dark:border-white/[0.08]';
  }
});
</script>
