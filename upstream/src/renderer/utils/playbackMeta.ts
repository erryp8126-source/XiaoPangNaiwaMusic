/**
 * 播放音源与音质状态元数据工具
 * 统一规范来源标签（本地文件 / 已下载 / 本地缓存 / 官方源 / LX 源 / 备用源 / 自定义源）
 * 与实际音质格式标签（Hi-Res / FLAC / 320k / 192k / 128k 等）
 */

export type PlaybackSourceCategory =
  | 'local'
  | 'downloaded'
  | 'cache'
  | 'official'
  | 'lx'
  | 'unblock'
  | 'custom';

export interface PlaybackAudioMeta {
  sourceCategory: PlaybackSourceCategory;
  sourceLabel: string;
  qualityLabel: string;
  bitrate?: number;
  format?: string;
  platform?: string;
  fallbackFrom?: string;
  fromDiskCache?: boolean;
}

export interface QualityInput {
  br?: number | string | null;
  type?: string | null;
  encodeType?: string | null;
  level?: string | null;
  quality?: string | null;
  url?: string | null;
}

const LOSSLESS_FORMATS = new Set(['flac', 'wav', 'ape', 'alac', 'aiff']);

function extractUrlExtension(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const clean = url.split('?')[0].split('#')[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // ignore malformed URI encoding
  }
  const match = decoded.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : '';
}

