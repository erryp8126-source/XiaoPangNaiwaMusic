<template>
  <!-- 透明遮罩层，点击任意位置关闭 -->
  <div v-if="internalVisible" class="fixed-overlay" @click="closePanel"></div>

  <!-- 使用animate.css进行动画效果 -->
  <div
    v-if="internalVisible"
    class="playlist-panel"
    :class="[
      'animate__animated',
      closing
        ? isMobile
          ? 'animate__slideOutDown'
          : 'animate__slideOutRight'
        : isMobile
          ? 'animate__slideInUp'
          : 'animate__slideInRight'
    ]"
    @animationend="onAnimationEnd"
  >
    <div class="playlist-panel-header">
      <div class="drag-pill" v-if="isMobile"></div>
      <div class="header-row">
        <div class="title-wrap">
          <div class="title">{{ t('player.playBar.playList') }}</div>
          <span class="count-pill">{{ playList.length }}</span>
        </div>
        <div class="header-actions">
          <button
            v-if="playList.length > 0"
            type="button"
            class="save-playlist-pill"
            @click="openSavePlaylistBox"
          >
            <i class="ri-play-list-add-line"></i>
            <span>存为歌单</span>
          </button>
          <n-tooltip trigger="hover">
            <template #trigger>
              <div class="action-btn" @click="handleClearPlaylist">
                <i class="iconfont ri-delete-bin-line"></i>
              </div>
            </template>
            {{ t('player.playList.clearAll') }}
          </n-tooltip>
          <div class="close-btn" @click="closePanel">
            <i class="iconfont ri-close-line"></i>
          </div>
        </div>
      </div>

      <!-- 一键保存当前队列为自建歌单输入条 -->
      <div v-if="showSavePlaylistInput" class="save-playlist-bar">
        <input
          v-model="savePlaylistName"
          type="text"
          maxlength="40"
          placeholder="输入新歌单名称..."
          class="save-playlist-input"
          @keyup.enter="confirmSavePlaylist"
        />
        <button type="button" class="save-confirm-btn" @click="confirmSavePlaylist">保存</button>
        <button type="button" class="save-cancel-btn" @click="showSavePlaylistInput = false">取消</button>
      </div>

      <!-- 下一首播放预览与音源来源 -->
      <div v-if="nextSongPreview" class="next-up-bar">
        <span class="next-up-label">下一首</span>
        <span class="next-up-name truncate">{{ nextSongPreview.name }}</span>
        <span class="next-up-source">{{ nextSongPreview.sourceLabel }}</span>
      </div>
    </div>
    <div class="playlist-panel-content">
      <div v-if="playList.length === 0" class="empty-playlist">
        <i class="iconfont ri-music-2-line"></i>
        <p>{{ t('player.playList.empty') }}</p>
      </div>
      <n-virtual-list v-else ref="playListRef" :item-size="66" item-resizable :items="indexedPlayList">
        <template #default="{ item }">
          <div
            class="music-play-list-row"
            :class="{
              'is-dragging': draggingIndex === item.index,
              'is-drag-over': dragOverIndex === item.index && draggingIndex !== item.index
            }"
            draggable="true"
            @dragstart="onDragStart(item.index, $event)"
            @dragover.prevent="onDragOver(item.index)"
            @drop.prevent="onDrop(item.index)"
            @dragend="onDragEnd"
          >
            <!-- 左滑露出的移除底槽 -->
            <div
              class="swipe-remove-bg"
              :class="{ active: swipedItemId === String(item.song.id) }"
              @click.stop="handleDeleteSong(item.song)"
            >
              <i class="ri-delete-bin-line"></i>
              <span>移除</span>
            </div>

            <div
              class="music-play-list-content"
              :style="getSwipeRowStyle(item.song.id)"
              @touchstart="onRowTouchStart(item.song.id, $event)"
              @touchmove="onRowTouchMove(item.song.id, $event)"
              @touchend="onRowTouchEnd(item.song)"
            >
              <div class="flex items-center justify-between gap-1">
                <!-- 拖拽排序手柄（支持桌面拖拽与移动端按住上下拖动） -->
                <div
                  class="drag-handle"
                  title="拖动调整播放顺序"
                  @touchstart.stop="onGripTouchStart(item.index, $event)"
                  @touchmove.stop.prevent="onGripTouchMove($event)"
                  @touchend.stop="onGripTouchEnd"
                >
                  <i class="ri-draggable"></i>
                </div>
                <song-item :key="item.song.id" class="flex-1 min-w-0" :item="item.song" mini></song-item>
                <div class="delete-btn" @click.stop="handleDeleteSong(item.song)">
                  <i
                    class="iconfont ri-delete-bin-line text-gray-400 hover:text-red-500 transition-colors"
                  ></i>
                </div>
              </div>
            </div>
          </div>
        </template>
      </n-virtual-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDialog, useMessage } from 'naive-ui';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import SongItem from '@/components/common/SongItem.vue';
