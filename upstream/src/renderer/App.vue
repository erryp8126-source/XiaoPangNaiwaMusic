<template>
  <div class="app-container h-full w-full" :class="{ mobile: isMobile, noElectron: !isElectron }">
    <n-config-provider
      :theme="theme === 'dark' ? darkTheme : lightTheme"
      :theme-overrides="naiveThemeOverrides"
    >
      <n-dialog-provider>
        <n-message-provider>
          <router-view></router-view>
          <disclaimer-modal />
        </n-message-provider>
      </n-dialog-provider>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from 'lodash';
import { darkTheme, type GlobalThemeOverrides, lightTheme } from 'naive-ui';
import { computed, nextTick, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DisclaimerModal from '@/components/common/DisclaimerModal.vue';
import { useCloudSyncStore } from '@/store/modules/cloudSync';
import { useListeningStatsStore } from '@/store/modules/listeningStats';
import { usePlayerStore } from '@/store/modules/player';
import { usePlayerCoreStore } from '@/store/modules/playerCore';
import { useSettingsStore } from '@/store/modules/settings';
import { useUserStore } from '@/store/modules/user';
import { isAndroid, isElectron, isLyricWindow, isNative } from '@/utils';
import { dispatchAndroidBackHandlers, onAndroidEvent } from '@/utils/androidBridge';
import { checkLoginStatus } from '@/utils/auth';

import { initAudioListeners, initMusicHook } from './hooks/MusicHook';
import { audioService } from './services/audioService';
import { initLxMusicRunner } from './services/LxMusicSourceRunner';
import { isMobile } from './utils';
import { useAppShortcuts } from './utils/appShortcuts';

const { locale } = useI18n();
const settingsStore = useSettingsStore();
const listeningStatsStore = useListeningStatsStore();
const cloudSyncStore = useCloudSyncStore();
const playerStore = usePlayerStore();
const playerCoreStore = usePlayerCoreStore();
const userStore = useUserStore();
const router = useRouter();

// 监听语言变化
watch(
  () => settingsStore.setData.language,
  (newLanguage) => {
    if (newLanguage && newLanguage !== locale.value) {
      locale.value = newLanguage;
    }
  },
  { immediate: true }
);

const theme = computed(() => {
  return settingsStore.theme;
});

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#E89200',
    primaryColorHover: '#F5A623',
    primaryColorPressed: '#CC7B00',
    primaryColorSuppl: '#FFB81C',
    infoColor: '#0EA5E9',
    infoColorHover: '#38BDF8',
    successColor: '#E89200',
    borderRadius: '14px',
    borderRadiusSmall: '10px',
    bodyColor: '#F6FAFD',
    cardColor: 'rgba(255, 255, 255, 0.92)',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',
    textColorBase: '#1E293B',
    textColor1: '#1E293B',
    textColor2: '#475569',
    textColor3: '#94A3B8'
  },
  Button: {
    borderRadiusMedium: '12px',
    borderRadiusSmall: '10px',
    fontWeight: '600'
  },
  Input: {
    borderRadius: '12px',
    color: '#F8FAFC',
    colorFocus: '#FFFFFF',
    border: '1px solid #CBD5E1',
    textColor: '#0F172A'
  },
  Switch: {
    railColor: '#CBD5E1',
    railColorActive: '#D97706',
    buttonColor: '#FFFFFF',
    boxShadowFocus: '0 0 0 2px rgba(217, 119, 6, 0.25)'
  },
  Radio: {
    textColor: '#0F172A',
    dotColorActive: '#D97706',
    boxShadowActive: 'inset 0 0 0 1px #D97706'
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '12px',
        color: '#F8FAFC',
        border: '1px solid #CBD5E1',
        textColor: '#0F172A'
      }
    }
  },
  Tabs: {
    tabBorderRadius: '12px',
    colorSegment: '#EAF3FA',
    tabColorSegment: '#FFFFFF',
    tabTextColorActiveSegment: '#E89200',
    tabTextColorActiveLine: '#E89200',
    barColor: '#E89200'
  },
  Slider: {
    fillColor: '#F59E0B',
    fillColorHover: '#E89200',
    dotBorderActive: '2px solid #F59E0B'
  },
  Tag: {
    borderRadius: '9999px'
  },
  Drawer: {
    color: '#F6FAFD'
  }
};

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#FFC533',
    primaryColorHover: '#FFD35C',
    primaryColorPressed: '#E89E00',
    primaryColorSuppl: '#FFB800',
    infoColor: '#38BDF8',
    successColor: '#FFC533',
    borderRadius: '14px',
    borderRadiusSmall: '10px',
    bodyColor: '#0F141C',
    cardColor: '#171E2A',
    modalColor: '#171E2A',
    popoverColor: '#1B2433',
    textColorBase: '#F1F5F9',
    textColor1: '#F8FAFC',
    textColor2: '#CBD5E1',
    textColor3: '#64748B'
  },
  Button: {
    borderRadiusMedium: '12px',
    borderRadiusSmall: '10px',
    fontWeight: '600',
    textColorPrimary: '#1E1404',
    textColorHoverPrimary: '#1E1404',
    textColorPressedPrimary: '#1E1404',
    textColorFocusPrimary: '#1E1404'
  },
  Input: {
    borderRadius: '12px',
    color: '#1E293B',
    colorFocus: '#243146',
    border: '1px solid #475569',
    textColor: '#F8FAFC'
  },
  Switch: {
    railColor: '#475569',
    railColorActive: '#F59E0B',
    buttonColor: '#FFFFFF',
    boxShadowFocus: '0 0 0 2px rgba(255, 197, 51, 0.25)'
  },
  Radio: {
    textColor: '#F1F5F9',
    dotColorActive: '#FFC533',
    boxShadowActive: 'inset 0 0 0 1px #FFC533'
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '12px',
        color: '#1E293B',
        border: '1px solid #475569',
        textColor: '#F8FAFC'
      }
    }
  },
  Tabs: {
    tabBorderRadius: '12px',
    colorSegment: '#1A2332',
    tabColorSegment: '#263246',
    tabTextColorActiveSegment: '#FFC533',
    tabTextColorActiveLine: '#FFC533',
    barColor: '#FFC533'
  },
  Slider: {
    fillColor: '#FFC533',
    fillColorHover: '#FFD35C',
    dotBorderActive: '2px solid #FFC533'
  },
  Tag: {
    borderRadius: '9999px'
  },
  Drawer: {
    color: '#131A24'
  }
};

