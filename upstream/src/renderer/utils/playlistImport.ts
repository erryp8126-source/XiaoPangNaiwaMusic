/**
 * 跨平台歌单导入纯算法模块（零 DOM / 零 Vue / 零 Store 依赖，可直接单测）
 * - 支持分享文案 URL 提取与平台识别（汽水音乐 / QQ 音乐 / 酷狗 / 酷我 / 网易云）
 * - 支持纯文本批量行解析（去序号、多分隔符、空行、去重、XSS 纯文本净化与上限截断）
 * - 复用防串歌打分与并发限速池（最大并发 3）
 */

export const MAX_IMPORT_TRACKS = 300;
export const IMPORT_MATCH_CONCURRENCY = 3;
export const IMPORT_MATCH_DELAY_MS = 120;
export const MIN_IMPORT_MATCH_SCORE = 25;
export const REJECT_IMPORT_SCORE = -1_000_000;

export const EXTERNAL_PLAYLIST_ALLOWED_DOMAINS: readonly string[] = [
  'qishui.douyin.com',
  'music.douyin.com',
  'y.qq.com',
  'c.y.qq.com',
  'i.y.qq.com',
  'kugou.com',
  'kuwo.cn',
  'music.163.com',
  '163cn.tv'
];

export const FALLBACK_TO_TEXT_MESSAGE =
  '该链接暂无法自动读取，可复制歌单文字使用「文本导入」';

export type ExternalPlaylistPlatform =
  | 'qishui'
  | 'qq'
  | 'kugou'
  | 'kuwo'
  | 'netease'
  | 'unknown';

export interface ImportedRawTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  neteaseId?: number;
  rawLine?: string;
}

export interface ExtractedShareLink {
  url: string;
  host: string;
  platform: ExternalPlaylistPlatform;
  platformLabel: string;
  allowed: boolean;
  titleHint?: string;
}

export interface ParsedTextImportResult {
  tracks: ImportedRawTrack[];
  totalNonEmptyLines: number;
  duplicateCount: number;
  truncatedCount: number;
}

const IPV4_LITERAL_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LIVE_VERSION_RE = /(?<![a-z])live(?![a-z])|现场/i;
const SEVERE_VERSION_PATTERNS = [
  /(?<![a-z])dj(?![a-z])/i,
  /(?<![a-z])remix(?![a-z])/i,
  /(?<![a-z])cover(?![a-z])/i,
  /(?<![a-z])instrumental(?![a-z])/i,
  /(?<![a-z])karaoke(?![a-z])/i,
  /(?<![a-z])ktv(?![a-z])/i,
  /(?<![a-z])slowed(?![a-z])/i,
  /(?<![a-z])sped\s+up(?![a-z])/i,
  /(?<![a-z])speed\s+up(?![a-z])/i,
  /伴奏/,
  /翻唱/,
  /片段/,
  /铃声/,
  /纯音乐/,
  /试听/,
  /串烧/,
  /高潮版/
];

export function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d{1,6});/g, (_, numStr) => {
      const code = Number(numStr);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hexStr) => {
      const code = parseInt(hexStr, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    });
}

/**
 * 纯文本清洗防 XSS（先解码后剥离 HTML 标签、控制字符与零宽字符）
 */
export function sanitizePlainText(raw: unknown, maxLen: number = 160): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  if (!s.trim()) return '';

  // 先清除显式 script/style 内容，再解码实体并再次剥离任何隐藏标签
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeBasicHtmlEntities(s);
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\ufeff]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  if (maxLen > 0 && s.length > maxLen) {
    s = s.slice(0, maxLen).trim();
  }
  return s;
}

export function isAllowedExternalPlaylistHost(rawHost: string | null | undefined): boolean {
  const clean = String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (!clean) return false;
  if (clean === 'localhost' || IPV4_LITERAL_RE.test(clean) || clean.includes(':')) {
    return false;
  }
  return EXTERNAL_PLAYLIST_ALLOWED_DOMAINS.some(
    (allowed) => clean === allowed || clean.endsWith(`.${allowed}`)
  );
}