import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { usePlayerStore } from '@/store/modules/player';
import type { SongResult } from '@/types/music';
import { isMobile } from '@/utils';
import { triggerHaptic } from '@/utils/androidBridge';
import { inferPlaybackMetaFromUrl } from '@/utils/playbackMeta';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const playerStore = usePlayerStore();
const offlineStore = useOfflineAvailabilityStore();

// 内部状态控制组件的可见性
const internalVisible = ref(false);
const closing = ref(false);

// 当前是否显示播放列表面板
const show = computed({
  get: () => playerStore.playListDrawerVisible,
  set: (value) => {
    playerStore.setPlayListDrawerVisible(value);
  }
});

// 监听外部可见性变化
watch(
  show,
  (newValue) => {
    if (newValue) {
      // 打开面板
      internalVisible.value = true;
      closing.value = false;
      // 在下一个渲染周期后滚动到当前歌曲
      nextTick(() => {
        scrollToCurrentSong();
      });
    } else {
      // 如果已经是关闭状态，不需要处理
      if (!internalVisible.value) return;

      // 开始关闭动画，等 animationend 后再隐藏
      closing.value = true;
    }
  },
  { immediate: true }
);

// 播放列表
const playList = computed(() => playerStore.playList as SongResult[]);
const indexedPlayList = computed(() =>
  playList.value.map((song, index) => ({
    key: `${song.id}_${index}`,
    index,
    song
  }))
);

// 下一首预览与来源展示
const nextSongPreview = computed(() => {
  const list = playList.value;
  if (list.length <= 1) return null;
  const nextIdx = (playerStore.playListIndex + 1) % list.length;
  const next = list[nextIdx];
  if (!next) return null;

  const badge = offlineStore.getOfflineBadge(next);
  let sourceLabel =
    badge === 'downloaded'
      ? '已下载'
      : badge === 'local'
        ? '本地文件'
        : badge === 'cached'
          ? '已缓存'
          : '';
  if (!sourceLabel) {
    if (next.playMusicUrl || next.playbackMeta) {
      const meta = inferPlaybackMetaFromUrl(next.playMusicUrl, {
        isDownloaded: Boolean(next.isDownloadedTrack),
        existing: next.playbackMeta
      });
      sourceLabel = meta.sourceLabel;
    } else {
      sourceLabel = '在线待解析';
    }
  }
  return {
    name: next.name,
    sourceLabel
  };
});

// 一键保存队列为自建歌单
const showSavePlaylistInput = ref(false);
const savePlaylistName = ref('');
const openSavePlaylistBox = () => {
  const now = new Date();
  const stamp = `${now.getMonth() + 1}-${now.getDate()}`;
  savePlaylistName.value = `我的队列歌单 ${stamp}`;
  showSavePlaylistInput.value = !showSavePlaylistInput.value;
};
const confirmSavePlaylist = () => {
  const res = playerStore.saveCurrentQueueAsCustomPlaylist(savePlaylistName.value);
  if (res.ok) {
    triggerHaptic('success');
    message.success(`已保存为自建歌单「${savePlaylistName.value.trim()}」（共 ${res.count} 首）`);
    showSavePlaylistInput.value = false;
  } else {
    message.warning('请输入有效的歌单名称');
  }
};

