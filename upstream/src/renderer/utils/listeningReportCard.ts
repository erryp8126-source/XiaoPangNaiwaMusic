/**
 * 听歌统计可视化报告卡片数据聚合与高分辨率 HTML Canvas 绘制工具
 * - 纯 Canvas 矢量与文字排版，无外部跨域图片污染风险，100% 可导出高清 PNG
 */

export type ReportPeriod = 'week' | 'month';

export interface ReportSongInput {
  id: string;
  name: string;
  artist: string;
  cover: string;
  seconds: number;
  plays: number;
}

export interface ReportStatsInput {
  totalSeconds: number;
  dailySeconds: Record<string, number>;
  hourlySeconds: number[];
  songs: Record<string, ReportSongInput>;
  artists: Record<string, number>;
}

export interface ListeningReportSummary {
  period: ReportPeriod;
  periodTitle: string;
  dateRangeLabel: string;
  periodSeconds: number;
  allTimeSeconds: number;
  activeDays: number;
  totalDaysWindow: number;
  totalPlays: number;
  peakHour: number;
  peakHourLabel: string;
  hourlySeconds: number[];
  topSongs: Array<{ name: string; artist: string; seconds: number; plays: number }>;
  topArtists: Array<{ name: string; seconds: number; percent: number }>;
  badgeTitle: string;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDotDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export function formatReportDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec} 秒`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hours === 0) return `${mins} 分钟`;
  return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
}

function describePeakHour(hour: number): string {
  if (hour >= 0 && hour < 6) return `深夜党 · 最爱 ${String(hour).padStart(2, '0')}:00 听歌`;
  if (hour >= 6 && hour < 12) return `晨光乐迷 · 最爱 ${String(hour).padStart(2, '0')}:00 听歌`;
  if (hour >= 12 && hour < 18) return `午后律动 · 最爱 ${String(hour).padStart(2, '0')}:00 听歌`;
  return `夜色知音 · 最爱 ${String(hour).padStart(2, '0')}:00 听歌`;
}

function resolveBadgeTitle(totalSec: number): string {
  const hours = totalSec / 3600;
  if (hours >= 100) return '殿堂知音';
  if (hours >= 30) return '黑胶收藏家';
  if (hours >= 10) return '旋律挚友';
  if (hours >= 2) return '音乐探索者';
  return '初遇旋律';
}

export function buildListeningReportSummary(
  stats: ReportStatsInput,
  period: ReportPeriod = 'week',
  now: Date = new Date()
): ListeningReportSummary {
  const windowDays = period === 'week' ? 7 : 30;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (windowDays - 1));
  const dailyMap = stats?.dailySeconds || {};

  let periodSeconds = 0;
  let activeDays = 0;
  for (let i = 0; i < windowDays; i++) {
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = formatYmd(cursor);
    const sec = Math.max(0, Number(dailyMap[key]) || 0);
    if (sec > 0) {
      periodSeconds += sec;
      activeDays++;
    }
  }

  const allTimeSeconds = Math.max(0, Number(stats?.totalSeconds) || 0);
  // 若按日数据尚未覆盖（如刚合并旧数据），回退总时长避免显示 0 秒
  const displaySeconds = periodSeconds > 0 ? periodSeconds : allTimeSeconds;

  const hourly = Array.from({ length: 24 }, (_, idx) =>
    Math.max(0, Number(stats?.hourlySeconds?.[idx]) || 0)
  );
  let peakHour = 21;
  let maxHourSec = -1;
  hourly.forEach((sec, hour) => {
    if (sec > maxHourSec) {
      maxHourSec = sec;
      peakHour = hour;
    }
  });

  const allSongs = Object.values(stats?.songs || {});
  const totalPlays = allSongs.reduce((acc, s) => acc + Math.max(0, Number(s?.plays) || 0), 0);
  const topSongs = allSongs
    .filter((s) => s && (Number(s.seconds) > 0 || Number(s.plays) > 0))
    .sort((a, b) => (Number(b.seconds) || 0) - (Number(a.seconds) || 0) || (Number(b.plays) || 0) - (Number(a.plays) || 0))
    .slice(0, 5)
    .map((s) => ({
      name: s.name || '未知歌曲',
      artist: s.artist || '未知歌手',
      seconds: Math.max(0, Number(s.seconds) || 0),
      plays: Math.max(1, Number(s.plays) || 0)
    }));

  const artistEntries = Object.entries(stats?.artists || {})
    .filter(([name, sec]) => name.trim() && Number(sec) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3);
  const maxArtistSec = artistEntries[0]?.[1] || 1;
  const topArtists = artistEntries.map(([name, sec]) => ({
    name,
    seconds: Number(sec),
    percent: Math.max(12, Math.round((Number(sec) / maxArtistSec) * 100))
  }));

  return {
    period,
    periodTitle: period === 'week' ? '本周听歌报告' : '本月听歌报告',
    dateRangeLabel: `${formatDotDate(startDate)} - ${formatDotDate(now)}`,
    periodSeconds: displaySeconds,
    allTimeSeconds,
    activeDays,
    totalDaysWindow: windowDays,
    totalPlays,
    peakHour,
    peakHourLabel: maxHourSec > 0 ? describePeakHour(peakHour) : '随时随地，与旋律相伴',
    hourlySeconds: hourly,
    topSongs,
    topArtists,
    badgeTitle: resolveBadgeTitle(allTimeSeconds)
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

/**
 * 绘制 1080x1620 高分辨率分享报告卡片 Canvas
 */
export function renderListeningReportCanvas(summary: ListeningReportSummary): HTMLCanvasElement {
  const width = 1080;
  const height = 1620;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

  // 1. 深邃暖阳弥散底色
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(0.48, '#172238');
  bgGrad.addColorStop(1, '#0b101d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 弥散光斑装饰
  const orb1 = ctx.createRadialGradient(880, 180, 20, 880, 180, 420);
  orb1.addColorStop(0, 'rgba(255, 194, 46, 0.34)');
  orb1.addColorStop(1, 'rgba(255, 194, 46, 0)');
  ctx.fillStyle = orb1;
  ctx.fillRect(0, 0, width, 680);

  const orb2 = ctx.createRadialGradient(180, 1340, 20, 180, 1340, 460);
  orb2.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
  orb2.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = orb2;
  ctx.fillRect(0, 800, width, 820);

  const padX = 68;
  const cardW = width - padX * 2;

  // 2. 顶部品牌栏与周期标签
  ctx.fillStyle = '#ffd147';
  ctx.font = `700 28px ${fontStack}`;
  ctx.fillText('小庞奶娃音乐 · LISTENING REPORT', padX, 96);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 58px ${fontStack}`;
  ctx.fillText(summary.periodTitle, padX, 174);

  // 日期胶囊 + 徽章胶囊
  drawRoundedRect(ctx, padX, 204, 340, 48, 24);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = `600 23px ${fontStack}`;
  ctx.fillText(summary.dateRangeLabel, padX + 24, 236);

  drawRoundedRect(ctx, padX + 358, 204, 210, 48, 24);
  ctx.fillStyle = 'rgba(255, 194, 46, 0.22)';
  ctx.fill();
  ctx.fillStyle = '#fde68a';
  ctx.font = `700 23px ${fontStack}`;
  ctx.fillText(`★ ${summary.badgeTitle}`, padX + 382, 236);

  // 3. 总时长主卡
  const heroY = 286;
  const heroH = 236;
  drawRoundedRect(ctx, padX, heroY, cardW, heroH, 34);
  const heroGrad = ctx.createLinearGradient(padX, heroY, padX + cardW, heroY + heroH);
  heroGrad.addColorStop(0, 'rgba(255, 184, 0, 0.26)');
  heroGrad.addColorStop(0.6, 'rgba(240, 144, 0, 0.16)');
  heroGrad.addColorStop(1, 'rgba(56, 189, 248, 0.18)');
  ctx.fillStyle = heroGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = `600 25px ${fontStack}`;
  ctx.fillText(
    summary.period === 'week' ? '近 7 天累计聆听' : '近 30 天累计聆听',
    padX + 40,
    heroY + 58
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 70px ${fontStack}`;
  ctx.fillText(formatReportDuration(summary.periodSeconds), padX + 40, heroY + 144);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
  ctx.font = `600 24px ${fontStack}`;
  ctx.fillText(
    `活跃 ${summary.activeDays} / ${summary.totalDaysWindow} 天   ·   累计播放 ${summary.totalPlays} 次   ·   总时长 ${formatReportDuration(summary.allTimeSeconds)}`,
    padX + 40,
    heroY + 198
  );

  // 4. 24 小时最常听时段热力条
  const heatY = 556;
  const heatH = 248;
  drawRoundedRect(ctx, padX, heatY, cardW, heatH, 30);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 28px ${fontStack}`;
  ctx.fillText('24 小时听歌时段热力', padX + 34, heatY + 52);

  ctx.fillStyle = '#7dd3fc';
  ctx.font = `600 22px ${fontStack}`;
  ctx.fillText(summary.peakHourLabel, padX + 34, heatY + 88);

  const maxH = Math.max(...summary.hourlySeconds, 1);
  const barAreaX = padX + 34;
  const barAreaW = cardW - 68;
  const barGap = 8;
  const barW = (barAreaW - barGap * 23) / 24;
  const barBottomY = heatY + 198;
  const maxBarH = 82;

  for (let h = 0; h < 24; h++) {
    const val = summary.hourlySeconds[h] || 0;
    const ratio = val / maxH;
    const bh = val > 0 ? Math.max(12, Math.round(ratio * maxBarH)) : 8;
    const bx = barAreaX + h * (barW + barGap);
    const by = barBottomY - bh;

    drawRoundedRect(ctx, bx, by, barW, bh, 6);
    if (h === summary.peakHour && val > 0) {
      ctx.fillStyle = '#ffc21c';
    } else if (val > 0) {
      ctx.fillStyle = `rgba(56, 189, 248, ${(0.35 + ratio * 0.6).toFixed(2)})`;
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    }
    ctx.fill();

    if (h % 4 === 0 || h === 23) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
      ctx.font = `600 18px ${fontStack}`;
      ctx.fillText(`${String(h).padStart(2, '0')}`, bx - 2, barBottomY + 28);
    }
  }

  // 5. Top 5 单曲榜
  const songsY = 836;
  const songsH = 420;
  drawRoundedRect(ctx, padX, songsY, cardW, songsH, 30);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 28px ${fontStack}`;
  ctx.fillText('单曲循环 Top 5', padX + 34, songsY + 52);

  if (summary.topSongs.length === 0) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = `500 24px ${fontStack}`;
    ctx.fillText('听几首歌后再来生成你的专属榜单吧', padX + 34, songsY + 130);
  } else {
    summary.topSongs.forEach((song, idx) => {
      const rowY = songsY + 96 + idx * 62;
      // 序号圆徽章
      drawRoundedRect(ctx, padX + 34, rowY - 24, 38, 38, 19);
      ctx.fillStyle =
        idx === 0
          ? '#f59e0b'
          : idx === 1
            ? '#38bdf8'
            : idx === 2
              ? '#fb7185'
              : 'rgba(255, 255, 255, 0.14)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 20px ${fontStack}`;
      ctx.fillText(String(idx + 1), padX + 47, rowY + 2);

      // 歌名 & 歌手
      ctx.fillStyle = '#f8fafc';
      ctx.font = `700 25px ${fontStack}`;
      ctx.fillText(fitText(ctx, song.name, 480), padX + 90, rowY + 2);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
      ctx.font = `500 20px ${fontStack}`;
      ctx.fillText(fitText(ctx, song.artist, 200), padX + 585, rowY + 2);

      // 时长
      const durText = formatReportDuration(song.seconds);
      ctx.fillStyle = '#fde68a';
      ctx.font = `700 22px ${fontStack}`;
      const durW = ctx.measureText(durText).width;
      ctx.fillText(durText, padX + cardW - 34 - durW, rowY + 2);
    });
  }

  // 6. Top 3 歌手榜
  const artistY = 1288;
  const artistH = 224;
  drawRoundedRect(ctx, padX, artistY, cardW, artistH, 30);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 28px ${fontStack}`;
  ctx.fillText('最常听歌手 Top 3', padX + 34, artistY + 50);

  if (summary.topArtists.length === 0) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = `500 24px ${fontStack}`;
    ctx.fillText('暂无歌手排行数据', padX + 34, artistY + 120);
  } else {
    summary.topArtists.forEach((ar, idx) => {
      const rowY = artistY + 94 + idx * 44;
      ctx.fillStyle = '#f8fafc';
      ctx.font = `700 23px ${fontStack}`;
      ctx.fillText(fitText(ctx, `${idx + 1}. ${ar.name}`, 250), padX + 34, rowY);

      const barX = padX + 300;
      const barFullW = cardW - 470;
      drawRoundedRect(ctx, barX, rowY - 16, barFullW, 18, 9);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();

      drawRoundedRect(ctx, barX, rowY - 16, Math.max(24, (barFullW * ar.percent) / 100), 18, 9);
      const arGrad = ctx.createLinearGradient(barX, 0, barX + barFullW, 0);
      arGrad.addColorStop(0, '#fbbf24');
      arGrad.addColorStop(1, '#fb923c');
      ctx.fillStyle = arGrad;
      ctx.fill();

      const durText = formatReportDuration(ar.seconds);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
      ctx.font = `600 21px ${fontStack}`;
      const dw = ctx.measureText(durText).width;
      ctx.fillText(durText, padX + cardW - 34 - dw, rowY);
    });
  }

  // 7. 底部品牌水印
  ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
  ctx.font = `500 22px ${fontStack}`;
  ctx.fillText('小庞奶娃音乐 · 每一段与旋律相伴的时光', padX, 1572);

  return canvas;
}
