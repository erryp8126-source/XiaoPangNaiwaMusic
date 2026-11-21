import axios from 'axios';

import { getAndroidLocalAuthToken, getAndroidMusicApiBaseUrl, isAndroid } from '@/utils/androidBridge';
import { getDefaultWebApiBaseUrl } from '@/utils/request';

const resolveMusicBaseUrl = () => {
  if (isAndroid()) {
    return getAndroidMusicApiBaseUrl();
  }
  const pwaMusicApi =
    typeof localStorage !== 'undefined' ? localStorage.getItem('alger_pwa_music_api_url')?.trim() : '';
  if (pwaMusicApi) {
    return pwaMusicApi.replace(/\/+$/, '');
  }
  const envMusicApi =
    typeof import.meta.env.VITE_API_MUSIC === 'string' ? import.meta.env.VITE_API_MUSIC.trim() : '';
  if (envMusicApi && envMusicApi !== 'undefined' && envMusicApi !== '***') {
    return envMusicApi.replace(/\/+$/, '');
  }
  return getDefaultWebApiBaseUrl();
};

const baseURL = resolveMusicBaseUrl();
const request = axios.create({
  baseURL,
  timeout: 15000
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    config.baseURL = resolveMusicBaseUrl();
    if (isAndroid() && typeof config.baseURL === 'string' && config.baseURL.startsWith('http://127.0.0.1:')) {
      const localToken = getAndroidLocalAuthToken();
      if (localToken) {
        config.headers = config.headers || ({} as any);
        (config.headers as any)['X-Alger-Token'] = localToken;
      }
    }
    return config;
  },
  (error) => {
    // 当请求异常时做一些处理
    return Promise.reject(error);
  }
);

export default request;
