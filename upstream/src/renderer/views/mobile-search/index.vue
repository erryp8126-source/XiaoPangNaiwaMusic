<template>
  <div class="mobile-search-page">
    <!-- 搜索头部 -->
    <div class="search-header" :class="{ 'safe-area-top': hasSafeArea }">
      <div class="header-back" @click="goBack">
        <i class="ri-arrow-left-s-line"></i>
      </div>
      <div class="search-input-wrapper">
        <i class="ri-search-line search-icon"></i>
        <input
          ref="searchInputRef"
          v-model="searchValue"
          type="text"
          class="search-input"
          :placeholder="hotSearchKeyword"
          @input="handleInput"
          @keydown.enter="handleSearch"
        />
        <i v-if="searchValue" class="ri-close-circle-fill clear-icon" @click="clearSearch"></i>
      </div>
      <div class="search-button" @click="handleSearch">
        {{ t('common.search') }}
      </div>
    </div>

    <!-- 搜索类型标签 -->
    <div class="search-types">
      <div
        v-for="type in searchTypes"
        :key="type.key"
        class="type-tag"
        :class="{ active: searchType === type.key }"
        @click="selectType(type.key)"
      >
        {{ type.label }}
      </div>
    </div>

    <!-- 搜索内容区域 -->
    <div class="search-content">
      <!-- 搜索建议 -->
      <div v-if="suggestions.length > 0" class="search-section">
        <div class="section-title">{{ t('search.suggestions') }}</div>
        <div class="suggestion-list">
          <div
            v-for="(item, index) in suggestions"
            :key="index"
            class="suggestion-item"
            @click="selectSuggestion(item)"
          >
            <i class="ri-search-line"></i>
            <span>{{ item }}</span>
          </div>
        </div>
      </div>

      <!-- 搜索历史 -->
      <div v-else-if="searchHistory.length > 0" class="search-section">
        <div class="section-header">
          <span class="section-title">{{ t('search.history') }}</span>
          <span class="clear-history" @click="clearHistory">{{ t('common.clear') }}</span>
        </div>
        <div class="history-tags">
          <div
            v-for="(item, index) in searchHistory"
            :key="index"
            class="history-tag"
            @click="selectSuggestion(item)"
          >
            {{ item }}
          </div>
        </div>
      </div>

      <!-- 热门搜索 -->
      <div v-if="hotSearchList.length > 0 && !searchValue" class="search-section">
        <div class="section-title">{{ t('search.hot') }}</div>
        <div class="hot-list">
          <div
            v-for="(item, index) in hotSearchList"
            :key="index"
            class="hot-item"
            @click="selectSuggestion(item.searchWord)"
          >
            <span class="hot-rank" :class="{ top: index < 3 }">{{ index + 1 }}</span>
            <span class="hot-word">{{ item.searchWord }}</span>
            <span v-if="item.iconUrl" class="hot-icon">
              <img :src="getImgUrl(item.iconUrl)" alt="" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { computed, inject, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getHotSearch, getSearchKeyword } from '@/api/home';
import { getSearchSuggestions } from '@/api/search';
import { SEARCH_TYPES } from '@/const/bar-const';
import { useSearchStore } from '@/store/modules/search';
import { getImgUrl } from '@/utils';

const { t, locale } = useI18n();
const router = useRouter();
const searchStore = useSearchStore();

// 注入是否有安全区域
const hasSafeArea = inject('hasSafeArea', false);

// 搜索值
const searchValue = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

// 热门搜索关键词占位符
const hotSearchKeyword = ref('搜索音乐、歌手、歌单');

// 搜索类型
const searchType = ref(searchStore.searchType || 1);
const searchTypes = computed(() => {
  locale.value;
  return SEARCH_TYPES.map((type) => ({
    label: t(type.label),
    key: type.key
  }));
});

// 搜索建议
const suggestions = ref<string[]>([]);

// 搜索历史
const HISTORY_KEY = 'mobile_search_history';
const searchHistory = ref<string[]>([]);

// 热门搜索
const hotSearchList = ref<any[]>([]);

// 加载热门搜索关键词
const loadHotSearchKeyword = async () => {
  try {
    const { data } = await getSearchKeyword();
    hotSearchKeyword.value = data.data.showKeyword;
  } catch (e) {
    console.error('加载热门搜索关键词失败:', e);
  }
};

// 加载热门搜索列表
const loadHotSearchList = async () => {
  try {
    const { data } = await getHotSearch();
    hotSearchList.value = data.data || [];
  } catch (e) {
    console.error('加载热门搜索失败:', e);
  }
};

// 加载搜索历史
const loadSearchHistory = () => {
  try {
    const history = localStorage.getItem(HISTORY_KEY);
    searchHistory.value = history ? JSON.parse(history) : [];
  } catch (e) {
    console.error('加载搜索历史失败:', e);
    searchHistory.value = [];
  }
};

// 保存搜索历史
const saveSearchHistory = (keyword: string) => {
  if (!keyword.trim()) return;

  // 移除重复项并添加到开头
  const history = searchHistory.value.filter((item) => item !== keyword);
  history.unshift(keyword);

  // 最多保存20条
  searchHistory.value = history.slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value));
};

// 清除搜索历史
const clearHistory = () => {
  searchHistory.value = [];
  localStorage.removeItem(HISTORY_KEY);
};

// 获取搜索建议（防抖）
const debouncedGetSuggestions = useDebounceFn(async (keyword: string) => {
  if (!keyword.trim()) {
    suggestions.value = [];
    return;
  }
  suggestions.value = await getSearchSuggestions(keyword);
}, 300);

// 处理输入
const handleInput = () => {
  debouncedGetSuggestions(searchValue.value);
};

