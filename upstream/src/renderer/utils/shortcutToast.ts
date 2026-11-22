import { reactive } from 'vue';

export interface ToastOptions {
  position?: 'top' | 'center' | 'bottom';
  showIcon?: boolean;
  durationMs?: number;
}

export const floatingToastState = reactive({
  visible: false,
  text: '',
  icon: ''
});

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 展示全局应用内毛玻璃胶囊轻提示（单条覆盖不堆叠，默认 1.5s 自动淡出）
 */
export function showFloatingToast(message: string, iconName = '', durationMs = 1500) {
  const cleanMsg = String(message ?? '').trim();
  if (!cleanMsg) return;

  // 极端兜底：无 DOM 环境时退回原生提示
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    (globalThis as any).AlgerAndroid?.showToast?.(cleanMsg);
    return;
  }

  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  floatingToastState.text = cleanMsg;
  floatingToastState.icon = iconName;
  floatingToastState.visible = true;

  dismissTimer = setTimeout(() => {
    floatingToastState.visible = false;
    dismissTimer = null;
  }, Math.max(800, durationMs));
}

export function showShortcutToast(message: string, iconName = '', options: ToastOptions = {}) {
  const resolvedIcon = options.showIcon === false ? '' : iconName;
  showFloatingToast(message, resolvedIcon, options.durationMs ?? 1500);
}

/**
 * 应用内轻提示（已统一接入顶部安全区下方毛玻璃胶囊组件）
 */
export function showBottomToast(message: string) {
  showFloatingToast(message, '', 1500);
}
