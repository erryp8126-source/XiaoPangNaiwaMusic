<template>
  <div class="listening-stats-panel space-y-4 pb-36">
    <!-- ===== 1. 顶部暖阳总览卡片 ===== -->
    <section class="hero-summary-card relative overflow-hidden rounded-[26px] p-5 text-white shadow-lg">
      <div class="hero-glow-orb-1" aria-hidden="true"></div>
      <div class="hero-glow-orb-2" aria-hidden="true"></div>

      <div class="relative z-10">
        <div class="flex items-center justify-between gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold backdrop-blur-md">
            <i :class="listenerBadge.icon" class="text-amber-200"></i>
            {{ listenerBadge.title }}
          </span>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-bold backdrop-blur-md active:scale-95 transition-all"
              @click="openReportModal('week')"
            >
              <i class="ri-image-2-line text-sm"></i>
              <span>生成报告卡</span>
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white/90 active:scale-90 transition-all"
              title="刷新统计"
              @click="handleRefresh"
            >
              <i class="ri-refresh-line text-base" :class="{ 'animate-spin': loading }"></i>
            </button>
          </div>
        </div>

        <div class="mt-4">
          <div class="text-xs font-medium text-white/80">累计听歌时长</div>
          <div class="mt-1 text-[30px] font-black leading-tight tracking-tight">
            {{ formatDurationFull(stats.totalSeconds) }}
          </div>
          <div class="mt-1 text-xs text-white/80">
            {{ listenerBadge.desc }}
          </div>
        </div>

        <!-- 下一级进度条 -->
        <div v-if="listenerBadge.nextTitle" class="mt-3.5">
          <div class="flex items-center justify-between text-[11px] text-white/80 mb-1">
            <span>升级进度</span>
            <span>距「{{ listenerBadge.nextTitle }}」还差 {{ listenerBadge.remainHours }} 小时</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-black/20 overflow-hidden">
            <div
              class="h-full rounded-full bg-white/90 transition-all duration-500"
              :style="{ width: `${listenerBadge.progress}%` }"
            ></div>
          </div>
        </div>

        <!-- 底部 3 格核心数据 -->
        <div class="mt-5 grid grid-cols-3 gap-2.5">
          <div class="rounded-2xl bg-black/18 px-3 py-2.5 backdrop-blur-sm">
            <div class="text-[11px] text-white/75">今日听歌</div>
            <div class="mt-0.5 text-sm font-extrabold tabular-nums">
              {{ formatDurationCompact(todaySeconds) }}
            </div>
          </div>
          <div class="rounded-2xl bg-black/18 px-3 py-2.5 backdrop-blur-sm">
            <div class="text-[11px] text-white/75">近 7 天</div>
            <div class="mt-0.5 text-sm font-extrabold tabular-nums">
              {{ formatDurationCompact(weekSeconds) }}
            </div>
          </div>
          <div class="rounded-2xl bg-black/18 px-3 py-2.5 backdrop-blur-sm">
            <div class="text-[11px] text-white/75">连续听歌</div>
            <div class="mt-0.5 text-sm font-extrabold tabular-nums">
              {{ streakDays }} 天
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== 2. 近 7 天每日听歌柱状图 ===== -->
    <section class="stats-card rounded-[24px] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-4 rounded-full bg-gradient-to-b from-amber-400 to-orange-500"></span>
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">近 7 天听歌趋势</h3>
        </div>
        <span class="text-xs font-semibold text-amber-600 dark:text-amber-300 tabular-nums">
          {{ selectedDayInfo }}
        </span>
      </div>

      <div class="grid grid-cols-7 gap-2 items-end h-[132px] pt-4">
        <button
          v-for="day in last7Days"
          :key="day.key"
          type="button"
          class="flex flex-col items-center h-full justify-end gap-1.5 focus:outline-none group"
          @click="selectedDayKey = day.key"
        >
          <span
            class="text-[10px] font-semibold tabular-nums transition-colors"
            :class="
              activeDayKey === day.key
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-slate-400 dark:text-slate-500'
            "
          >
            {{ day.seconds > 0 ? Math.max(1, Math.round(day.seconds / 60)) + 'm' : '0' }}
          </span>
          <div class="w-full flex-1 flex items-end justify-center">
            <div
              class="w-6 max-w-full rounded-t-xl rounded-b-md transition-all duration-300"
              :class="
                activeDayKey === day.key
                  ? 'bg-gradient-to-t from-orange-500 via-amber-400 to-yellow-300 shadow-md shadow-amber-500/35'
                  : day.seconds > 0
                    ? 'bg-sky-200/90 dark:bg-sky-500/35 group-hover:bg-sky-300'
                    : 'bg-slate-200/70 dark:bg-slate-700/60'
              "
              :style="{ height: `${day.percent}%` }"
            ></div>
          </div>
          <span
            class="text-[11px] font-semibold"
            :class="
              activeDayKey === day.key
                ? 'text-slate-900 dark:text-white'
                : 'text-slate-500 dark:text-slate-400'
            "
          >
            {{ day.label }}
          </span>
        </button>
      </div>
    </section>

    <!-- ===== 3. 听歌时段偏好 ===== -->
    <section class="stats-card rounded-[24px] p-4">
      <div class="flex items-center justify-between gap-2 mb-1">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-4 rounded-full bg-gradient-to-b from-sky-400 to-indigo-500"></span>
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">听歌时段分布</h3>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          累计活跃 {{ activeDays }} 天
        </span>
      </div>
      <p class="text-xs font-medium text-sky-600 dark:text-sky-300 mb-3.5">
        {{ favoriteTimeHabit }}
      </p>

      <div class="space-y-2.5">
        <div v-for="bucket in timeBuckets" :key="bucket.key" class="flex items-center gap-2.5">
          <div class="w-24 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 flex-shrink-0">
            <i :class="bucket.icon" class="text-sky-500 dark:text-sky-400 text-sm"></i>
            <span>{{ bucket.label }}</span>
          </div>
          <div class="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400 transition-all duration-500"
              :style="{ width: `${Math.max(bucket.percent, bucket.seconds > 0 ? 4 : 0)}%` }"
            ></div>
          </div>
          <span class="w-10 text-right text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">
            {{ bucket.percent }}%
          </span>
        </div>
      </div>
    </section>

    <!-- ===== 4. 最常听歌手 Top 5 ===== -->
    <section v-if="topArtists.length > 0" class="stats-card rounded-[24px] p-4">
      <div class="flex items-center gap-2 mb-3.5">
        <span class="w-1.5 h-4 rounded-full bg-gradient-to-b from-rose-400 to-amber-500"></span>
        <h3 class="text-sm font-bold text-slate-800 dark:text-white">最常听的歌手</h3>
      </div>

      <div class="space-y-3">
        <div v-for="(ar, idx) in topArtists" :key="ar.name" class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                :class="
                  idx === 0
                    ? 'bg-amber-500 text-white'
                    : idx === 1
                      ? 'bg-sky-500 text-white'
                      : idx === 2
                        ? 'bg-rose-400 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                "
              >
                {{ idx + 1 }}
              </span>
              <span class="font-semibold text-slate-800 dark:text-slate-100 truncate">{{ ar.name }}</span>
            </div>
            <span class="text-slate-500 dark:text-slate-400 font-semibold tabular-nums flex-shrink-0 ml-2">
              {{ formatDurationCompact(ar.seconds) }}
            </span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
              :style="{ width: `${ar.percent}%` }"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== 5. 最常听歌曲 Top 10 ===== -->
    <section class="stats-card rounded-[24px] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-4 rounded-full bg-gradient-to-b from-amber-400 to-sky-500"></span>
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">最常循环的歌曲</h3>
        </div>
        <span class="text-[11px] text-slate-400">轻点播放</span>
      </div>

      <div v-if="topSongs.length === 0" class="py-8 text-center">
        <i class="ri-music-2-line text-3xl text-slate-300 dark:text-slate-600"></i>
        <p class="mt-2 text-xs text-slate-400 dark:text-slate-500">
          去听几首歌，这里就会生成你的专属听歌排行榜啦
        </p>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="(song, idx) in topSongs"
          :key="song.id"
          type="button"
          class="w-full flex items-center gap-3 p-2 rounded-2xl text-left hover:bg-sky-50/80 dark:hover:bg-slate-800/80 active:scale-[0.985] transition-all"
          @click="handlePlayStatSong(song)"
        >
          <span
            class="w-5 text-center text-xs font-extrabold tabular-nums flex-shrink-0"
            :class="
              idx < 3 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'
            "
          >
            {{ idx + 1 }}
          </span>
          <img
            v-if="song.cover"
            :src="getImgUrl(song.cover, '100y100')"
            alt=""
            class="w-10 h-10 rounded-xl object-cover flex-shrink-0 bg-slate-200 dark:bg-slate-700"
          />
          <div
            v-else
            class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 dark:bg-amber-500/20 text-amber-500"
          >
            <i class="ri-music-2-fill text-lg"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {{ song.name }}
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {{ song.artist || '未知歌手' }} · {{ song.plays }} 次
            </div>
          </div>
          <span class="text-xs font-bold text-amber-600 dark:text-amber-300 tabular-nums flex-shrink-0">
            {{ formatDurationCompact(song.seconds) }}
          </span>
        </button>
      </div>
    </section>

    <!-- ===== 6. 底部说明与重置 ===== -->
    <div class="flex items-center justify-between px-2 pt-1 text-xs text-slate-400 dark:text-slate-500">
      <span>息屏与后台连播均自动计入真实播放时长</span>
      <button
        type="button"
        class="text-rose-500/85 hover:text-rose-600 font-semibold px-2 py-1 rounded-lg active:scale-95 transition-all"
        @click="confirmReset"
      >
        重置数据
      </button>
    </div>

    <!-- ===== 7. 听歌统计报告卡片生成弹窗 ===== -->
    <n-modal
      v-model:show="showReportModal"
      preset="card"
      :z-index="12000"
      style="width: 92vw; max-width: 440px"
      title="生成听歌报告卡片"
      :bordered="false"
    >
      <div class="space-y-3.5 pr-0.5" style="max-height: 82vh; overflow-y: auto">
        <div class="flex items-center justify-center gap-2">
          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            :class="
              reportPeriod === 'week'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            "
            @click="switchReportPeriod('week')"
          >
            本周报告（近 7 天）
          </button>
          <button
            type="button"
            class="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            :class="
              reportPeriod === 'month'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            "
            @click="switchReportPeriod('month')"
          >
            本月报告（近 30 天）
          </button>
        </div>

        <div
          class="relative w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/60 flex items-center justify-center min-h-[240px] max-h-[52vh]"
        >
          <img
            v-if="reportPreviewUrl"
            :src="reportPreviewUrl"
            alt="听歌统计报告卡片"
            class="w-full h-auto max-h-[52vh] object-contain"
          />
          <n-spin v-else size="medium" />
        </div>

        <div class="flex items-center gap-2.5 pb-1">
          <button
            type="button"
            :disabled="!reportPreviewUrl || savingReport"
            class="flex-1 py-2.5 px-4 rounded-full text-sm font-extrabold text-white active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-md"
            style="background: linear-gradient(135deg, #ffc21c 0%, #eb8f00 100%)"
            @click="handleSaveReportCard"
          >
            <i
              :class="savingReport ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'"
              class="text-base"
            ></i>
            <span>{{ savingReport ? '正在保存...' : isNativeShell ? '保存到相册 / 分享' : '保存报告图片' }}</span>
          </button>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useDialog, useMessage } from 'naive-ui';
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  formatDurationCompact,
  formatDurationFull,
  type ListeningSongStat,
  useListeningStatsStore
} from '@/store/modules/listeningStats';
import { usePlayerStore } from '@/store/modules/player';
import { getImgUrl } from '@/utils';
import { isAndroid, saveImageViaNativeBridge, triggerHaptic } from '@/utils/androidBridge';
import {
  buildListeningReportSummary,
  renderListeningReportCanvas,
  type ReportPeriod
} from '@/utils/listeningReportCard';

