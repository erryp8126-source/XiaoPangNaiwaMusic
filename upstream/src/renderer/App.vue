<template>
  <div class="app-container h-full w-full" :class="{ mobile: isMobile, noElectron: !isElectron }">
    <n-config-provider
      :theme="theme === 'dark' ? darkTheme : lightTheme"
      :theme-overrides="naiveThemeOverrides"
    >
      <n-dialog-provider>
        <n-message-provider>
          <router-view></router-view>
          <traffic-warning-drawer v-if="!isNative"></traffic-warning-drawer>
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

import TrafficWarningDrawer from '@/components/TrafficWarningDrawer.vue';
import { usePlayerStore } from '@/store/modules/player';
import { usePlayerCoreStore } from '@/store/modules/playerCore';
import { useSettingsStore } from '@/store/modules/settings';
import { useUserStore } from '@/store/modules/user';
import { isAndroid, isElectron, isLyricWindow, isNative } from '@/utils';
import { checkLoginStatus } from '@/utils/auth';

import { initAudioListeners, initMusicHook } from './hooks/MusicHook';
import { audioService } from './services/audioService';
import { initLxMusicRunner } from './services/LxMusicSourceRunner';
import { isMobile } from './utils';
import { useAppShortcuts } from './utils/appShortcuts';

const { locale } = useI18n();
const settingsStore = useSettingsStore();
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

  // 注册 Android 系统返回键处理
  window.__algerHandleBack = (): boolean => {
    if (playerStore.musicFull) {
      playerStore.setMusicFull(false);
      return true;
    }
    if (playerStore.playListDrawerVisible) {
      playerStore.setPlayListDrawerVisible(false);
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
  playerStore.setIsPlay(false);
  if (isLyricWindow.value) {
    return;
  }

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
