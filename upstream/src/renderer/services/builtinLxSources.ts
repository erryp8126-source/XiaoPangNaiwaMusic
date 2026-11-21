import builtinLxYuningxiScript from '@/assets/lx-sources/lx-yuningxi-pro.js?raw';
import { parseScriptInfo } from '@/services/LxMusicSourceRunner';
import type { LxMusicScriptConfig, LxSourceKey } from '@/types/lxMusic';
import type { Platform } from '@/types/music';

/**
 * 预装五源合一落雪音源：lx-玉宁熙-Pro v1.2.5（来自 guoyue2010/lxmusic- V261117）
 * 支持 wy(网易云) / tx(QQ) / kw(酷我) / kg(酷狗) / mg(咪咕)
 */
export const BUILTIN_LX_YUNINGXI_ID = 'builtin_lx_yuningxi_pro_v1_2_5';
export const BUILTIN_SOURCES_PRESET_VERSION = '2026-11-22-lx-yuningxi-1.2.5-pyncmd';

export const DEFAULT_ENABLED_MUSIC_SOURCES: Platform[] = [
  'lxMusic',
  'pyncmd',
  'kuwo',
  'kugou',
  'migu',
  'gdmusic'
];

const BUILTIN_YUNINGXI_SOURCES: LxSourceKey[] = ['wy', 'tx', 'kw', 'kg', 'mg'];

export const createBuiltinLxYuningxiConfig = (): LxMusicScriptConfig => {
  const info = parseScriptInfo(builtinLxYuningxiScript);
  return {
    id: BUILTIN_LX_YUNINGXI_ID,
    name: info.name || 'lx-玉宁熙-Pro',
    script: builtinLxYuningxiScript,
    info,
    sources: [...BUILTIN_YUNINGXI_SOURCES],
    enabled: true,
    createdAt: 1795200000000
  };
};

/**
 * 预装默认音源与一次性老版本升级迁移：
 * - 首次启动或老版本升级时自动预装并激活 lx-玉宁熙-Pro，同时默认开启 lxMusic + pyncmd
 * - 迁移完成后写入版本号标记，后续完全尊重用户在「音源设置」中的自定义勾选/删除/切换
 */
export const applyBuiltinMusicSourceDefaults = <T extends Record<string, any>>(settings: T): T => {
  const next: Record<string, any> = { ...settings };
  const existingScripts: LxMusicScriptConfig[] = Array.isArray(next.lxMusicScripts)
    ? [...next.lxMusicScripts]
    : [];

  const needsPresetSeed =
    next.builtinSourcesPresetVersion !== BUILTIN_SOURCES_PRESET_VERSION;

  if (needsPresetSeed) {
    const builtinConfig = createBuiltinLxYuningxiConfig();
    const hasBuiltin = existingScripts.some(
      (s) =>
        s &&
        (s.id === BUILTIN_LX_YUNINGXI_ID ||
          (s.name === builtinConfig.name && s.info?.version === builtinConfig.info.version))
    );

    if (!hasBuiltin) {
      existingScripts.unshift(builtinConfig);
    }
    next.lxMusicScripts = existingScripts;

    const activeExists = existingScripts.some((s) => s && s.id === next.activeLxMusicApiId);
    if (!next.activeLxMusicApiId || !activeExists) {
      next.activeLxMusicApiId =
        existingScripts.find((s) => s.id === BUILTIN_LX_YUNINGXI_ID)?.id ||
        existingScripts[0]?.id ||
        null;
    }

    if (next.enableMusicUnblock === undefined || next.enableMusicUnblock === null) {
      next.enableMusicUnblock = true;
    }

    const currentSources: string[] = Array.isArray(next.enabledMusicSources)
      ? next.enabledMusicSources.filter((s: any) => typeof s === 'string' && s.trim())
      : [...DEFAULT_ENABLED_MUSIC_SOURCES];

    const mergedSources: string[] = [];
    if (next.activeLxMusicApiId && !currentSources.includes('lxMusic')) {
      mergedSources.push('lxMusic');
    }
    if (!currentSources.includes('pyncmd')) {
      mergedSources.push('pyncmd');
    }
    for (const s of currentSources) {
      if (!mergedSources.includes(s)) {
        mergedSources.push(s);
      }
    }
    next.enabledMusicSources =
      mergedSources.length > 0 ? mergedSources : [...DEFAULT_ENABLED_MUSIC_SOURCES];
    next.builtinSourcesPresetVersion = BUILTIN_SOURCES_PRESET_VERSION;
  }

  return next as T;
};