const statsStore = useListeningStatsStore();
const playerStore = usePlayerStore();
const dialog = useDialog();
const message = useMessage();
const isNativeShell = computed(() => isAndroid());

const showReportModal = ref(false);
const reportPeriod = ref<ReportPeriod>('week');
const reportPreviewUrl = ref('');
const savingReport = ref(false);

const regenerateReportImage = () => {
  try {
    const summary = buildListeningReportSummary(stats.value, reportPeriod.value);
    const canvas = renderListeningReportCanvas(summary);
    reportPreviewUrl.value = canvas.toDataURL('image/png');
  } catch (err) {
    console.error('[ListeningReport] render failed:', err);
    message.error('生成听歌报告卡片失败');
  }
};

const openReportModal = async (period: ReportPeriod = 'week') => {
  triggerHaptic('light');
  reportPeriod.value = period;
  showReportModal.value = true;
  reportPreviewUrl.value = '';
  await statsStore.refreshStats();
  regenerateReportImage();
};

const switchReportPeriod = (period: ReportPeriod) => {
  if (reportPeriod.value === period) return;
  triggerHaptic('selection');
  reportPeriod.value = period;
  regenerateReportImage();
};

const handleSaveReportCard = async () => {
  if (!reportPreviewUrl.value || savingReport.value) return;
  savingReport.value = true;
  try {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `xiaopang-listening-report-${reportPeriod.value}-${stamp}.png`;

    if (isAndroid()) {
      const res = await saveImageViaNativeBridge(filename, reportPreviewUrl.value);
      if (res.success) {
        triggerHaptic('success');
        message.success(
          window.__ALGER_PLATFORM__ === 'ios'
            ? '已调起系统分享/保存面板'
            : `听歌报告已保存至相册（${res.path || filename}）`
        );
        return;
      }
      message.error(res.error || '保存图片失败');
      return;
    }

    // Web / Desktop 触发 PNG 下载
    const a = document.createElement('a');
    a.href = reportPreviewUrl.value;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    triggerHaptic('success');
    message.success(`已保存 ${filename}`);
  } finally {
    savingReport.value = false;
  }
};

