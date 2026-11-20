<template>
  <!-- Android 端：内置本地直连代理 + 自定义 API 服务器 + 后台保活 -->
  <setting-section v-if="isAndroid" title="接口与手机服务">
    <setting-item
      title="音乐接口模式"
      description="默认使用手机内置本地代理直连网易云（无需额外服务器），也可随时切换为自建 NeteaseCloudMusicApi 地址"
    >
      <template #action>
        <n-radio-group v-model:value="androidCfg.mode" @update:value="handleSaveAndroidConfig">
          <n-radio value="local">内置本地代理</n-radio>
          <n-radio value="custom">自定义 API</n-radio>
        </n-radio-group>
      </template>
    </setting-item>

    <setting-item
      title="内置本地服务状态"
      :description="localStatusDesc"
    >
      <template #action>
        <div class="flex items-center gap-2">
          <n-tag :type="localStatus.running ? 'success' : 'error'" size="small" round>
            {{ localStatus.running ? '运行中' : '未启动' }}
          </n-tag>
          <s-btn :loading="testingApi" @click="testCurrentApi">测试连接</s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      v-if="androidCfg.mode === 'custom'"
      title="自定义网易云 API 地址"
      description="填写自建或第三方 NeteaseCloudMusicApi 根地址，例如 https://your-api.example.com"
    >
      <template #action>
        <div class="flex items-center gap-2 w-full max-md:flex-col">
          <s-input
            v-model="androidCfg.customApiUrl"
            placeholder="https://your-ncm-api.example.com"
            width="w-[260px] max-md:w-full"
          />
          <s-btn variant="primary" @click="handleSaveAndroidConfig">保存</s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      title="自定义音源解析接口（可选）"
      description="留空则使用手机内置多平台解锁引擎（酷我 / 酷狗 / 咪咕 / GD音乐台 / 洛雪脚本）"
    >
      <template #action>
        <div class="flex items-center gap-2 w-full max-md:flex-col">
          <s-input
            v-model="androidCfg.customMusicApiUrl"
            placeholder="留空使用内置解析引擎"
            width="w-[260px] max-md:w-full"
          />
          <s-btn @click="handleSaveAndroidConfig">保存</s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      title="后台播放保活"
      description="将本应用加入系统电池优化白名单，防止熄屏后系统限制后台切歌与播放"
    >
      <template #action>
        <div class="flex items-center gap-2">
          <n-tag :type="ignoringBattery ? 'success' : 'warning'" size="small" round>
            {{ ignoringBattery ? '已允许后台运行' : '建议开启' }}
          </n-tag>
          <s-btn @click="requestBatteryWhitelist">去设置</s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      title="本地音乐与下载管理"
      description="扫描手机存储中的本地歌曲，或查看/播放已下载的离线音乐"
    >
      <template #action>
        <div class="flex items-center gap-2">
          <s-btn @click="router.push('/local-music')">本地音乐</s-btn>
          <s-btn @click="router.push('/downloads')">下载管理</s-btn>
        </div>
      </template>
    </setting-item>
  </setting-section>

  <!-- Electron 桌面端原有网络设置 -->
  <setting-section v-if="isElectron" :title="t('settings.sections.network')">
    <setting-item
      :title="t('settings.network.apiPort')"
      :description="t('settings.network.apiPortDesc')"
    >
      <s-input
        v-model="setData.musicApiPort"
        type="number"
        :min="1024"
        :max="65535"
        :step="1"
        width="w-[140px] max-md:w-32"
      />
    </setting-item>

    <setting-item
      :title="t('settings.network.proxy')"
      :description="t('settings.network.proxyDesc')"
    >
      <template #action>
        <div class="flex items-center gap-2">
          <n-switch v-model:value="setData.proxyConfig.enable">
            <template #checked>{{ t('common.on') }}</template>
            <template #unchecked>{{ t('common.off') }}</template>
          </n-switch>
          <s-btn @click="showProxyModal = true">{{ t('common.configure') }}</s-btn>
        </div>
      </template>
    </setting-item>

    <setting-item
      :title="t('settings.network.realIP')"
      :description="t('settings.network.realIPDesc')"
    >
      <template #action>
        <div class="flex items-center gap-2 max-md:flex-wrap">
          <n-switch v-model:value="setData.enableRealIP">
            <template #checked>{{ t('common.on') }}</template>
            <template #unchecked>{{ t('common.off') }}</template>
          </n-switch>
          <s-input
            v-if="setData.enableRealIP"
            v-model="setData.realIP"
            placeholder="realIP"
            width="w-[200px] max-md:w-full"
            @blur="validateAndSaveRealIP"
          />
        </div>
      </template>
    </setting-item>

    <proxy-settings
      v-model:show="showProxyModal"
      :config="proxyForm"
      @confirm="handleProxyConfirm"
    />
  </setting-section>