const naiveThemeOverrides = computed(() =>
  theme.value === 'dark' ? darkThemeOverrides : lightThemeOverrides
);

// 同步 Android 系统状态栏与导航栏图标颜色
if (isAndroid) {
  watch(
    () => [settingsStore.theme, playerStore.musicFull],
    ([currentTheme, isFull]) => {
      try {
        (window as any).AlgerAndroid?.setStatusBarStyle?.(currentTheme === 'dark' || Boolean(isFull));
      } catch {
        // ignore
      }
    },
    { immediate: true }
  );

  // 注册 Android 系统侧滑返回键逐层关闭栈：
  // EQ 抽屉(100) -> 播放设置抽屉(100) -> 播放列表抽屉 -> 歌词页回封面(60) -> 收起全屏播放器 -> 路由返回 -> 退后台
  window.__algerHandleBack = (): boolean => {
    if (dispatchAndroidBackHandlers()) {
      return true;
    }
    if (playerStore.playListDrawerVisible) {
      playerStore.setPlayListDrawerVisible(false);
      return true;
    }
    if (playerStore.musicFull) {
      playerStore.setMusicFull(false);
      return true;
    }
    if (router.currentRoute.value.path !== '/') {
      router.back();
      return true;
    }
    return false;
  };
}

// 监听字体变化并应用
watch(
  () => [settingsStore.setData.fontFamily, settingsStore.setData.fontScope],
  ([newFont, fontScope]) => {
    const appElement = document.body;
    if (newFont && fontScope === 'global') {
      appElement.style.fontFamily = newFont;
    } else {
      appElement.style.fontFamily = '';
    }
  }
);

const handleSetLanguage = (value: string) => {
  console.log('应用语言变更:', value);
  if (value) {
    locale.value = value;
  }
};

