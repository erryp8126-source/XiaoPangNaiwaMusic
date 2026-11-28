import { cloneDeep } from 'lodash';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { getParsingMusicUrl } from '@/api/music';
import { useLyrics, useSongDetail } from '@/hooks/usePlayerHooks';
import { audioService, isPlaybackCancelledError } from '@/services/audioService';
import { playbackRequestManager } from '@/services/playbackRequestManager';
import { preloadService } from '@/services/preloadService';
import { SongSourceConfigManager } from '@/services/SongSourceConfigManager';
import type { AudioOutputDevice } from '@/types/audio';
import type { Platform, SongResult } from '@/types/music';
import { getImgUrl } from '@/utils';
import {
  getNativeCapabilities,
  isAndroid,
  isAndroidAudioCached,
  isExternalAudioOutputConnected
} from '@/utils/androidBridge';
import {
  getEffectiveLaunchAutoPlayMode,
  isAutoplayBlockedError,
  shouldAutoPlayOnLaunch
} from '@/utils/launchPolicy';
import { getImageLinearBackground } from '@/utils/linearColor';
import {
  classifyPlaybackFailure,
  MAX_SINGLE_TRACK_RETRIES,
  shouldRetrySingleTrack
} from '@/utils/playbackDiagnostics';
import {
  notifyPlaybackAutoFallback,
  notifyPlaybackBufferingRetry,
  notifyPlaybackUnavailable
} from '@/utils/playbackFeedback';
import { buildPlaybackMeta, inferPlaybackMetaFromUrl } from '@/utils/playbackMeta';
import { resolveSeededFirstSong } from '@/utils/playlistIndexSync';

import { useOfflineAvailabilityStore } from './offlineAvailability';
import { usePlayHistoryStore } from './playHistory';

const isOfflineNow = (): boolean => {
  try {
    return useOfflineAvailabilityStore().isOffline;
  } catch {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }
};

export type PlayMusicOutcome = 'playing' | 'cancelled' | 'failed' | 'autoplay-blocked';

/**
 * 核心播放控制 Store
 * 负责：播放/暂停、当前歌曲、音频URL、音量、播放速度、全屏状态
 */