</template>

<script setup lang="ts">
import axios from 'axios';
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ProxySettings from '@/components/settings/ProxySettings.vue';
import { isAndroid, isElectron } from '@/utils';
import {
  type AndroidServerConfig,
  getAndroidApiBaseUrl,
  getAndroidServerConfig,
  saveAndroidServerConfig
} from '@/utils/androidBridge';

import { SETTINGS_DATA_KEY, SETTINGS_MESSAGE_KEY } from '../keys';
import SBtn from '../SBtn.vue';
import SettingItem from '../SettingItem.vue';
import SettingSection from '../SettingSection.vue';
import SInput from '../SInput.vue';

const { t } = useI18n();
const router = useRouter();
const setData = inject(SETTINGS_DATA_KEY)!;
const message = inject(SETTINGS_MESSAGE_KEY)!;

// ==================== Android 配置状态 ====================
const androidCfg = ref<AndroidServerConfig>(getAndroidServerConfig(true));
const localStatus = ref<{ running: boolean; port: number; hasAnonToken: boolean }>({
  running: true,
  port: androidCfg.value.localPort || 30488,
  hasAnonToken: false
});
const testingApi = ref(false);
const ignoringBattery = ref(false);

const localStatusDesc = computed(() => {
  const activeUrl = getAndroidApiBaseUrl();
  const modeLabel = androidCfg.value.mode === 'custom' ? '当前使用自定义 API' : '当前使用内置本地代理';
  return `${modeLabel}: ${activeUrl}`;
});

const refreshAndroidStatus = () => {
  if (!isAndroid) return;
  try {
    androidCfg.value = getAndroidServerConfig(true);
    const raw = (window as any).AlgerAndroid?.getLocalServerStatus?.();
    if (raw) {
      localStatus.value = JSON.parse(raw);
    }
    ignoringBattery.value = Boolean((window as any).AlgerAndroid?.isIgnoringBatteryOptimizations?.());
  } catch (e) {
    console.error('读取 Android 服务状态失败:', e);
  }
};

const handleSaveAndroidConfig = () => {
  if (!isAndroid) return;
  const saved = saveAndroidServerConfig({
    mode: androidCfg.value.mode,
    customApiUrl: androidCfg.value.customApiUrl?.trim() || '',
    customMusicApiUrl: androidCfg.value.customMusicApiUrl?.trim() || ''
  });
  androidCfg.value = saved;
  message.success('接口配置已保存并立即生效');
};

const testCurrentApi = async () => {
  testingApi.value = true;
  try {
    const base = getAndroidApiBaseUrl();
    const res = await axios.get(`${base}/search/default`, { timeout: 8000 });
    if (res.status === 200) {
      message.success(`连接成功 (${base})`);
    } else {
      message.warning(`响应异常: HTTP ${res.status}`);
    }
  } catch (e: any) {
    message.error(`连接失败: ${e?.message || '网络不可达'}`);
  } finally {
    testingApi.value = false;
    refreshAndroidStatus();
  }
};

const requestBatteryWhitelist = () => {
  (window as any).AlgerAndroid?.requestIgnoreBatteryOptimizations?.();
  setTimeout(refreshAndroidStatus, 1500);
};

onMounted(() => {
  refreshAndroidStatus();
});

// ==================== Electron 原有逻辑 ====================
const showProxyModal = ref(false);
const proxyForm = ref({ protocol: 'http', host: '127.0.0.1', port: 7890 });

watch(
  () => setData.value.proxyConfig,
  (newVal) => {
    if (newVal) {
      proxyForm.value = {
        protocol: newVal.protocol || 'http',
        host: newVal.host || '127.0.0.1',
        port: newVal.port || 7890
      };
    }
  },
  { immediate: true, deep: true }
);

const handleProxyConfirm = async (proxyConfig: any) => {
  setData.value = {
    ...setData.value,
    proxyConfig: { enable: setData.value.proxyConfig?.enable || false, ...proxyConfig }
  };
  message.success(t('settings.network.messages.proxySuccess'));
};

const validateAndSaveRealIP = () => {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!setData.value.realIP || ipRegex.test(setData.value.realIP)) {
    setData.value = { ...setData.value, realIP: setData.value.realIP, enableRealIP: true };
    if (setData.value.realIP) {
      message.success(t('settings.network.messages.realIPSuccess'));
    }
  } else {
    message.error(t('settings.network.messages.realIPError'));
    setData.value = { ...setData.value, realIP: '' };
  }
};

watch(
  () => setData.value.enableRealIP,
  (newVal) => {
    if (!newVal) {
      setData.value = { ...setData.value, realIP: '', enableRealIP: false };
    }
  }
);
</script>