// 拖拽排序（桌面 HTML5 拖拽 + 移动端拖拽手柄上下拖动）
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
let touchDragStartY = 0;
let touchDragOriginIndex = -1;

const onDragStart = (index: number, event: DragEvent) => {
  draggingIndex.value = index;
  dragOverIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
};

const onDragOver = (index: number) => {
  if (draggingIndex.value !== null) {
    dragOverIndex.value = index;
  }
};

const onDrop = (toIndex: number) => {
  if (draggingIndex.value !== null && draggingIndex.value !== toIndex) {
    playerStore.reorderPlayList(draggingIndex.value, toIndex);
    triggerHaptic('selection');
  }
  draggingIndex.value = null;
  dragOverIndex.value = null;
};

const onDragEnd = () => {
  draggingIndex.value = null;
  dragOverIndex.value = null;
};

const onGripTouchStart = (index: number, event: TouchEvent) => {
  if (!event.touches[0]) return;
  touchDragStartY = event.touches[0].clientY;
  touchDragOriginIndex = index;
  draggingIndex.value = index;
  dragOverIndex.value = index;
  triggerHaptic('light');
};

const onGripTouchMove = (event: TouchEvent) => {
  if (touchDragOriginIndex < 0 || !event.touches[0]) return;
  const deltaY = event.touches[0].clientY - touchDragStartY;
  const stepOffset = Math.round(deltaY / 66);
  const target = Math.max(0, Math.min(playList.value.length - 1, touchDragOriginIndex + stepOffset));
  if (target !== dragOverIndex.value) {
    dragOverIndex.value = target;
    triggerHaptic('selection');
  }
};

const onGripTouchEnd = () => {
  if (
    touchDragOriginIndex >= 0 &&
    dragOverIndex.value !== null &&
    dragOverIndex.value !== touchDragOriginIndex
  ) {
    playerStore.reorderPlayList(touchDragOriginIndex, dragOverIndex.value);
    triggerHaptic('medium');
  }
  touchDragOriginIndex = -1;
  draggingIndex.value = null;
  dragOverIndex.value = null;
};

// 左滑移除手势
const swipedItemId = ref<string | null>(null);
const activeSwipeOffset = ref<number>(0);
const activeSwipeId = ref<string | null>(null);
let swipeStartX = 0;
let swipeStartY = 0;
let swipeLockedHorizontal = false;

const getSwipeRowStyle = (id: string | number) => {
  const key = String(id);
  if (activeSwipeId.value === key && activeSwipeOffset.value < 0) {
    return { transform: `translateX(${activeSwipeOffset.value}px)`, transition: 'none' };
  }
  if (swipedItemId.value === key) {
    return { transform: 'translateX(-72px)', transition: 'transform 0.2s ease' };
  }
  return { transform: 'translateX(0px)', transition: 'transform 0.2s ease' };
};

const onRowTouchStart = (id: string | number, event: TouchEvent) => {
  if (!event.touches[0]) return;
  swipeStartX = event.touches[0].clientX;
  swipeStartY = event.touches[0].clientY;
  swipeLockedHorizontal = false;
  activeSwipeId.value = String(id);
  activeSwipeOffset.value = 0;
};

const onRowTouchMove = (id: string | number, event: TouchEvent) => {
  if (activeSwipeId.value !== String(id) || !event.touches[0]) return;
  const dx = event.touches[0].clientX - swipeStartX;
  const dy = event.touches[0].clientY - swipeStartY;
  if (!swipeLockedHorizontal) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      swipeLockedHorizontal = true;
    } else if (Math.abs(dy) > 12) {
      activeSwipeId.value = null;
      return;
    } else {
      return;
    }
  }
  if (dx < 0) {
    activeSwipeOffset.value = Math.max(-110, dx);
  } else {
    activeSwipeOffset.value = 0;
  }
};

