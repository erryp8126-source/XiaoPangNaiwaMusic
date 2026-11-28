/**
 * 登录状态管理工具
 *
 * 注意：这个工具主要用于在组件外部或 store 初始化之前检查登录状态。
 * 在组件内部，建议直接使用 userStore 中的状态。
 */

import {
  getNativeNeteaseCookieFromStore,
  isAndroid,
  nativeSecureGetSecret,
  nativeSecureRemoveSecret,
  nativeSecureSetSecret
} from '@/utils/androidBridge';
import {
  hydrateAuthTokenSync,
  type HydrateAuthTokenResult,
  NATIVE_NETEASE_COOKIE_SECRET_KEY
} from '@/utils/authSession';

export interface LoginInfo {
  isLoggedIn: boolean;
  loginType: 'token' | 'cookie' | 'qr' | 'uid' | null;
  hasToken: boolean;
  hasUser: boolean;
  user: any;
}

/**
 * 检查登录状态
 * @returns 登录信息对象
 */
export function checkLoginStatus(): LoginInfo {
  const token = localStorage.getItem('token');
  const userData = localStorage.getItem('user');
  const loginType = localStorage.getItem('loginType') as LoginInfo['loginType'];
  const uidLogin = localStorage.getItem('uidLogin');

  const hasToken = !!token;
  const hasUser = !!userData;
  let user = null;

  if (hasUser) {
    try {
      user = JSON.parse(userData);
    } catch (error) {
      console.error('解析用户数据失败:', error);
    }
  }

  // 判断是否已登录
  let isLoggedIn = false;

  if (loginType === 'uid' || uidLogin === 'true') {
    // UID登录：只需要有用户数据即可
    isLoggedIn = hasUser && !!user;
  } else {
    // 其他登录方式：需要token和用户数据
    isLoggedIn = hasToken && hasUser && !!user;
  }

  return {
    isLoggedIn,
    loginType,
    hasToken,
    hasUser,
    user
  };
}

/**
 * 检查是否有访问权限
 * @param requireAuth 是否需要真实登录权限（token）
 * @returns 是否有权限
 */
export function hasPermission(requireAuth: boolean = false): boolean {
  const loginInfo = checkLoginStatus();

  if (!loginInfo.isLoggedIn) {
    return false;
  }

  // 如果需要真实登录权限，UID登录无法满足
  if (requireAuth && loginInfo.loginType === 'uid') {
    return false;
  }

  return true;
}

/**
 * 持久化保存网易云登录 Cookie：写入 localStorage，并在 Android 原生端同步写入硬件 Keystore
 */
export function persistNeteaseAuthToken(token: string): void {
  const clean = typeof token === 'string' ? token.trim() : '';
  if (!clean) return;
  try {
    localStorage.setItem('token', clean);
  } catch {
    // ignore storage errors
  }
  if (isAndroid()) {
    nativeSecureSetSecret(NATIVE_NETEASE_COOKIE_SECRET_KEY, clean);
  }
}

/**
 * 清理前端及 Android Keystore 中保存的登录 Token
 */
export function removeNeteaseAuthToken(): void {
  try {
    localStorage.removeItem('token');
  } catch {
    // ignore
  }
  if (isAndroid()) {
    nativeSecureRemoveSecret(NATIVE_NETEASE_COOKIE_SECRET_KEY);
  }
}

/**
 * 同步恢复 Android 原生凭据仓库 / CookieManager 中的登录态至 localStorage，
 * 确保覆盖安装或冷启动时首屏鉴权请求之前已完成会话就绪。
 */
export function ensureAndroidAuthRestoredSync(): HydrateAuthTokenResult {
  if (typeof localStorage === 'undefined') {
    return { restored: false, syncedToNative: false, token: '', source: 'none' };
  }
  try {
    return hydrateAuthTokenSync({
      storage: localStorage,
      isNativeAndroid: isAndroid(),
      readSecureCookie: () => nativeSecureGetSecret(NATIVE_NETEASE_COOKIE_SECRET_KEY),
      writeSecureCookie: (value: string) =>
        nativeSecureSetSecret(NATIVE_NETEASE_COOKIE_SECRET_KEY, value),
      readCookieManagerCookie: () => getNativeNeteaseCookieFromStore()
    });
  } catch {
    return { restored: false, syncedToNative: false, token: '', source: 'none' };
  }
}

/**
 * 清除登录状态
 */
export function clearLoginStatus(): void {
  removeNeteaseAuthToken();
  localStorage.removeItem('user');
  localStorage.removeItem('loginType');
  localStorage.removeItem('uidLogin');
}

/**
 * 设置登录状态（不包括用户数据，用户数据应通过 userStore.setUser 设置）
 * @param loginType 登录类型
 * @param token 登录token（可选）
 */
export function setLoginStatus(loginType: LoginInfo['loginType'], token?: string): void {
  localStorage.setItem('loginType', loginType || '');

  if (token) {
    persistNeteaseAuthToken(token);
  }

  if (loginType === 'uid') {
    localStorage.setItem('uidLogin', 'true');
  }
}

/**
 * 获取登录错误信息
 * @param requireAuth 是否需要真实登录权限
 * @returns 错误信息
 */
export function getLoginErrorMessage(requireAuth: boolean = false): string {
  const loginInfo = checkLoginStatus();

  if (!loginInfo.isLoggedIn) {
    return '请先登录';
  }

  if (requireAuth && loginInfo.loginType === 'uid') {
    return 'UID登录无法访问此功能，请使用Cookie或二维码登录';
  }

  return '';
}

/**
 * 获取登录方式的本地化展示文案
 */
export function getLoginTypeLabel(
  loginType: LoginInfo['loginType'] | string | null | undefined,
  t: (key: string) => string
): string {
  switch (loginType) {
    case 'qr':
      return t('login.title.qr');
    case 'phone':
      return t('login.title.phone');
    case 'cookie':
    case 'token':
      return t('login.title.cookie');
    case 'uid':
      return t('login.title.uid');
    default:
      return '';
  }
}

/**
 * 退出登录 / 切换账号统一二次确认弹窗（弹窗层级高于底部播放条 9500）
 */
export function confirmAccountLogout(
  dialog: { warning: (options: Record<string, any>) => any },
  message: { info?: (msg: string) => any; success?: (msg: string) => any } | null | undefined,
  userStore: { handleLogout: (options?: { redirectToLogin?: boolean }) => Promise<void> },
  options?: { redirectToLogin?: boolean }
): void {
  const isSwitch = Boolean(options?.redirectToLogin);
  dialog.warning({
    title: isSwitch ? '切换账号' : '退出登录',
    content: isSwitch
      ? '确定要退出当前账号并切换其他账号登录吗？将清除本机登录态与网易云 Cookie，不会影响本地音乐、已下载歌曲和云同步配置。'
      : '确定要退出当前网易云账号吗？退出后将清除本机登录态与网易云 Cookie，不会影响本地音乐、已下载歌曲和云同步配置。',
    positiveText: isSwitch ? '确认切换' : '确认退出',
    negativeText: '取消',
    positiveButtonProps: isSwitch ? undefined : { type: 'error' },
    style: { zIndex: 13000 },
    onPositiveClick: async () => {
      await userStore.handleLogout({ redirectToLogin: isSwitch });
      if (isSwitch) {
        message?.info?.('已退出当前账号，请登录新账号');
      } else {
        message?.success?.('已退出登录');
      }
    }
  });
}
