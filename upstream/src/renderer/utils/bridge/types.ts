/**
 * AlgerMusicPlayer 原生桥接层类型定义（Android / iOS 共用）
 */

export interface AndroidServerConfig {
  mode: 'local' | 'custom';
  localPort: number;
  localToken?: string;
  customApiUrl: string;
  customMusicApiUrl: string;
  floatingLyricEnabled: boolean;
}

export type HapticStyle = 'light' | 'medium' | 'selection' | 'success';

export interface NativeCapabilities {
  supportsEq: boolean;
  supportsFloatingLyric: boolean;
  supportsBatteryOptimization: boolean;
  supportsAudioCache: boolean;
}

export interface AudioCacheLimitUpdateResult {
  maxMb: number;
  activeMaxMb: number;
  requiresRestart: boolean;
}

export interface FloatingLyricStyleConfig {
  color: string;
  textSizeSp: number;
  showTranslation: boolean;
  locked: boolean;
}

export interface AndroidBridgeInterface {
  getCapabilities?(): string;
  getServerConfig(): string;
  setServerConfig(json: string): string;
  getLocalServerStatus(): string;
  invokeAsync(callbackId: string, action: string, payloadJson: string): void;
  // Audio control (Android Media3 ExoPlayer / iOS AVPlayer)
  audioLoad(payloadJson: string): void;
  audioPlay(): void;
  audioPause(): void;
  audioStop(): void;
  audioSeek(positionSec: number): void;
  audioSetVolume(volume: number): void;
  audioSetRate(rate: number): void;
  audioGetState(): string;
  audioGetActiveTrack?(): string;
  audioSyncQueue(queueJson: string): void;
  audioSetAudioEnhancement?(configJson: string): void;
  setMediaFavoriteState?(songId: string, isFavorite: boolean): void;
  // Hardware Equalizer (Android only; iOS supportsEq=false)
  eqSetEnabled(enabled: boolean): void | boolean;
  eqSetBandGain(freqHz: number, gainDb: number): void | boolean;
  eqReset(): void | boolean;
  // Desktop / Floating Lyrics (Android only; iOS supportsFloatingLyric=false)
  setFloatingLyricEnabled(enabled: boolean): boolean;
  isFloatingLyricEnabled(): boolean;
  isFloatingLyricLocked?(): boolean;
  setFloatingLyricLocked?(locked: boolean): boolean;
  isFloatingLyricHideInLandscape?(): boolean;
  setFloatingLyricHideInLandscape?(enabled: boolean): boolean;
  updateFloatingLyric(text: string, translation: string, songTitle: string, isPlaying: boolean): void;
  syncFloatingLyricLines?(songId: string, songTitle: string, linesJson: string): void;
  getFloatingLyricStyle?(): string;
  setFloatingLyricStyle?(configJson: string): string;
  // Bluetooth Auto-Resume & Diagnostics (Android only)
  isAutoResumeOnBluetoothConnect?(): boolean;
  setAutoResumeOnBluetoothConnect?(enabled: boolean): boolean;
  getLastCrashLog?(): string;
  clearLastCrashLog?(): boolean;
  // System UI & Power
  setStatusBarStyle(isDark: boolean): void;
  requestIgnoreBatteryOptimizations(): void | boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openExternalUrl(url: string): void;
  showToast(msg: string): void;
  triggerHaptic?(style: string): void;
  isAudioOutputExternal?(): boolean;
  isAudioCached?(songId: string, quality: string): boolean;
  getOfflinePlayableIds?(): string;
  exitApp?(): void;
  getAudioCacheSize?(): number;
  clearAudioCache?(): boolean;
  getAudioCacheMaxMb?(): number;
  setAudioCacheMaxMb?(mb: number): string;
  getListeningStats?(): string;
  resetListeningStats?(): boolean;
  mergeListeningStats?(statsJson: string): string;
  consumePendingWidgetAction?(): string;
  secureSetSecret?(key: string, value: string): boolean;
  secureGetSecret?(key: string): string;
  secureRemoveSecret?(key: string): boolean;
  getNeteaseCookieFromStore?(): string;
  clearNeteaseCookies?(): boolean;
}

export type NativeEventListener = (event: any, data: any) => void;

export interface NativeIpcAdapter {
  on(channel: string, listener: NativeEventListener): void;
  removeListener(channel: string, listener: NativeEventListener): void;
  removeAllListeners(channel: string): void;
  send(channel: string, ...args: any[]): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
}

declare global {
  interface Window {
    AlgerAndroid?: AndroidBridgeInterface;
    __ALGER_PLATFORM__?: string;
    __ALGER_CAPABILITIES__?: Partial<NativeCapabilities>;
    __algerNativeCallback?: (callbackId: string, success: boolean, resultJson: string) => void;
    __algerNativeEvent?: (channel: string, payloadJson: string) => void;
    __algerHandleBack?: () => boolean;
  }
}
