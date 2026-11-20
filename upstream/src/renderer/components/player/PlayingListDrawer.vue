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
    </div>
    <div class="playlist-panel-content">
      <div v-if="playList.length === 0" class="empty-playlist">
        <i class="iconfont ri-music-2-line"></i>
        <p>{{ t('player.playList.empty') }}</p>
      </div>
      <n-virtual-list v-else ref="playListRef" :item-size="62" item-resizable :items="playList">
        <template #default="{ item }">
          <div class="music-play-list-content">
            <div class="flex items-center justify-between">
              <song-item :key="item.id" class="flex-1" :item="item" mini></song-item>
              <div class="delete-btn" @click.stop="handleDeleteSong(item)">
                <i
                  class="iconfont ri-delete-bin-line text-gray-400 hover:text-red-500 transition-colors"
                ></i>
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
import { usePlayerStore } from '@/store/modules/player';
import type { SongResult } from '@/types/music';
import { isMobile } from '@/utils';

const { t } = useI18n();
const message = useMessage();
const dialog = useDialog();
const playerStore = usePlayerStore();

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

:global(.dark) .playlist-panel {
  background: rgba(20, 27, 39, 0.94);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.58);

  .playlist-panel-header {
    border-bottom-color: rgba(255, 255, 255, 0.08);

    .title {
      color: #f8fafc;
    }

    .count-pill {
      background: rgba(255, 197, 51, 0.16);
      color: #ffc533;
    }

    .action-btn,
    .close-btn {
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.1);
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

.music-play-list-content {
  @apply pr-1 rounded-2xl transition-colors;

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
