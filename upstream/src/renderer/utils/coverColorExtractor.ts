/**
 * 封面动态弥散背景主色提取工具
 * - 基于 24x24 离屏 Canvas 快速采样并做色相/饱和度/亮度聚类
 * - 按封面 URL 做有界 LRU 缓存与并发去重，切歌不重复计算
 * - 内置 WCAG 2.1 相对亮度可读性兜底，确保暗色模式下文字与控件对比度 >= 4.5:1
 */

export type RgbTuple = [number, number, number];

export interface DynamicCoverPalette {
  /** 经可读性压暗约束的暗底主色（与 #FFFFFF 对比度 >= 4.5:1） */
  primaryRgb: RgbTuple;
  /** 经可读性压暗约束的暗底次色（与 #FFFFFF 对比度 >= 4.5:1） */
  secondaryRgb: RgbTuple;
  /** 弥散光斑主色（配合模糊与暗层叠渲染） */
  orbPrimaryRgb: RgbTuple;
  /** 弥散光斑次色 */
  orbSecondaryRgb: RgbTuple;
  /** 浅色模式下 MiniBar 柔化主色（保证深色文字高对比度） */
  lightTintPrimaryRgb: RgbTuple;
  /** 浅色模式下 MiniBar 柔化次色 */
  lightTintSecondaryRgb: RgbTuple;
  primaryCss: string;
  secondaryCss: string;
  orbPrimaryCss: string;
  orbSecondaryCss: string;
  lightTintPrimaryCss: string;
  lightTintSecondaryCss: string;
  /** 主底色对纯白文字的 WCAG 对比度 */
  contrastOnWhite: number;
}

const SAMPLE_SIZE = 24;
const MAX_CACHE_ENTRIES = 120;
const LOAD_TIMEOUT_MS = 2200;
const MIN_DARK_CONTRAST_ON_WHITE = 5.5; // 高于 4.5:1 门槛，确保半透明副歌词同样清晰

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rgbToCss(rgb: RgbTuple, alpha?: number): string {
  const [r, g, b] = rgb;
  if (typeof alpha === 'number') {
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }

  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RgbTuple {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);

  if (sn === 0) {
    const v = Math.round(ln * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, tInput: number): number => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)
  ];
}

