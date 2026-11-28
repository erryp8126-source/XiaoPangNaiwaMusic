import axios, { InternalAxiosRequestConfig } from 'axios';

import { useOfflineAvailabilityStore } from '@/store/modules/offlineAvailability';
import { useUserStore } from '@/store/modules/user';
import { getAndroidApiBaseUrl, getAndroidLocalAuthToken, isAndroid } from '@/utils/androidBridge';
import { ensureAndroidAuthRestoredSync } from '@/utils/auth';
import {
  attachAuthCookieToRequestConfig,
  buildLoginStatusVerifyConfig,
  createHttp301SessionGuard,
  SESSION_EXPIRED_TOAST_TEXT
} from '@/utils/authSession';
import { showFloatingToast } from '@/utils/shortcutToast';

import { getSetData, isElectron, isMobile } from '.';

let setData: any = null;

// 扩展请求配置接口
interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
  noRetry?: boolean;
  skip301Guard?: boolean;
}

const DEFAULT_CLOUD_WEB_API = 'https://xiaopang-naiwa-music.netlify.app/api';

export const getDefaultWebApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith('.netlify.app')) {
      return '/api';
    }
  }
  const envApi = typeof import.meta.env.VITE_API === 'string' ? import.meta.env.VITE_API.trim() : '';
  if (envApi && envApi !== 'undefined') {
    return envApi.replace(/\/+$/, '');
  }
  return DEFAULT_CLOUD_WEB_API;
};

const resolveBaseURL = () => {
  if (window.electron) {
    return `http://127.0.0.1:${setData?.musicApiPort}`;
  }
  if (isAndroid()) {
    return getAndroidApiBaseUrl();
  }
  const pwaApi = typeof localStorage !== 'undefined' ? localStorage.getItem('alger_pwa_api_url')?.trim() : '';
  if (pwaApi) {
    return pwaApi.replace(/\/+$/, '');
  }
  return getDefaultWebApiBaseUrl();
};

const baseURL = resolveBaseURL();

const request = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: !isAndroid()
});

// 最大重试次数
const MAX_RETRIES = 1;
// 重试延迟（毫秒）
const RETRY_DELAY = 500;

// 请求拦截器
request.interceptors.request.use(
  (config: CustomAxiosRequestConfig) => {
    setData = getSetData();
    config.baseURL = resolveBaseURL();
    // 访问本机内置回环代理时自动携带每进程随机鉴权令牌，防止同机外部网页/应用越权访问
    if (isAndroid() && typeof config.baseURL === 'string' && config.baseURL.startsWith('http://127.0.0.1:')) {
      const localToken = getAndroidLocalAuthToken();
      if (localToken) {
        config.headers = config.headers || ({} as any);
        (config.headers as any)['X-Alger-Token'] = localToken;
      }
    }
    // 只在retryCount未定义时初始化为0
    if (config.retryCount === undefined) {
      config.retryCount = 0;
    }

    // 在请求发送之前做一些处理
    // 在get请求params中添加timestamp
    config.params = {
      ...config.params,
      timestamp: Date.now(),
      device: isElectron ? 'pc' : isMobile ? 'mobile' : 'web'
    };
    if (isAndroid() && typeof localStorage !== 'undefined' && !localStorage.getItem('token')) {
      ensureAndroidAuthRestoredSync();
    }
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    attachAuthCookieToRequestConfig(config, token);
    if (isElectron) {
      const proxyConfig = setData?.proxyConfig;
      if (proxyConfig?.enable && ['http', 'https'].includes(proxyConfig?.protocol)) {
        config.params.proxy = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
      }
      if (setData.enableRealIP && setData.realIP) {
        config.params.realIP = setData.realIP;
      }
    }

    return config;
  },
  (error) => {
    // 当请求异常时做一些处理
    return Promise.reject(error);
  }
);

const NO_RETRY_URLS = ['暂时没有'];

const isClientOfflineNow = (): boolean => {
  try {
    if (useOfflineAvailabilityStore().isOffline) {
      return true;
    }
  } catch {
    // ignore if Pinia is not active yet
  }
  return typeof navigator !== 'undefined' && navigator.onLine === false;
};

const session301Guard = createHttp301SessionGuard({
  verifySession: () =>
    request.get('/login/status', buildLoginStatusVerifyConfig() as CustomAxiosRequestConfig),
  hasActiveAuthSession: () => {
    try {
      if (typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('token'))) {
        return true;
      }
    } catch {
      // ignore
    }
    try {
      const userStore = useUserStore();
      return Boolean(userStore.user?.userId && userStore.loginType !== 'uid');
    } catch {
      return false;
    }
  },
  isOffline: isClientOfflineNow,
  onConfirmedExpired: async () => {
    try {
      const userStore = useUserStore();
      await userStore.handleLogout();
    } catch {
      // ignore if Pinia is not active yet
    }
    showFloatingToast(SESSION_EXPIRED_TOAST_TEXT, 'ri-error-warning-line', 2600);
  }
});

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    try {
      const reqUrl = String(response?.config?.url || '');
      const bodyCode = response?.data?.code;
      if (
        !reqUrl.includes('__alger_health') &&
        bodyCode !== 502 &&
        bodyCode !== 503 &&
        bodyCode !== 504
      ) {
        useOfflineAvailabilityStore().markOnline();
      }
    } catch {
      // ignore if Pinia is not active yet
    }
    return response;
  },
  async (error) => {
    console.error('error', error);
    const config = error.config as CustomAxiosRequestConfig;

    // 离线安静模式：断网时立即快速失败并打标，避免无意义重试与重复弹窗
    if (isClientOfflineNow()) {
      (error as any).isOfflineError = true;
      return Promise.reject(error);
    }

    // 如果没有配置，直接返回错误
    if (!config) {
      return Promise.reject(error);
    }

    // 处理 301 状态码：先加防重入锁调用 /login/status 核验，防止冷启动竞态或单次波动误登出
    if (
      error.response?.status === 301 &&
      config.skip301Guard !== true &&
      config.params?.noLogin !== true
    ) {
      const guardResult = await session301Guard.handle301({
        url: String(config.url || ''),
        noLogin: config.params?.noLogin === true,
        skip301Guard: config.skip301Guard === true
      });
      if (guardResult.action === 'logged-out') {
        console.warn(`[request] HTTP 301 确认会话失效 (${guardResult.reason})，已清理登录态`);
        config.noRetry = true;
      } else if (guardResult.action === 'kept-valid') {
        console.info(
          `[request] 收到 HTTP 301 但 /login/status 仍有效 (${guardResult.reason})，保留登录态并允许安全重试`
        );
      } else {
        console.info(`[request] HTTP 301 未触发登出 (${guardResult.reason})`);
        config.noRetry = true;
      }
    }

    // 检查是否还可以重试
    if (
      config.retryCount !== undefined &&
      config.retryCount < MAX_RETRIES &&
      !NO_RETRY_URLS.includes(config.url as string) &&
      !config.noRetry
    ) {
      config.retryCount++;
      console.error(`请求重试第 ${config.retryCount} 次`);

      // 延迟重试
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));

      // 重新发起请求
      return request(config);
    }

    console.error(`重试${MAX_RETRIES}次后仍然失败`);
    return Promise.reject(error);
  }
);

export default request;