const {
  stats,
  loading,
  todaySeconds,
  weekSeconds,
  activeDays,
  streakDays,
  last7Days,
  listenerBadge,
  timeBuckets,
  favoriteTimeHabit,
  topArtists,
  topSongs
} = storeToRefs(statsStore);

const selectedDayKey = ref('');
const activeDayKey = computed(() => {
  if (selectedDayKey.value && last7Days.value.some((d) => d.key === selectedDayKey.value)) {
    return selectedDayKey.value;
  }
  return last7Days.value[last7Days.value.length - 1]?.key || '';
});

const selectedDayInfo = computed(() => {
  const found = last7Days.value.find((d) => d.key === activeDayKey.value);
  if (!found) return '';
  return `${found.shortDate} (${found.label}) · ${formatDurationCompact(found.seconds)}`;
});

let liveRefreshTimer: number | null = null;

const handleRefresh = async () => {
  await statsStore.refreshStats();
};

const handlePlayStatSong = async (song: ListeningSongStat) => {
  const numericId = Number(song.id);
  if (!song.id || Number.isNaN(numericId) || numericId <= 0) {
    message.info('该曲目为本地或临时音频，请在本地音乐中播放');
    return;
  }
  const songPayload: any = {
    id: numericId,
    name: song.name,
    picUrl: song.cover,
    ar: song.artist
      ? song.artist.split(/[/、,，]/).map((n) => ({ id: 0, name: n.trim() }))
      : [],
    al: { id: 0, name: '', picUrl: song.cover }
  };
  await playerStore.setPlay(songPayload);
};

