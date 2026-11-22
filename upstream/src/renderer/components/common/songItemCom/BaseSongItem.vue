<template>
  <div
    class="song-item"
    @contextmenu.prevent="handleContextMenu"
    @touchstart.passive="handleLongPressTouchStart"
    @touchmove.passive="handleLongPressTouchMove"
    @touchend="handleLongPressTouchEnd"
    @touchcancel="handleLongPressTouchEnd"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @dblclick.stop="handleDirectPlay"
  >
    <slot name="index"></slot>
    <slot name="select" v-if="selectable"></slot>
    <slot name="image"></slot>
    <slot name="content"></slot>
    <slot name="operating"></slot>

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
      @play="handleDirectPlay"
      @play-next="handlePlayNext"
      @download="downloadMusic(item)"
      @download-lyric="downloadLyric(item)"
      @toggle-favorite="toggleFavorite"
      @toggle-dislike="toggleDislike"
      @remove="$emit('remove-song', $event)"
    />
  </div>
</template>

<script lang="ts" setup>
import { useSongItem } from '@/hooks/useSongItem';
import type { SongResult } from '@/types/music';
import { isNative } from '@/utils';

import SongItemDropdown from './SongItemDropdown.vue';

const props = defineProps<{
  item: SongResult;
  selectable?: boolean;
  selected?: boolean;
  canRemove?: boolean;
  isNext?: boolean;
  index?: number;
}>();

const emits = defineEmits(['play', 'select', 'remove-song']);

// 使用公共逻辑
const {
  playLoading,
  isPlaying,
  isFavorite,
  isDislike,
  artists,
  showDropdown,
  dropdownX,
  dropdownY,
  isHovering,
  handleImageLoad,
  playMusicEvent,
  toggleFavorite,
  toggleDislike,
  handlePlayNext,
  handleContextMenu,
  handleMenuClick,
  handleLongPressTouchStart,
  handleLongPressTouchMove,
  handleLongPressTouchEnd,
  handleArtistClick,
  handleMouseEnter,
  handleMouseLeave,
  downloadMusic,
  downloadLyric
} = useSongItem(props);

// 处理图片加载
const imageLoad = async (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (!target) return;
  await handleImageLoad(target);
};

// 切换选择状态
const toggleSelect = () => {
  emits('select', props.item.id, !props.selected);
};

// 双击或右键菜单播放：先通知父组件更新播放列表上下文，再开始播放
const handleDirectPlay = () => {
  emits('play', props.item);
  playMusicEvent(props.item);
};

// 把图片处理、艺术家处理等公共方法暴露给子组件
defineExpose({
  imageLoad,
  toggleSelect,
  handleArtistClick,
  handleMenuClick,
  playMusicEvent,
  toggleFavorite,
  handlePlayNext,
  playLoading,
  isPlaying,
  isFavorite,
  isDislike,
  artists,
  isHovering
});
</script>

<style lang="scss" scoped>
.song-item {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  @apply rounded-xl p-3 flex items-center transition bg-transparent dark:text-white text-gray-900;
}

.text-ellipsis {
  width: 100%;
}
</style>
