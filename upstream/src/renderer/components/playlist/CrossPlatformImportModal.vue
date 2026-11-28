<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-[999985] flex items-center justify-center p-3 sm:p-4 bg-black/55 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div
        class="w-full max-w-[540px] max-h-[88vh] flex flex-col overflow-hidden rounded-3xl bg-white dark:bg-[#131316] border border-slate-200/80 dark:border-white/[0.08] shadow-2xl text-slate-900 dark:text-[#FAFAFA]"
      >
        <!-- Header -->
        <div class="px-5 pt-5 pb-3.5 border-b border-slate-200/60 dark:border-white/[0.06] flex items-start justify-between gap-3 flex-shrink-0">
          <div class="flex items-center gap-2.5">
            <div
              class="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-sm flex-shrink-0"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
            >
              <i class="ri-download-cloud-2-line text-lg"></i>
            </div>
            <div>
              <h3 class="text-base font-bold leading-snug">跨平台歌单导入</h3>
              <p class="text-xs text-slate-500 dark:text-[#A1A1AA] mt-0.5">
                支持分享链接或纯文本列表，匹配后保存为自建歌单并自动参与云同步
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="关闭"
            class="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-white/[0.08] transition-colors flex-shrink-0"
            @click="handleClose"
          >
            <i class="ri-close-line text-lg"></i>
          </button>
        </div>

        <!-- Scrollable Body -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <!-- Stage 1: Input -->
          <template v-if="stage === 'input'">
            <!-- Mode Tabs -->
            <div class="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-100/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06]">
              <button
                type="button"
                class="py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                :class="
                  activeTab === 'link'
                    ? 'bg-white dark:bg-[#131316] text-slate-900 dark:text-[#FFC533] shadow-sm'
                    : 'text-slate-500 dark:text-[#A1A1AA] hover:text-slate-800 dark:hover:text-[#FAFAFA]'
                "
                @click="switchMode('link')"
              >
                <i class="ri-link-m text-sm"></i>
                <span>链接导入</span>
              </button>
              <button
                type="button"
                class="py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                :class="
                  activeTab === 'text'
                    ? 'bg-white dark:bg-[#131316] text-slate-900 dark:text-[#FFC533] shadow-sm'
                    : 'text-slate-500 dark:text-[#A1A1AA] hover:text-slate-800 dark:hover:text-[#FAFAFA]'
                "
                @click="switchMode('text')"
              >
                <i class="ri-file-text-line text-sm"></i>
                <span>文本导入（万能兜底）</span>
              </button>
            </div>

            <!-- Link Tab -->
            <div v-if="activeTab === 'link'" class="space-y-3">
              <div class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06] p-3.5 space-y-2.5">
                <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-[#A1A1AA]">
                  <span>支持平台：</span>
                  <span class="px-2 py-0.5 rounded-full bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06]">汽水音乐</span>
                  <span class="px-2 py-0.5 rounded-full bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06]">QQ 音乐</span>
                  <span class="px-2 py-0.5 rounded-full bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06]">酷狗</span>
                  <span class="px-2 py-0.5 rounded-full bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06]">酷我</span>
                  <span class="px-2 py-0.5 rounded-full bg-white dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06]">网易云</span>
                </div>

                <textarea
                  v-model="linkShareText"
                  rows="4"
                  placeholder="直接粘贴完整分享文案或链接，例如：&#10;分享歌单《深夜emo》https://y.qq.com/n/ryqq/playlist/..."
                  class="w-full rounded-xl p-3 text-xs bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-800 dark:text-[#FAFAFA] placeholder:text-slate-400 focus:outline-none focus:border-amber-500 dark:focus:border-[#FFC533]"
                ></textarea>

                <!-- Extracted Link Indicator -->
                <div v-if="extractedShare" class="flex items-center justify-between gap-2 text-xs px-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span
                      v-if="extractedShare.allowed"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                    >
                      <i class="ri-checkbox-circle-line"></i>
                      <span>已识别：{{ extractedShare.platformLabel }}</span>
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/12 text-amber-700 dark:text-[#FFC533]"
                    >
                      <i class="ri-alert-line"></i>
                      <span>暂不支持该链接域名</span>
                    </span>
                    <span class="text-[11px] text-slate-400 dark:text-zinc-500 truncate">
                      {{ extractedShare.host }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Fallback to Text Prompt -->
              <div
                v-if="linkFallbackNotice"
                class="rounded-2xl p-3.5 bg-amber-50/90 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-400/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div class="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <i class="ri-information-line text-base text-amber-500 dark:text-[#FFC533] flex-shrink-0 mt-0.5"></i>
                  <span>{{ linkFallbackNotice }}</span>
                </div>
                <button
                  type="button"
                  class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex-shrink-0 active:scale-95 transition-all"
                  @click="switchMode('text')"
                >
                  切换至文本导入
                </button>
              </div>
            </div>

            <!-- Text Tab -->
            <div v-else class="space-y-3">
              <div class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06] p-3.5 space-y-2.5">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-500 dark:text-[#A1A1AA] mb-1">
                    新歌单名称（可选）
                  </label>
                  <input
                    v-model="draftPlaylistName"
                    type="text"
                    maxlength="60"
                    placeholder="例如：我的跨平台精选歌单"
                    class="w-full rounded-xl px-3 py-2 text-xs bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-800 dark:text-[#FAFAFA] placeholder:text-slate-400 focus:outline-none focus:border-amber-500 dark:focus:border-[#FFC533]"
                  />
                </div>

                <div>
                  <div class="flex items-center justify-between gap-2 mb-1">
                    <label class="text-[11px] font-semibold text-slate-500 dark:text-[#A1A1AA]">
                      歌曲列表（每行一首，单次最多 {{ MAX_IMPORT_TRACKS }} 首）
                    </label>
                    <span class="text-[11px] text-slate-400 dark:text-zinc-500">
                      自动去序号 / 空行 / 重复行
                    </span>
                  </div>
                  <textarea
                    v-model="plainTextInput"
                    rows="7"
                    placeholder="支持以下常见格式混排：&#10;晴天 - 周杰伦&#10;七里香 / 周杰伦&#10;1. 江南 - 林俊杰&#10;稻香"
                    class="w-full rounded-xl p-3 text-xs leading-relaxed bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-800 dark:text-[#FAFAFA] placeholder:text-slate-400 focus:outline-none focus:border-amber-500 dark:focus:border-[#FFC533]"
                  ></textarea>
                </div>

                <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-[#A1A1AA]">
                  <span class="font-semibold text-slate-700 dark:text-zinc-200">
                    有效识别 {{ parsedTextStats.tracks.length }} 首
                  </span>
                  <span v-if="parsedTextStats.duplicateCount > 0">
                    · 已去重 {{ parsedTextStats.duplicateCount }} 条
                  </span>
                  <span
                    v-if="parsedTextStats.truncatedCount > 0"
                    class="text-amber-600 dark:text-[#FFC533]"
                  >
                    · 超出 {{ MAX_IMPORT_TRACKS }} 首上限已忽略 {{ parsedTextStats.truncatedCount }} 条
                  </span>
                </div>
              </div>
            </div>
          </template>

          <!-- Stage 2: Matching Progress -->
          <template v-else-if="stage === 'matching'">
            <div class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06] p-5 space-y-4 text-center">
              <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-500/12 text-amber-500 dark:text-[#FFC533] flex items-center justify-center">
                <i class="ri-loader-4-line animate-spin text-2xl"></i>
              </div>

              <div>
                <div class="text-sm font-bold text-slate-900 dark:text-[#FAFAFA]">
                  正在匹配 {{ matchProgress.done }} / {{ matchProgress.total }} 首…
                </div>
                <div class="text-xs text-slate-500 dark:text-[#A1A1AA] mt-1 truncate">
                  {{
                    matchProgress.currentTrack
                      ? `当前：${matchProgress.currentTrack.title}${
                          matchProgress.currentTrack.artist ? ` - ${matchProgress.currentTrack.artist}` : ''
                        }`
                      : '正在按防串歌规则搜索最佳音轨…'
                  }}
                </div>
              </div>

              <!-- Progress Bar -->
              <div class="w-full h-2.5 rounded-full bg-slate-200/80 dark:bg-white/[0.08] overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-200"
                  :style="{
                    width: `${progressPercent}%`,
                    background: 'linear-gradient(90deg, #ffc21c 0%, #eb8f00 100%)'
                  }"
                ></div>
              </div>

              <div class="flex items-center justify-center gap-4 text-xs">
                <span class="text-emerald-600 dark:text-emerald-400 font-semibold">
                  已匹配 {{ matchProgress.matchedCount }} 首
                </span>
                <span class="text-slate-400 dark:text-zinc-500">·</span>
                <span class="text-slate-500 dark:text-[#A1A1AA]">
                  未找到 {{ matchProgress.unmatchedCount }} 首
                </span>
              </div>
            </div>
          </template>

          <!-- Stage 3: Preview & Confirm -->
          <template v-else>
            <!-- Summary -->
            <div class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06] p-3.5 space-y-3">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <span class="text-xs font-bold text-slate-800 dark:text-[#FAFAFA]">
                  成功匹配 {{ matchedItems.length }} 首，未找到 {{ unmatchedItems.length }} 首
                </span>
                <span
                  v-if="sourcePlatformLabel"
                  class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/12 text-amber-700 dark:text-[#FFC533]"
                >
                  来源：{{ sourcePlatformLabel }}
                </span>
              </div>

              <div>
                <label class="block text-[11px] font-semibold text-slate-500 dark:text-[#A1A1AA] mb-1">
                  自建歌单名称
                </label>
                <input
                  v-model="confirmPlaylistName"
                  type="text"
                  maxlength="60"
                  placeholder="请输入导入歌单名称"
                  class="w-full rounded-xl px-3 py-2 text-xs font-semibold bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-900 dark:text-[#FAFAFA] focus:outline-none focus:border-amber-500 dark:focus:border-[#FFC533]"
                />
              </div>
            </div>

            <!-- Matched Checklist -->
            <div v-if="matchedItems.length > 0" class="space-y-2">
              <div class="flex items-center justify-between px-1">
                <span class="text-xs font-bold text-slate-600 dark:text-[#A1A1AA]">
                  已匹配曲目（已选 {{ selectedKeys.size }} / {{ matchedItems.length }} 首）
                </span>
                <div class="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    class="font-semibold text-amber-600 dark:text-[#FFC533] hover:underline"
                    @click="selectAllMatched"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    class="text-slate-500 dark:text-zinc-400 hover:underline"
                    @click="clearAllMatched"
                  >
                    全不选
                  </button>
                </div>
              </div>

              <div class="max-h-[34vh] overflow-y-auto space-y-1.5 pr-1">
                <label
                  v-for="item in matchedItems"
                  :key="item.key"
                  class="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.05] cursor-pointer hover:bg-slate-100/80 dark:hover:bg-white/[0.06] transition-colors"
                >
                  <input
                    type="checkbox"
                    :checked="selectedKeys.has(item.key)"
                    class="w-4 h-4 rounded accent-amber-500 flex-shrink-0"
                    @change="toggleSelectedKey(item.key)"
                  />
                  <img
                    v-if="item.song.picUrl || item.song.al?.picUrl"
                    :src="getImgUrl(item.song.picUrl || item.song.al?.picUrl, '100y100')"
                    alt=""
                    class="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                  />
                  <div
                    v-else
                    class="w-9 h-9 rounded-lg bg-slate-200/70 dark:bg-white/[0.08] flex items-center justify-center flex-shrink-0 text-slate-400"
                  >
                    <i class="ri-music-line"></i>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-xs font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
                      {{ item.song.name }}
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-[#A1A1AA] truncate mt-0.5">
                      {{ formatSongArtists(item.song) }}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div
              v-else
              class="py-6 text-center rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] text-xs text-slate-500 dark:text-[#A1A1AA]"
            >
              暂未在曲库中匹配到可用歌曲，可返回修改歌名或补充歌手后重试。
            </div>

            <!-- Unmatched Tracks & Copy Action -->
            <div
              v-if="unmatchedItems.length > 0"
              class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/60 dark:border-white/[0.06] p-3.5 space-y-2"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                  未找到曲目（{{ unmatchedItems.length }} 首）
                </span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] active:scale-95 transition-all"
                  @click="copyUnmatchedList"
                >
                  <i class="ri-file-copy-line text-xs"></i>
                  <span>复制未找到清单</span>
                </button>
              </div>
              <div class="max-h-24 overflow-y-auto space-y-1 text-[11px] text-slate-500 dark:text-[#A1A1AA] pr-1">
                <div
                  v-for="(u, i) in unmatchedItems"
                  :key="`u-${i}-${u.title}`"
                  class="truncate"
                >
                  • {{ u.title }}{{ u.artist ? ` - ${u.artist}` : '' }}
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3.5 border-t border-slate-200/60 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#18181D] flex items-center justify-end gap-2.5 flex-shrink-0">
          <template v-if="stage === 'input'">
            <button
              type="button"
              class="px-4 py-2 rounded-full text-xs font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-white/[0.08] transition-colors"
              @click="handleClose"
            >
              取消
            </button>
            <button
              v-if="activeTab === 'link'"
              type="button"
              :disabled="parsingLink || !linkShareText.trim()"
              class="px-5 py-2 rounded-full text-xs font-extrabold text-white shadow-sm disabled:opacity-50 active:scale-95 transition-all flex items-center gap-1.5"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="handleParseLink"
            >
              <i v-if="parsingLink" class="ri-loader-4-line animate-spin text-sm"></i>
              <span>{{ parsingLink ? '正在解析链接...' : '解析歌单链接' }}</span>
            </button>
            <button
              v-else
              type="button"
              :disabled="parsedTextStats.tracks.length === 0"
              class="px-5 py-2 rounded-full text-xs font-extrabold text-white shadow-sm disabled:opacity-50 active:scale-95 transition-all"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="handleStartTextMatch"
            >
              开始匹配曲库（{{ parsedTextStats.tracks.length }} 首）
            </button>
          </template>

          <template v-else-if="stage === 'matching'">
            <button
              type="button"
              class="px-5 py-2 rounded-full text-xs font-semibold bg-rose-500/12 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all"
              @click="handleCancelMatching"
            >
              取消匹配
            </button>
          </template>

          <template v-else>
            <button
              type="button"
              class="px-4 py-2 rounded-full text-xs font-semibold bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
              @click="stage = 'input'"
            >
              返回修改
            </button>
            <button
              type="button"
              :disabled="selectedKeys.size === 0"
              class="px-5 py-2 rounded-full text-xs font-extrabold text-white shadow-sm disabled:opacity-50 active:scale-95 transition-all"
              style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
              @click="handleConfirmImport"
            >
              确认导入（{{ selectedKeys.size }} 首）
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import {
  type MatchBatchProgress,
  type MatchedImportItem,
  matchImportedTracksBatch,
  parseExternalPlaylistLink
} from '@/api/externalPlaylist';
import { useCloudSyncStore } from '@/store/modules/cloudSync';
import { usePlayerStore } from '@/store/modules/player';
import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { registerAndroidBackHandler } from '@/utils/androidBridge';
import {
  detectExternalPlaylistPlatform,
  extractShareUrlFromText,
  FALLBACK_TO_TEXT_MESSAGE,
  type ImportedRawTrack,
  MAX_IMPORT_TRACKS,
  parsePlaylistTextLines
} from '@/utils/playlistImport';

defineOptions({
  name: 'CrossPlatformImportModal'
});

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'imported', payload: { id: string; name: string; count: number }): void;
}>();

const message = useMessage();
const playerStore = usePlayerStore();
const cloudSyncStore = useCloudSyncStore();

type ImportTab = 'link' | 'text';
type ModalStage = 'input' | 'matching' | 'preview';

const activeTab = ref<ImportTab>('link');
const stage = ref<ModalStage>('input');

const linkShareText = ref('');
const parsingLink = ref(false);
const linkFallbackNotice = ref('');

const draftPlaylistName = ref('');
const plainTextInput = ref('');

const confirmPlaylistName = ref('导入外部歌单');
const sourcePlatformLabel = ref('');
const matchedItems = ref<MatchedImportItem[]>([]);
const unmatchedItems = ref<ImportedRawTrack[]>([]);
const selectedKeys = ref<Set<string>>(new Set());

const matchProgress = ref<MatchBatchProgress>({
  done: 0,
  total: 0,
  matchedCount: 0,
  unmatchedCount: 0
});

let matchAbortController: AbortController | null = null;
let unregisterBackHandler: (() => void) | null = null;

const extractedShare = computed(() => extractShareUrlFromText(linkShareText.value));
const parsedTextStats = computed(() =>
  parsePlaylistTextLines(plainTextInput.value, MAX_IMPORT_TRACKS)
);

const progressPercent = computed(() => {
  if (!matchProgress.value.total) return 0;
  return Math.min(
    100,
    Math.max(4, Math.round((matchProgress.value.done / matchProgress.value.total) * 100))
  );
});

const formatSongArtists = (song: SongResult): string => {
  const list = song.ar || song.artists || [];
  if (Array.isArray(list) && list.length > 0) {
    return list.map((a) => a?.name).filter(Boolean).join(' / ') || '未知歌手';
  }
  return '未知歌手';
};

const abortMatching = () => {
  if (matchAbortController) {
    matchAbortController.abort();
    matchAbortController = null;
  }
};

const cleanupBackHandler = () => {
  if (unregisterBackHandler) {
    unregisterBackHandler();
    unregisterBackHandler = null;
  }
};

const resetState = () => {
  abortMatching();
  stage.value = 'input';
  activeTab.value = 'link';
  linkShareText.value = '';
  parsingLink.value = false;
  linkFallbackNotice.value = '';
  draftPlaylistName.value = '';
  plainTextInput.value = '';
  confirmPlaylistName.value = '导入外部歌单';
  sourcePlatformLabel.value = '';
  matchedItems.value = [];
  unmatchedItems.value = [];
  selectedKeys.value = new Set();
  matchProgress.value = { done: 0, total: 0, matchedCount: 0, unmatchedCount: 0 };
};

const handleClose = () => {
  abortMatching();
  cleanupBackHandler();
  emit('update:show', false);
};

const switchMode = (tab: ImportTab) => {
  activeTab.value = tab;
  if (tab === 'text' && !draftPlaylistName.value && extractedShare.value?.titleHint) {
    draftPlaylistName.value = extractedShare.value.titleHint;
  }
};

const runMatchPipeline = async (
  rawTracks: ImportedRawTrack[],
  playlistName: string,
  platformLabel: string
) => {
  if (rawTracks.length === 0) {
    message.warning('未提取到有效歌曲条目');
    return;
  }

  abortMatching();
  const controller = new AbortController();
  matchAbortController = controller;

  sourcePlatformLabel.value = platformLabel;
  confirmPlaylistName.value = playlistName.trim() || '导入外部歌单';
  matchProgress.value = {
    done: 0,
    total: rawTracks.length,
    matchedCount: 0,
    unmatchedCount: 0,
    currentTrack: rawTracks[0]
  };
  stage.value = 'matching';

  const result = await matchImportedTracksBatch(rawTracks, {
    signal: controller.signal,
    onProgress: (p) => {
      matchProgress.value = { ...p };
    }
  });

  if (matchAbortController === controller) {
    matchAbortController = null;
  }

  if (result.cancelled) {
    stage.value = 'input';
    message.info('已取消匹配');
    return;
  }

  matchedItems.value = result.matched;
  unmatchedItems.value = result.unmatched;
  selectedKeys.value = new Set(result.matched.map((m) => m.key));
  stage.value = 'preview';
};

const handleParseLink = async () => {
  if (parsingLink.value) return;
  const extracted = extractedShare.value;
  if (!extracted) {
    message.warning('未检测到有效 HTTP(S) 分享链接，请核对或使用「文本导入」');
    return;
  }
  if (!extracted.allowed) {
    linkFallbackNotice.value = FALLBACK_TO_TEXT_MESSAGE;
    return;
  }

  parsingLink.value = true;
  linkFallbackNotice.value = '';
  try {
    const res = await parseExternalPlaylistLink(extracted.url);
    if (!res.ok || !Array.isArray(res.tracks) || res.tracks.length === 0) {
      linkFallbackNotice.value = FALLBACK_TO_TEXT_MESSAGE;
      if (res.playlistName && !draftPlaylistName.value) {
        draftPlaylistName.value = res.playlistName;
      }
      return;
    }

    const detected = detectExternalPlaylistPlatform(extracted.host);
    const title = res.playlistName || extracted.titleHint || `${detected.label}歌单`;
    await runMatchPipeline(res.tracks.slice(0, MAX_IMPORT_TRACKS), title, detected.label);
  } finally {
    parsingLink.value = false;
  }
};

const handleStartTextMatch = async () => {
  const stats = parsedTextStats.value;
  if (stats.tracks.length === 0) {
    message.warning('请先粘贴至少一首歌曲名称');
    return;
  }
  const title =
    draftPlaylistName.value.trim() ||
    extractedShare.value?.titleHint ||
    `文本导入歌单 (${stats.tracks.length}首)`;
  await runMatchPipeline(stats.tracks, title, '文本清单');
};

const handleCancelMatching = () => {
  abortMatching();
  stage.value = 'input';
  message.info('已取消匹配');
};

const toggleSelectedKey = (key: string) => {
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
};

const selectAllMatched = () => {
  selectedKeys.value = new Set(matchedItems.value.map((m) => m.key));
};

const clearAllMatched = () => {
  selectedKeys.value = new Set();
};

const copyUnmatchedList = async () => {
  const text = unmatchedItems.value
    .map((u) => (u.artist ? `${u.title} - ${u.artist}` : u.title))
    .join('\n');
  if (!text) return;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      message.success(`已复制 ${unmatchedItems.value.length} 首未找到曲目清单`);
      return;
    }
  } catch {
    // fallback below
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    message.success(`已复制 ${unmatchedItems.value.length} 首未找到曲目清单`);
  } catch {
    message.warning('当前环境不支持自动复制，请手动选择列表复制');
  }
};

const handleConfirmImport = () => {
  const selectedSongs = matchedItems.value
    .filter((m) => selectedKeys.value.has(m.key))
    .map((m) => m.song);
  if (selectedSongs.length === 0) {
    message.warning('请至少勾选一首歌曲后再导入');
    return;
  }

  const finalName = confirmPlaylistName.value.trim() || '导入外部歌单';
  const saved = playerStore.saveCustomPlaylist(finalName, selectedSongs);
  if (!saved.ok || !saved.id) {
    message.error('保存本地歌单失败，请检查存储空间');
    return;
  }

  if (cloudSyncStore.isConfigured && cloudSyncStore.config.autoSync) {
    cloudSyncStore.scheduleAutoSyncAfterPlay();
  }

  message.success(`已成功导入「${finalName}」（共 ${saved.count} 首）`);
  emit('imported', { id: saved.id, name: finalName, count: saved.count });
  handleClose();
};

watch(
  () => props.show,
  (visible) => {
    cleanupBackHandler();
    if (visible) {
      resetState();
      unregisterBackHandler = registerAndroidBackHandler(() => {
        handleClose();
        return true;
      }, 115);
    } else {
      abortMatching();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  abortMatching();
  cleanupBackHandler();
});
</script>
