<template>
  <base-song-item
    :item="item"
    :selectable="selectable"
    :selected="selected"
    :can-remove="canRemove"
    :is-next="isNext"
    :index="index"
    @play="(...args) => $emit('play', ...args)"
    @select="(...args) => $emit('select', ...args)"
    @remove-song="(...args) => $emit('remove-song', ...args)"
    class="standard-song-item"
    :class="{ 'is-playing-row': isPlaying }"
    ref="baseItem"
  >
    <!-- 选择框插槽 -->
    <template #select>
      <div v-if="baseItem && selectable" class="song-item-select" @click.stop="onToggleSelect">
        <n-checkbox :checked="selected" />
      </div>
    </template>

    <!-- 图片插槽 -->
    <template #image>
      <n-image
        v-if="item.picUrl"
        :src="getImgUrl(item.picUrl, '100y100')"
        class="song-item-img"
        preview-disabled
        :img-props="{
          crossorigin: 'anonymous'
        }"
        @load="onImageLoad"
      />
    </template>

    <!-- 内容插槽 -->
    <template #content>
      <div class="song-item-content">
        <div class="song-item-content-title">
          <n-ellipsis
            class="text-ellipsis"
            line-clamp="1"
            :class="{ 'text-primary font-bold': isPlaying }"
            >{{ item.name }}</n-ellipsis
          >
        </div>
        <div class="song-item-content-name">
          <n-ellipsis class="text-ellipsis" line-clamp="1">
            <template v-for="(artist, index) in artists" :key="index">
              <span
                class="cursor-pointer hover:text-primary"
                @click.stop="onArtistClick(artist.id)"
                >{{ artist.name }}</span
              >
              <span v-if="index < artists.length - 1"> / </span>
            </template>
          </n-ellipsis>
        </div>
      </div>
    </template>

    <!-- 操作插槽 -->
    <template #operating>
      <div class="song-item-operating">
        <div v-if="favorite" class="song-item-operating-like" @click.stop="onToggleFavorite">
          <i
            class="iconfont icon-likefill"
            :class="{ 'like-active': isFavorite }"
          ></i>
        </div>
        <n-tooltip v-if="isNext" trigger="hover" :z-index="9999999" :delay="400">
          <template #trigger>
            <div class="song-item-operating-next" @click.stop="onPlayNext">
              <i class="iconfont ri-skip-forward-fill"></i>
            </div>
          </template>
          {{ t('songItem.menu.playNext') }}
        </n-tooltip>
        <div
          class="song-item-operating-play animate__animated"
          :class="{ 'is-playing-btn': isPlaying, animate__flipInY: playLoading }"
          @click.stop="onPlayMusic"
        >
          <i v-if="isPlaying && play" class="ri-pause-fill text-base"></i>
          <i v-else class="ri-play-fill text-base ml-0.5"></i>
        </div>
      </div>
    </template>
  </base-song-item>
</template>

<script lang="ts" setup>
import { NCheckbox, NEllipsis, NImage, NTooltip } from 'naive-ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePlayerStore } from '@/store';
import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';

import BaseSongItem from './BaseSongItem.vue';

const { t } = useI18n();
const playerStore = usePlayerStore();

const props = withDefaults(
  defineProps<{
    item: SongResult;
    favorite?: boolean;
    selectable?: boolean;
    selected?: boolean;
    canRemove?: boolean;
    isNext?: boolean;
    index?: number;
  }>(),
  {
    favorite: true,
    selectable: false,
    selected: false,
    canRemove: false,
    isNext: false,
    index: undefined
  }
);

const emit = defineEmits(['play', 'select', 'remove-song']);
const baseItem = ref<InstanceType<typeof BaseSongItem>>();

// 从playerStore和baseItem获取响应式状态
const play = computed(() => playerStore.isPlay);
const isPlaying = computed(() => baseItem.value?.isPlaying || false);
const playLoading = computed(() => baseItem.value?.playLoading || false);
const isFavorite = computed(() => baseItem.value?.isFavorite || false);
const artists = computed(() => baseItem.value?.artists || []);

// 包装方法，避免直接访问可能为undefined的ref
const onToggleSelect = () => {
  baseItem.value?.toggleSelect();
};
const onImageLoad = (event: Event) => baseItem.value?.imageLoad(event);
const onArtistClick = (id: number) => baseItem.value?.handleArtistClick(id);
const onToggleFavorite = (event: Event) => {
  baseItem.value?.toggleFavorite(event);
};
const onPlayMusic = () => {
  emit('play', props.item);
  baseItem.value?.playMusicEvent(props.item);
};
const onPlayNext = () => {
  baseItem.value?.handlePlayNext();
};
</script>

<style lang="scss" scoped>
.standard-song-item {
  border-radius: 18px;
  padding: 8px 10px;
  transition: background-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.72);
  }

  &.is-playing-row {
    background: rgba(255, 248, 225, 0.88);
    box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.25);
  }

  .song-item-img {
    @apply w-12 h-12 rounded-[14px] mr-3.5 shadow-sm;
  }

  .song-item-content {
    @apply flex-1 min-w-0;

    &-title {
      @apply text-[14.5px] font-semibold text-slate-800 dark:text-slate-100;
    }

    &-name {
      @apply text-xs text-slate-500 dark:text-slate-400 mt-0.5;
    }
  }

  .song-item-operating {
    @apply flex items-center gap-1.5 ml-2.5 flex-shrink-0;

    .iconfont {
      @apply text-lg;
    }

    .icon-likefill {
      @apply text-lg transition text-slate-400 dark:text-slate-500 hover:text-rose-500;
    }

    &-like,
    &-next {
      @apply w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-90;
    }

    &-next .iconfont {
      @apply text-lg transition text-slate-400 dark:text-slate-400 hover:text-primary;
    }

    .like-active {
      @apply text-rose-500 dark:text-rose-400;
    }

    &-play {
      @apply cursor-pointer rounded-full w-9 h-9 flex justify-center items-center transition-all active:scale-90;
      background: rgba(232, 243, 251, 0.9);
      color: #475569;

      &:hover,
      &.is-playing-btn {
        background: linear-gradient(135deg, #ffd147 0%, #eb8f00 100%);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(232, 146, 0, 0.32);
      }
    }
  }

  .song-item-select {
    @apply mr-3 cursor-pointer;
  }
}

:global(.dark) .standard-song-item {
  &:hover {
    background: rgba(30, 41, 59, 0.55);
  }

  &.is-playing-row {
    background: rgba(255, 197, 51, 0.12);
    box-shadow: inset 0 0 0 1px rgba(255, 197, 51, 0.25);
  }

  .song-item-operating-play {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;

    &:hover,
    &.is-playing-btn {
      background: linear-gradient(135deg, #ffd147 0%, #eb8f00 100%);
      color: #ffffff;
    }
  }
}
</style>
