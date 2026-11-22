/**
 * 启动首页模式与“打开 App 自动播放”策略工具
 * 纯函数实现，便于前端与 Node 24 单元测试共同复用
 */

export type LaunchHomeMode = 'immersive' | 'classic';
export type LaunchAutoPlayMode = 'always' | 'external-audio' | 'off';

export interface LaunchSettingsLike {
  launchHomeMode?: string;
  launchAutoPlayMode?: string;
  autoPlay?: boolean;
}

const VALID_AUTO_PLAY_MODES = new Set<LaunchAutoPlayMode>(['always', 'external-audio', 'off']);

/**
 * 解析当前生效的启动首页模式（默认沉浸黑胶）
 */
export function getEffectiveLaunchHomeMode(settings?: LaunchSettingsLike | null): LaunchHomeMode {
  return settings?.launchHomeMode === 'classic' ? 'classic' : 'immersive';
}

/**
 * 解析当前生效的“打开 App 自动播放”策略
 * - 原生端（Android / iOS）未显式配置时默认 `always`（始终自动播放）
 * - 非原生端（Web / 桌面）兼容旧 `autoPlay` 布尔值，默认 `off`
 */
export function getEffectiveLaunchAutoPlayMode(
  settings: LaunchSettingsLike | null | undefined,
  isNativeEnv: boolean
): LaunchAutoPlayMode {
  const raw = settings?.launchAutoPlayMode as LaunchAutoPlayMode | undefined;
  if (raw && VALID_AUTO_PLAY_MODES.has(raw)) {
    return raw;
  }
  if (isNativeEnv) {
    return 'always';
  }
  return settings?.autoPlay ? 'always' : 'off';
}

/**
 * 根据启动策略与耳机/蓝牙输出状态决定冷启动是否自动开播
 */
export function shouldAutoPlayOnLaunch(params: {
  mode: LaunchAutoPlayMode;
  isExternalAudioConnected: boolean;
}): boolean {
  if (params.mode === 'always') return true;
  if (params.mode === 'external-audio') return Boolean(params.isExternalAudioConnected);
  return false;
}

/**
 * 识别浏览器 / Safari PWA 自动播放策略拦截异常（NotAllowedError 等）
 * 命中后应静默停在待播态，绝不弹出报错提示
 */
export function isAutoplayBlockedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null) {
    const name = String((error as any).name || '').toLowerCase();
    if (name === 'notallowederror') return true;
  }
  const msg = (
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : String((error as any)?.message || error)
  ).toLowerCase();

  return (
    msg.includes('notallowederror') ||
    msg.includes('not allowed by the user agent') ||
    msg.includes("user didn't interact") ||
    msg.includes('user did not interact') ||
    msg.includes('autoplay') ||
    msg.includes('playback was unable to start') ||
    msg.includes('audio playback was prevented') ||
    msg.includes('gesture')
  );
}
