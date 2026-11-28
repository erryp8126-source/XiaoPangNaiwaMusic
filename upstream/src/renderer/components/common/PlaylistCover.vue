<template>
  <div class="relative w-full h-full overflow-hidden">
    <!-- 无封面 / 已知纯灰占位图 / 加载中 / 加载失败：展示主题适配的 3D 耳机云境兜底封面 -->
    <div
      v-if="!loaded || hasError || !resolvedSrc"
      class="absolute inset-0 bg-gradient-to-br from-sky-100 via-amber-50 to-orange-100 dark:from-[#161922] dark:via-[#12141a] dark:to-[#1a1816] select-none"
      aria-hidden="true"
    >
      <img
        :src="defaultCoverLight"
        alt=""
        decoding="async"
        class="block dark:hidden w-full h-full object-cover"
        :class="imgClass"
      />
      <img
        :src="defaultCoverDark"
        alt=""
        decoding="async"
        class="hidden dark:block w-full h-full object-cover"
        :class="imgClass"
      />
    </div>

    <img
      v-if="resolvedSrc && !hasError"
      :src="resolvedSrc"
      :alt="alt"
      :crossorigin="crossorigin || undefined"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="relative z-[1] w-full h-full object-cover transition-opacity duration-300"
      :class="[imgClass, loaded ? 'opacity-100' : 'opacity-0']"
      @load="handleLoad"
      @error="handleError"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import defaultCoverDark from '@/assets/playlist-cover-dark.jpg';
import defaultCoverLight from '@/assets/playlist-cover-light.jpg';
import { getImgUrl } from '@/utils';
import { isKnownBlankCoverUrl } from '@/utils/imageUrl';

const props = withDefaults(
  defineProps<{
    src?: string;
    size?: string;
    alt?: string;
    seed?: string | number;
    imgClass?: string;
    compact?: boolean;
    crossorigin?: 'anonymous' | 'use-credentials' | '';
  }>(),
  {
    src: '',
    size: '400y400',
    alt: '',
    seed: '',
    imgClass: '',
    compact: false,
    crossorigin: ''
  }
);

const emit = defineEmits<{
  (e: 'load', img: HTMLImageElement): void;
}>();

const resolvedSrc = computed(() => {
  if (isKnownBlankCoverUrl(props.src)) return '';
  return getImgUrl(props.src, props.size);
});

const loaded = ref(false);
const hasError = ref(false);

watch(resolvedSrc, () => {
  loaded.value = false;
  hasError.value = false;
});

const handleLoad = (e: Event) => {
  const img = e.target as HTMLImageElement | null;
  if (!img || img.naturalWidth === 0) {
    hasError.value = true;
    loaded.value = false;
    return;
  }
  loaded.value = true;
  emit('load', img);
};

const handleError = () => {
  hasError.value = true;
  loaded.value = false;
};
</script>
