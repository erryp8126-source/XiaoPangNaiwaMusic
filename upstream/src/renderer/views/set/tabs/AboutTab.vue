<template>
  <div>
    <!-- 小庞奶娃音乐 品牌展示卡片（浅色/深色双模高对比度自适应） -->
    <div
      class="mb-5 p-5 rounded-[22px] relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-amber-50 dark:from-[#1B2638] dark:via-[#192231] dark:to-[#221F26] border border-slate-200/90 dark:border-slate-700/80 shadow-[0_2px_12px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      <div class="relative z-10 flex items-center gap-4">
        <img
          :src="mascotIcon"
          alt="小庞奶娃音乐"
          class="w-16 h-16 rounded-[18px] object-cover shadow-md ring-2 ring-amber-400/50"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-lg font-extrabold text-slate-900 dark:text-white">小庞奶娃音乐</h2>
            <span
              class="px-2.5 py-0.5 rounded-full text-[11px] font-bold text-white shadow-sm"
              style="background: linear-gradient(135deg, #D97706 0%, #EA580C 100%)"
            >
              v{{ updateInfo.currentVersion }} 奶娃暖阳版
            </span>
          </div>
          <p class="text-[13px] text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
            基于 AlgerMusicPlayer 深度定制的 Android / iOS / PWA 跨平台音乐播放器 · 晴空暖阳治愈视觉
          </p>
        </div>
      </div>
    </div>

    <setting-section :title="t('settings.sections.about')">
    <setting-item :title="t('settings.about.version')">
      <template #description>
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ updateInfo.currentVersion }}</span>
          <n-tag v-if="updateInfo.hasUpdate" type="success">
            {{ t('settings.about.hasUpdate') }} {{ updateInfo.latestVersion }}
          </n-tag>
        </div>
        <div v-if="hasManualUpdateFallback" class="mt-2 text-xs text-amber-600">
          <i class="ri-information-line mr-1"></i>
          {{ appUpdateState.errorMessage || t('settings.about.messages.checkError') }}
        </div>
      </template>
      <template #action>
        <div class="flex items-center gap-2 flex-wrap">
          <s-btn :loading="checking" @click="checkForUpdates(true)">
            {{ checking ? t('settings.about.checking') : t('settings.about.checkUpdate') }}
          </s-btn>
          <s-btn v-if="updateInfo.hasUpdate" variant="primary" @click="openReleasePage">
            {{ t('settings.about.gotoUpdate') }}
          </s-btn>
          <s-btn v-if="hasManualUpdateFallback" variant="ghost" @click="openManualUpdatePage">
            {{ t('settings.about.manualUpdate') }}
          </s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      title="作者"
      description="perry · 小庞奶娃音乐作者与维护者"
      clickable
      @click="openAuthor"
    >
      <s-btn @click.stop="openAuthor">
        <i class="ri-github-line mr-1"></i>前往 GitHub
      </s-btn>
    </setting-item>

    <setting-item
      title="原始作者"
      description="algerkong · AlgerMusicPlayer 原项目作者（MIT 开源协议）"
      clickable
      @click="openOriginalAuthor"
    >
      <s-btn @click.stop="openOriginalAuthor">
        <i class="ri-github-line mr-1"></i>原项目仓库
      </s-btn>
    </setting-item>

    <setting-item
      v-if="isRealAndroid"
      title="最近崩溃日志"
      :description="
        hasCrashLog
          ? '已记录最近 1 次异常闪退日志（已自动脱敏，不含 Cookie 与同步密钥）'
          : '暂无崩溃记录（偶发闪退重启后可在此一键复制定位问题）'
      "
    >
      <div class="flex items-center gap-2 flex-wrap">
        <s-btn @click="handleOpenCrashLog">
          <i class="ri-bug-line mr-1"></i>{{ hasCrashLog ? '查看日志' : '查看/复制最近崩溃日志' }}
        </s-btn>
        <s-btn v-if="hasCrashLog" variant="primary" @click="handleCopyCrashLog">
          <i class="ri-file-copy-line mr-1"></i>一键复制
        </s-btn>
      </div>
    </setting-item>
  </setting-section>

  <n-modal
    v-if="isRealAndroid"
    v-model:show="showCrashLogModal"
    preset="card"
    :z-index="12000"
    style="width: 94vw; max-width: 680px"
    title="最近崩溃日志"
  >
    <div class="space-y-3">
      <div class="text-xs text-slate-500 dark:text-slate-400">
        日志已自动屏蔽 Cookie、Token 与同步口令等敏感信息（上限 16 KB）。
      </div>
      <pre
        class="max-h-[55vh] overflow-auto p-3 rounded-xl bg-slate-900 text-slate-100 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all select-text"
      >{{ lastCrashLog }}</pre>
      <div class="flex items-center justify-end gap-2 pt-1">
        <s-btn @click="handleClearCrashLog">清空日志</s-btn>
        <s-btn variant="primary" @click="handleCopyCrashLog">
          <i class="ri-file-copy-line mr-1"></i>一键复制日志
        </s-btn>
      </div>
    </div>
  </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import mascotIcon from '@/assets/icon.png';

