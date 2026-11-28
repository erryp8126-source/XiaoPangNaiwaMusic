<template>
  <div class="space-y-3">
    <!-- 主账号（网易云音乐） -->
    <div
      v-if="!hidePrimary"
      class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/70 dark:border-white/[0.06] p-3.5"
    >
      <div class="flex items-center justify-between gap-2 mb-2.5">
        <span class="text-xs font-semibold tracking-wide text-slate-500 dark:text-zinc-400">
          主账号（网易云音乐）
        </span>
        <span
          v-if="primaryLoginTypeLabel"
          class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100/90 text-amber-800 dark:bg-amber-500/15 dark:text-[#FFC533] border border-amber-200/80 dark:border-amber-400/30"
        >
          {{ primaryLoginTypeLabel }}
        </span>
      </div>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <img
            v-if="userStore.user?.avatarUrl"
            :src="getImgUrl(userStore.user.avatarUrl, '100y100')"
            alt="网易云头像"
            class="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-slate-200/80 dark:border-white/[0.1]"
          />
          <div
            v-else
            class="w-10 h-10 rounded-full flex items-center justify-center bg-rose-500/10 text-rose-500 flex-shrink-0"
          >
            <i class="ri-netease-cloud-music-line text-lg"></i>
          </div>

          <div class="min-w-0">
            <div class="text-sm font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
              {{ userStore.user?.nickname || '未登录网易云主账号' }}
            </div>
            <div class="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
              {{
                userStore.user
                  ? '控制收藏、历史、云同步与日常歌单'
                  : '登录后可使用红心同步、验证码快捷登录与个人歌单'
              }}
            </div>
          </div>
        </div>

        <button
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 active:scale-95 transition-all"
          :class="
            userStore.user
              ? 'bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              : 'bg-emerald-500 hover:bg-emerald-600 text-white'
          "
          @click="handlePrimaryAction"
        >
          {{ userStore.user ? '切换账号' : '前往登录' }}
        </button>
      </div>
    </div>

    <!-- 扩展绑定平台（独立隔离，不影响主账号） -->
    <div
      class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/70 dark:border-white/[0.06] p-3.5 space-y-3"
    >
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div class="text-xs font-semibold text-slate-800 dark:text-[#FAFAFA]">
            扩展绑定平台
          </div>
          <div class="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
            独立管理，绑定或解绑绝不影响网易云主账号与本地歌单
          </div>
        </div>
      </div>

      <!-- B 站（Bilibili） -->
      <div
        class="rounded-xl bg-white/95 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06] p-3 flex items-center justify-between gap-3"
      >
        <div class="flex items-center gap-3 min-w-0">
          <img
            v-if="platformAccountsStore.isBilibiliBound && platformAccountsStore.bilibiliProfile?.avatar"
            :src="getImgUrl(platformAccountsStore.bilibiliProfile.avatar)"
            alt="B 站头像"
            class="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-pink-200/80 dark:border-pink-400/25"
          />
          <div
            v-else
            class="w-9 h-9 rounded-full flex items-center justify-center bg-pink-500/12 text-pink-500 flex-shrink-0"
          >
            <i class="ri-bilibili-line text-lg"></i>
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[13px] font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
                {{
                  platformAccountsStore.isBilibiliBound
                    ? platformAccountsStore.bilibiliProfile?.nickname || '哔哩哔哩用户'
                    : 'B 站（Bilibili）'
                }}
              </span>
              <span
                v-if="platformAccountsStore.isBilibiliBound"
                class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
              >
                已绑定
              </span>
              <span
                v-if="platformAccountsStore.isBilibiliBound && platformAccountsStore.bilibiliProfile?.isVip"
                class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-pink-500/15 text-pink-600 dark:text-pink-300"
              >
                大会员
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
              {{
                platformAccountsStore.isBilibiliBound
                  ? `UID ${platformAccountsStore.bilibiliProfile?.uid} · 支持高音质音频解析与收藏夹播放`
                  : '扫码授权以解锁 B 站收藏夹导入与高音质音频流'
              }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <template v-if="platformAccountsStore.isBilibiliBound">
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-pink-500/12 text-pink-600 dark:text-pink-300 hover:bg-pink-500/20 active:scale-95 transition-all"
              @click="openBilibiliFavorites"
            >
              收藏夹
            </button>
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-full text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
              @click="confirmUnbind('bilibili')"
            >
              解绑
            </button>
          </template>
          <button
            v-else
            type="button"
            class="px-3 py-1.5 rounded-full text-xs font-semibold bg-pink-500 hover:bg-pink-600 text-white active:scale-95 transition-all"
            @click="openBindModal('bilibili')"
          >
            扫码绑定
          </button>
        </div>
      </div>

      <!-- QQ 音乐 -->
      <div
        class="rounded-xl bg-white/95 dark:bg-[#131316] border border-slate-200/70 dark:border-white/[0.06] p-3 flex items-center justify-between gap-3"
      >
        <div class="flex items-center gap-3 min-w-0">
          <img
            v-if="platformAccountsStore.isQqBound && platformAccountsStore.qqProfile?.avatar"
            :src="getImgUrl(platformAccountsStore.qqProfile.avatar)"
            alt="QQ 音乐头像"
            class="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-emerald-200/80 dark:border-emerald-400/25"
          />
          <div
            v-else
            class="w-9 h-9 rounded-full flex items-center justify-center bg-emerald-500/12 text-emerald-500 flex-shrink-0"
          >
            <i class="ri-qq-line text-lg"></i>
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[13px] font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
                {{
                  platformAccountsStore.isQqBound
                    ? platformAccountsStore.qqProfile?.nickname || 'QQ 音乐用户'
                    : 'QQ 音乐'
                }}
              </span>
              <span
                v-if="platformAccountsStore.isQqBound"
                class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
              >
                已绑定
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
              {{
                platformAccountsStore.isQqBound
                  ? `QQ ${platformAccountsStore.qqProfile?.uid} · 已优先用于解灰音源解析与歌单导入`
                  : '支持手机 QQ 扫码或粘贴 Cookie，导入歌单并增强解灰'
              }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <template v-if="platformAccountsStore.isQqBound">
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all"
              @click="openQqPlaylists"
            >
              导入歌单
            </button>
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-full text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
              @click="confirmUnbind('qq')"
            >
              解绑
            </button>
          </template>
          <button
            v-else
            type="button"
            class="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white active:scale-95 transition-all"
            @click="openBindModal('qq')"
          >
            扫码 / Cookie 绑定
          </button>
        </div>
      </div>
    </div>

    <!-- 扫码 / Cookie 绑定弹窗 -->
    <PlatformBindModal
      v-model:show="bindModalVisible"
      :platform="bindModalPlatform"
    />

    <!-- B 站收藏夹浏览与导入弹窗 -->
    <n-modal
      v-model:show="showBiliFavModal"
      :z-index="12000"
      preset="card"
      title="B 站收藏夹"
      style="width: min(620px, 94vw)"
    >
      <div class="space-y-3">
        <div v-if="biliFoldersLoading" class="py-6 text-center text-xs text-slate-500 dark:text-zinc-400">
          正在读取 B 站收藏夹列表...
        </div>

        <div v-else-if="biliFolders.length === 0" class="py-6 text-center text-xs text-slate-500 dark:text-zinc-400">
          暂无可见收藏夹，或登录态已过期，请尝试重新扫码绑定。
        </div>

        <template v-else>
          <!-- Folder Pills -->
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="folder in biliFolders"
              :key="folder.id"
              type="button"
              class="px-3 py-1 rounded-full text-xs font-medium transition-all active:scale-95"
              :class="
                selectedBiliFolderId === folder.id
                  ? 'bg-pink-500 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-white/[0.08] text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 dark:hover:bg-white/[0.12]'
              "
              @click="selectBiliFolder(folder.id)"
            >
              {{ folder.title }} ({{ folder.mediaCount }})
            </button>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between gap-2 pt-1">
            <span class="text-xs text-slate-500 dark:text-zinc-400">
              当前加载 {{ biliResources.length }} 个音频/视频稿件
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="biliResources.length === 0"
                class="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-white/[0.08] text-slate-700 dark:text-zinc-200 hover:bg-slate-200/80 disabled:opacity-50"
                @click="saveCurrentBiliFolderAsPlaylist"
              >
                保存为本地歌单
              </button>
              <button
                type="button"
                :disabled="biliResources.length === 0"
                class="px-3 py-1.5 rounded-full text-xs font-semibold bg-pink-500 hover:bg-pink-600 text-white disabled:opacity-50"
                @click="playAllBiliResources()"
              >
                播放全部
              </button>
            </div>
          </div>

          <!-- Resources -->
          <div v-if="biliResourcesLoading" class="py-8 text-center text-xs text-slate-500 dark:text-zinc-400">
            正在读取收藏夹稿件...
          </div>
          <div
            v-else
            class="max-h-[50vh] overflow-y-auto space-y-2 pr-1"
          >
            <div
              v-for="item in biliResources"
              :key="`${item.bvid}-${item.cid}`"
              class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#1C1C22] hover:bg-slate-100 dark:hover:bg-white/[0.08] cursor-pointer transition-colors"
              @click="playAllBiliResources(item)"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <img
                  v-if="item.cover"
                  :src="getImgUrl(item.cover)"
                  alt=""
                  class="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                />
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
                    {{ item.title }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                    {{ item.authorName || 'UP 主' }} · {{ formatDuration(item.durationSec) }}
                  </div>
                </div>
              </div>
              <i class="ri-play-circle-line text-lg text-pink-500 flex-shrink-0"></i>
            </div>
          </div>
        </template>
      </div>
    </n-modal>

    <!-- QQ 音乐歌单导入弹窗 -->
    <n-modal
      v-model:show="showQqPlaylistModal"
      :z-index="12000"
      preset="card"
      title="QQ 音乐自建歌单"
      style="width: min(600px, 94vw)"
    >
      <div class="space-y-3">
        <div v-if="qqPlaylistsLoading" class="py-6 text-center text-xs text-slate-500 dark:text-zinc-400">
          正在获取您的 QQ 音乐歌单...
        </div>

        <div v-else-if="qqPlaylists.length === 0" class="py-6 text-center text-xs text-slate-500 dark:text-zinc-400">
          未检测到自建歌单，若刚绑定失败可在「绑定 QQ 音乐」中重新粘贴有效 Cookie。
        </div>

        <div v-else class="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
          <div
            v-for="pl in qqPlaylists"
            :key="pl.tid"
            class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#1C1C22]"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <img
                v-if="pl.cover"
                :src="getImgUrl(pl.cover)"
                alt=""
                class="w-11 h-11 rounded-lg object-cover flex-shrink-0"
              />
              <div
                v-else
                class="w-11 h-11 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center flex-shrink-0"
              >
                <i class="ri-play-list-2-line text-lg"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-900 dark:text-[#FAFAFA] truncate">
                  {{ pl.name }}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  {{ pl.songCount }} 首曲目
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                :disabled="importingQqTid === pl.tid"
                class="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-200 disabled:opacity-50"
                @click="playQqPlaylistNow(pl)"
              >
                播放
              </button>
              <button
                type="button"
                :disabled="importingQqTid === pl.tid"
                class="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50"
                @click="importQqPlaylist(pl)"
              >
                {{ importingQqTid === pl.tid ? '导入中...' : '一键导入' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useDialog, useMessage } from 'naive-ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  type BilibiliFavFolder,
  type BilibiliFavResource,
  fetchBilibiliFavFolders,
  fetchBilibiliFavResources,
  fetchQqPlaylistDetail,
  fetchQqPlaylists,
  type QqBoundPlaylistSummary,
  type QqBoundPlaylistTrack
} from '@/api/platformBind';
import PlatformBindModal from '@/components/account/PlatformBindModal.vue';
import { usePlatformAccountsStore } from '@/store/modules/platformAccounts';
import { usePlayerStore } from '@/store/modules/player';
import { useUserStore } from '@/store/modules/user';
import type { SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import { getLoginTypeLabel } from '@/utils/auth';

defineOptions({
  name: 'MultiPlatformAccountsCard'
});

withDefaults(
  defineProps<{
    hidePrimary?: boolean;
  }>(),
  {
    hidePrimary: false
  }
);

const emit = defineEmits<{
  (e: 'playlistImported', payload: { id: string; name: string; count: number }): void;
}>();

const CUSTOM_PLAYLISTS_STORAGE_KEY = 'xiaopang_custom_playlists_v1';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const userStore = useUserStore();
const playerStore = usePlayerStore();
const platformAccountsStore = usePlatformAccountsStore();

const primaryLoginTypeLabel = computed(() => getLoginTypeLabel(userStore.loginType, t));

const bindModalVisible = ref(false);
const bindModalPlatform = ref<'bilibili' | 'qq'>('bilibili');

// B 站收藏夹状态
const showBiliFavModal = ref(false);
const biliFoldersLoading = ref(false);
const biliResourcesLoading = ref(false);
const biliFolders = ref<BilibiliFavFolder[]>([]);
const selectedBiliFolderId = ref<number>(0);
const biliResources = ref<BilibiliFavResource[]>([]);

// QQ 音乐歌单状态
const showQqPlaylistModal = ref(false);
const qqPlaylistsLoading = ref(false);
const qqPlaylists = ref<QqBoundPlaylistSummary[]>([]);
const importingQqTid = ref('');

const formatDuration = (sec: number): string => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const upsertCustomPlaylist = (id: string, name: string, tracks: SongResult[]) => {
  try {
    const raw = localStorage.getItem(CUSTOM_PLAYLISTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list: Array<{ id: string; name: string; updatedAt?: number; tracks: SongResult[] }> =
      Array.isArray(parsed) ? parsed : [];
    const entry = {
      id,
      name,
      updatedAt: Date.now(),
      tracks
    };
    const nextList = [entry, ...list.filter((item) => item && item.id !== id)];
    localStorage.setItem(CUSTOM_PLAYLISTS_STORAGE_KEY, JSON.stringify(nextList));
    emit('playlistImported', { id, name, count: tracks.length });
    return true;
  } catch {
    return false;
  }
};

const handlePrimaryAction = () => {
  void router.push('/login');
};

const openBindModal = (platform: 'bilibili' | 'qq') => {
  bindModalPlatform.value = platform;
  bindModalVisible.value = true;
};

const confirmUnbind = (platform: 'bilibili' | 'qq') => {
  const isBili = platform === 'bilibili';
  dialog.warning({
    title: isBili ? '解绑 B 站账号' : '解绑 QQ 音乐账号',
    content: `确定要解绑当前${isBili ? ' B 站' : ' QQ 音乐'}扩展账号吗？仅清除该平台授权凭据，绝不会退出您的网易云主账号，也不会删除已导入歌单。`,
    positiveText: '确认解绑',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    style: { zIndex: 13000 },
    onPositiveClick: () => {
      if (isBili) {
        platformAccountsStore.unbindBilibili();
        showBiliFavModal.value = false;
        biliFolders.value = [];
        biliResources.value = [];
        message.success('已解绑 B 站账号（网易云主账号保持不变）');
      } else {
        platformAccountsStore.unbindQq();
        showQqPlaylistModal.value = false;
        qqPlaylists.value = [];
        message.success('已解绑 QQ 音乐账号（网易云主账号保持不变）');
      }
    }
  });
};

const toBilibiliSongResult = (item: BilibiliFavResource, folderTitle: string): SongResult => {
  const safeCover = getImgUrl(item.cover);
  return {
    id: `${item.bvid}--${item.cid || 0}`,
    bvid: item.bvid,
    cid: item.cid || 0,
    name: item.title || item.bvid,
    picUrl: safeCover,
    ar: [{ id: 0, name: item.authorName || 'B站 UP 主' }] as any,
    al: { id: 0, name: folderTitle || 'B站收藏夹', picUrl: safeCover } as any,
    dt: (Number(item.durationSec) || 0) * 1000,
    count: 0,
    source: 'bilibili' as any,
    bilibiliData: { bvid: item.bvid, cid: item.cid || 0 }
  } as SongResult;
};

const selectBiliFolder = async (folderId: number) => {
  const cookie = platformAccountsStore.getBilibiliCookie();
  if (!cookie) {
    message.warning('B 站授权已失效，请重新扫码绑定');
    return;
  }
  selectedBiliFolderId.value = folderId;
  biliResourcesLoading.value = true;
  try {
    const res: any = await fetchBilibiliFavResources(folderId, 1, 30, cookie);
    biliResources.value = Array.isArray(res?.data?.items) ? res.data.items : [];
  } catch {
    biliResources.value = [];
    message.error('获取 B 站收藏夹内容失败');
  } finally {
    biliResourcesLoading.value = false;
  }
};

const openBilibiliFavorites = async () => {
  const uid = platformAccountsStore.bilibiliProfile?.uid || '';
  const cookie = platformAccountsStore.getBilibiliCookie();
  if (!uid || !cookie) {
    message.warning('请先扫码绑定 B 站账号');
    openBindModal('bilibili');
    return;
  }
  showBiliFavModal.value = true;
  biliFoldersLoading.value = true;
  biliFolders.value = [];
  biliResources.value = [];
  try {
    const res: any = await fetchBilibiliFavFolders(uid, cookie);
    const folders: BilibiliFavFolder[] = Array.isArray(res?.data?.folders) ? res.data.folders : [];
    biliFolders.value = folders;
    if (folders.length > 0) {
      await selectBiliFolder(folders[0].id);
    }
  } catch {
    message.error('读取 B 站收藏夹失败，请检查网络或重新绑定');
  } finally {
    biliFoldersLoading.value = false;
  }
};

const playAllBiliResources = async (targetItem?: BilibiliFavResource) => {
  if (biliResources.value.length === 0) return;
  const folder = biliFolders.value.find((f) => f.id === selectedBiliFolderId.value);
  const folderTitle = folder?.title || 'B站收藏夹';
  const songs = biliResources.value.map((item) => toBilibiliSongResult(item, folderTitle));
  const targetSong = targetItem
    ? songs.find((s) => (s as any).bvid === targetItem.bvid) || songs[0]
    : songs[0];
  playerStore.setPlayList(songs);
  await playerStore.setPlay(targetSong);
  showBiliFavModal.value = false;
};

const saveCurrentBiliFolderAsPlaylist = () => {
  if (biliResources.value.length === 0) return;
  const folder = biliFolders.value.find((f) => f.id === selectedBiliFolderId.value);
  const folderTitle = folder?.title || 'B站收藏夹';
  const songs = biliResources.value.map((item) => toBilibiliSongResult(item, folderTitle));
  const ok = upsertCustomPlaylist(
    `bili-${folder?.id || Date.now()}`,
    `B站 · ${folderTitle}`,
    songs
  );
  if (ok) {
    message.success(`已将「${folderTitle}」的 ${songs.length} 首曲目保存到「我的音乐 → 歌单」`);
  } else {
    message.error('保存本地歌单失败');
  }
};

const openQqPlaylists = async () => {
  const uid = platformAccountsStore.qqProfile?.uid || '';
  const cookie = platformAccountsStore.getQqCookie();
  if (!uid || !cookie) {
    message.warning('请先绑定 QQ 音乐账号');
    openBindModal('qq');
    return;
  }
  showQqPlaylistModal.value = true;
  qqPlaylistsLoading.value = true;
  qqPlaylists.value = [];
  try {
    const res: any = await fetchQqPlaylists(uid, cookie);
    qqPlaylists.value = Array.isArray(res?.data?.playlists) ? res.data.playlists : [];
  } catch {
    message.error('获取 QQ 音乐歌单失败，请检查 Cookie 是否有效');
  } finally {
    qqPlaylistsLoading.value = false;
  }
};

const toQqSongResult = (track: QqBoundPlaylistTrack, playlistName: string, idx: number): SongResult => {
  const safeCover = getImgUrl(track.picUrl);
  return {
    id: `qq-${track.mid || track.id || idx}`,
    name: track.name || '未知曲目',
    picUrl: safeCover,
    ar:
      Array.isArray(track.artists) && track.artists.length > 0
        ? (track.artists as any)
        : ([{ id: 0, name: '未知歌手' }] as any),
    al: {
      id: 0,
      name: track.albumName || playlistName,
      picUrl: safeCover
    } as any,
    dt: Number(track.durationMs) || 0,
    count: 0,
    source: 'netease'
  };
};

const loadQqPlaylistTracks = async (pl: QqBoundPlaylistSummary): Promise<SongResult[]> => {
  const cookie = platformAccountsStore.getQqCookie();
  if (!cookie) {
    throw new Error('QQ 音乐凭据已失效，请重新绑定');
  }
  const res: any = await fetchQqPlaylistDetail(pl.tid, cookie);
  const rawTracks: QqBoundPlaylistTrack[] = Array.isArray(res?.data?.playlist?.tracks)
    ? res.data.playlist.tracks
    : [];
  return rawTracks.map((t, idx) => toQqSongResult(t, pl.name, idx));
};

const importQqPlaylist = async (pl: QqBoundPlaylistSummary) => {
  if (importingQqTid.value) return;
  importingQqTid.value = pl.tid;
  try {
    const songs = await loadQqPlaylistTracks(pl);
    if (songs.length === 0) {
      message.warning(`「${pl.name}」暂无可导入曲目`);
      return;
    }
    const ok = upsertCustomPlaylist(`qq-${pl.tid}`, `QQ · ${pl.name}`, songs);
    if (ok) {
      message.success(`已导入「${pl.name}」（共 ${songs.length} 首）到「我的音乐 → 歌单」`);
    } else {
      message.error('保存本地歌单失败');
    }
  } catch (err: any) {
    message.error(err?.message || '读取 QQ 音乐歌单详情失败');
  } finally {
    importingQqTid.value = '';
  }
};

const playQqPlaylistNow = async (pl: QqBoundPlaylistSummary) => {
  if (importingQqTid.value) return;
  importingQqTid.value = pl.tid;
  try {
    const songs = await loadQqPlaylistTracks(pl);
    if (songs.length === 0) {
      message.warning(`「${pl.name}」暂无可播放曲目`);
      return;
    }
    playerStore.setPlayList(songs);
    await playerStore.setPlay(songs[0]);
    showQqPlaylistModal.value = false;
  } catch (err: any) {
    message.error(err?.message || '播放 QQ 音乐歌单失败');
  } finally {
    importingQqTid.value = '';
  }
};
</script>