export function normalizeBitrateKbps(br?: number | string | null): number {
  if (br === null || br === undefined || br === '') return 0;
  const numeric = typeof br === 'number' ? br : parseFloat(String(br));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  // 兼容 kbps（如 320 / 999）与 bps（如 320000 / 999000）
  return numeric > 10000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

/**
 * 归一化实际音质/格式展示文案（如 Hi-Res / FLAC / WAV / 320k / 192k / 128k / MP3）
 */
export function formatQualityLabel(input: QualityInput): string {
  const ext = extractUrlExtension(input.url);
  const typeNorm = (input.type || input.encodeType || '').toLowerCase().trim();
  const levelNorm = (input.level || '').toLowerCase().trim();
  const qualityNorm = (input.quality || '').toLowerCase().trim();
  const kbps = normalizeBitrateKbps(input.br);

  if (
    levelNorm === 'hires' ||
    levelNorm === 'jymaster' ||
    levelNorm === 'sky' ||
    levelNorm === 'jyeffect' ||
    qualityNorm === 'flac24bit' ||
    qualityNorm === 'hires' ||
    kbps >= 1400
  ) {
    return 'Hi-Res';
  }

  if (
    ext === 'flac' ||
    typeNorm === 'flac' ||
    levelNorm === 'lossless' ||
    qualityNorm === 'flac' ||
    qualityNorm === 'lossless' ||
    kbps >= 700
  ) {
    return 'FLAC';
  }

  if (ext && LOSSLESS_FORMATS.has(ext)) {
    return ext.toUpperCase();
  }
  if (typeNorm && LOSSLESS_FORMATS.has(typeNorm)) {
    return typeNorm.toUpperCase();
  }

  if (kbps >= 280) return '320k';
  if (kbps >= 170) return '192k';
  if (kbps >= 96) return '128k';
  if (kbps > 0) return `${kbps}k`;

  if (qualityNorm === '320k' || levelNorm === 'exhigh') return '320k';
  if (qualityNorm === '192k' || levelNorm === 'higher') return '192k';
  if (qualityNorm === '128k' || levelNorm === 'standard') return '128k';

  if (ext === 'm4a' || ext === 'aac' || typeNorm === 'aac' || typeNorm === 'm4a') return 'AAC';
  if (ext === 'ogg' || typeNorm === 'ogg') return 'OGG';
  if (ext === 'mp3' || typeNorm === 'mp3') return 'MP3';

  return '标准';
}

export interface BuildPlaybackMetaOptions extends QualityInput {
  rawSource?: string | null;
  strategy?: string | null;
  platform?: string | null;
  isLocal?: boolean;
  isDownloaded?: boolean;
  fromDiskCache?: boolean;
  fallbackFrom?: string;
}

export function buildPlaybackMeta(options: BuildPlaybackMetaOptions): PlaybackAudioMeta {
  const qualityLabel = formatQualityLabel(options);
  const rawSource = (options.rawSource || options.strategy || options.platform || '')
    .toLowerCase()
    .trim();
  const bitrateKbps = normalizeBitrateKbps(options.br);
  const ext = extractUrlExtension(options.url);
  const format = (options.type || options.encodeType || ext || '').toLowerCase() || undefined;

  let sourceCategory: PlaybackSourceCategory = 'official';
  let sourceLabel = '官方源';

  if (options.isDownloaded) {
    sourceCategory = 'downloaded';
    sourceLabel = '已下载';
  } else if (options.isLocal) {
    sourceCategory = 'local';
    sourceLabel = '本地文件';
  } else if (options.fromDiskCache) {
    sourceCategory = 'cache';
    sourceLabel = '本地缓存';
  } else if (
    rawSource === 'lxmusic' ||
    rawSource === 'lx' ||
    rawSource.startsWith('lx-') ||
    (options.strategy || '').toLowerCase() === 'lxmusic'
  ) {
    sourceCategory = 'lx';
    sourceLabel = 'LX 源';
  } else if (rawSource === 'custom' || (options.strategy || '').toLowerCase() === 'custom') {
    sourceCategory = 'custom';
    sourceLabel = '自定义源';
  } else if (
    rawSource === 'official' ||
    rawSource === 'netease' ||
    rawSource === ''
  ) {
    sourceCategory = 'official';
    sourceLabel = '官方源';
  } else {
    sourceCategory = 'unblock';
    sourceLabel = '备用源';
  }

  return {
    sourceCategory,
    sourceLabel,
    qualityLabel,
    bitrate: bitrateKbps > 0 ? bitrateKbps * 1000 : undefined,
    format,
    platform: options.platform || options.rawSource || undefined,
    fallbackFrom: options.fallbackFrom,
    fromDiskCache: Boolean(options.fromDiskCache)
  };
}

/**
 * 当歌曲来自本地文件、已下载文件或原生后台切歌同步时，按 URL 与状态兜底推断播放元数据
 */
export function inferPlaybackMetaFromUrl(
  url: string | null | undefined,
  options: {
    isDownloaded?: boolean;
    fromDiskCache?: boolean;
    fallbackQuality?: string;
    existing?: PlaybackAudioMeta | null;
  } = {}
): PlaybackAudioMeta {
  if (options.existing) {
    if (options.fromDiskCache && options.existing.sourceCategory !== 'local' && options.existing.sourceCategory !== 'downloaded') {
      return {
        ...options.existing,
        sourceCategory: 'cache',
        sourceLabel: '本地缓存',
        fromDiskCache: true
      };
    }
    return options.existing;
  }

  const normalizedUrl = url || '';
  const isLocalScheme =
    normalizedUrl.startsWith('local://') ||
    normalizedUrl.startsWith('file://') ||
    normalizedUrl.includes('/local/audio');

  let inferredSource = 'official';
  if (!isLocalScheme && /^https?:\/\//i.test(normalizedUrl)) {
    const lower = normalizedUrl.toLowerCase();
    if (
      lower.includes('kuwo') ||
      lower.includes('kugou') ||
      lower.includes('migu') ||
      lower.includes('gdstudio') ||
      lower.includes('qqmusic') ||
      lower.includes('joox')
    ) {
      inferredSource = 'unblock';
    }
  }

  return buildPlaybackMeta({
    url: normalizedUrl,
    level: options.fallbackQuality,
    rawSource: inferredSource,
    isLocal: isLocalScheme && !options.isDownloaded,
    isDownloaded: Boolean(options.isDownloaded),
    fromDiskCache: Boolean(options.fromDiskCache)
  });
}

/**
 * 格式化黑胶播放页胶囊文案，例如 "FLAC · 本地缓存"
 */
export function formatPlaybackBadgeText(meta: PlaybackAudioMeta | null | undefined): string {
  if (!meta) return '';
  const parts = [meta.qualityLabel, meta.sourceLabel].filter((p) => Boolean(p && p.trim()));
  return parts.join(' · ');
}