const confirmReset = () => {
  dialog.warning({
    title: '重置听歌统计',
    content: '确定要清空本机累计的听歌时长、趋势与排行数据吗？此操作无法撤销。',
    positiveText: '确定清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      const ok = await statsStore.resetAllStats();
      if (ok) {
        message.success('听歌统计已重置');
      } else {
        message.error('重置失败');
      }
    }
  });
};

onMounted(() => {
  void statsStore.refreshStats();
  // 停留在本页且正在播放时，每 3 秒自动同步一次原生实时累计时长
  liveRefreshTimer = window.setInterval(() => {
    if (playerStore.play) {
      void statsStore.refreshStats();
    }
  }, 3000);
});

onUnmounted(() => {
  if (liveRefreshTimer !== null) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
});
</script>

<style scoped lang="scss">
.hero-summary-card {
  background: linear-gradient(135deg, #f59e0b 0%, #ea580c 52%, #0284c7 100%);
  box-shadow: 0 12px 28px rgba(234, 88, 12, 0.24);
}

.hero-glow-orb-1 {
  position: absolute;
  top: -36px;
  right: -24px;
  width: 150px;
  height: 150px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255, 241, 180, 0.45) 0%, transparent 70%);
}

.hero-glow-orb-2 {
  position: absolute;
  bottom: -48px;
  left: -30px;
  width: 160px;
  height: 160px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.4) 0%, transparent 70%);
}

.stats-card {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(186, 218, 238, 0.52);
  box-shadow: 0 6px 20px rgba(82, 134, 168, 0.08);
}

:global(.dark) .stats-card {
  background: rgba(25, 34, 49, 0.9);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}
</style>
