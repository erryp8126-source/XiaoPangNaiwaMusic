import type { LxMusicScriptConfig } from '@/types/lxMusic';
import type { Platform } from '@/types/music';

/**
 * 默认启用的内置合规解灰通道（不包含任何混淆或外连第三方黑盒脚本）
 * 用户如需使用落雪（LX Music）自定义音源，请在「设置 → 播放 → 音源设置」中自行导入本地 .js 脚本或自建模板。
 */
export const BUILTIN_SOURCES_PRESET_VERSION = '2026-11-27-clean-sources-v3-demote-kuwo';

const REMOVED_LEGACY_BUILTIN_LX_IDS = new Set(['builtin_lx_yuningxi_pro_v1_2_5']);

export const DEFAULT_ENABLED_MUSIC_SOURCES: Platform[] = [
  'pyncmd',
  'gdmusic',
  'migu',
  'kugou',
  'kuwo'
];

/**
 * 透明可读的自建 LX Music 音源脚本最小示例模板（仅作文档/本地导入参考，默认不自动激活）
 */
export const CUSTOM_LX_SCRIPT_TEMPLATE = `/*!
 * @name 自建音源模板 (示例)
 * @description 请替换为您的自建音源解析服务地址后通过本地文件导入
 * @version 1.0.0
 * @author custom
 */
const { EVENT_NAMES, request, on, send } = globalThis.lx;

on(EVENT_NAMES.request, ({ source, action, info }) => {
  if (action !== 'musicUrl') return Promise.reject(new Error('Unsupported action'));
  return new Promise((resolve, reject) => {
    const endpoint = 'https://your-music-api.example.com/url';
    request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { source, songmid: info.musicInfo.songmid, quality: info.type }
    }, (err, resp) => {
      if (err) return reject(err);
      const url = resp?.body?.url;
      return url ? resolve(url) : reject(new Error('No audio url returned'));
    });
  });
});

send(EVENT_NAMES.inited, {
  openDevTools: false,
  sources: {
    wy: { name: '网易云', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] }
  }
});
`;

/**
 * 默认音源初始化与升级清理：
 * - 自动移除旧版本曾预装的混淆黑盒脚本（若存在），避免残留外连逻辑
 * - 保留用户自行导入的合法自定义脚本与设置，并确保默认开启 pyncmd 等内置通道
 */
export const applyBuiltinMusicSourceDefaults = <T extends Record<string, any>>(settings: T): T => {
  const next: Record<string, any> = { ...settings };
  const rawScripts: LxMusicScriptConfig[] = Array.isArray(next.lxMusicScripts)
    ? [...next.lxMusicScripts]
    : [];

  const cleanedScripts = rawScripts.filter(
    (s) => s && !REMOVED_LEGACY_BUILTIN_LX_IDS.has(String(s.id || ''))
  );
  const removedLegacy = cleanedScripts.length !== rawScripts.length;
  if (removedLegacy) {
    next.lxMusicScripts = cleanedScripts;
    if (REMOVED_LEGACY_BUILTIN_LX_IDS.has(String(next.activeLxMusicApiId || ''))) {
      next.activeLxMusicApiId = cleanedScripts[0]?.id ?? null;
    }
  }

  const needsPresetSeed =
    removedLegacy || next.builtinSourcesPresetVersion !== BUILTIN_SOURCES_PRESET_VERSION;

  if (needsPresetSeed) {
    if (next.enableMusicUnblock === undefined || next.enableMusicUnblock === null) {
      next.enableMusicUnblock = true;
    }

    const currentSources: string[] = Array.isArray(next.enabledMusicSources)
      ? next.enabledMusicSources.filter((s: any) => typeof s === 'string' && s.trim())
      : [...DEFAULT_ENABLED_MUSIC_SOURCES];

    const hasUserLxScript = Boolean(
      next.activeLxMusicApiId &&
        cleanedScripts.some((s) => s && s.id === next.activeLxMusicApiId)
    );

    const hasKuwo = currentSources.includes('kuwo');
    const nonKuwoSources = currentSources.filter((s) => s !== 'kuwo');
    const mergedSources: string[] = [];
    if (hasUserLxScript && nonKuwoSources.includes('lxMusic')) {
      mergedSources.push('lxMusic');
    }
    mergedSources.push('pyncmd');
    for (const preferred of DEFAULT_ENABLED_MUSIC_SOURCES) {
      if (preferred === 'kuwo' || preferred === 'pyncmd') continue;
      if (nonKuwoSources.includes(preferred) && !mergedSources.includes(preferred)) {
        mergedSources.push(preferred);
      }
    }
    for (const s of nonKuwoSources) {
      if (s === 'lxMusic' && !hasUserLxScript) continue;
      if (!mergedSources.includes(s)) {
        mergedSources.push(s);
      }
    }
    if (hasKuwo && !mergedSources.includes('kuwo')) {
      mergedSources.push('kuwo');
    }
    next.enabledMusicSources =
      mergedSources.length > 0 ? mergedSources : [...DEFAULT_ENABLED_MUSIC_SOURCES];
    next.builtinSourcesPresetVersion = BUILTIN_SOURCES_PRESET_VERSION;
  }

  return next as T;
};
