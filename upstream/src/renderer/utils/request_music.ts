import axios from 'axios';

import { getAndroidMusicApiBaseUrl, isAndroid } from '@/utils/androidBridge';

const baseURL = isAndroid() ? getAndroidMusicApiBaseUrl() : `${import.meta.env.VITE_API_MUSIC}`;
const request = axios.create({
  baseURL,
  timeout: 15000
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    if (isAndroid()) {
      config.baseURL = getAndroidMusicApiBaseUrl();
    }
    return config;
  },
  (error) => {
    // 当请求异常时做一些处理
    return Promise.reject(error);
  }
);

export default request;