export const usePlayerCoreStore = defineStore(
  'playerCore',
  () => {
    // ==================== 状态 ====================
    const play = ref(false);
    const isPlay = ref(false);
    const playMusic = ref<SongResult>({} as SongResult);
    const playMusicUrl = ref('');
    const musicFull = ref(false);
    const playbackRate = ref(1.0);
    const volume = ref(1);
    const userPlayIntent = ref(false); // 用户是否想要播放
    const isFmPlaying = ref(false); // 是否正在播放私人FM
    const isSeedingLaunchTrack = ref(false); // 首次打开无历史记录时正在拉取推荐首曲
    const isBuffering = ref(false); // 切歌解析或原生播放器缓冲中
    const lastPlaybackError = ref('');
    const lastFailureCode = ref<string>('');
    const lastPlaybackOutcome = ref<'idle' | PlayMusicOutcome>('idle');

    // 音频输出设备
    const audioOutputDeviceId = ref<string>(
      localStorage.getItem('audioOutputDeviceId') || 'default'
    );
    const availableAudioDevices = ref<AudioOutputDevice[]>([]);

    let checkPlayTime: NodeJS.Timeout | null = null;
    let checkPlaybackRetryCount = 0;
    const MAX_CHECKPLAYBACK_RETRIES = MAX_SINGLE_TRACK_RETRIES; // 严格限制单曲最大重试 <= 2 次
    let scrobbleTimer: number | null = null;
    let seedLaunchPromise: Promise<boolean> | null = null;

    // 监听 Web / Safari PWA 自动播放策略拦截事件：静默停在待播态，绝不弹出报错提示
    audioService.on('autoplay_blocked', () => {
      if (checkPlayTime) {
        clearTimeout(checkPlayTime);
        checkPlayTime = null;
      }
      checkPlaybackRetryCount = 0;
      isBuffering.value = false;
      play.value = false;
      isPlay.value = false;
      userPlayIntent.value = false;
      if (playMusic.value) {
        playMusic.value.playLoading = false;
      }
    });

    audioService.on('buffering', (buffering: boolean) => {
      isBuffering.value = Boolean(buffering);
    });
    const clearBufferingState = () => {
      isBuffering.value = false;
    };
    audioService.on('load', clearBufferingState);
    audioService.on('play', clearBufferingState);
    audioService.on('pause', clearBufferingState);
    audioService.on('end', clearBufferingState);
    audioService.on('loaderror', clearBufferingState);
    audioService.on('playerror', clearBufferingState);

    // ==================== Computed ====================
    const currentSong = computed(() => playMusic.value);
    const isPlaying = computed(() => isPlay.value);

    // ==================== Actions ====================

    /**
     * 设置缓冲中状态
     */
    const setBuffering = (value: boolean) => {
      isBuffering.value = Boolean(value);
    };

    /**
     * 设置播放状态
     */
    const setIsPlay = (value: boolean) => {
      isPlay.value = value;
      play.value = value;
      if (!value) {
        isBuffering.value = false;
      }
      window.electron?.ipcRenderer.send('update-play-state', value);
    };

    /**
     * 设置全屏状态
     */
    const setMusicFull = (value: boolean) => {
      musicFull.value = value;
    };

    /**
     * 设置播放速度
     */
    const setPlaybackRate = (rate: number) => {
      playbackRate.value = rate;
      audioService.setPlaybackRate(rate);
    };

    /**
     * 设置音量
     */
    const setVolume = (newVolume: number) => {
      const normalizedVolume = Math.max(0, Math.min(1, newVolume));
      volume.value = normalizedVolume;
      audioService.setVolume(normalizedVolume);
    };

    /**
     * 获取音量
     */
    const getVolume = () => volume.value;

    /**
     * 增加音量
     */
    const increaseVolume = (step: number = 0.1) => {
      const newVolume = Math.min(1, volume.value + step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 减少音量
     */
    const decreaseVolume = (step: number = 0.1) => {
      const newVolume = Math.max(0, volume.value - step);
      setVolume(newVolume);
      return newVolume;
    };

    /**
     * 取消待执行的播放状态检测定时器（例如原生层已无缝切歌或从通知栏接管时调用，防止旧定时器误跳回旧歌）
     */
    const cancelPlaybackCheck = () => {
      if (checkPlayTime) {
        clearTimeout(checkPlayTime);
        checkPlayTime = null;
      }
      checkPlaybackRetryCount = 0;
    };

    /**
     * 播放状态检测
     * 在播放开始后延迟检查音频是否真正在播放，防止无声播放
     */
    const checkPlaybackState = (song: SongResult, requestId?: string, timeout: number = 6000) => {
      if (checkPlayTime) {
        clearTimeout(checkPlayTime);
      }
      const sound = audioService.getCurrentSound();
      if (!sound) return;

      // 如果没有提供 requestId，创建一个临时标识
      const actualRequestId = requestId || `check_${Date.now()}`;

      const onPlayHandler = () => {
        console.log(`[${actualRequestId}] 播放事件触发，歌曲成功开始播放`);
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);
        checkPlaybackRetryCount = 0; // 播放成功，重置重试计数
        if (checkPlayTime) {
          clearTimeout(checkPlayTime);
          checkPlayTime = null;
        }
      };

      const onPlayErrorHandler = async (err?: any) => {
        // 网页版 / Safari PWA 自动播放策略拦截：静默退回待播态，不报错也不切歌
        if (isAutoplayBlockedError(err?.error ?? err)) {
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);
          cancelPlaybackCheck();
          if (playMusic.value) {
            playMusic.value.playLoading = false;
          }
          setPlayMusic(false);
          return;
        }
        console.log('播放错误事件触发，检查是否需要重新获取URL');
        audioService.off('play', onPlayHandler);
        audioService.off('playerror', onPlayErrorHandler);

        // 如果有 requestId，验证其有效性
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过重试');
          return;
        }

        const isLocal = Boolean(playMusic.value?.playMusicUrl?.startsWith('local://'));
        const offlineNow = isOfflineNow();
        const diagnosis = classifyPlaybackFailure({
          error: err,
          hasUrl: Boolean(playMusic.value?.playMusicUrl),
          isOffline: offlineNow,
          isLocal
        });
        lastPlaybackError.value = diagnosis.userMessage;
        lastFailureCode.value = diagnosis.code;

        if (playMusic.value) {
          playMusic.value.playLoading = false;
        }

        // 检查重试次数上限（严格 <= 2 次）及失败类型，杜绝无限转圈重试
        if (!shouldRetrySingleTrack(checkPlaybackRetryCount, diagnosis.code)) {
          console.warn(
            `播放失败且不再重试 (reason=${diagnosis.code}, retries=${checkPlaybackRetryCount}/${MAX_CHECKPLAYBACK_RETRIES})`
          );
          checkPlaybackRetryCount = 0;
          notifyPlaybackUnavailable(song?.name || playMusic.value?.name, {
            isOffline: offlineNow,
            isLocal
          });
          if (userPlayIntent.value && diagnosis.code !== 'offline') {
            const { usePlaylistStore } = await import('./playlist');
            const playlistStore = usePlaylistStore();
            if (playlistStore.playList.length > 1) {
              playlistStore.nextPlay();
              return;
            }
          }
          setPlayMusic(false);
          return;
        }

        if (userPlayIntent.value && play.value) {
          checkPlaybackRetryCount++;
          notifyPlaybackBufferingRetry(song?.name || playMusic.value?.name, {
            isOffline: offlineNow
          });
          if (!isLocal) {
            playMusic.value.playMusicUrl = undefined;
          }
          const refreshedSong = { ...song, isFirstPlay: true };
          await handlePlayMusic(refreshedSong, true);
        }
      };

      audioService.on('play', onPlayHandler);
      audioService.on('playerror', onPlayErrorHandler);

      checkPlayTime = setTimeout(() => {
        // 如果有 requestId，验证其有效性
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log('请求已过期，跳过超时重试');
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);
          return;
        }

        // 双重确认：Howler 报告未播放 + 用户仍想播放
        // 额外检查底层 HTMLAudioElement 的状态，避免 EQ 重建期间的误判
        const currentSound = audioService.getCurrentSound();
        let htmlPlaying = false;
        if (currentSound) {
          try {
            const sounds = (currentSound as any)._sounds as any[];
            if (sounds?.[0]?._node instanceof HTMLMediaElement) {
              const node = sounds[0]._node as HTMLMediaElement;
              htmlPlaying = !node.paused && !node.ended && node.readyState > 2;
            }
          } catch {
            // 静默忽略
          }
        }

        if (htmlPlaying) {
          // 底层 HTMLAudioElement 实际在播放，不需要重试
          console.log('底层音频元素正在播放，跳过超时重试');
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);
          return;
        }

        // 原生壳（Android/iOS）：额外核对底层 ExoPlayer/AVPlayer 真实状态，
        // 避免从后台/通知栏返回时因 WebView 曾休眠误判未播放而跳转回旧歌曲
        if (isAndroid()) {
          try {
            const rawNative = window.AlgerAndroid?.audioGetState?.();
            if (rawNative) {
              const st = JSON.parse(rawNative);
              if (st?.playing) {
                audioService.off('play', onPlayHandler);
                audioService.off('playerror', onPlayErrorHandler);
                return;
              }
            }
          } catch {
            // ignore
          }
          if (String(playMusic.value?.id) !== String(song.id)) {
            audioService.off('play', onPlayHandler);
            audioService.off('playerror', onPlayErrorHandler);
            return;
          }
        }

        if (!audioService.isActuallyPlaying() && userPlayIntent.value && play.value) {
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);

          const isLocal = Boolean(playMusic.value?.playMusicUrl?.startsWith('local://'));
          const offlineNow = isOfflineNow();
          const diagnosis = classifyPlaybackFailure({
            error: 'network timeout',
            hasUrl: Boolean(playMusic.value?.playMusicUrl),
            isOffline: offlineNow,
            isLocal
          });
          lastPlaybackError.value = diagnosis.userMessage;
          lastFailureCode.value = diagnosis.code;
          if (playMusic.value) {
            playMusic.value.playLoading = false;
          }

          // 检查重试次数上限（严格 <= 2 次）：超时或离线不再无限转圈
          if (!shouldRetrySingleTrack(checkPlaybackRetryCount, diagnosis.code)) {
            console.warn(`超时重试已达上限 (${MAX_CHECKPLAYBACK_RETRIES} 次)，停止当前曲目重试`);
            checkPlaybackRetryCount = 0;
            notifyPlaybackUnavailable(song?.name || playMusic.value?.name, {
              isOffline: offlineNow,
              isLocal
            });
            if (userPlayIntent.value && diagnosis.code !== 'offline') {
              void (async () => {
                const { usePlaylistStore } = await import('./playlist');
                const playlistStore = usePlaylistStore();
                if (playlistStore.playList.length > 1) {
                  playlistStore.nextPlay();
                } else {
                  setPlayMusic(false);
                }
              })();
            } else {
              setPlayMusic(false);
            }
            return;
          }

          checkPlaybackRetryCount++;
          notifyPlaybackBufferingRetry(song?.name || playMusic.value?.name, {
            isOffline: offlineNow
          });

          if (!isLocal) {
            playMusic.value.playMusicUrl = undefined;
          }
          (async () => {
            const refreshedSong = { ...song, isFirstPlay: true };
            await handlePlayMusic(refreshedSong, true);
          })();
        } else {
          audioService.off('play', onPlayHandler);
          audioService.off('playerror', onPlayErrorHandler);
        }
      }, timeout);
    };

    /**
     * 核心播放处理函数（显式区分成功 / 被新切歌取消 / 失败 / 浏览器自动播放拦截）
     */
    const handlePlayMusicWithOutcome = async (
      music: SongResult,
      shouldPlay: boolean = true
    ): Promise<PlayMusicOutcome> => {
      // 如果是新歌曲，重置已尝试的音源和重试计数
      if (music.id !== playMusic.value.id) {
        SongSourceConfigManager.clearTriedSources(music.id);
        checkPlaybackRetryCount = 0;
      }

      // 创建新的播放请求并取消之前的所有请求
      const requestId = playbackRequestManager.createRequest(music);
      console.log(`[handlePlayMusic] 开始处理歌曲: ${music.name}, 请求ID: ${requestId}`);

      const currentSound = audioService.getCurrentSound();
      if (currentSound) {
        if (isAndroid()) {
          // 原生壳（Android / iOS）切歌时仅解绑旧实例监听，不提前调用 audioStop()，
          // 防止误取消原生切歌过渡 WakeLock 与后台自动切歌保险丝；由下一次 audioLoad 无缝替换曲目
          currentSound.off();
        } else {
          console.log('主动停止并卸载当前音频实例');
          currentSound.stop();
          currentSound.unload();
        }
      }

      // 验证请求是否仍然有效
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 请求已失效: ${requestId}`);
        lastPlaybackOutcome.value = 'cancelled';
        return 'cancelled';
      }

      // 激活请求
      if (!playbackRequestManager.activateRequest(requestId)) {
        console.log(`[handlePlayMusic] 无法激活请求: ${requestId}`);
        lastPlaybackOutcome.value = 'cancelled';
        return 'cancelled';
      }

      const originalMusic = { ...music };

      const { loadLrc } = useLyrics();
      const { getSongDetail } = useSongDetail();

      // 并行加载歌词和背景色
      const [lyrics, { backgroundColor, primaryColor }] = await Promise.all([
        (async () => {
          if (music.lyric && music.lyric.lrcTimeArray.length > 0) {
            return music.lyric;
          }
          return await loadLrc(music.id);
        })(),
        (async () => {
          if (music.backgroundColor && music.primaryColor) {
            return { backgroundColor: music.backgroundColor, primaryColor: music.primaryColor };
          }
          return await getImageLinearBackground(getImgUrl(music?.picUrl, '30y30'));
        })()
      ]);

      // 在更新状态前再次验证请求
      if (!playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[handlePlayMusic] 加载歌词/背景色后请求已失效: ${requestId}`);
        lastPlaybackOutcome.value = 'cancelled';
        return 'cancelled';
      }

      // 设置歌词和背景色
      music.lyric = lyrics;
      music.backgroundColor = backgroundColor;
      music.primaryColor = primaryColor;
      music.playLoading = true;

      // 更新 playMusic 和播放状态
      playMusic.value = music;
      play.value = shouldPlay;
      isPlay.value = shouldPlay;
      userPlayIntent.value = shouldPlay;

      // 更新标题
      let title = music.name;
      if (music.source === 'netease' && music?.song?.artists) {
        title += ` - ${music.song.artists.reduce(
          (prev: string, curr: any) => `${prev}${curr.name}/`,
          ''
        )}`;
      }
      document.title = '小庞奶娃音乐 - ' + title;

      try {
        // 添加到历史记录
        const playHistoryStore = usePlayHistoryStore();
        if (music.isPodcast) {
          if (music.program) {
            playHistoryStore.addPodcast(music.program);
          }
        } else {
          playHistoryStore.addMusic(music);
        }

        // 触发免 Cookie 个人云同步节流上传（若用户已配置 WebDAV / GitHub Gist）
        import('./cloudSync')
          .then(({ useCloudSyncStore }) => {
            useCloudSyncStore().scheduleAutoSyncAfterPlay();
          })
          .catch(() => {});

        // 若已扫码/账号登录网易云，连续播放满 30 秒自动向网易云打卡同步云端最近播放
        if (scrobbleTimer !== null) {
          window.clearTimeout(scrobbleTimer);
          scrobbleTimer = null;
        }
        if (
          shouldPlay &&
          !music.isPodcast &&
          typeof music.id === 'number' &&
          music.source !== 'bilibili' &&
          !music.playMusicUrl?.startsWith('local://')
        ) {
          const targetId = music.id;
          const sourceId = music.al?.id || music.song?.album?.id || '';
          const durationSec = Math.max(
            30,
            Math.round(((music.dt || music.song?.duration || 180000) as number) / 1000)
          );
          scrobbleTimer = window.setTimeout(async () => {
            scrobbleTimer = null;
            try {
              if (playMusic.value?.id !== targetId || !play.value) return;
              const { useUserStore } = await import('./user');
              const userStore = useUserStore();
              if (!userStore.hasNeteaseAuth) return;
              const { scrobbleSong } = await import('@/api/user');
              await scrobbleSong({ id: targetId, sourceid: sourceId, time: durationSec });
            } catch {
              // 静默忽略打卡失败，不影响播放
            }
          }, 30000);
        }

        // 获取歌曲详情
        const updatedPlayMusic = await getSongDetail(originalMusic, requestId);

        // 在获取详情后再次验证请求
        if (!playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[handlePlayMusic] 获取歌曲详情后请求已失效: ${requestId}`);
          lastPlaybackOutcome.value = 'cancelled';
          return 'cancelled';
        }

        updatedPlayMusic.lyric = lyrics;

        // 若所有音源均未能返回有效播放地址，立即结束 loading 并给出清晰原因，杜绝无限转圈
        if (!updatedPlayMusic.playMusicUrl || !String(updatedPlayMusic.playMusicUrl).trim()) {
          if (!playbackRequestManager.isRequestValid(requestId)) {
            lastPlaybackOutcome.value = 'cancelled';
            return 'cancelled';
          }
          const isLocal = Boolean(originalMusic.playMusicUrl?.startsWith('local://'));
          const offlineNow = isOfflineNow();
          const diagnosis = classifyPlaybackFailure({
            hasUrl: false,
            isOffline: offlineNow,
            isLocal
          });
          lastPlaybackError.value = diagnosis.userMessage;
          lastFailureCode.value = diagnosis.code;
          isBuffering.value = false;
          updatedPlayMusic.playLoading = false;
          playMusic.value = updatedPlayMusic;
          setIsPlay(false);
          notifyPlaybackUnavailable(updatedPlayMusic.name || originalMusic.name, {
            isOffline: offlineNow,
            isLocal
          });
          playbackRequestManager.failRequest(requestId);
          lastPlaybackOutcome.value = 'failed';
          return 'failed';
        }

        // 统一补齐播放音源/音质元数据，并在原生缓存命中时标注「本地缓存」
        const { useSettingsStore } = await import('./settings');
        if (!playbackRequestManager.isRequestValid(requestId)) {
          lastPlaybackOutcome.value = 'cancelled';
          return 'cancelled';
        }
        const settingsStore = useSettingsStore();
        const currentQuality = settingsStore.setData?.musicQuality || 'higher';
        const isLocalUrl = Boolean(updatedPlayMusic.playMusicUrl?.startsWith('local://'));
        const hitAndroidDiskCache =
          isAndroid() &&
          !isLocalUrl &&
          isAndroidAudioCached(updatedPlayMusic.id, currentQuality);

        updatedPlayMusic.playbackMeta = inferPlaybackMetaFromUrl(updatedPlayMusic.playMusicUrl, {
          isDownloaded: Boolean(updatedPlayMusic.isDownloadedTrack),
          fromDiskCache: hitAndroidDiskCache,
          fallbackQuality: currentQuality,
          existing: updatedPlayMusic.playbackMeta
        });

        // 当主音源解析失败已自动切换备用解灰 / LX 源时，统一收口为单条轻提示
        if (
          shouldPlay &&
          updatedPlayMusic.playbackMeta?.fallbackFrom === 'official' &&
          !updatedPlayMusic.playbackMeta?.fromDiskCache
        ) {
          notifyPlaybackAutoFallback(updatedPlayMusic.name, { isOffline: isOfflineNow() });
          updatedPlayMusic.playbackMeta = {
            ...updatedPlayMusic.playbackMeta,
            fallbackFrom: undefined
          };
        }

        // 播放成功后，若当前平台支持原生边听边缓存，即时刷新离线可播缓存徽标
        if (isAndroid() && getNativeCapabilities().supportsAudioCache && !isLocalUrl && updatedPlayMusic.id) {
          import('./offlineAvailability')
            .then(({ useOfflineAvailabilityStore }) => {
              useOfflineAvailabilityStore().markCached(updatedPlayMusic.id);
            })
            .catch(() => {});
        }

        playMusic.value = updatedPlayMusic;
        playMusicUrl.value = updatedPlayMusic.playMusicUrl as string;
        music.playMusicUrl = updatedPlayMusic.playMusicUrl as string;

        // 在拆分后补充：触发预加载下一首/下下首（与 playlist store 保持一致）
        try {
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          // 基于当前歌曲在播放列表中的位置来预加载
          const list = playlistStore.playList;
          if (Array.isArray(list) && list.length > 0) {
            const idx = list.findIndex(
              (item: SongResult) =>
                item.id === updatedPlayMusic.id && item.source === updatedPlayMusic.source
            );
            if (idx !== -1) {
              setTimeout(() => {
                if (playbackRequestManager.isRequestValid(requestId)) {
                  playlistStore.preloadNextSongs(idx);
                }
              }, 3000);
            }
          }
        } catch (e) {
          console.warn('预加载触发失败（可能是依赖未加载或循环依赖），已忽略:', e);
        }

        try {
          const result = await playAudio(requestId);
          if (!playbackRequestManager.isRequestValid(requestId)) {
            lastPlaybackOutcome.value = 'cancelled';
            return 'cancelled';
          }

          if (result) {
            // 播放成功，清除 isFirstPlay 标记，避免暂停时被误判为新歌
            playMusic.value.isFirstPlay = false;
            playbackRequestManager.completeRequest(requestId);
            lastPlaybackOutcome.value = 'playing';
            return 'playing';
          } else {
            if (lastPlaybackOutcome.value === 'autoplay-blocked') {
              playbackRequestManager.failRequest(requestId);
              return 'autoplay-blocked';
            }
            playbackRequestManager.failRequest(requestId);
            lastPlaybackOutcome.value = 'failed';
            return 'failed';
          }
        } catch (error) {
          isBuffering.value = false;
          if (isPlaybackCancelledError(error) || !playbackRequestManager.isRequestValid(requestId)) {
            lastPlaybackOutcome.value = 'cancelled';
            return 'cancelled';
          }
          if (isAutoplayBlockedError(error)) {
            lastPlaybackOutcome.value = 'autoplay-blocked';
            playbackRequestManager.failRequest(requestId);
            return 'autoplay-blocked';
          }
          console.error('自动播放音频失败:', error);
          playbackRequestManager.failRequest(requestId);
          lastPlaybackOutcome.value = 'failed';
          return 'failed';
        }
      } catch (error) {
        isBuffering.value = false;
        if (isPlaybackCancelledError(error) || !playbackRequestManager.isRequestValid(requestId)) {
          console.info(`[handlePlayMusic] 切歌请求已被新切歌取消: ${requestId}`);
          lastPlaybackOutcome.value = 'cancelled';
          return 'cancelled';
        }
        if (isAutoplayBlockedError(error)) {
          console.info('[handlePlayMusic] Browser autoplay blocked, staying paused ready-to-play');
          if (playMusic.value) {
            playMusic.value.playLoading = false;
          }
          setIsPlay(false);
          userPlayIntent.value = false;
          playbackRequestManager.failRequest(requestId);
          lastPlaybackOutcome.value = 'autoplay-blocked';
          return 'autoplay-blocked';
        }
        console.error('处理播放音乐失败:', error);
        const isLocal = Boolean(originalMusic.playMusicUrl?.startsWith('local://'));
        const offlineNow = isOfflineNow();
        const diagnosis = classifyPlaybackFailure({
          error,
          hasUrl: Boolean(playMusicUrl.value),
          isOffline: offlineNow,
          isLocal
        });
        lastPlaybackError.value = diagnosis.userMessage;
        lastFailureCode.value = diagnosis.code;
        notifyPlaybackUnavailable(originalMusic?.name || playMusic.value?.name, {
          isOffline: offlineNow,
          isLocal
        });
        if (playMusic.value) {
          playMusic.value.playLoading = false;
        }
        playbackRequestManager.failRequest(requestId);
        lastPlaybackOutcome.value = 'failed';
        return 'failed';
      }
    };

    const handlePlayMusic = async (music: SongResult, shouldPlay: boolean = true): Promise<boolean> => {
      return (await handlePlayMusicWithOutcome(music, shouldPlay)) === 'playing';
    };

    /**
     * 播放音频
     */
    const playAudio = async (requestId?: string) => {
      if (!playMusicUrl.value || !playMusic.value) return null;

      // 如果提供了 requestId，验证请求是否仍然有效
      if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
        console.log(`[playAudio] 请求已失效: ${requestId}`);
        return null;
      }

      try {
        const shouldPlay = play.value;
        console.log('播放音频，当前播放状态:', shouldPlay ? '播放' : '暂停');

        // 检查保存的进度
        let initialPosition = 0;
        const savedProgress = JSON.parse(localStorage.getItem('playProgress') || '{}');
        console.log(
          '[playAudio] 读取保存的进度:',
          savedProgress,
          '当前歌曲ID:',
          playMusic.value.id
        );
        if (
          savedProgress.songId === playMusic.value.id &&
          typeof savedProgress.progress === 'number' &&
          savedProgress.progress > 1
        ) {
          const songDurSec = (playMusic.value.dt || playMusic.value.duration || 0) / 1000;
          if (songDurSec <= 0 || savedProgress.progress < songDurSec - 5) {
            initialPosition = savedProgress.progress;
            console.log('[playAudio] 恢复播放进度:', initialPosition);
          }
        }

        // 使用 PreloadService 获取音频
        // 优先使用已预加载的 sound（通过 consume 获取并从缓存中移除）
        // 如果没有预加载，则进行加载
        let sound: Howl | undefined;
        if (!isAndroid()) {
          try {
            // 先尝试消耗预加载的 sound
            const preloadedSound = preloadService.consume(playMusic.value.id);
            if (preloadedSound && preloadedSound.state() === 'loaded') {
              console.log(`[playAudio] 使用预加载的音频: ${playMusic.value.name}`);
              sound = preloadedSound;
            } else {
              // 没有预加载或预加载状态不正常，需要加载
              console.log(`[playAudio] 没有预加载，开始加载: ${playMusic.value.name}`);
              sound = await preloadService.load(playMusic.value);
            }
          } catch (error) {
            console.error('PreloadService 加载失败:', error);
            // 如果 PreloadService 失败，尝试直接播放作为回退
            // 但通常 PreloadService 失败意味着 URL 问题
            throw error;
          }
        }

        // 播放新音频，传入已加载的 sound 实例
        if (shouldPlay) {
          isBuffering.value = true;
        }
        const newSound = await audioService.play(
          playMusicUrl.value,
          playMusic.value,
          shouldPlay,
          initialPosition || 0,
          sound
        );

        // 播放后再次验证请求
        if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
          console.log(`[playAudio] 播放后请求已失效: ${requestId}`);
          newSound.stop();
          newSound.unload();
          return null;
        }

        // 添加播放状态检测
        if (shouldPlay && requestId) {
          checkPlaybackState(playMusic.value, requestId);
        }

        // 发布音频就绪事件
        window.dispatchEvent(
          new CustomEvent('audio-ready', { detail: { sound: newSound, shouldPlay } })
        );

        // 时长检查已在 preloadService.ts 中完成

        return newSound;
      } catch (error) {
        isBuffering.value = false;
        if (isPlaybackCancelledError(error) || (requestId && !playbackRequestManager.isRequestValid(requestId))) {
          throw error;
        }
        if (isAutoplayBlockedError(error)) {
          console.info('[playAudio] Browser autoplay blocked, staying paused ready-to-play');
          if (playMusic.value) {
            playMusic.value.playLoading = false;
          }
          setIsPlay(false);
          userPlayIntent.value = false;
          lastPlaybackOutcome.value = 'autoplay-blocked';
          return null;
        }
        console.error('播放音频失败:', error);

        const errorMsg = error instanceof Error ? error.message : String(error);

        // 操作锁错误不应该停止播放状态，只需要重试
        if (errorMsg.includes('操作锁激活')) {
          console.log('由于操作锁正在使用，将在1000ms后重试');

          try {
            audioService.forceResetOperationLock();
            console.log('已强制重置操作锁');
          } catch (e) {
            console.error('重置操作锁失败:', e);
          }

          setTimeout(() => {
            // 验证请求是否仍然有效再重试
            if (requestId && !playbackRequestManager.isRequestValid(requestId)) {
              console.log('重试时请求已失效，跳过重试');
              return;
            }
            if (userPlayIntent.value && play.value) {
              playAudio(requestId).catch((e) => {
                console.error('重试播放失败:', e);
                setPlayMusic(false);
              });
            }
          }, 1000);
        } else {
          // 非操作锁错误：不要清掉 userPlayIntent，交由调用方（如 _nextPlay）自动重试或跳过到下一首
          console.warn('播放音频失败（非操作锁错误），交由调用方自动重试或切换下一首');
        }

        return null;
      }
    };

    /**
     * 暂停播放
     */
    const handlePause = async () => {
      try {
        isBuffering.value = false;
        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }
        setPlayMusic(false);
        userPlayIntent.value = false;
      } catch (error) {
        console.error('暂停播放失败:', error);
      }
    };

    /**
     * 设置播放/暂停
     */
    const setPlayMusic = async (value: boolean | SongResult) => {
      if (typeof value === 'boolean') {
        setIsPlay(value);
        userPlayIntent.value = value;
      } else {
        await handlePlayMusic(value);
        play.value = true;
        isPlay.value = true;
        userPlayIntent.value = true;
      }
    };

    /**
     * 使用指定音源重新解析当前歌曲
     */
    const reparseCurrentSong = async (sourcePlatform: Platform, isAuto: boolean = false) => {
      try {
        const currentSong = playMusic.value;
        if (!currentSong || !currentSong.id) {
          console.warn('没有有效的播放对象');
          return false;
        }

        // 使用 SongSourceConfigManager 保存配置
        SongSourceConfigManager.setConfig(
          currentSong.id,
          [sourcePlatform],
          isAuto ? 'auto' : 'manual'
        );

        const currentSound = audioService.getCurrentSound();
        if (currentSound) {
          currentSound.pause();
        }

        const numericId =
          typeof currentSong.id === 'string' ? parseInt(currentSong.id, 10) : currentSong.id;

        console.log(`使用音源 ${sourcePlatform} 重新解析歌曲 ${numericId}`);

        const songData = cloneDeep(currentSong);
        const res = await getParsingMusicUrl(numericId, songData);

        if (res && res.data && res.data.data && res.data.data.url) {
          const parsedData = res.data.data;
          const newUrl = parsedData.url;
          console.log(`解析成功，获取新URL: ${newUrl.substring(0, 50)}...`);

          const updatedMusic = {
            ...currentSong,
            playMusicUrl: newUrl,
            expiredAt: Date.now() + 1800000,
            playbackMeta: buildPlaybackMeta({
              url: newUrl,
              br: parsedData.br,
              type: parsedData.type,
              encodeType: parsedData.encodeType,
              level: parsedData.level,
              quality: parsedData.quality,
              strategy: parsedData._strategy || sourcePlatform,
              rawSource: parsedData.source || parsedData.platform || sourcePlatform,
              platform: parsedData.platform || sourcePlatform
            })
          };

          await handlePlayMusic(updatedMusic, true);

          // 更新播放列表中的歌曲信息
          const { usePlaylistStore } = await import('./playlist');
          const playlistStore = usePlaylistStore();
          playlistStore.updateSong(updatedMusic);

          return true;
        } else {
          console.warn(`使用音源 ${sourcePlatform} 解析失败`);
          return false;
        }
      } catch (error) {
        console.error('重新解析失败:', error);
        return false;
      }
    };

    const normalizeSeedSong = (raw: any): SongResult | null => {
      if (!raw || !raw.id) return null;
      const ar = raw.ar || raw.artists || raw.song?.artists || [];
      const al = raw.al || raw.album || raw.song?.album || {};
      const picUrl = raw.picUrl || al?.picUrl || '';
      const dt = Number(raw.dt || raw.duration || raw.song?.duration || 0);
      return {
        ...raw,
        id: raw.id,
        name: raw.name || '未知歌曲',
        picUrl,
        ar,
        al: { ...al, picUrl: al?.picUrl || picUrl },
        dt,
        source: 'netease',
        song: raw.song || {
          ...raw,
          artists: ar,
          album: { ...al, picUrl: al?.picUrl || picUrl },
          duration: dt
        },
        playLoading: false,
        isFirstPlay: true
      } as SongResult;
    };

    /**
     * 新用户首次打开无历史记录时，自动拉取每日推荐 / 私人 FM / 推荐新歌首曲填充黑胶盘面
     * - 满足自动播放策略时自动开播；否则填好封面、歌名、队列与歌词停在待播态（绝不出现空白黑胶）
     */
    const seedInitialLaunchTrack = async (shouldAutoPlay: boolean): Promise<boolean> => {
      if (playMusic.value && playMusic.value.id) return true;
      if (isOfflineNow()) return false;
      if (seedLaunchPromise) return seedLaunchPromise;

      seedLaunchPromise = (async () => {
        isSeedingLaunchTrack.value = true;
        try {
          const [{ useRecommendStore }, { getPersonalFM, getRecommendMusic }, { usePlaylistStore }, { useSettingsStore }] =
            await Promise.all([
              import('./recommend'),
              import('@/api/home'),
              import('./playlist'),
              import('./settings')
            ]);

          const recommendStore = useRecommendStore();
          const playlistStore = usePlaylistStore();
          const settingsStore = useSettingsStore();

          let rawList: any[] = [];

          // 1. 优先每日推荐
          try {
            await recommendStore.refreshIfStale();
            if (Array.isArray(recommendStore.dailyRecommendSongs) && recommendStore.dailyRecommendSongs.length > 0) {
              rawList = recommendStore.dailyRecommendSongs;
            }
          } catch {
            // fallback below
          }

          // 2. 次选私人 FM
          if (rawList.length === 0) {
            try {
              const fmRes: any = await getPersonalFM();
              const fmData = fmRes?.data?.data;
              if (Array.isArray(fmData) && fmData.length > 0) {
                rawList = fmData;
              }
            } catch {
              // fallback below
            }
          }

          // 3. 游客/未登录兜底：推荐新歌（免登录即可稳定返回）
          if (rawList.length === 0) {
            try {
              const recRes: any = await getRecommendMusic({ limit: 15 });
              const recList = recRes?.data?.result || recRes?.result || [];
              if (Array.isArray(recList) && recList.length > 0) {
                rawList = recList;
              }
            } catch {
              // ignore
            }
          }

          const normalized = rawList
            .map(normalizeSeedSong)
            .filter((item): item is SongResult => Boolean(item));

          if (normalized.length === 0) {
            return false;
          }

          // 如果拉取期间用户已经手动点了某首歌，切勿覆盖用户选择
          if (playMusic.value && playMusic.value.id) {
            return true;
          }

          playlistStore.setPlayList(normalized, false, false);
          const seeded = resolveSeededFirstSong(
            playlistStore.playList,
            playlistStore.playListIndex,
            normalized
          );
          if (seeded.mutated) {
            playlistStore.playList = seeded.playList;
          }
          playlistStore.playListIndex = seeded.playListIndex;
          const firstSong = seeded.firstSong;

          if (shouldAutoPlay) {
            await handlePlayMusic({ ...firstSong, isFirstPlay: true }, true);
          } else {
            const currentQuality = settingsStore.setData?.musicQuality || 'higher';
            play.value = false;
            isPlay.value = false;
            userPlayIntent.value = false;
            playMusic.value = {
              ...firstSong,
              isFirstPlay: true,
              playLoading: false,
              playbackMeta: inferPlaybackMetaFromUrl(undefined, {
                fallbackQuality: currentQuality
              })
            };

            // 预填时间轴与歌词，待用户点击一键开播
            void (async () => {
              try {
                const [{ loadLrc }, { nowTime, allTime }] = await Promise.all([
                  Promise.resolve(useLyrics()),
                  import('@/hooks/MusicHook')
                ]);
                const durSec = Number(firstSong.dt || firstSong.duration || 0) / 1000;
                if (durSec > 0) allTime.value = durSec;
                nowTime.value = 0;
                const lyric = await loadLrc(firstSong.id);
                if (String(playMusic.value?.id) === String(firstSong.id)) {
                  playMusic.value = { ...playMusic.value, lyric };
                }
              } catch {
                // ignore
              }
            })();
          }

          return true;
        } catch (error) {
          if (!isAutoplayBlockedError(error)) {
            console.warn('[seedInitialLaunchTrack] 拉取首次推荐曲目失败:', error);
          }
          return false;
        } finally {
          isSeedingLaunchTrack.value = false;
          seedLaunchPromise = null;
        }
      })();

      return seedLaunchPromise;
    };

    /**
     * 初始化播放状态
     */
    const initializePlayState = async () => {
      // 优先检查 Android / iOS 原生后台服务是否已有正在运行/挂起的音轨！
      // 例如：系统回收了后台 Activity 后用户点击通知栏/悬浮窗重新进入 App，
      // 必须直接无缝附着到原生正在播放的歌曲，绝不能用本地缓存覆盖播放导致暂停或跳回旧歌！
      if (isAndroid()) {
        try {
          const rawActive = window.AlgerAndroid?.audioGetActiveTrack?.();
          if (rawActive) {
            const active = JSON.parse(rawActive);
            if (active?.hasActiveTrack && active?.songId) {
              console.log('[initializePlayState] 检测到原生服务已有活跃曲目，直接无缝接管:', active.title);
              const { applyNativeTrackSync } = await import('@/hooks/MusicHook');
              applyNativeTrackSync(active, false);
              return;
            }
          }
        } catch (e) {
          console.warn('[initializePlayState] 查询原生活跃曲目失败，回退本地恢复:', e);
        }
      }

      const { useSettingsStore } = await import('./settings');
      const settingStore = useSettingsStore();

      const launchAutoPlayMode = getEffectiveLaunchAutoPlayMode(settingStore.setData, isAndroid());
      const externalAudioConnected =
        launchAutoPlayMode === 'external-audio' ? isExternalAudioOutputConnected() : false;
      const shouldAutoPlay = shouldAutoPlayOnLaunch({
        mode: launchAutoPlayMode,
        isExternalAudioConnected: externalAudioConnected
      });

      if (playMusic.value && Object.keys(playMusic.value).length > 0 && playMusic.value.id) {
        const isLocalMusic = Boolean(playMusic.value.playMusicUrl?.startsWith('local://'));

        if (shouldAutoPlay) {
          try {
            console.log(
              `[initializePlayState] 满足启动自动播放策略 (${launchAutoPlayMode})，续播:`,
              playMusic.value.name
            );
            await handlePlayMusic(
              {
                ...playMusic.value,
                isFirstPlay: true,
                playMusicUrl: isLocalMusic ? playMusic.value.playMusicUrl : undefined
              },
              true
            );
          } catch (error) {
            if (!isAutoplayBlockedError(error)) {
              console.error('重新获取音乐链接失败:', error);
            }
            play.value = false;
            isPlay.value = false;
            userPlayIntent.value = false;
          }
        } else {
          // 继续聆听：冷启动恢复上次退出时的歌曲、播放进度、队列与音质（停在待播态）
          console.log('[initializePlayState] 冷启动待命恢复上次曲目:', playMusic.value.name);
          play.value = false;
          isPlay.value = false;
          userPlayIntent.value = false;

          let savedProgressSec = 0;
          let savedDurationSec = Number(playMusic.value.dt || playMusic.value.duration || 0) / 1000;
          let restoredQuality = settingStore.setData?.musicQuality || 'higher';
          try {
            const rawSnap = localStorage.getItem('playProgress');
            if (rawSnap) {
              const parsed = JSON.parse(rawSnap);
              if (
                String(parsed?.songId) === String(playMusic.value.id) &&
                typeof parsed?.progress === 'number' &&
                parsed.progress > 0
              ) {
                savedProgressSec = parsed.progress;
                if (typeof parsed?.duration === 'number' && parsed.duration > 0) {
                  savedDurationSec = parsed.duration;
                }
                if (typeof parsed?.quality === 'string' && parsed.quality) {
                  restoredQuality = parsed.quality;
                }
              }
            }
          } catch {
            // ignore corrupted storage
          }

          playMusic.value = {
            ...playMusic.value,
            isFirstPlay: true,
            playLoading: false,
            playMusicUrl: isLocalMusic ? playMusic.value.playMusicUrl : undefined,
            expiredAt: isLocalMusic ? playMusic.value.expiredAt : undefined,
            playbackMeta: inferPlaybackMetaFromUrl(
              isLocalMusic ? playMusic.value.playMusicUrl : undefined,
              {
                isDownloaded: Boolean(playMusic.value.isDownloadedTrack),
                fallbackQuality: restoredQuality,
                existing: playMusic.value.playbackMeta
              }
            )
          };
          if (!isLocalMusic) {
            playMusicUrl.value = '';
          }

          // 立即将上次进度写入界面时间轴（保持暂停状态，点击播放时精准续播）
          try {
            const { nowTime, allTime } = await import('@/hooks/MusicHook');
            if (savedDurationSec > 0) {
              allTime.value = savedDurationSec;
            }
            if (savedProgressSec > 0 && (savedDurationSec <= 0 || savedProgressSec < savedDurationSec - 2)) {
              nowTime.value = savedProgressSec;
            }
          } catch {
            // ignore
          }
        }
      } else {
        // 新用户首次打开无历史记录：自动拉取每日推荐 / 私人 FM / 推荐新歌首曲填充黑胶并按策略开播
        await seedInitialLaunchTrack(shouldAutoPlay);
      }

      setTimeout(() => {
        audioService.setPlaybackRate(playbackRate.value);
      }, 2000);
    };

    // ==================== 音频输出设备管理 ====================

    /**
     * 刷新可用音频输出设备列表
     */
    const refreshAudioDevices = async () => {
      availableAudioDevices.value = await audioService.getAudioOutputDevices();
    };

    /**
     * 切换音频输出设备
     */
    const setAudioOutputDevice = async (deviceId: string): Promise<boolean> => {
      const success = await audioService.setAudioOutputDevice(deviceId);
      if (success) {
        audioOutputDeviceId.value = deviceId;
      }
      return success;
    };

    /**
     * 初始化设备变化监听
     */
    const initAudioDeviceListener = () => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
          await refreshAudioDevices();
          const exists = availableAudioDevices.value.some(
            (d) => d.deviceId === audioOutputDeviceId.value
          );
          if (!exists && audioOutputDeviceId.value !== 'default') {
            await setAudioOutputDevice('default');
          }
        });
      }
    };

    return {
      // 状态
      play,
      isPlay,
      playMusic,
      playMusicUrl,
      musicFull,
      playbackRate,
      volume,
      userPlayIntent,
      isFmPlaying,
      isSeedingLaunchTrack,
      isBuffering,
      lastPlaybackError,
      lastFailureCode,
      lastPlaybackOutcome,
      audioOutputDeviceId,
      availableAudioDevices,

      // Computed
      currentSong,
      isPlaying,

      // Actions
      setIsPlay,
      setBuffering,
      setMusicFull,
      setPlayMusic,
      setPlaybackRate,
      setVolume,
      getVolume,
      increaseVolume,
      decreaseVolume,
      handlePlayMusic,
      handlePlayMusicWithOutcome,
      playAudio,
      handlePause,
      checkPlaybackState,
      cancelPlaybackCheck,
      reparseCurrentSong,
      seedInitialLaunchTrack,
      initializePlayState,
      refreshAudioDevices,
      setAudioOutputDevice,
      initAudioDeviceListener
    };
  },
  {
    persist: {
      key: 'player-core-store',
      storage: localStorage,
      pick: ['playMusic', 'playMusicUrl', 'playbackRate', 'volume', 'isPlay', 'audioOutputDeviceId']
    }
  }
);