if (!isLyricWindow.value) {
  settingsStore.initializeSettings();
  settingsStore.initializeTheme();
  settingsStore.initializeSystemFonts();

  // 初始化登录状态 - 从 localStorage 恢复用户信息和登录类型
  const loginInfo = checkLoginStatus();
  if (loginInfo.isLoggedIn) {
    if (loginInfo.user && !userStore.user) {
      userStore.setUser(loginInfo.user);
    }
    if (loginInfo.loginType && !userStore.loginType) {
      userStore.setLoginType(loginInfo.loginType);
    }
  }
}

handleSetLanguage(settingsStore.setData.language);

// 监听迷你模式状态
if (isElectron) {
  window.api.onLanguageChanged(handleSetLanguage);
  window.electron.ipcRenderer.on('mini-mode', (_, value) => {
    settingsStore.setMiniMode(value);
    if (value) {
      // 存储当前路由
      localStorage.setItem('currentRoute', router.currentRoute.value.path);
      router.push('/mini');
    } else {
      // 恢复当前路由
      const currentRoute = localStorage.getItem('currentRoute');
      if (currentRoute) {
        router.push(currentRoute);
        localStorage.removeItem('currentRoute');
      } else {
        router.push('/');
      }
    }
  });
}

// 使用应用内快捷键
useAppShortcuts();