export function detectExternalPlaylistPlatform(rawHost: string | null | undefined): {
  platform: ExternalPlaylistPlatform;
  label: string;
} {
  const host = String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  if (!host) return { platform: 'unknown', label: '未知平台' };

  if (host === 'qishui.douyin.com' || host === 'music.douyin.com' || host.endsWith('.qishui.douyin.com')) {
    return { platform: 'qishui', label: '汽水音乐' };
  }
  if (
    host === 'y.qq.com' ||
    host === 'c.y.qq.com' ||
    host === 'i.y.qq.com' ||
    host.endsWith('.y.qq.com')
  ) {
    return { platform: 'qq', label: 'QQ 音乐' };
  }
  if (host === 'kugou.com' || host.endsWith('.kugou.com')) {
    return { platform: 'kugou', label: '酷狗音乐' };
  }
  if (host === 'kuwo.cn' || host.endsWith('.kuwo.cn')) {
    return { platform: 'kuwo', label: '酷我音乐' };
  }
  if (host === 'music.163.com' || host.endsWith('.music.163.com') || host === '163cn.tv') {
    return { platform: 'netease', label: '网易云音乐' };
  }
  return { platform: 'unknown', label: '未知平台' };
}

/**
 * 从各平台分享文案（如「分享歌单《xxx》https://...」）提取首个有效 HTTP(S) 链接并识别平台
 */
export function extractShareUrlFromText(rawText: string): ExtractedShareLink | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(text);
  if (!urlMatch) return null;

  let candidate = urlMatch[0].replace(/[】》）」』”’，。！？、；：.,!?;:'")\]]+$/u, '');
  let parsed: URL | null = null;
  while (candidate.length > 8) {
    try {
      parsed = new URL(candidate);
      break;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = isAllowedExternalPlaylistHost(host);
  const { platform, label } = detectExternalPlaylistPlatform(host);

  let titleHint = '';
  const titleMatch = /《([^《》\n]{1,60})》/.exec(text);
  if (titleMatch?.[1]) {
    titleHint = sanitizePlainText(titleMatch[1], 60);
  }

  return {
    url: parsed.toString(),
    host,
    platform,
    platformLabel: label,
    allowed,
    ...(titleHint ? { titleHint } : {})
  };
}

function stripLeadingTrackNumber(line: string): string {
  // 去掉行首常见序号：1. / 01. / 1、 / 1) / (1) / [1] / 【1】 / #1 / ①-⑳ / - / • / ·
  return line
    .replace(
      /^\s*(?:[\u2460-\u2473]\s*|[\[(【]\s*\d{1,4}\s*[\])】]\s*|#?\d{1,4}\s*[.、)\]:：]\s*|#\d{1,4}\s+|[-•·*]\s+)+/u,
      ''
    )
    .trim();
}

function splitOutsideBrackets(
  text: string,
  separatorRegex: RegExp
): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '（' || ch === '【') {
      depth++;
      continue;
    }
    if ((ch === ')' || ch === ']' || ch === '）' || ch === '】') && depth > 0) {
      depth--;
      continue;
    }
    if (depth !== 0) continue;

    separatorRegex.lastIndex = i;
    const m = separatorRegex.exec(text);
    if (m && m.index === i) {
      const left = text.slice(0, i).trim();
      const right = text.slice(i + m[0].length).trim();
      if (left && right) {
        return [left, right];
      }
    }
  }
  return null;
}

function parseSingleTrackLine(rawLine: string): ImportedRawTrack | null {
  const cleanedRaw = rawLine.trim();
  if (!cleanedRaw) return null;
  if (/^[=\-*~_·•\s]{3,}$/.test(cleanedRaw)) return null;

  const stripped = stripLeadingTrackNumber(cleanedRaw);
  if (!stripped) return null;

  let title = stripped;
  let artist = '';

  const splitAttempt =
    splitOutsideBrackets(stripped, /\t+/y) ||
    splitOutsideBrackets(stripped, /\s+[-—–]\s+/y) ||
    splitOutsideBrackets(stripped, /\s+[/／|｜]\s+/y) ||
    splitOutsideBrackets(stripped, /\s*[—–|｜]\s*/y) ||
    splitOutsideBrackets(stripped, /[/／]/y);

  if (splitAttempt) {
    title = splitAttempt[0];
    artist = splitAttempt[1];
  } else {
    // 兼容紧凑写法如「晴天-周杰伦」，左侧至少 2 字符避免拆断「a-ha」「X-Japan」
    const compactDash = /^(.{2,}?)-([^-\s].*)$/.exec(stripped);
    if (compactDash && !/^https?:$/i.test(compactDash[1].trim())) {
      title = compactDash[1].trim();
      artist = compactDash[2].trim();
    }
  }

  const safeTitle = sanitizePlainText(title, 120);
  const safeArtist = sanitizePlainText(artist, 80);
  if (!safeTitle) return null;

  return {
    title: safeTitle,
    artist: safeArtist,
    rawLine: sanitizePlainText(cleanedRaw, 200)
  };
}

/**
 * 解析纯文本歌单列表：
 * - 兼容「歌名 - 歌手」「歌名 / 歌手」「1. 歌名 - 歌手」或纯歌名
 * - 去除行首序号、空行、分割线与大小写不敏感重复行，并按 maxTracks 截断（默认 300）
 */
export function parsePlaylistTextLines(
  rawText: string,
  maxTracks: number = MAX_IMPORT_TRACKS
): ParsedTextImportResult {
  const limit = Math.max(1, Math.floor(maxTracks || MAX_IMPORT_TRACKS));
  const lines = String(rawText || '').split(/\r?\n/);

  const tracks: ImportedRawTrack[] = [];
  const seen = new Set<string>();
  let totalNonEmptyLines = 0;
  let duplicateCount = 0;
  let truncatedCount = 0;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const parsed = parseSingleTrackLine(raw);
    if (!parsed) continue;
    totalNonEmptyLines++;

    const dedupeKey = `${compactTrackText(parsed.title)}::${compactTrackText(parsed.artist)}`;
    if (seen.has(dedupeKey)) {
      duplicateCount++;
      continue;
    }
    seen.add(dedupeKey);

    if (tracks.length >= limit) {
      truncatedCount++;
      continue;
    }
    tracks.push(parsed);
  }

  return {
    tracks,
    totalNonEmptyLines,
    duplicateCount,
    truncatedCount
  };
}

