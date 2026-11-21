import {
  getNativeCapabilities,
  invokeAndroidAsync,
  isAndroid,
  offAndroidEvent,
  onAndroidEvent
} from './core';
import type { NativeIpcAdapter } from './types';

export const androidIpcAdapter: NativeIpcAdapter = {
  on(channel, listener) {
    onAndroidEvent(channel, listener);
  },
  removeListener(channel, listener) {
    offAndroidEvent(channel, listener);
  },
  removeAllListeners(channel) {
    offAndroidEvent(channel);
  },
  send(channel, ...args) {
    if (!isAndroid()) return;
    if (channel === 'download-music') {
      void invokeAndroidAsync('download-music', args[0] || {});
    } else if (channel === 'open-directory') {
      window.AlgerAndroid!.showToast(`保存位置: ${args[0] || 'Music/AlgerMusicPlayer'}`);
    } else if (channel === 'close-lyric') {
      if (getNativeCapabilities().supportsFloatingLyric) {
        window.AlgerAndroid!.setFloatingLyricEnabled(false);
      }
    } else if (channel === 'update-play-state') {
      // Handled directly by NativeHowl / ExoPlayer / AVPlayer
    } else if (channel === 'set-store-value') {
      const key = String(args[0] || '');
      try {
        localStorage.setItem(`alger_store_${key}`, JSON.stringify(args[1]));
      } catch {
        // ignore
      }
    }
  },
  async invoke(channel, ...args) {
    if (!isAndroid()) return null;
    switch (channel) {
      case 'get-store-value': {
        const key = String(args[0] || '');
        const raw = localStorage.getItem(`alger_store_${key}`);
        if (raw === null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      case 'get-downloads-path':
        return invokeAndroidAsync('get-downloads-path', {});
      case 'get-downloaded-music':
        return invokeAndroidAsync('get-downloaded-music', {});
      case 'check-file-exists':
        return invokeAndroidAsync('check-file-exists', { path: args[0] || '' });
      case 'delete-downloaded-music':
        return invokeAndroidAsync('delete-downloaded-music', { path: args[0] || '' });
      case 'clear-downloaded-music':
        return invokeAndroidAsync('clear-downloaded-music', {});
      case 'save-lyric-file':
        return invokeAndroidAsync('save-lyric-file', args[0] || {});
      case 'select-directory':
        return invokeAndroidAsync('select-local-music-source', {}, 120000);
      case 'get-download-settings':
        return invokeAndroidAsync('get-download-settings', {});
      case 'save-download-settings':
        return invokeAndroidAsync('save-download-settings', args[0] || {});
      case 'resolve-cached-music-url':
        return { url: args[0]?.url, cached: false };
      case 'get-cached-lyric':
        return null;
      case 'cache-lyric':
        return true;
      default:
        return invokeAndroidAsync(channel, { args });
    }
  }
};

export function getNativeIpc(): NativeIpcAdapter | null {
  if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
    return (window as any).electron.ipcRenderer;
  }
  if (isAndroid()) {
    return androidIpcAdapter;
  }
  return null;
}
