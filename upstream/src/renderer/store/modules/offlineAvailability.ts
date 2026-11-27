import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  fetchNativeOfflinePlayableIds,
  getNativeIpc,
  isAndroid,
  onAndroidEvent
} from '@/utils/androidBridge';

export type OfflineBadgeType = 'downloaded' | 'cached' | 'local' | null;
export type TrackOriginType = 'local' | 'downloaded' | 'cached' | 'online';

export const useOfflineAvailabilityStore = defineStore('offlineAvailability', () => {
  const downloadedIds = ref<Set<string>>(new Set());
  const cachedIds = ref<Set<string>>(new Set());
  const localIds = ref<Set<string>>(new Set());
  const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  const isOffline = computed(() => !isOnline.value);
  const initialized = ref(false);

  let listenersBound = false;

  const setOnlineStatus = (online: boolean) => {
    isOnline.value = Boolean(online);
  };

  const markOnline = () => {
    if (!isOnline.value) {
      isOnline.value = true;
    }
  };

  const syncBrowserOnlineStatus = () => {
    if (typeof navigator === 'undefined') return;
    if (!isAndroid()) {
      isOnline.value = navigator.onLine !== false;
      return;
    }
    if (navigator.onLine === true) {
      isOnline.value = true;
    }
  };

  const bindEnvironmentListeners = () => {
    if (listenersBound || typeof window === 'undefined') return;
    listenersBound = true;

    window.addEventListener('online', () => {
      isOnline.value = true;
    });
    window.addEventListener('offline', () => {
      isOnline.value = false;
    });
    window.addEventListener('focus', syncBrowserOnlineStatus);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          syncBrowserOnlineStatus();
        }
      });
    }

    if (isAndroid()) {
      onAndroidEvent('network-status-changed', (_, payload: any) => {
        if (typeof payload?.online === 'boolean') {
          setOnlineStatus(payload.online);
        } else if (typeof payload === 'boolean') {
          setOnlineStatus(payload);
        }
      });

      onAndroidEvent('music-download-complete', (_, payload: any) => {
        if (payload?.success) {
          const songId = payload?.songInfo?.id ?? payload?.id;
          if (songId !== undefined && songId !== null && String(songId).trim()) {
            const next = new Set(downloadedIds.value);
            next.add(String(songId));
            downloadedIds.value = next;
          }
          void refresh();
        }
      });
    }
  };

  bindEnvironmentListeners();

  const refresh = async (): Promise<void> => {
    bindEnvironmentListeners();
    const nextDownloaded = new Set<string>();
    const nextCached = new Set<string>();
    const nextLocal = new Set<string>();

    try {
      if (isAndroid()) {
        const nativeIds = await fetchNativeOfflinePlayableIds();
        nativeIds.downloadedIds.forEach((id) => nextDownloaded.add(id));
        nativeIds.cachedIds.forEach((id) => nextCached.add(id));
        nativeIds.localIds.forEach((id) => nextLocal.add(id));
      } else {
        const ipc = getNativeIpc();
        if (ipc) {
          try {
            const list = await ipc.invoke('get-downloaded-music');
            if (Array.isArray(list)) {
              for (const item of list) {
                if (item?.id !== undefined && item?.id !== null) {
                  nextDownloaded.add(String(item.id));
                }
              }
            }
          } catch {
            // ignore on web
          }
        }
      }

      // 合并前端已加载的本地音乐 Store ID 与路径
      try {
        const { useLocalMusicStore } = await import('./localMusic');
        const localStore = useLocalMusicStore();
        for (const entry of localStore.musicList || []) {
          if (entry?.id) nextLocal.add(String(entry.id));
          if (entry?.filePath) nextLocal.add(String(entry.filePath));
        }
      } catch {
        // ignore
      }
    } finally {
      downloadedIds.value = nextDownloaded;
      cachedIds.value = nextCached;
      localIds.value = nextLocal;
      initialized.value = true;
    }
  };

  const ensureInitialized = () => {
    bindEnvironmentListeners();
    if (!initialized.value) {
      void refresh();
    }
  };

  const markCached = (songId: string | number | undefined | null) => {
    if (songId === undefined || songId === null || !String(songId).trim()) return;
    const key = String(songId);
    if (!cachedIds.value.has(key)) {
      const next = new Set(cachedIds.value);
      next.add(key);
      cachedIds.value = next;
    }
  };

  const markDownloaded = (songId: string | number | undefined | null) => {
    if (songId === undefined || songId === null || !String(songId).trim()) return;
    const key = String(songId);
    if (!downloadedIds.value.has(key)) {
      const next = new Set(downloadedIds.value);
      next.add(key);
      downloadedIds.value = next;
    }
  };

  const getOfflineBadge = (
    song: { id?: string | number; playMusicUrl?: string; isDownloadedTrack?: boolean } | null | undefined
  ): OfflineBadgeType => {
    if (!song) return null;
    const key = song.id !== undefined && song.id !== null ? String(song.id) : '';
    if (song.isDownloadedTrack || (key && downloadedIds.value.has(key))) {
      return 'downloaded';
    }
    if (
      song.playMusicUrl?.startsWith('local://') ||
      (key && localIds.value.has(key))
    ) {
      return 'local';
    }
    if (key && cachedIds.value.has(key)) {
      return 'cached';
    }
    return null;
  };

  const isOfflinePlayable = (
    song: { id?: string | number; playMusicUrl?: string; isDownloadedTrack?: boolean } | null | undefined
  ): boolean => {
    return getOfflineBadge(song) !== null;
  };

  const getTrackOrigin = (
    song: { id?: string | number; playMusicUrl?: string; isDownloadedTrack?: boolean } | null | undefined
  ): TrackOriginType => {
    return getOfflineBadge(song) ?? 'online';
  };

  const isTrackUnavailableOffline = (
    song: { id?: string | number; playMusicUrl?: string; isDownloadedTrack?: boolean } | null | undefined
  ): boolean => {
    return isOffline.value && !isOfflinePlayable(song);
  };

  return {
    downloadedIds,
    cachedIds,
    localIds,
    isOnline,
    isOffline,
    initialized,
    refresh,
    ensureInitialized,
    setOnlineStatus,
    markOnline,
    markCached,
    markDownloaded,
    getOfflineBadge,
    getTrackOrigin,
    isOfflinePlayable,
    isTrackUnavailableOffline
  };
});
