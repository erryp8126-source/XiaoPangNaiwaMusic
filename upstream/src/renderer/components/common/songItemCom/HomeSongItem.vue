<template>
  <div
    class="home-song-card group flex cursor-pointer items-center gap-3 md:gap-4 rounded-2xl p-2.5 transition-all duration-200 active:scale-[0.985]"
    :class="[
      isPlaying
        ? 'bg-amber-50/95 dark:bg-amber-500/15 ring-1 ring-amber-300/70 dark:ring-amber-400/30 shadow-sm'
        : 'bg-white/85 dark:bg-[#131316] ring-1 ring-sky-100/80 dark:ring-white/[0.08] hover:bg-white dark:hover:bg-[#1C1C22] shadow-naiwa-sm',
      { 'is-offline-unavailable': isOfflineUnavailable }
    ]"
    @click="onPlayMusic"
    @contextmenu.prevent="handleContextMenu"
    @touchstart.passive="handleLongPressTouchStart"
    @touchmove.passive="handleLongPressTouchMove"
    @touchend="handleLongPressTouchEnd"
    @touchcancel="handleLongPressTouchEnd"
  >
    <!-- Album Cover -->
    <div
      class="cover relative h-[52px] w-[52px] md:h-14 md:w-14 flex-shrink-0 overflow-hidden rounded-xl bg-sky-100/70 dark:bg-slate-800 shadow-sm"
    >
      <n-image
        v-if="item.picUrl"
        :src="getImgUrl(item.picUrl, '200y200')"
        class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        preview-disabled
        :img-props="{
          crossorigin: 'anonymous',
          loading: 'lazy',
          alt: item.name
        }"
      />
      <div
        class="absolute inset-0 flex items-center justify-center bg-slate-900/25 transition-opacity duration-200"
        :class="isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      >
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md"
          style="background: linear-gradient(135deg, #ffd147 0%, #f09000 100%)"
        >
          <i :class="isPlaying ? 'ri-volume-up-fill text-xs' : 'ri-play-fill text-sm ml-0.5'"></i>
        </span>
      </div>
    </div>

    <!-- Song Info -->
    <div class="song-info flex flex-col overflow-hidden flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <n-ellipsis
          class="song-name text-[14.5px] md:text-base font-bold transition-colors duration-200"
          :class="isPlaying ? 'text-primary' : 'text-slate-800 dark:text-slate-100 group-hover:text-primary'"
        >
          {{ item.name }}
        </n-ellipsis>
        <track-origin-tag :song="item" :show-online="showOrigin || isOffline" />
      </div>
      <n-ellipsis
        class="artist-name text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5"
      >
        <template v-for="(artist, index) in artists" :key="index">
          <span class="cursor-pointer hover:text-primary" @click.stop="onArtistClick(artist.id)">
            {{ artist.name }}
          </span>
          <span v-if="index < artists.length - 1"> / </span>
        </template>
      </n-ellipsis>
    </div>

    <!-- More Button -->
    <button
      type="button"
      class="more-btn flex h-8 w-8 items-center justify-center rounded-full bg-sky-50/80 dark:bg-white/5 text-slate-500 dark:text-slate-300 transition-all duration-200 active:scale-90"
      @click.stop="onMenuClick"
    >
      <i class="ri-more-fill text-base"></i>
    </button>

    <!-- Dropdown Menu -->
    <song-item-dropdown
      v-if="isNative"
      :item="item"
      :show="showDropdown"
      :x="dropdownX"
      :y="dropdownY"
      :is-favorite="isFavorite"
      :is-dislike="isDislike"
      :can-remove="canRemove"
      @update:show="showDropdown = $event"
      @play="onPlayMusic"
      @play-next="handlePlayNext"
      @download="downloadMusic"
      @download-lyric="downloadLyric(item)"
      @toggle-favorite="toggleFavorite"
      @toggle-dislike="toggleDislike"
      @remove="$emit('remove-song', $event)"
    />
  </div>
</template>

<script lang="ts" setup>
import { NEllipsis, NImage } from 'naive-ui';

import TrackOriginTag from '@/components/common/TrackOriginTag.vue';
import { useSongItem } from '@/hooks/useSongItem';
import type { SongResult } from '@/types/music';
import { getImgUrl, isNative } from '@/utils';

import SongItemDropdown from './SongItemDropdown.vue';

const props = withDefaults(
  defineProps<{
    item: SongResult;
    favorite?: boolean;
    selectable?: boolean;
    selected?: boolean;
    canRemove?: boolean;
    isNext?: boolean;
    index?: number;
    showOrigin?: boolean;
  }>(),
  {
    favorite: true,
    selectable: false,
    selected: false,
    canRemove: false,
    isNext: false,
    index: undefined,
    showOrigin: false
  }
);

const emit = defineEmits(['play', 'select', 'remove-song']);

// 使用公共逻辑
const {
  isPlaying,
  isFavorite,
  isDislike,
  isOffline,
  isOfflineUnavailable,
  artists,
  showDropdown,
  dropdownX,
  dropdownY,
  playMusicEvent,
  toggleFavorite,
  toggleDislike,
  handlePlayNext,
  handleContextMenu,
  handleMenuClick,
  handleLongPressTouchStart,
  handleLongPressTouchMove,
  handleLongPressTouchEnd,
  consumeLongPressClickGuard,
  handleArtistClick,
  downloadMusic,
  downloadLyric
} = useSongItem(props);

const onPlayMusic = () => {
  if (consumeLongPressClickGuard()) return;
  emit('play', props.item);
  playMusicEvent(props.item);
};

const onArtistClick = (id: number) => handleArtistClick(id);
const onMenuClick = (event: MouseEvent) => handleMenuClick(event);
</script>

<style lang="scss" scoped>
.home-song-card {
  &.is-offline-unavailable {
    opacity: 0.46;

    :deep(img) {
      filter: grayscale(0.35);
    }
  }
}
</style>