// 清除搜索
const clearSearch = () => {
  searchValue.value = '';
  suggestions.value = [];
};

// 选择搜索类型
const selectType = (type: number) => {
  searchType.value = type;
  searchStore.searchType = type;
};

// 选择建议
const selectSuggestion = (keyword: string) => {
  searchValue.value = keyword;
  handleSearch();
};

// 执行搜索
const handleSearch = () => {
  const keyword = searchValue.value.trim();
  if (!keyword) return;

  // 保存搜索历史
  saveSearchHistory(keyword);

  // 跳转到搜索结果页
  router.push({
    path: '/mobile-search-result',
    query: {
      keyword,
      type: searchType.value
    }
  });
};

// 返回上一页
const goBack = () => {
  router.back();
};

onMounted(() => {
  loadHotSearchKeyword();
  loadHotSearchList();
  loadSearchHistory();
  nextTick(() => {
    searchInputRef.value?.focus();
  });
});
</script>

<style lang="scss" scoped>
.mobile-search-page {
  @apply fixed inset-0 z-50 flex flex-col;
  background-color: var(--bg-color);
  background-image:
    radial-gradient(circle at 12% 0%, var(--naiwa-sky-glow) 0%, transparent 48%),
    radial-gradient(circle at 92% 6%, var(--naiwa-sun-glow) 0%, transparent 44%);
}

.search-header {
  @apply flex items-center gap-2.5 px-3 py-3;
  background: rgba(246, 250, 253, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(186, 218, 238, 0.32);

  &.safe-area-top {
    padding-top: calc(var(--safe-area-inset-top, 0px) + 12px);
  }
}

.header-back {
  @apply flex items-center justify-center w-9 h-9 rounded-full text-2xl text-slate-700 active:scale-90 transition-transform;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(186, 218, 238, 0.45);
}

.search-input-wrapper {
  @apply flex-1 flex items-center gap-2 rounded-full px-3.5 py-2;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(186, 218, 238, 0.55);
  box-shadow: 0 4px 12px rgba(82, 134, 168, 0.06);
}

.search-icon {
  @apply text-amber-500 text-lg;
}

.search-input {
  @apply flex-1 bg-transparent border-none outline-none text-slate-800 text-[14.5px];

  &::placeholder {
    @apply text-slate-400;
  }
}

.clear-icon {
  @apply text-slate-400 text-lg cursor-pointer;
}

.search-button {
  @apply px-3.5 py-2 rounded-full text-xs font-bold text-white cursor-pointer active:scale-95 transition-transform flex-shrink-0;
  background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
  box-shadow: 0 4px 12px rgba(232, 146, 0, 0.28);
}

.search-types {
  @apply flex gap-2 px-4 py-3 overflow-x-auto;
  border-bottom: 1px solid rgba(186, 218, 238, 0.28);

  &::-webkit-scrollbar {
    display: none;
  }
}

.type-tag {
  @apply px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 active:scale-95;
  background: rgba(255, 255, 255, 0.78);
  color: #475569;
  border: 1px solid rgba(186, 218, 238, 0.45);

  &.active {
    background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%);
    color: #ffffff;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(232, 146, 0, 0.26);
  }
}

.search-content {
  @apply flex-1 overflow-y-auto px-4 py-4 pb-32;
}

.search-section {
  @apply mb-6;
}

.section-header {
  @apply flex items-center justify-between mb-3;
}

.section-title {
  @apply text-sm font-extrabold text-slate-700 mb-3 tracking-tight;
}

.clear-history {
  @apply text-xs font-semibold text-slate-400 px-2.5 py-1 rounded-full bg-white/70 active:scale-95;
}

.suggestion-list {
  @apply space-y-1.5;
}

.suggestion-item {
  @apply flex items-center gap-3 px-3.5 py-3 rounded-2xl text-slate-700 transition-colors;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(186, 218, 238, 0.35);

  i {
    @apply text-amber-500;
  }
}

.history-tags {
  @apply flex flex-wrap gap-2;
}

.history-tag {
  @apply px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 active:scale-95 transition-transform;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(186, 218, 238, 0.45);
}

.hot-list {
  @apply grid grid-cols-1 gap-2;
}

.hot-item {
  @apply flex items-center gap-3 px-3.5 py-2.5 rounded-2xl transition-all active:scale-[0.98];
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(186, 218, 238, 0.35);
}

.hot-rank {
  @apply w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold text-slate-400 bg-sky-50;

  &.top {
    background: linear-gradient(135deg, #ffc21c 0%, #f97316 100%);
    color: #ffffff;
    box-shadow: 0 3px 8px rgba(249, 115, 22, 0.25);
  }
}

.hot-word {
  @apply flex-1 text-[14px] font-semibold text-slate-700;
}

.hot-icon {
  img {
    @apply h-4;
  }
}

html.dark {
  .mobile-search-page {
    background: #09090b;
  }

  .search-header {
    background: rgba(15, 15, 19, 0.94);
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }

  .header-back,
  .search-input-wrapper,
  .type-tag,
  .history-tag {
    background: #1c1c22;
    border-color: rgba(255, 255, 255, 0.08);
    color: #fafafa;
  }

  .search-input-wrapper:focus-within {
    border-color: #ffc533;
  }

  .suggestion-item,
  .hot-item {
    background: #131316;
    border-color: rgba(255, 255, 255, 0.08);
    color: #fafafa;
  }

  .search-input,
  .section-title,
  .hot-word {
    color: #fafafa;
  }

  .hot-rank:not(.top) {
    background: #1c1c22;
    color: #a1a1aa;
  }

  .clear-history {
    background: #1c1c22;
    border-color: rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
  }
}
</style>
