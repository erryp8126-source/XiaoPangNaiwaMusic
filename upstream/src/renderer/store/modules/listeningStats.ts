import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { usePlayerStore } from '@/store/modules/player';
import { invokeAndroidAsync, isAndroid } from '@/utils/androidBridge';

export interface ListeningSongStat {
  id: string;
  name: string;
  artist: string;
  cover: string;
  seconds: number;
  plays: number;
}

export interface ListeningStatsData {
  totalSeconds: number;
  dailySeconds: Record<string, number>;
  hourlySeconds: number[];
  songs: Record<string, ListeningSongStat>;
  artists: Record<string, number>;
}

const WEB_STORAGE_KEY = 'alger_listening_stats_v1';

const createEmptyStats = (): ListeningStatsData => ({
  totalSeconds: 0,
  dailySeconds: {},
  hourlySeconds: Array.from({ length: 24 }, () => 0),
  songs: {},
  artists: {}
});

const formatDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const normalizeStats = (raw: any): ListeningStatsData => {
  const base = createEmptyStats();
  if (!raw || typeof raw !== 'object') return base;

  base.totalSeconds = Math.max(0, Number(raw.totalSeconds) || 0);
  if (raw.dailySeconds && typeof raw.dailySeconds === 'object') {
    for (const [k, v] of Object.entries(raw.dailySeconds)) {
      const sec = Math.max(0, Number(v) || 0);
      if (sec > 0) base.dailySeconds[k] = sec;
    }
  }
  if (Array.isArray(raw.hourlySeconds)) {
    for (let i = 0; i < Math.min(24, raw.hourlySeconds.length); i++) {
      base.hourlySeconds[i] = Math.max(0, Number(raw.hourlySeconds[i]) || 0);
    }
  }
  if (raw.songs && typeof raw.songs === 'object') {
    for (const [k, v] of Object.entries(raw.songs as Record<string, any>)) {
      if (!v || typeof v !== 'object') continue;
      base.songs[k] = {
        id: String(v.id ?? k),
        name: String(v.name || '未知歌曲'),
        artist: String(v.artist || ''),
        cover: String(v.cover || ''),
        seconds: Math.max(0, Number(v.seconds) || 0),
        plays: Math.max(0, Number(v.plays) || 0)
      };
    }
  }
  if (raw.artists && typeof raw.artists === 'object') {
    for (const [k, v] of Object.entries(raw.artists)) {
      const sec = Math.max(0, Number(v) || 0);
      if (k.trim() && sec > 0) base.artists[k] = sec;
    }
  }
  return base;
};

export const formatDurationFull = (totalSec: number): string => {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec} 秒`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hours === 0) return `${mins} 分钟`;
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
};

export const formatDurationCompact = (totalSec: number): string => {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}秒`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hours === 0) return `${mins}分钟`;
  return `${hours}小时${mins > 0 ? `${mins}分` : ''}`;
};