export function relativeLuminance(rgb: RgbTuple): number {
  const toLinear = (channel: number): number => {
    const s = clamp(channel, 0, 255) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

export function contrastRatio(rgbA: RgbTuple, rgbB: RgbTuple): number {
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 暗色模式可读性兜底：约束饱和度并自动压暗过亮主色，确保对 #FFFFFF 对比度 >= minContrast
 */
export function constrainForDarkReadability(
  rgb: RgbTuple,
  minContrast: number = MIN_DARK_CONTRAST_ON_WHITE
): RgbTuple {
  const [h, rawS, rawL] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  // 对极低饱和度（灰白封面）保留温和深蓝灰质感，对过高饱和度适度柔化避免刺眼
  const s = rawS < 0.08 ? clamp(rawS * 1.15, 0.08, 0.22) : clamp(rawS, 0.24, 0.68);
  let l = clamp(rawL * 0.42 + 0.09, 0.11, 0.34);

  let candidate = hslToRgb(h, s, l);
  let guard = 0;
  while (contrastRatio(candidate, [255, 255, 255]) < minContrast && l > 0.05 && guard < 30) {
    l = Math.max(0.05, l - 0.02);
    candidate = hslToRgb(h, s, l);
    guard++;
  }
  return candidate;
}

function buildOrbAccent(rgb: RgbTuple): RgbTuple {
  const [h, rawS, rawL] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const s = rawS < 0.1 ? 0.26 : clamp(rawS * 1.05, 0.36, 0.74);
  const l = clamp(rawL * 0.55 + 0.18, 0.28, 0.48);
  return hslToRgb(h, s, l);
}

function buildLightSurfaceTint(rgb: RgbTuple): RgbTuple {
  const [h, rawS] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const s = rawS < 0.08 ? 0.16 : clamp(rawS * 0.65, 0.22, 0.52);
  const l = 0.89;
  return hslToRgb(h, s, l);
}

export function buildDynamicPalette(primaryRaw: RgbTuple, secondaryRaw: RgbTuple): DynamicCoverPalette {
  const primaryRgb = constrainForDarkReadability(primaryRaw, MIN_DARK_CONTRAST_ON_WHITE);
  const secondaryRgb = constrainForDarkReadability(secondaryRaw, MIN_DARK_CONTRAST_ON_WHITE);
  const orbPrimaryRgb = buildOrbAccent(primaryRaw);
  const orbSecondaryRgb = buildOrbAccent(secondaryRaw);
  const lightTintPrimaryRgb = buildLightSurfaceTint(primaryRaw);
  const lightTintSecondaryRgb = buildLightSurfaceTint(secondaryRaw);
  const contrastOnWhite = contrastRatio(primaryRgb, [255, 255, 255]);

  return {
    primaryRgb,
    secondaryRgb,
    orbPrimaryRgb,
    orbSecondaryRgb,
    lightTintPrimaryRgb,
    lightTintSecondaryRgb,
    primaryCss: rgbToCss(primaryRgb),
    secondaryCss: rgbToCss(secondaryRgb),
    orbPrimaryCss: rgbToCss(orbPrimaryRgb),
    orbSecondaryCss: rgbToCss(orbSecondaryRgb),
    lightTintPrimaryCss: rgbToCss(lightTintPrimaryRgb),
    lightTintSecondaryCss: rgbToCss(lightTintSecondaryRgb),
    contrastOnWhite
  };
}

export const DEFAULT_DYNAMIC_PALETTE: DynamicCoverPalette = buildDynamicPalette(
  [38, 66, 118],
  [180, 128, 48]
);

interface ColorBucket {
  rSum: number;
  gSum: number;
  bSum: number;
  weight: number;
  count: number;
  hue: number;
  sat: number;
}

function hueDistance(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * 从 RGBA 像素数组（默认 24x24 = 576 像素）提取主色与次色并构造可读性安全的动态调色板
 */
export function extractPaletteFromPixels(pixels: Uint8ClampedArray | number[]): DynamicCoverPalette {
  if (!pixels || pixels.length < 4) {
    return DEFAULT_DYNAMIC_PALETTE;
  }

  const buckets = new Map<number, ColorBucket>();
  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;
  let fallbackCount = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    fallbackR += r;
    fallbackG += g;
    fallbackB += b;
    fallbackCount++;

    const [h, s, l] = rgbToHsl(r, g, b);
    // 跳过极端纯黑与纯白像素，优先提取封面真实色彩倾向
    if (l < 0.06 || l > 0.94) continue;

    const hueBin = s < 0.12 ? 24 : Math.floor((h % 360) / 15); // 24 个色相桶 + 1 个中性灰桶
    const lumBin = l < 0.35 ? 0 : l < 0.7 ? 1 : 2;
    const key = hueBin * 3 + lumBin;

    // 偏爱适中亮度、饱和度较高的封面主色
    const chromaBoost = s < 0.12 ? 0.32 : 0.55 + s * 1.45;
    const midLumBoost = 1 - Math.abs(l - 0.48) * 0.65;
    const pixelWeight = chromaBoost * midLumBoost;

    const existing = buckets.get(key);
    if (existing) {
      existing.rSum += r;
      existing.gSum += g;
      existing.bSum += b;
      existing.weight += pixelWeight;
      existing.count++;
    } else {
      buckets.set(key, {
        rSum: r,
        gSum: g,
        bSum: b,
        weight: pixelWeight,
        count: 1,
        hue: h,
        sat: s
      });
    }
  }

  if (fallbackCount === 0) {
    return DEFAULT_DYNAMIC_PALETTE;
  }

  const ranked = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight);

  const primaryRaw: RgbTuple =
    ranked.length > 0
      ? [
          Math.round(ranked[0].rSum / ranked[0].count),
          Math.round(ranked[0].gSum / ranked[0].count),
          Math.round(ranked[0].bSum / ranked[0].count)
        ]
      : [
          Math.round(fallbackR / fallbackCount),
          Math.round(fallbackG / fallbackCount),
          Math.round(fallbackB / fallbackCount)
        ];

  const [primaryH, primaryS, primaryL] = rgbToHsl(primaryRaw[0], primaryRaw[1], primaryRaw[2]);

  // 寻找色相有区分度的次色；若单色调封面则通过邻近和谐色相偏移构造双色层次
  let secondaryRaw: RgbTuple | null = null;
  for (let i = 1; i < ranked.length; i++) {
    const candidate: RgbTuple = [
      Math.round(ranked[i].rSum / ranked[i].count),
      Math.round(ranked[i].gSum / ranked[i].count),
      Math.round(ranked[i].bSum / ranked[i].count)
    ];
    const [ch, cs] = rgbToHsl(candidate[0], candidate[1], candidate[2]);
    if (hueDistance(primaryH, ch) >= 28 && cs >= 0.14) {
      secondaryRaw = candidate;
      break;
    }
  }

  if (!secondaryRaw) {
    secondaryRaw = hslToRgb(
      (primaryH + 34) % 360,
      clamp(primaryS * 0.9 + 0.12, 0.24, 0.68),
      clamp(primaryL * 0.85 + 0.08, 0.2, 0.55)
    );
  }

  return buildDynamicPalette(primaryRaw, secondaryRaw);
}

// URL 级 LRU 缓存与并发去重
const paletteCache = new Map<string, DynamicCoverPalette>();
const inflightRequests = new Map<string, Promise<DynamicCoverPalette>>();

function setCachedPalette(key: string, palette: DynamicCoverPalette): void {
  if (paletteCache.has(key)) {
    paletteCache.delete(key);
  } else if (paletteCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = paletteCache.keys().next().value;
    if (oldestKey !== undefined) {
      paletteCache.delete(oldestKey);
    }
  }
  paletteCache.set(key, palette);
}

export function getCachedCoverPalette(url: string | null | undefined): DynamicCoverPalette | null {
  if (!url) return null;
  const cached = paletteCache.get(url);
  if (!cached) return null;
  // 刷新 LRU 顺序
  paletteCache.delete(url);
  paletteCache.set(url, cached);
  return cached;
}

export function clearCoverPaletteCache(): void {
  paletteCache.clear();
  inflightRequests.clear();
}

function upgradeExternalHttp(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('//') && !/^\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice(7)}`;
  }
  return trimmed;
}

/**
 * 异步提取封面主色与次色（24x24 离屏 Canvas 采样 + URL 缓存 + 异常静默降级）
 */
export function extractCoverPalette(
  imageUrl: string | null | undefined
): Promise<DynamicCoverPalette> {
  if (!imageUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(DEFAULT_DYNAMIC_PALETTE);
  }
  const safeImageUrl = upgradeExternalHttp(imageUrl);

  const cached = getCachedCoverPalette(imageUrl);
  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = inflightRequests.get(imageUrl);
  if (existing) {
    return existing;
  }

  const task = new Promise<DynamicCoverPalette>((resolve) => {
    let settled = false;
    const finish = (palette: DynamicCoverPalette, shouldCache: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      inflightRequests.delete(imageUrl);
      if (shouldCache) {
        setCachedPalette(imageUrl, palette);
      }
      resolve(palette);
    };

    const timer = window.setTimeout(() => {
      finish(DEFAULT_DYNAMIC_PALETTE, false);
    }, LOAD_TIMEOUT_MS);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          finish(DEFAULT_DYNAMIC_PALETTE, false);
          return;
        }
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const palette = extractPaletteFromPixels(imageData.data);
        finish(palette, true);
      } catch {
        // 跨域未返回 ACAO 头触发 canvas 污染时安全回退默认深色极光调色板
        finish(DEFAULT_DYNAMIC_PALETTE, true);
      }
    };

    img.onerror = () => {
      finish(DEFAULT_DYNAMIC_PALETTE, false);
    };

    img.src = safeImageUrl;
  });

  inflightRequests.set(imageUrl, task);
  return task;
}
