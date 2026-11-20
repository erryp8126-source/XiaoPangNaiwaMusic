<template>
  <div class="relative inline-block" :class="widthClass" ref="wrapperRef">
    <button
      type="button"
      :disabled="disabled"
      class="flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all duration-200 select-none disabled:opacity-50 disabled:cursor-not-allowed"
      :class="
        isOpen
          ? 'border-amber-500 bg-white dark:bg-slate-800 ring-2 ring-amber-500/20'
          : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500'
      "
      @click="toggle"
    >
      <span
        class="truncate"
        :class="selectedLabel ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-400'"
      >
        {{ selectedLabel || placeholder }}
      </span>
      <i
        class="ri-arrow-down-s-line text-base text-slate-500 dark:text-slate-300 transition-transform duration-200 flex-shrink-0"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[99998]"
        @click="isOpen = false"
      ></div>
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 -translate-y-1 scale-[0.98]"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 -translate-y-1 scale-[0.98]"
      >
        <div
          v-if="isOpen"
          ref="dropdownRef"
          :style="dropdownStyle"
          class="fixed z-[99999] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-[#1E293B]"
        >
          <div class="max-h-[260px] overflow-y-auto py-1.5">
            <div
              v-for="opt in options"
              :key="String(opt.value)"
              class="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-sm transition-colors"
              :class="
                opt.value === modelValue
                  ? 'bg-amber-50 text-amber-800 font-bold dark:bg-amber-500/20 dark:text-amber-300'
                  : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700/70'
              "
              @click="select(opt.value)"
            >
              <span class="truncate flex-1">{{ opt.label }}</span>
              <i
                v-if="opt.value === modelValue"
                class="ri-check-line text-amber-600 dark:text-amber-300 text-base flex-shrink-0"
              />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

defineOptions({ name: 'SSelect' });

type OptionValue = string | number | boolean;

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue;
    options?: { label: string; value: OptionValue }[];
    placeholder?: string;
    disabled?: boolean;
    width?: string;
  }>(),
  {
    modelValue: undefined,
    options: () => [],
    placeholder: '',
    disabled: false,
    width: 'w-40'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: OptionValue];
}>();

const isOpen = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

const widthClass = computed(() => props.width);

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue);
  return opt?.label ?? '';
});

const updateDropdownPosition = () => {
  if (!wrapperRef.value) return;
  const rect = wrapperRef.value.getBoundingClientRect();
  const menuWidth = Math.max(rect.width, 180);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12));
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 240 && rect.top > 240) {
    dropdownStyle.value = {
      left: `${left}px`,
      width: `${menuWidth}px`,
      bottom: `${window.innerHeight - rect.top + 6}px`
    };
  } else {
    dropdownStyle.value = {
      left: `${left}px`,
      width: `${menuWidth}px`,
      top: `${rect.bottom + 6}px`
    };
  }
};

const toggle = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    updateDropdownPosition();
  }
};

const select = (value: OptionValue) => {
  emit('update:modelValue', value);
  isOpen.value = false;
};

const handleScrollOrResize = () => {
  if (isOpen.value) {
    updateDropdownPosition();
  }
};

onMounted(() => {
  window.addEventListener('resize', handleScrollOrResize);
  window.addEventListener('scroll', handleScrollOrResize, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleScrollOrResize);
  window.removeEventListener('scroll', handleScrollOrResize, true);
});
</script>