export const useListeningStatsStore = defineStore('listeningStats', () => {
  const stats = ref<ListeningStatsData>(createEmptyStats());
  const loading = ref(false);
  let webTimer: number | null = null;
  let webDirtyTicks = 0;
  let webLastSongKey = '';

  const loadWebStats = (): ListeningStatsData => {
    try {
      const raw = localStorage.getItem(WEB_STORAGE_KEY);
      if (!raw) return createEmptyStats();
      return normalizeStats(JSON.parse(raw));
    } catch {
      return createEmptyStats();
    }
  };

  const saveWebStats = () => {
    try {
      localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(stats.value));
    } catch {
      // ignore quota errors
    }
  };

  const refreshStats = async () => {
    loading.value = true;
    try {
      if (isAndroid()) {
        // Android 端支持同步直读；iOS 端走 invokeAsync 获取 Swift 原生精准累计数据
        if (typeof window.AlgerAndroid?.getListeningStats === 'function') {
          const raw = window.AlgerAndroid.getListeningStats();
          stats.value = normalizeStats(JSON.parse(raw));
        } else {
          const raw = await invokeAndroidAsync<any>('get-listening-stats', {}, 6000);
          stats.value = normalizeStats(typeof raw === 'string' ? JSON.parse(raw) : raw);
        }
      } else {
        stats.value = loadWebStats();
      }
    } catch (err) {
      console.warn('[ListeningStats] refresh failed:', err);
      if (!isAndroid()) {
        stats.value = loadWebStats();
      }
    } finally {
      loading.value = false;
    }
  };

  const resetAllStats = async (): Promise<boolean> => {
    try {
      if (isAndroid()) {
        if (typeof window.AlgerAndroid?.resetListeningStats === 'function') {
          window.AlgerAndroid.resetListeningStats();
        } else {
          await invokeAndroidAsync('reset-listening-stats', {}, 6000);
        }
      }
      stats.value = createEmptyStats();
      if (!isAndroid()) {
        localStorage.removeItem(WEB_STORAGE_KEY);
      }
      return true;
    } catch (err) {
      console.warn('[ListeningStats] reset failed:', err);
      return false;
    }
  };

  const mergeRemoteStats = async (incomingRaw: any): Promise<ListeningStatsData> => {
    const incoming = normalizeStats(incomingRaw);
    try {
      if (isAndroid()) {
        const payloadStr = JSON.stringify(incoming);
        if (typeof window.AlgerAndroid?.mergeListeningStats === 'function') {
          const mergedRaw = window.AlgerAndroid.mergeListeningStats(payloadStr);
          stats.value = normalizeStats(JSON.parse(mergedRaw));
        } else {
          const mergedRaw = await invokeAndroidAsync<any>(
            'merge-listening-stats',
            { stats: payloadStr },
            6000
          );
          stats.value = normalizeStats(
            typeof mergedRaw === 'string' ? JSON.parse(mergedRaw) : mergedRaw
          );
        }
        return stats.value;
      }

      // Web / Safari PWA 本地幂等最大值合并
      const local = loadWebStats();
      const merged = createEmptyStats();
      const allDays = new Set([
        ...Object.keys(local.dailySeconds),
        ...Object.keys(incoming.dailySeconds)
      ]);
      for (const day of allDays) {
        const sec = Math.max(local.dailySeconds[day] || 0, incoming.dailySeconds[day] || 0);
        if (sec > 0) merged.dailySeconds[day] = sec;
      }
      for (let i = 0; i < 24; i++) {
        merged.hourlySeconds[i] = Math.max(
          local.hourlySeconds[i] || 0,
          incoming.hourlySeconds[i] || 0
        );
      }
      const allSongs = new Set([...Object.keys(local.songs), ...Object.keys(incoming.songs)]);
      for (const key of allSongs) {
        const a = local.songs[key];
        const b = incoming.songs[key];
        if (a && b) {
          merged.songs[key] = {
            id: a.id || b.id || key,
            name: a.name || b.name || '未知歌曲',
            artist: a.artist || b.artist || '',
            cover: a.cover || b.cover || '',
            seconds: Math.max(a.seconds, b.seconds),
            plays: Math.max(a.plays, b.plays)
          };
        } else if (a || b) {
          merged.songs[key] = { ...(a || b)! };
        }
      }
      const allArtists = new Set([...Object.keys(local.artists), ...Object.keys(incoming.artists)]);
      for (const ar of allArtists) {
        const sec = Math.max(local.artists[ar] || 0, incoming.artists[ar] || 0);
        if (sec > 0) merged.artists[ar] = sec;
      }
      const dailySum = Object.values(merged.dailySeconds).reduce((acc, v) => acc + v, 0);
      merged.totalSeconds = Math.max(local.totalSeconds, incoming.totalSeconds, dailySum);
      stats.value = merged;
      saveWebStats();
      return stats.value;
    } catch (err) {
      console.warn('[ListeningStats] mergeRemoteStats failed:', err);
      return stats.value;
    }
  };

  // Web / Safari PWA 端兜底每秒累计真实播放时长（原生 Android/iOS 由原生播放服务在息屏后台精准记录）
  const initWebFallbackTracking = () => {
    if (isAndroid() || webTimer !== null) return;
    stats.value = loadWebStats();

    webTimer = window.setInterval(() => {
      try {
        const playerStore = usePlayerStore();
        if (!playerStore.play) return;
        const song = playerStore.playMusic;
        const now = new Date();
        const dayKey = formatDateKey(now);
        const hour = now.getHours();

        stats.value.totalSeconds += 1;
        stats.value.dailySeconds[dayKey] = (stats.value.dailySeconds[dayKey] || 0) + 1;
        stats.value.hourlySeconds[hour] = (stats.value.hourlySeconds[hour] || 0) + 1;

        if (song?.id || song?.name) {
          const key = String(song.id || `title:${song.name}`);
          const artistText =
            (song.ar || song.song?.artists || [])
              .map((a: any) => a?.name)
              .filter(Boolean)
              .join(' / ') || '';
          const coverUrl = song.picUrl || song.al?.picUrl || '';
          const isNewPlay = key !== webLastSongKey;
          if (isNewPlay) webLastSongKey = key;

          const cur = stats.value.songs[key];
          if (cur) {
            cur.seconds += 1;
            if (isNewPlay) cur.plays += 1;
            if (coverUrl && !cur.cover) cur.cover = coverUrl;
          } else {
            stats.value.songs[key] = {
              id: String(song.id || key),
              name: song.name || '未知歌曲',
              artist: artistText,
              cover: coverUrl,
              seconds: 1,
              plays: 1
            };
          }

          if (artistText) {
            artistText
              .split(/[/、,，]/)
              .map((s: string) => s.trim())
              .filter(Boolean)
              .forEach((ar: string) => {
                stats.value.artists[ar] = (stats.value.artists[ar] || 0) + 1;
              });
          }
        }

        webDirtyTicks += 1;
        if (webDirtyTicks >= 5) {
          webDirtyTicks = 0;
          saveWebStats();
        }
      } catch {
        // ignore
      }
    }, 1000);
  };

  // ==================== 聚合计算指标 ====================

  const todayKey = computed(() => formatDateKey(new Date()));

  const todaySeconds = computed(() => stats.value.dailySeconds[todayKey.value] || 0);

  const last7Days = computed(() => {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const result: Array<{
      key: string;
      label: string;
      shortDate: string;
      seconds: number;
      isToday: boolean;
      percent: number;
    }> = [];
    const now = new Date();
    let maxSec = 0;

    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = formatDateKey(d);
      const sec = stats.value.dailySeconds[key] || 0;
      if (sec > maxSec) maxSec = sec;
      result.push({
        key,
        label: offset === 0 ? '今天' : weekdays[d.getDay()],
        shortDate: `${d.getMonth() + 1}/${d.getDate()}`,
        seconds: sec,
        isToday: offset === 0,
        percent: 0
      });
    }

    const scaleBase = Math.max(maxSec, 60);
    return result.map((item) => ({
      ...item,
      percent: item.seconds > 0 ? Math.max(10, Math.round((item.seconds / scaleBase) * 100)) : 4
    }));
  });

  const weekSeconds = computed(() =>
    last7Days.value.reduce((acc, item) => acc + item.seconds, 0)
  );

  const activeDays = computed(
    () => Object.values(stats.value.dailySeconds).filter((s) => s > 0).length
  );

  const streakDays = computed(() => {
    const now = new Date();
    let streak = 0;
    // 若今天还没听满，允许从昨天起算连续天数
    const todayHas = (stats.value.dailySeconds[formatDateKey(now)] || 0) > 0;
    const startOffset = todayHas ? 0 : 1;
    for (let i = startOffset; i < 120; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if ((stats.value.dailySeconds[formatDateKey(d)] || 0) > 0) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  });

  const listenerBadge = computed(() => {
    const hrs = stats.value.totalSeconds / 3600;
    const tiers = [
      { min: 0, max: 1, title: '初遇旋律', desc: '刚刚开启你的小庞奶娃听歌之旅', icon: 'ri-seedling-fill' },
      { min: 1, max: 5, title: '清风听客', desc: '音乐已开始悄悄陪伴你的日常', icon: 'ri-windy-fill' },
      { min: 5, max: 20, title: '日落漫游者', desc: '在暖阳与旋律间自在穿梭', icon: 'ri-sun-fill' },
      { min: 20, max: 50, title: '旋律收藏家', desc: '每首歌都记着你的一段心情', icon: 'ri-disc-fill' },
      { min: 50, max: 150, title: '奶娃资深乐迷', desc: '耳机一戴，世界就归你所有', icon: 'ri-headphone-fill' },
      { min: 150, max: 500, title: '殿堂级音乐灵魂', desc: '灵魂自带 BGM 的重度乐迷', icon: 'ri-vip-crown-2-fill' }
    ];
    const current = tiers.find((t) => hrs >= t.min && hrs < t.max) || tiers[tiers.length - 1];
    const nextIdx = tiers.indexOf(current) + 1;
    const nextTier = tiers[nextIdx] || null;
    const progress = nextTier
      ? Math.min(100, Math.max(4, Math.round(((hrs - current.min) / (nextTier.min - current.min)) * 100)))
      : 100;
    const remainHours = nextTier ? Math.max(0.1, Number((nextTier.min - hrs).toFixed(1))) : 0;

    return {
      ...current,
      nextTitle: nextTier?.title || '',
      remainHours,
      progress
    };
  });

  const timeBuckets = computed(() => {
    const h = stats.value.hourlySeconds;
    const sumRange = (hours: number[]) => hours.reduce((acc, hr) => acc + (h[hr] || 0), 0);
    const raw = [
      { key: 'morning', label: '清晨 05–09', habit: '早起元气听众', icon: 'ri-sun-foggy-line', seconds: sumRange([5, 6, 7, 8]) },
      { key: 'forenoon', label: '上午 09–12', habit: '专注效率搭子', icon: 'ri-sun-line', seconds: sumRange([9, 10, 11]) },
      { key: 'afternoon', label: '午后 12–18', habit: '午后暖阳听歌党', icon: 'ri-cup-line', seconds: sumRange([12, 13, 14, 15, 16, 17]) },
      { key: 'evening', label: '傍晚 18–22', habit: '日落治愈漫游者', icon: 'ri-contrast-2-line', seconds: sumRange([18, 19, 20, 21]) },
      { key: 'night', label: '深夜 22–05', habit: '深夜单曲循环家', icon: 'ri-moon-clear-line', seconds: sumRange([22, 23, 0, 1, 2, 3, 4]) }
    ];
    const total = raw.reduce((acc, b) => acc + b.seconds, 0);
    return raw.map((b) => ({
      ...b,
      percent: total > 0 ? Math.round((b.seconds / total) * 100) : 0
    }));
  });

  const favoriteTimeHabit = computed(() => {
    const sorted = [...timeBuckets.value].sort((a, b) => b.seconds - a.seconds);
    if (!sorted.length || sorted[0].seconds <= 0) return '等待记录你的听歌作息';
    return `${sorted[0].habit} · ${sorted[0].label} 占比 ${sorted[0].percent}%`;
  });

  const topArtists = computed(() => {
    const entries = Object.entries(stats.value.artists)
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 5);
    const maxSec = Math.max(entries[0]?.seconds || 1, 1);
    return entries.map((e) => ({
      ...e,
      percent: Math.max(10, Math.round((e.seconds / maxSec) * 100))
    }));
  });

  const topSongs = computed(() => {
    return Object.values(stats.value.songs)
      .filter((s) => s.seconds > 0 || s.plays > 0)
      .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
      .slice(0, 10);
  });

  return {
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
    topSongs,
    refreshStats,
    resetAllStats,
    mergeRemoteStats,
    initWebFallbackTracking
  };
});
