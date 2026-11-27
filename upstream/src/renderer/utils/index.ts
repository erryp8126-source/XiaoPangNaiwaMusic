import { computed } from 'vue';

import { useSettingsStore } from '@/store/modules/settings';

import { normalizeImgUrl, upgradeExternalHttpToHttps } from './imageUrl';

export { normalizeImgUrl, upgradeExternalHttpToHttps };

// 设置歌手背景图片
export const setBackgroundImg = (url: String) => {
  return `background-image:url(${upgradeExternalHttpToHttps(String(url || ''))})`;
};
// 设置动画类型
export const setAnimationClass = (type: String) => {
  const settingsStore = useSettingsStore();
  if (settingsStore.setData && settingsStore.setData.noAnimate) {
    return '';
  }
  const speed = settingsStore.setData?.animationSpeed || 1;

  let speedClass = '';
  if (speed <= 0.3) speedClass = 'animate__slower';
  else if (speed <= 0.8) speedClass = 'animate__slow';
  else if (speed >= 2.5) speedClass = 'animate__faster';
  else if (speed >= 1.5) speedClass = 'animate__fast';

  return `animate__animated ${type}${speedClass ? ` ${speedClass}` : ''}`;
};
// 设置动画延时
export const setAnimationDelay = (index: number = 6, time: number = 50) => {
  const settingsStore = useSettingsStore();
  if (settingsStore.setData?.noAnimate) {
    return '';
  }
  const speed = settingsStore.setData?.animationSpeed || 1;
  return `animation-delay:${(index * time) / (speed * 2)}ms`;
};

// 计算动画延迟(秒) - 用于新的动画效果
// 根据动画速度配置自动调整延迟时间
export const calculateAnimationDelay = (index: any, baseDelay: number = 0.03): string => {
  const settingsStore = useSettingsStore();
  if (settingsStore.setData?.noAnimate) {
    return '0s';
  }
  const speed = settingsStore.setData?.animationSpeed || 1;
  // 速度越快，延迟应该越短，所以除以 speed
  const delay = (index * baseDelay) / speed;
  return `${delay.toFixed(3)}s`;
};

// 将秒转换为分钟和秒
export const secondToMinute = (s: number) => {
  if (!s) {
    return '00:00';
  }
  const minute: number = Math.floor(s / 60);
  const second: number = Math.floor(s % 60);
  const minuteStr: string = minute > 9 ? minute.toString() : `0${minute.toString()}`;
  const secondStr: string = second > 9 ? second.toString() : `0${second.toString()}`;
  return `${minuteStr}:${secondStr}`;
};

// 格式化数字 千,万, 百万, 千万,亿
const units = [
  { value: 1e8, symbol: '亿' },
  { value: 1e4, symbol: '万' }
];

export const formatNumber = (num: string | number) => {
  num = Number(num);
  for (let i = 0; i < units.length; i++) {
    if (num >= units[i].value) {
      return `${(num / units[i].value).toFixed(1)}${units[i].symbol}`;
    }
  }
  return num.toString();
};

export const getImgUrl = (url: string | undefined, size: string = '') => {
  return normalizeImgUrl(url, size);
};

export const isMobile = computed(() => {
  const settingsStore = useSettingsStore();
  return settingsStore.isMobile;
});

export const isElectron = (window as any).electron !== undefined;

export const isIOS = typeof window !== 'undefined' && (window as any).__ALGER_PLATFORM__ === 'ios';

// Android 与 iOS 原生壳均注入统一的 window.AlgerAndroid 桥接对象，便于双端共享 100% 原生播控与本地代理能力
export const isAndroid = typeof window !== 'undefined' && (window as any).AlgerAndroid !== undefined;

export const isRealAndroid = isAndroid && !isIOS;

export const isNative = isElectron || isAndroid;

export const isLyricWindow = computed(() => {
  return window.location.hash.includes('lyric');
});

export const getSetData = (): any => {
  let setData = null;
  if (window.electron) {
    setData = window.electron.ipcRenderer.sendSync('get-store-value', 'set');
  } else {
    const settingsStore = useSettingsStore();
    setData = settingsStore.setData;
  }
  return setData;
};