onMounted(async () => {
  // 若 Android/iOS 原生服务已在后台播放（如从通知栏/悬浮窗重进 App），切勿先置 false 引起闪烁或状态误判
  let hasLiveNativeTrack = false;
  if (isAndroid) {
    try {
      const raw = (window as any).AlgerAndroid?.audioGetActiveTrack?.();
      if (raw) {
        const active = JSON.parse(raw);
        hasLiveNativeTrack = Boolean(active?.hasActiveTrack && active?.playing);
      }
    } catch {
      // ignore
    }
  }
  if (!hasLiveNativeTrack) {
    playerStore.setIsPlay(false);
  }
  if (isLyricWindow.value) {
    return;
  }
  listeningStatsStore.initWebFallbackTracking();
  cloudSyncStore.runAutoSyncOnLaunch();

  // 检查网络状态，离线时自动跳转到本地音乐页面
  if (!navigator.onLine) {
    console.log('检测到无网络连接，跳转到本地音乐页面');
    router.push('/local-music');
  }

  // 监听网络状态变化，断网时跳转到本地音乐页面
  window.addEventListener('offline', () => {
    console.log('网络连接断开，跳转到本地音乐页面');
    router.push('/local-music');
  });

  // 初始化 MusicHook，注入 playerStore
  initMusicHook(playerStore);
  // 初始化播放状态
  await playerStore.initializePlayState();

  // 初始化音频设备变化监听器
  playerCoreStore.initAudioDeviceListener();

  // 初始化落雪音源（如果有激活的音源）
  const activeLxApiId = settingsStore.setData?.activeLxMusicApiId;
  if (activeLxApiId) {
    const lxMusicScripts = settingsStore.setData?.lxMusicScripts || [];
    const activeScript = lxMusicScripts.find((script: any) => script.id === activeLxApiId);
    if (activeScript && activeScript.script) {
      try {
        console.log('[App] 初始化激活的落雪音源:', activeScript.name);
        await initLxMusicRunner(activeScript.script);
      } catch (error) {
        console.error('[App] 初始化落雪音源失败:', error);
      }
    }
  }

  // 如果有正在播放的音乐，则初始化音频监听器
  if (playerStore.playMusic && playerStore.playMusic.id) {
    // 使用 nextTick 确保 DOM 更新后再初始化
    await nextTick();
    initAudioListeners();
    if (isElectron) {
      window.api.sendSong(cloneDeep(playerStore.playMusic));
    }
  }

  audioService.releaseOperationLock();

  // 桌面小组件一键直达（每日推荐 / 私人FM / 我喜欢 / 搜索）与冷启动自动续播
  if (isAndroid) {
    const openDailyRecommendFromWidget = async () => {
      try {
        const [{ useRecommendStore }, { navigateToMusicList }] = await Promise.all([
          import('@/store/modules/recommend'),
          import('@/components/common/MusicListNavigator')
        ]);
        const recommendStore = useRecommendStore();
        await recommendStore.refreshIfStale();
        if (recommendStore.dailyRecommendSongs.length > 0) {
          navigateToMusicList(router, {
            type: 'dailyRecommend',
            name: '每日推荐',
            songList: recommendStore.dailyRecommendSongs,
            canRemove: false
          });
        } else {
          await router.push('/').catch(() => {});
        }
      } catch (err) {
        console.warn('[App] widget daily recommend failed:', err);
        await router.push('/').catch(() => {});
      }
    };

    const startPersonalFmFromWidget = async () => {
      try {
        const [{ getPersonalFM, getRecommendMusic }, { usePlaylistStore }] = await Promise.all([
          import('@/api/home'),
          import('@/store/modules/playlist')
        ]);
        const playlistStore = usePlaylistStore();
        let fmSongs: any[] = [];
        try {
          const res = await getPersonalFM();
          if (Array.isArray(res.data?.data) && res.data.data.length > 0) {
            fmSongs = res.data.data;
          }
        } catch {
          // fallback below
        }

        if (fmSongs.length === 0) {
          const recRes: any = await getRecommendMusic({ limit: 15 }).catch(() => null);
          const recList = recRes?.data?.result || recRes?.result || [];
          fmSongs = recList.map((item: any) => ({
            id: item.id,
            name: item.name,
            picUrl: item.picUrl || item.song?.album?.picUrl,
            ar: item.song?.artists || [],
            al: item.song?.album || {},
            dt: item.song?.duration || 0,
            song: item.song
          }));
        }

        if (fmSongs.length > 0) {
          const first = fmSongs[0];
          const normalized = {
            id: first.id,
            name: first.name,
            picUrl: first.al?.picUrl || first.album?.picUrl || first.picUrl || '',
            ar: first.artists || first.ar || [],
            al: first.al || first.album || {},
            source: 'netease' as const,
            song: first,
            ...first,
            playLoading: false
          };
          playlistStore.setPlayList([normalized], false, false);
          playerCoreStore.isFmPlaying = true;
          await playerCoreStore.handlePlayMusic(normalized, true);
          playerStore.setMusicFull(true);
        } else {
          await router.push('/').catch(() => {});
        }
      } catch (err) {
        console.warn('[App] widget personal FM failed:', err);
        await router.push('/').catch(() => {});
      }
    };

    const navigateFromWidget = (route: string) => {
      if (!route || typeof route !== 'string') return;
      if (playerStore.playListDrawerVisible) {
        playerStore.setPlayListDrawerVisible(false);
      }
      if (playerStore.musicFull) {
        playerStore.setMusicFull(false);
      }
      if (route === 'action:daily-recommend') {
        void openDailyRecommendFromWidget();
        return;
      }
      if (route === 'action:personal-fm') {
        void startPersonalFmFromWidget();
        return;
      }
      if (router.currentRoute.value.path !== route) {
        router.push(route).catch(() => {});
      }
    };

    const autoplayFromWidget = async () => {
      try {
        if (!playerStore.isPlay && playerStore.playMusic?.id) {
          await playerStore.setPlay({ ...playerStore.playMusic });
        }
      } catch (err) {
        console.warn('[App] widget autoplay failed:', err);
      }
    };

    onAndroidEvent('widget-navigate', (_evt: any, route: any) => {
      if (typeof route === 'string') {
        navigateFromWidget(route);
      }
    });
    onAndroidEvent('widget-autoplay', () => {
      void autoplayFromWidget();
    });

    try {
      const rawPending = (window as any).AlgerAndroid?.consumePendingWidgetAction?.();
      if (rawPending) {
        const pending = JSON.parse(rawPending);
        if (pending?.route) {
          navigateFromWidget(pending.route);
        }
        if (pending?.autoplay) {
          void autoplayFromWidget();
        }
      }
    } catch {
      // ignore
    }
  }
});
</script>

<style lang="scss" scoped>
.app-container {
  user-select: none;
}

.mobile {
  .text-base {
    font-size: 14px !important;
  }
}

.html:has(.mobile) {
  font-size: 14px;
}
</style>
