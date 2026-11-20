<template>
  <div class="inline-flex items-center gap-1" :class="widthClass">
    <button
      v-if="type === 'number' && showButtons"
      type="button"
      class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
      :disabled="disabled || atMin"
      @click="decrement"
    >
      <i class="ri-subtract-line text-sm" />
    </button>

    <div class="relative flex-1 min-w-0">
      <input
        ref="inputRef"
        :type="type === 'number' ? 'text' : type"
        :value="displayValue"
        :placeholder="placeholder"
        :disabled="disabled"
        inputmode="decimal"
        class="w-full rounded-xl border border-slate-300 bg-slate-50 py-2 pl-3 text-sm font-medium text-slate-900 transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400 dark:focus:bg-slate-900"
        :class="[type === 'number' && !suffix ? 'text-center pr-3' : '', suffix ? 'pr-10' : 'pr-3']"
        @input="handleInput"
        @blur="handleBlur"
        @keydown="handleKeydown"
      />
      <span
        v-if="suffix"
        class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-400"
      >
        {{ suffix }}
      </span>
    </div>

    <button
      v-if="type === 'number' && showButtons"
      type="button"
      class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
      :disabled="disabled || atMax"
      @click="increment"
    >
      <i class="ri-add-line text-sm" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

defineOptions({ name: 'SInput' });

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    type?: 'text' | 'number';
    placeholder?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    showButtons?: boolean;
    width?: string;
  }>(),
  {
    modelValue: '',
    type: 'text',
    placeholder: '',
    disabled: false,
    min: -Infinity,
    max: Infinity,
    step: 1,
    suffix: '',
    showButtons: true,
    width: ''
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  blur: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

const numericValue = computed(() => {
  const n = Number(props.modelValue);
  return Number.isFinite(n) ? n : 0;
});

const displayValue = computed(() => {
  if (props.type === 'number') {
    return String(props.modelValue ?? '');
  }
  return String(props.modelValue ?? '');
});

const atMin = computed(() => numericValue.value <= props.min);
const atMax = computed(() => numericValue.value >= props.max);

const widthClass = computed(() => props.width);

const clamp = (n: number) => Math.min(props.max, Math.max(props.min, n));

const handleInput = (e: Event) => {
  const val = (e.target as HTMLInputElement).value;
  if (props.type === 'text') {
    emit('update:modelValue', val);
    return;
  }
  if (val === '' || val === '-') {
    emit('update:modelValue', val as unknown as number);
    return;
  }
  const n = Number(val);
  if (!Number.isNaN(n)) {
    emit('update:modelValue', n);
  }
};

const handleBlur = () => {
  if (props.type === 'number') {
    const clamped = clamp(numericValue.value);
    emit('update:modelValue', clamped);
  }
  emit('blur');
};

const increment = () => {
  emit('update:modelValue', clamp(numericValue.value + props.step));
};

const decrement = () => {
  emit('update:modelValue', clamp(numericValue.value - props.step));
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.type !== 'number') return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    increment();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    decrement();
  }
};
</script>