const onRowTouchEnd = (song: SongResult) => {
  const key = String(song.id);
  if (activeSwipeId.value === key) {
    if (activeSwipeOffset.value <= -88) {
      activeSwipeId.value = null;
      activeSwipeOffset.value = 0;
      swipedItemId.value = null;
      triggerHaptic('medium');
      handleDeleteSong(song);
      return;
    }
    if (activeSwipeOffset.value <= -40) {
      swipedItemId.value = key;
      triggerHaptic('light');
    } else if (swipedItemId.value === key) {
      swipedItemId.value = null;
    }
  }
  activeSwipeId.value = null;
  activeSwipeOffset.value = 0;
};

// 播放列表引用
const playListRef = ref<any>(null);

// 关闭面板
const closePanel = () => {
  show.value = false;
};

// 动画结束后隐藏组件
const onAnimationEnd = () => {
  if (closing.value) {
    internalVisible.value = false;
  }
};

// 清空播放列表
const handleClearPlaylist = () => {
  if (playList.value.length === 0) {
    message.info(t('player.playList.alreadyEmpty'));
    return;
  }

  if (isMobile.value) {
    closePanel();
  }

  dialog.warning({
    title: t('player.playList.clearConfirmTitle'),
    content: t('player.playList.clearConfirmContent'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    style: { zIndex: 999999999 }, // 确保对话框显示在遮罩之上
    onPositiveClick: () => {
      // 清空播放列表
      playerStore.clearPlayAll();
      message.success(t('player.playList.cleared'));
    }
  });
};

// 处理键盘事件
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && internalVisible.value) {
    closePanel();
  }
};

// 添加和移除键盘事件监听
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// 滚动到当前播放歌曲
const scrollToCurrentSong = () => {
  // 延长等待时间，确保列表已渲染完成
  setTimeout(() => {
    if (playListRef.value && playList.value.length > 0) {
      const index = playerStore.playListIndex;
      console.log('滚动到歌曲索引:', index);
      playListRef.value.scrollTo({
        top: (index > 3 ? index - 3 : 0) * 62
      });
    }
  }, 100);
};

// 删除歌曲
const handleDeleteSong = (song: SongResult) => {
  playerStore.removeFromPlayList(song.id as number);
};
</script>

<style lang="scss" scoped>
.fixed-overlay {
  @apply fixed inset-0 z-[999999];
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  pointer-events: auto;
  cursor: default;
}