function normalizeTrackText(raw: string): string {
  if (!raw || !raw.trim()) return '';
  const decoded = decodeBasicHtmlEntities(raw);
  let mapped = '';
  for (const ch of decoded) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      mapped += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000 || ch === '《' || ch === '》') {
      mapped += ' ';
    } else if (ch === '【' || ch === '「') {
      mapped += '[';
    } else if (ch === '】' || ch === '」') {
      mapped += ']';
    } else {
      mapped += ch;
    }
  }
  return mapped.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripBracketSuffixes(normalized: string): string {
  if (!normalized) return '';
  const cleaned = normalized
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(
      /\s+-\s+(?:live|现场|dj|remix|伴奏|翻唱|cover|片段|铃声|纯音乐|instrumental|karaoke|ktv|试听|串烧|高潮版|slowed|sped\s+up|speed\s+up|ver\.?|version|edit|mix|acoustic).*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || normalized;
}

function compactTrackText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function splitArtistTokens(artists: string): string[] {
  const norm = normalizeTrackText(artists);
  if (!norm) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of norm.split(/[\s/,&、+·;；|]+/)) {
    const token = compactTrackText(stripBracketSuffixes(part));
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/**
 * 歌单曲库匹配打分（与服务端 Candidate Scorer 同源防串歌/Live/翻唱/DJ 逻辑）
 */
export function scoreImportCandidate(params: {
  targetTitle: string;
  targetArtists: string;
  expectedDurationMs?: number;
  candidateTitle: string;
  candidateArtists: string;
  candidateDurationMs?: number;
}): number {
  const targetRawNorm = normalizeTrackText(params.targetTitle);
  const candRawNorm = normalizeTrackText(params.candidateTitle);
  const targetCoreStr = stripBracketSuffixes(targetRawNorm);
  const candCoreStr = stripBracketSuffixes(candRawNorm);

  const targetRawCompact = compactTrackText(targetRawNorm);
  const candRawCompact = compactTrackText(candRawNorm);
  const targetCore = compactTrackText(targetCoreStr) || targetRawCompact;
  const candCore = compactTrackText(candCoreStr) || candRawCompact;

  let score = 0;

  if (targetCore) {
    if (!candCore) return REJECT_IMPORT_SCORE;
    if (candCore === targetCore || (candRawCompact && candRawCompact === targetRawCompact)) {
      score += 60;
      if (candRawCompact === targetRawCompact) score += 10;
    } else if (targetCore.length >= 2 && candCore.includes(targetCore)) {
      score += 42;
    } else if (
      candCore.length >= 2 &&
      targetCore.includes(candCore) &&
      candCore.length / targetCore.length >= 0.5
    ) {
      score += 32;
    } else {
      const targetTokens = (targetCoreStr.match(/[\p{L}\p{N}]{2,}/gu) || []).map((t) =>
        compactTrackText(t)
      );
      if (targetTokens.length >= 2 && targetTokens.every((t) => candCore.includes(t))) {
        score += 30;
      } else {
        return REJECT_IMPORT_SCORE;
      }
    }
  }

  const targetArtistTokens = splitArtistTokens(params.targetArtists);
  const candArtistTokens = splitArtistTokens(params.candidateArtists);
  if (targetArtistTokens.length > 0 && candArtistTokens.length > 0) {
    const matched = targetArtistTokens.filter((t) =>
      candArtistTokens.some(
        (c) => c === t || (Math.min(c.length, t.length) >= 2 && (c.includes(t) || t.includes(c)))
      )
    ).length;
    if (matched === targetArtistTokens.length) {
      score += 40;
    } else if (matched > 0) {
      score += 30;
    } else {
      score -= 65;
    }
  }

  if (LIVE_VERSION_RE.test(candRawNorm) && !LIVE_VERSION_RE.test(targetRawNorm)) {
    score -= 45;
  }
  const hasUndesiredVersion = SEVERE_VERSION_PATTERNS.some(
    (pat) => pat.test(candRawNorm) && !pat.test(targetRawNorm)
  );
  if (hasUndesiredVersion) {
    score -= 105;
  }

  const expectedDurationMs = params.expectedDurationMs ?? 0;
  const candidateDurationMs = params.candidateDurationMs ?? 0;
  if (expectedDurationMs > 30_000 && candidateDurationMs > 0) {
    const diffMs = Math.abs(candidateDurationMs - expectedDurationMs);
    const ratio = diffMs / expectedDurationMs;
    if (diffMs <= 15_000) {
      score += 25;
    } else if (ratio <= 0.2) {
      score += 10;
    } else if (ratio <= 0.35) {
      score -= 15;
    } else {
      score -= 85;
    }
  }

  return score;
}

export function pickBestImportCandidate<T>(
  items: T[],
  extractor: (item: T) => { title: string; artists: string; durationMs?: number },
  target: { targetTitle: string; targetArtists: string; expectedDurationMs?: number },
  minScore: number = MIN_IMPORT_MATCH_SCORE
): { item: T; score: number } | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const meta = extractor(item);
    const score = scoreImportCandidate({
      targetTitle: target.targetTitle,
      targetArtists: target.targetArtists,
      expectedDurationMs: target.expectedDurationMs,
      candidateTitle: meta.title,
      candidateArtists: meta.artists,
      candidateDurationMs: meta.durationMs
    });
    if (score >= minScore && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 并发限速执行池：严格约束最大并发数（默认 3）并在任务间插入轻量延迟防 429，支持取消信号与实时进度回调
 */
export async function runConcurrentPool<T, R>(
  items: T[],
  options: {
    concurrency?: number;
    delayMs?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, current?: T) => void;
  },
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<R | null>> {
  const total = items.length;
  const results: Array<R | null> = new Array(total).fill(null);
  if (total === 0) return results;

  const concurrency = Math.max(1, Math.min(total, options.concurrency ?? IMPORT_MATCH_CONCURRENCY));
  const delayMs = Math.max(0, options.delayMs ?? IMPORT_MATCH_DELAY_MS);
  let nextIdx = 0;
  let completed = 0;

  const workerLoop = async () => {
    while (true) {
      if (options.signal?.aborted) return;
      const idx = nextIdx++;
      if (idx >= total) return;

      const item = items[idx];
      try {
        results[idx] = await worker(item, idx);
      } catch {
        results[idx] = null;
      } finally {
        completed++;
        options.onProgress?.(completed, total, item);
      }

      if (delayMs > 0 && nextIdx < total && !options.signal?.aborted) {
        await sleepAbortable(delayMs, options.signal);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  return results;
}