import { useSettingsStore } from '@/store/modules/settings';
import { isElectron, isRealAndroid } from '@/utils';
import { clearNativeLastCrashLog, getNativeLastCrashLog } from '@/utils/androidBridge';
import { checkUpdate, UpdateResult } from '@/utils/update';

import config from '../../../../../package.json';
import { APP_UPDATE_STATUS, hasAvailableAppUpdate } from '../../../../shared/appUpdate';
import { SETTINGS_MESSAGE_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';

const { t } = useI18n();
const settingsStore = useSettingsStore();
const message = inject(SETTINGS_MESSAGE_KEY)!;

const checking = ref(false);
const webUpdateInfo = ref<UpdateResult>({
  hasUpdate: false,
  latestVersion: '',
  currentVersion: config.version,
  releaseInfo: null
});

const appUpdateState = computed(() => settingsStore.appUpdateState);
const hasAppUpdate = computed(() => hasAvailableAppUpdate(appUpdateState.value));
const hasManualUpdateFallback = computed(
  () => isElectron && appUpdateState.value.status === APP_UPDATE_STATUS.error
);

const updateInfo = computed<UpdateResult>(() => {
  if (!isElectron) {
    return webUpdateInfo.value;
  }

  return {
    hasUpdate: hasAppUpdate.value,
    latestVersion: appUpdateState.value.availableVersion ?? '',
    currentVersion: appUpdateState.value.currentVersion || config.version,
    releaseInfo: appUpdateState.value.availableVersion
      ? {
          tag_name: appUpdateState.value.availableVersion,
          body: appUpdateState.value.releaseNotes,
          html_url: appUpdateState.value.releasePageUrl,
          assets: []
        }
      : null
  };
});

const checkForUpdates = async (isClick = false) => {
  checking.value = true;
  try {
    if (isElectron) {
      const result = await window.api.checkAppUpdate(isClick);
      settingsStore.setAppUpdateState(result);

      if (hasAvailableAppUpdate(result)) {
        if (isClick) {
          settingsStore.setShowUpdateModal(true);
        }
      } else if (result.status === APP_UPDATE_STATUS.notAvailable && isClick) {
        message.success(t('settings.about.latest'));
      } else if (result.status === APP_UPDATE_STATUS.error && isClick) {
        message.error(result.errorMessage || t('settings.about.messages.checkError'));
      }

      return;
    }

    const result = await checkUpdate(config.version);
    if (result) {
      webUpdateInfo.value = result;
      if (!result.hasUpdate && isClick) {
        message.success(t('settings.about.latest'));
      }
    } else if (isClick) {
      message.success(t('settings.about.latest'));
    }
  } catch (error) {
    console.error('检查更新失败:', error);
    if (isClick) {
      message.error(t('settings.about.messages.checkError'));
    }
  } finally {
    checking.value = false;
  }
};

const AUTHOR_GITHUB_URL = 'https://github.com/erryp8126-source/XiaoPangNaiwaMusic';
const ORIGINAL_AUTHOR_GITHUB_URL = 'https://github.com/algerkong/AlgerMusicPlayer';

const openExternal = (url: string) => {
  if ((window as any).AlgerAndroid?.openExternalUrl) {
    (window as any).AlgerAndroid.openExternalUrl(url);
  } else {
    window.open(url, '_blank');
  }
};

const openReleasePage = () => {
  if (isElectron) {
    settingsStore.setShowUpdateModal(true);
    return;
  }

  openExternal(updateInfo.value.releaseInfo?.html_url || AUTHOR_GITHUB_URL);
};

const openManualUpdatePage = async () => {
  if (isElectron) {
    await window.api.openAppUpdatePage();
    return;
  }

  openExternal(updateInfo.value.releaseInfo?.html_url || AUTHOR_GITHUB_URL);
};

const openAuthor = () => {
  openExternal(AUTHOR_GITHUB_URL);
};

const openOriginalAuthor = () => {
  openExternal(ORIGINAL_AUTHOR_GITHUB_URL);
};

const lastCrashLog = ref('');
const showCrashLogModal = ref(false);
const hasCrashLog = computed(() => lastCrashLog.value.trim().length > 0);

const refreshCrashLog = () => {
  if (!isRealAndroid) return;
  lastCrashLog.value = getNativeLastCrashLog();
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below for WebView contexts without Clipboard API permission
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

const handleOpenCrashLog = () => {
  refreshCrashLog();
  if (!hasCrashLog.value) {
    message.info('暂无崩溃记录');
    return;
  }
  showCrashLogModal.value = true;
};

const handleCopyCrashLog = async () => {
  refreshCrashLog();
  if (!hasCrashLog.value) {
    message.info('暂无崩溃记录');
    return;
  }
  const copied = await copyTextToClipboard(lastCrashLog.value);
  if (copied) {
    message.success('已复制最近崩溃日志到剪贴板');
  } else {
    showCrashLogModal.value = true;
    message.warning('自动复制受限，请在弹窗内长按全选复制');
  }
};

const handleClearCrashLog = () => {
  if (!isRealAndroid) return;
  const ok = clearNativeLastCrashLog();
  refreshCrashLog();
  if (ok) {
    showCrashLogModal.value = false;
    message.success('已清空崩溃日志');
  } else {
    message.error('清空崩溃日志失败');
  }
};

onMounted(() => {
  refreshCrashLog();
});

defineExpose({ checkForUpdates });
</script>
