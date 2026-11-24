<template>
  <immersive-vinyl-home v-if="showImmersiveHome" @switch-discover="switchToDiscover" />
  <div
    v-else
    class="home-container h-full w-full max-w-full overflow-x-hidden bg-transparent transition-colors duration-300"
  >
    <n-scrollbar class="h-full">
      <div class="home-content w-full max-w-full overflow-x-hidden box-border pb-44 pt-3 page-padding">
        <!-- 移动端顶部模式快捷切换（心动黑胶 / 发现 / 音乐库） -->
        <div v-if="settingsStore.isMobile" class="flex items-center justify-between gap-2 mb-3">
          <div class="classic-mode-switcher">
            <button
              type="button"
              class="switcher-tab"
              @click="switchToImmersive"
            >
              <i class="ri-disc-fill text-amber-500"></i>
              <span>心动</span>
            </button>
            <span class="switcher-tab is-active">发现</span>
            <button
              type="button"
              class="switcher-tab"
              @click="router.push('/library')"
            >
              音乐库
            </button>
          </div>
        </div>

        <!-- 移动端顶部暖阳快捷搜索胶囊 -->
        <button
          type="button"
          class="home-search-pill md:hidden"
          @click="router.push('/mobile-search')"
        >
          <i class="ri-search-2-line text-[17px] text-amber-500 dark:text-amber-400"></i>
          <span class="flex-1 text-left text-[13.5px] text-slate-400 dark:text-slate-400 truncate">
            搜索想听的歌曲、歌手或歌单…
          </span>
          <span class="search-tag">热搜</span>
        </button>

        <!-- Hero Section -->
        <home-hero />

        <!-- Main Content Sections -->
        <div class="content-sections space-y-8 md:space-y-10">
          <!-- Recommended Playlists (Grid Section) -->
          <home-playlist-section
            :title="t('comp.recommendSonglist.title')"
            :limit="18"
            @more="router.push('/list')"
          />

          <!-- Hot Artists (Horizontal Scroll Section) -->
          <home-artists :title="t('comp.recommendSinger.title')" :limit="15" />

          <!-- New Albums (新碟上架) -->
          <home-album-section
            :title="t('comp.newAlbum.title')"
            :limit="6"
            :columns="5"
            :rows="1"
            @more="router.push('/album')"
          />

          <!-- New Songs (推荐新歌) -->
          <home-new-songs :title="t('comp.recommendNewMusic.title')" :limit="20" />
        </div>
      </div>
    </n-scrollbar>
  </div>
</template>

<script lang="ts" setup>
import { NScrollbar } from 'naive-ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { useSettingsStore } from '@/store/modules/settings';
import { triggerHaptic } from '@/utils/androidBridge';

import HomeAlbumSection from './components/HomeAlbumSection.vue';
import HomeArtists from './components/HomeArtists.vue';
import HomeHero from './components/HomeHero.vue';
import HomeNewSongs from './components/HomeNewSongs.vue';
import HomePlaylistSection from './components/HomePlaylistSection.vue';
import ImmersiveVinylHome from './components/ImmersiveVinylHome.vue';

defineOptions({
  name: 'Home'
});

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();

const showImmersiveHome = computed(
  () => settingsStore.isMobile && settingsStore.homeDisplayMode === 'immersive'
);

const switchToDiscover = () => {
  settingsStore.setHomeDisplayMode('classic');
};

const switchToImmersive = () => {
  triggerHaptic('selection');
  settingsStore.setHomeDisplayMode('immersive');
};
</script>

<style lang="scss" scoped>
.home-container {
  position: relative;
}

.classic-mode-switcher {
  @apply inline-flex items-center gap-1 p-1 rounded-full;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(186, 218, 238, 0.45);
  box-shadow: 0 4px 14px rgba(82, 134, 168, 0.08);

  .switcher-tab {
    @apply inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-slate-600 transition-all active:scale-95;

    &.is-active {
      @apply font-bold text-amber-700;
      background: linear-gradient(135deg, rgba(255, 214, 102, 0.34) 0%, rgba(167, 224, 248, 0.24) 100%);
    }
  }
}

html.dark .classic-mode-switcher {
  background: #131316;
  border-color: rgba(255, 255, 255, 0.08);

  .switcher-tab {
    color: #a1a1aa;

    &.is-active {
      color: #ffc533;
      background: rgba(255, 197, 51, 0.18);
    }
  }
}

:deep(.n-scrollbar-content) {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

.home-search-pill {
  @apply w-full flex items-center gap-2.5 px-4 py-2.5 mb-4 rounded-full transition-all duration-200 active:scale-[0.98];
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(186, 218, 238, 0.45);
  box-shadow: 0 6px 18px rgba(82, 134, 168, 0.08);

  .search-tag {
    @apply px-2.5 py-0.5 rounded-full text-[11px] font-bold;
    background: linear-gradient(135deg, rgba(255, 206, 68, 0.25) 0%, rgba(125, 211, 252, 0.25) 100%);
    color: #d97706;
  }
}

html.dark .home-search-pill {
  background: #1c1c22;
  border-color: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.36);

  .search-tag {
    background: rgba(255, 197, 51, 0.16);
    color: #ffc533;
  }
}

/* Global animation optimization */
:deep(.animate-item) {
  animation: fadeInUp 0.52s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

:deep(.animate-item) {
  @for $i from 1 through 20 {
    &:nth-child(#{$i}) {
      animation-delay: #{$i * 0.035}s;
    }
  }
}
</style>
