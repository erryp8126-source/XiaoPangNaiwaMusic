<template>
  <div
    class="eq-control p-4 md:p-6 rounded-2xl w-full max-w-[700px]"
    :class="
      darkPanel
        ? 'bg-slate-800/80 border border-slate-700/80 text-slate-100'
        : 'bg-sky-50/70 dark:bg-slate-900/90 text-gray-800 dark:text-gray-200'
    "
  >
    <div class="eq-header flex justify-between items-center gap-2 mb-4">
      <div class="flex items-center gap-2 min-w-0">
        <h3
          class="text-base md:text-lg font-semibold truncate"
          :class="darkPanel ? 'text-white' : 'text-gray-800 dark:text-gray-200'"
        >
          {{ t('player.eq.title') }}
        </h3>
        <n-tag type="warning" size="small" round v-if="!isNative">
          桌面版/安卓版可用
        </n-tag>
      </div>
      <div class="eq-controls flex items-center gap-2.5 flex-shrink-0">
        <button
          type="button"
          @click="handleReset"
          class="px-2.5 py-1 rounded-full text-xs font-medium transition-all active:scale-95 border"
          :class="
            darkPanel
              ? 'bg-slate-700/90 border-slate-600 text-slate-200 hover:bg-slate-600'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
          "
        >
          重置
        </button>
        <n-switch v-model:value="isEnabled" @update:value="toggleEQ">
          <template #checked>{{ t('player.eq.on') }}</template>
          <template #unchecked>{{ t('player.eq.off') }}</template>
        </n-switch>
      </div>
    </div>

    <!-- 预设标签（移动端直接横向滚动，点击即生效） -->
    <div class="eq-presets mb-3 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
      <button
        v-for="preset in presetOptions"
        :key="preset.value"
        type="button"
        @click="applyPreset(preset.value)"
        class="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all active:scale-95 border"
        :class="
          currentPreset === preset.value
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 border-amber-400/60 text-white shadow-sm shadow-amber-500/30'
            : darkPanel
              ? 'bg-slate-900/80 border-slate-700 text-slate-300 hover:bg-slate-700'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
        "
      >
        {{ preset.label }}
      </button>
    </div>

    <!-- 10 段滑块（每段固定宽度，窄屏可流畅左右滑动） -->
    <div
      class="eq-sliders flex items-end gap-1.5 rounded-2xl p-3 h-[280px] overflow-x-auto"
      :class="
        darkPanel
          ? 'bg-slate-900/90 border border-slate-700/70'
          : 'bg-white/90 dark:bg-gray-800 border border-slate-200/80 dark:border-slate-700/60'
      "
    >
      <div
        v-for="freq in frequencies"
        :key="freq"
        class="eq-slider flex flex-col items-center flex-shrink-0 w-[46px] h-full"
      >
        <div
          class="freq-label text-[11px] font-semibold text-center whitespace-nowrap my-1 h-4"
          :class="darkPanel ? 'text-slate-300' : 'text-gray-600 dark:text-gray-300'"
        >
          {{ formatFreq(freq) }}
        </div>
        <n-slider
          v-model:value="eqValues[freq.toString()]"
          :min="-12"
          :max="12"
          :step="0.5"
          vertical
          :disabled="!isEnabled"
          @update:value="updateEQ(freq.toString(), $event)"
          class="flex-1 my-2 min-h-[168px]"
        />
        <div
          class="gain-value text-[11px] font-mono text-center whitespace-nowrap my-1 h-4"
          :class="
            isEnabled
              ? darkPanel
                ? 'text-amber-300'
                : 'text-amber-600 dark:text-amber-300'
              : 'text-slate-500'
          "
        >
          {{ formatGain(eqValues[freq.toString()]) }}
        </div>
      </div>
    </div>

    <p
      class="text-[11px] mt-2.5 text-center"
      :class="darkPanel ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'"
    >
      {{ isEnabled ? '左右滑动可调节全部 10 个频段（±12 dB）' : '开启上方开关或点选预设音效即可实时调音' }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { audioService } from '@/services/audioService';
import { isNative } from '@/utils';

withDefaults(
  defineProps<{
    darkPanel?: boolean;
  }>(),
  {
    darkPanel: false
  }
);

const emit = defineEmits<{
  (e: 'change-enabled', enabled: boolean): void;
}>();

const { t } = useI18n();

const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const eqValues = ref<{ [key: string]: number }>({});
const isEnabled = ref(audioService.isEQEnabled());
const currentPreset = ref(audioService.getCurrentPreset() || 'flat');

// 预设配置
const presets = {
  flat: {
    label: t('player.eq.presets.flat'),
    values: Object.fromEntries(frequencies.map((f) => [f, 0]))
  },
  pop: {
    label: t('player.eq.presets.pop'),
    values: {
      31: -1.5,
      62: 3.5,
      125: 5.5,
      250: 3.5,
      500: -0.5,
      1000: -1.5,
      2000: 1.5,
      4000: 2.5,
      8000: 2.5,
      16000: 2.5
    }
  },
  rock: {
    label: t('player.eq.presets.rock'),
    values: {
      31: 4.5,
      62: 3.5,
      125: 2,
      250: 0.5,
      500: -0.5,
      1000: -1,
      2000: 0.5,
      4000: 2,
      8000: 2.5,
      16000: 3.5
    }
  },
  classical: {
    label: t('player.eq.presets.classical'),
    values: {
      31: 3.5,
      62: 3,
      125: 2.5,
      250: 1.5,
      500: -0.5,
      1000: -1.5,
      2000: -1.5,
      4000: 0.5,
      8000: 2,
      16000: 3
    }
  },
  jazz: {
    label: t('player.eq.presets.jazz'),
    values: {
      31: 3,
      62: 2,
      125: 1.5,
      250: 2,
      500: -1,
      1000: -1.5,
      2000: -0.5,
      4000: 1,
      8000: 2.5,
      16000: 3
    }
  },
  hiphop: {
    label: t('player.eq.presets.hiphop'),
    values: {
      31: 5,
      62: 4.5,
      125: 3,
      250: 1.5,
      500: -0.5,
      1000: -1,
      2000: 0.5,
      4000: 1.5,
      8000: 2,
      16000: 2.5
    }
  },
  vocal: {
    label: t('player.eq.presets.vocal'),
    values: {
      31: -2,
      62: -1.5,
      125: -1,
      250: 0.5,
      500: 2,
      1000: 3.5,
      2000: 3,
      4000: 1.5,
      8000: 0.5,
      16000: 0
    }
  },
  dance: {
    label: t('player.eq.presets.dance'),
    values: {
      31: 4,
      62: 3.5,
      125: 2.5,
      250: 1,
      500: 0,
      1000: -0.5,
      2000: 1.5,
      4000: 2.5,
      8000: 3,
      16000: 2.5
    }
  },
  acoustic: {
    label: t('player.eq.presets.acoustic'),
    values: {
      31: 2,
      62: 1.5,
      125: 1,
      250: 1.5,
      500: 2,
      1000: 1.5,
      2000: 2,
      4000: 2.5,
      8000: 2,
      16000: 1.5
    }
  }
};

const presetOptions = Object.entries(presets).map(([value, preset]) => ({
  label: preset.label,
  value
}));

const toggleEQ = (enabled: boolean) => {
  isEnabled.value = enabled;
  audioService.setEQEnabled(enabled);
  emit('change-enabled', enabled);
};

const handleReset = () => {
  audioService.resetEQ();
  currentPreset.value = 'flat';
  audioService.setCurrentPreset('flat');
  eqValues.value = Object.fromEntries(frequencies.map((f) => [f.toString(), 0]));
};

const applyPreset = (presetName: string) => {
  // 点击非平坦预设时自动开启 EQ，让调音效果立刻生效
  if (presetName !== 'flat' && !isEnabled.value) {
    isEnabled.value = true;
    audioService.setEQEnabled(true);
    emit('change-enabled', true);
  }
  currentPreset.value = presetName;
  audioService.setCurrentPreset(presetName);
  const preset = presets[presetName as keyof typeof presets];
  if (preset) {
    Object.entries(preset.values).forEach(([freq, gain]) => {
      updateEQ(freq, gain);
    });
  }
};

onMounted(() => {
  const settings = audioService.getAllEQSettings();
  eqValues.value = settings;
  isEnabled.value = audioService.isEQEnabled();

  const savedPreset = audioService.getCurrentPreset();
  if (savedPreset && presets[savedPreset as keyof typeof presets]) {
    currentPreset.value = savedPreset;
  }
});

const updateEQ = (frequency: string, gain: number) => {
  audioService.setEQFrequencyGain(frequency, gain);
  eqValues.value = {
    ...eqValues.value,
    [frequency]: gain
  };

  const currentValues = eqValues.value;
  let matchedPreset: string | null = null;

  Object.entries(presets).forEach(([presetName, preset]) => {
    const isMatch = Object.entries(preset.values).every(
      ([freq, value]) => Math.abs((currentValues[freq] ?? 0) - value) < 0.1
    );
    if (isMatch) {
      matchedPreset = presetName;
    }
  });

  if (matchedPreset !== null) {
    currentPreset.value = matchedPreset;
    audioService.setCurrentPreset(matchedPreset);
  } else if (currentPreset.value !== 'custom') {
    currentPreset.value = 'custom';
    audioService.setCurrentPreset('custom');
  }
};

const formatFreq = (freq: number) => {
  if (freq >= 1000) {
    return `${freq / 1000}k`;
  }
  return `${freq}`;
};

const formatGain = (gain?: number) => {
  const val = Number(gain || 0);
  if (val > 0) return `+${val}`;
  return `${val}`;
};
</script>

<style lang="scss" scoped>
.no-scrollbar {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

:deep(.n-slider) {
  --n-rail-height: 4px;
  --n-rail-width-vertical: 5px;
  --n-rail-color: rgba(148, 163, 184, 0.35);
  --n-rail-color-hover: rgba(148, 163, 184, 0.5);
  --n-fill-color: #f59e0b;
  --n-fill-color-hover: #e89200;
  --n-handle-color: #f59e0b;
  --n-handle-size: 16px;
  --n-handle-box-shadow: 0 2px 6px rgba(232, 146, 0, 0.35);

  .n-slider-handle {
    transition: transform 0.15s ease;
    &:active {
      transform: scale(1.25);
    }
  }
}
</style>
