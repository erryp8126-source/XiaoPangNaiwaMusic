/**
 * AlgerMusicPlayer 原生桥接层统一导出入口（保持对外 API 100% 兼容）
 * 具体实现按职责拆分至 ./bridge/ 子模块：
 * - types.ts: 桥接接口、配置与平台能力类型
 * - core.ts: 环境探测、能力查询、返回键栈、异步回调、事件总线与服务配置
 * - ipcAdapter.ts: Electron 兼容 IPC 适配器
 * - nativeHowl.ts: 原生音频播放适配器与后台队列同步
 * - windowApi.ts: 全局 window.api 与原生回调分发安装器
 */

export type {
  AndroidBridgeInterface,
  AndroidServerConfig,
  HapticStyle,
  NativeCapabilities,
  NativeEventListener,
  NativeIpcAdapter
} from './bridge/types';

export {
  clearNativeNeteaseCookies,
  dispatchAndroidBackHandlers,
  fetchNativeOfflinePlayableIds,
  getAndroidApiBaseUrl,
  getAndroidLocalAuthToken,
  getAndroidLocalServerUrl,
  getAndroidMusicApiBaseUrl,
  getAndroidServerConfig,
  getNativeCapabilities,
  invokeAndroidAsync,
  isAndroid,
  isAndroidAudioCached,
  isCloudFavoriteSupportedSong,
  isExternalAudioOutputConnected,
  nativeSecureGetSecret,
  nativeSecureRemoveSecret,
  nativeSecureSetSecret,
  offAndroidEvent,
  onAndroidEvent,
  registerAndroidBackHandler,
  saveAndroidServerConfig,
  saveImageViaNativeBridge,
  syncNativeAudioEnhancement,
  syncNativeMediaFavoriteState,
  triggerHaptic,
  type OfflinePlayableIdGroups
} from './bridge/core';

export { getNativeIpc } from './bridge/ipcAdapter';

export {
  getActiveNativeHowl,
  NativeHowl,
  syncAndroidPlaybackQueue
} from './bridge/nativeHowl';

export { installAndroidWindowApi } from './bridge/windowApi';