.playlist-panel {
  @apply fixed right-0 z-[9999999] rounded-l-2xl overflow-hidden flex flex-col;
  width: 360px;
  height: 72vh;
  top: 14vh;
  animation-duration: 0.34s !important;
  background: rgba(246, 250, 253, 0.94);
  backdrop-filter: blur(26px) saturate(180%);
  -webkit-backdrop-filter: blur(26px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 16px 48px rgba(30, 41, 59, 0.22);

  &-header {
    @apply px-5 pt-3 pb-3 border-b border-sky-100/80 flex-shrink-0;

    .drag-pill {
      @apply w-10 h-1 rounded-full mx-auto mb-3;
      background: rgba(148, 163, 184, 0.38);
    }

    .header-row {
      @apply flex items-center justify-between;
    }

    .title-wrap {
      @apply flex items-center gap-2;
    }

    .title {
      @apply text-[16px] font-bold text-slate-800;
    }

    .count-pill {
      @apply px-2 py-0.5 rounded-full text-[11px] font-bold;
      background: rgba(245, 158, 11, 0.14);
      color: #d97706;
    }

    .header-actions {
      @apply flex items-center gap-1.5;
    }

    .action-btn,
    .close-btn {
      @apply w-8 h-8 flex items-center justify-center rounded-full cursor-pointer text-slate-600 transition-all active:scale-90;
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(186, 218, 238, 0.45);

      .iconfont {
        @apply text-lg;
      }
    }

    .action-btn:hover {
      @apply text-rose-500;
    }
  }

  &-content {
    @apply flex-1 min-h-0 overflow-hidden px-3 py-2;
  }
}

html.dark .playlist-panel {
  background: #131316;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);

  .playlist-panel-header {
    border-bottom-color: rgba(255, 255, 255, 0.08);

    .title {
      color: #fafafa;
    }

    .count-pill {
      background: rgba(255, 197, 51, 0.16);
      color: #ffc533;
    }

    .action-btn,
    .close-btn {
      color: #fafafa;
      background: #1c1c22;
      border-color: rgba(255, 255, 255, 0.08);
    }
  }
}

.empty-playlist {
  @apply flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500;

  .iconfont {
    @apply text-5xl mb-3 opacity-50;
  }

  p {
    @apply text-sm font-medium;
  }
}

.music-play-list-row {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  margin-bottom: 2px;

  &.is-dragging {
    opacity: 0.55;
  }

  &.is-drag-over {
    outline: 2px dashed rgba(245, 158, 11, 0.7);
    outline-offset: -2px;
  }
}

.swipe-remove-bg {
  position: absolute;
  inset: 2px 2px 2px auto;
  width: 72px;
  border-radius: 14px;
  background: linear-gradient(135deg, #f43f5e, #e11d48);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.drag-handle {
  @apply w-6 h-10 flex items-center justify-center text-slate-400 hover:text-amber-500 cursor-grab active:cursor-grabbing flex-shrink-0;
  touch-action: none;
}

.save-playlist-pill {
  @apply h-8 px-2.5 rounded-full text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all active:scale-95;
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.save-playlist-bar {
  @apply mt-2.5 flex items-center gap-1.5;

  .save-playlist-input {
    @apply flex-1 min-w-0 h-8 px-3 rounded-xl text-xs bg-white/90 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none focus:border-amber-400;
  }

  .save-confirm-btn {
    @apply h-8 px-3 rounded-xl text-xs font-bold text-white bg-amber-500 hover:bg-amber-600;
  }

  .save-cancel-btn {
    @apply h-8 px-2.5 rounded-xl text-xs text-slate-500 dark:text-slate-400;
  }
}

.next-up-bar {
  @apply mt-2.5 px-3 py-1.5 rounded-xl flex items-center gap-2 text-[11px];
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.16);

  .next-up-label {
    @apply font-bold text-sky-600 dark:text-sky-300 flex-shrink-0;
  }

  .next-up-name {
    @apply flex-1 text-slate-700 dark:text-slate-200 font-medium;
  }

  .next-up-source {
    @apply px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0;
    background: rgba(245, 158, 11, 0.16);
    color: #b45309;
  }
}

html.dark .next-up-bar .next-up-source {
  color: #ffc533;
}

.music-play-list-content {
  @apply pr-1 rounded-2xl transition-colors relative z-10;
  background: rgba(246, 250, 253, 0.96);

  &:hover {
    .delete-btn {
      @apply visible;
    }
  }

  .delete-btn {
    @apply px-2 cursor-pointer invisible;
    .iconfont {
      @apply text-lg;
    }
  }
}

html.dark .music-play-list-content {
  background: #131316;
}

// 移动端底部磨砂抽屉
@media (max-width: 768px) {
  .playlist-panel {
    position: fixed;
    width: 100%;
    height: 76vh;
    top: auto;
    bottom: 0;
    border-radius: 30px 30px 0 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    padding-bottom: var(--safe-area-inset-bottom, 10px);

    &-content {
      @apply px-3.5;

      .delete-btn {
        @apply visible;
      }
    }
  }
}
</style>
