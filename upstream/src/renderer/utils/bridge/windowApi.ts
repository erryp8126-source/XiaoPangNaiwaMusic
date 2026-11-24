import { assertSafeLxRequestUrl } from '../../services/LxMusicSourceRunner';
import {
  emitAndroidEvent,
  getNativeCapabilities,
  invokeAndroidAsync,
  isAndroid,
  onAndroidEvent,
  resolvePendingNativeCallback
} from './core';
import { androidIpcAdapter } from './ipcAdapter';
import { getActiveNativeHowl } from './nativeHowl';

// ==================== Global Window Bridge Installer ====================
let installed = false;

export function installAndroidWindowApi(): void {
  if (installed || !isAndroid()) return;
  installed = true;

  // 1. Register async callback dispatcher called from Android/iOS native shell
  window.__algerNativeCallback = (callbackId: string, success: boolean, resultJson: string) => {
    resolvePendingNativeCallback(callbackId, success, resultJson);
  };

  // 2. Register native event dispatcher called from Android/iOS native shell
  window.__algerNativeEvent = (channel: string, payloadJson: string) => {
    let payload: any = payloadJson;
    if (typeof payloadJson === 'string' && payloadJson.length > 0) {
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        payload = payloadJson;
      }
    }

    if (channel === 'audio-event') {
      const activeHowl = getActiveNativeHowl();
      if (payload?.type === 'nexttrack' || payload?.type === 'previoustrack') {
        emitAndroidEvent('media-control', payload.type);
      } else if (payload?.type === 'native-track-changed') {
        emitAndroidEvent('native-track-changed', payload);
      } else if (activeHowl) {
        activeHowl.handleNativeEvent(payload);
      }
      return;
    }

    emitAndroidEvent(channel, payload);
  };

  // 3. Install window.api shim for AlgerMusicPlayer v5.1.x features
  const existingApi = (window as any).api || {};
  (window as any).api = {
    ...existingApi,

    // Multi-source music unblock via native embedded unblock engine
    unblockMusic: async (id: number | string, songData: any, enabledSources?: string[]) => {
      return invokeAndroidAsync('unblock-music', {
        id: Number(id) || id,
        songData,
        enabledSources: enabledSources || ['pyncmd', 'kuwo', 'kugou', 'migu', 'gdmusic']
      });
    },

    // CORS-free HTTP request for LX Music scripts, GDMusic, and Custom API plugins
    lxMusicHttpRequest: async (params: { url: string; options?: any; requestId?: string }) => {
      const safeUrl = assertSafeLxRequestUrl(params.url);
      const rawBody = params.options?.body;
      const normalizedBody =
        rawBody === undefined || rawBody === null
          ? null
          : typeof rawBody === 'string'
            ? rawBody
            : JSON.stringify(rawBody);
      return invokeAndroidAsync(
        'http-request',
        {
          url: safeUrl,
          method: params.options?.method || 'GET',
          headers: params.options?.headers || {},
          body: normalizedBody,
          form: params.options?.form || null,
          timeout: params.options?.timeout || 15000
        },
        (params.options?.timeout || 15000) + 5000
      );
    },

    lxMusicHttpCancel: async (_requestId: string) => {
      return true;
    },

    // Import local .js / .json script via native document picker
    importLxMusicScript: async () => {
      return invokeAndroidAsync('pick-text-file', { accept: '.js' }, 120000);
    },

    importCustomApiPlugin: async () => {
      return invokeAndroidAsync('pick-text-file', { accept: '.json' }, 120000);
    },

    // Local music scanning via native MediaStore (Android) or Documents/LocalMusic (iOS)
    scanLocalMusicWithStats: async (folderPath: string) => {
      return invokeAndroidAsync('scan-local-music', { folderPath }, 60000);
    },

    parseLocalMusicMetadata: async (filePaths: string[]) => {
      return invokeAndroidAsync('parse-local-music-metadata', { filePaths }, 60000);
    },

    // Floating lyrics bridge (guarded by platform capability)
    openLyric: () => {
      if (getNativeCapabilities().supportsFloatingLyric) {
        window.AlgerAndroid?.setFloatingLyricEnabled(true);
      }
    },
    sendLyric: (dataStr: string) => {
      try {
        const data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (data?.type === 'update' || data?.text !== undefined) {
          // Handled via dedicated floating lyric sync in MusicHook
        }
      } catch {
        // ignore
      }
    },
    sendSong: (_song: any) => {
      // Metadata synced directly through NativeHowl -> MediaSession / NowPlaying
    },
    onLyricWindowClosed: (cb: () => void) => {
      onAndroidEvent('floating-lyric-closed', () => cb());
    },
    onLyricWindowReady: (_cb: () => void) => {},
    onLanguageChanged: (_cb: (lang: string) => void) => {},
    quitApp: () => {},
    invoke: (channel: string, ...args: any[]) => androidIpcAdapter.invoke(channel, ...args)
  };
}
