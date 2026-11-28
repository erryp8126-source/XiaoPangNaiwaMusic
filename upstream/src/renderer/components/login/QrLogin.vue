<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { checkQr, createQr, getQrKey, getUserDetail } from '@/api/login';
import { setAnimationClass } from '@/utils';
import { persistNeteaseAuthToken } from '@/utils/auth';
import { launchExternalAppScheme, saveQrImageToGallery } from '@/utils/qrActions';

defineOptions({
  name: 'QrLogin'
});

// Emits
interface Emits {
  (e: 'loginSuccess', userProfile: any, loginType: string): void;
  (e: 'loginError', error: string): void;
}

const emit = defineEmits<Emits>();

const { t } = useI18n();
const message = useMessage();

const qrUrl = ref<string>();
const timerRef = ref(null);
const qrStatus = ref<'loading' | 'active' | 'expired' | 'scanned' | 'confirmed'>('loading');
const isRefreshing = ref(false);

const loadLogin = async () => {
  try {
    isRefreshing.value = true;
    qrStatus.value = 'loading';

    // 清理之前的定时器
    if (timerRef.value) {
      clearInterval(timerRef.value);
      timerRef.value = null;
    }

    const qrKey = await getQrKey();
    const key = qrKey.data.data.unikey;
    const { data } = await createQr(key);
    qrUrl.value = data.data.qrimg;
    qrStatus.value = 'active';

    const timer = timerIsQr(key);
    timerRef.value = timer as any;
  } catch (error) {
    console.error(t('login.message.loadError'), error);
    qrStatus.value = 'expired';
    const errorMsg = t('login.message.loadError');
    message.error(errorMsg);
    emit('loginError', errorMsg);
  } finally {
    isRefreshing.value = false;
  }
};

const timerIsQr = (key: string) => {
  const timer = setInterval(async () => {
    try {
      const { data } = await checkQr(key);

      // 二维码过期或不存在
      if (data.code === 800) {
        qrStatus.value = 'expired';
        clearInterval(timer);
        timerRef.value = null;
        message.warning(t('login.message.qrExpiredWarning'));
        return;
      }

      // 等待扫码
      if (data.code === 801) {
        qrStatus.value = 'active';
        return;
      }

      // 已扫码，等待确认
      if (data.code === 802) {
        qrStatus.value = 'scanned';
        message.info(t('login.message.qrScannedInfo'));
        return;
      }

      // 登录成功
      if (data.code === 803) {
        qrStatus.value = 'confirmed';
        persistNeteaseAuthToken(data.cookie);
        const user = await getUserDetail();
        const successMsg = t('login.message.loginSuccess');
        message.success(successMsg);
        emit('loginSuccess', user.data.profile, 'qr');

        clearInterval(timer);
        timerRef.value = null;
      }
    } catch (error) {
      console.error(t('login.message.qrCheckError'), error);
      qrStatus.value = 'expired';
      clearInterval(timer);
      timerRef.value = null;
      const errorMsg = t('login.message.qrCheckFailed');
      message.error(errorMsg);
      emit('loginError', errorMsg);
    }
  }, 3000);

  return timer;
};

// 手动刷新二维码
const refreshQr = () => {
  loadLogin();
};

const savingQr = ref(false);

const handleSaveQr = async () => {
  if (!qrUrl.value || savingQr.value) return;
  savingQr.value = true;
  try {
    const res = await saveQrImageToGallery('xiaopang-netease-qr', qrUrl.value);
    if (res.ok) message.success(res.message);
    else message.warning(res.message);
  } finally {
    savingQr.value = false;
  }
};

const handleOpenNeteaseApp = () => {
  launchExternalAppScheme('orpheus://');
  message.info('正在唤起网易云音乐，也可先点击上方保存二维码到相册扫码');
};

// 获取状态显示文本
const getStatusText = () => {
  switch (qrStatus.value) {
    case 'loading':
      return t('login.message.qrLoading');
    case 'active':
      return t('login.qrTip');
    case 'expired':
      return t('login.message.qrExpired');
    case 'scanned':
      return t('login.message.qrScanned');
    case 'confirmed':
      return t('login.message.qrConfirmed');
    default:
      return t('login.qrTip');
  }
};

onMounted(() => {
  loadLogin();
});

onUnmounted(() => {
  if (timerRef.value) {
    clearInterval(timerRef.value);
    timerRef.value = null;
  }
});
</script>

<template>
  <div class="qr-login" :class="setAnimationClass('animate__fadeInUp')">
    <div class="login-title">{{ t('login.title.qr') }}</div>

    <!-- 二维码容器 -->
    <div class="qr-container">
      <!-- 加载状态 -->
      <div v-if="qrStatus === 'loading'" class="qr-loading">
        <n-spin size="large" />
        <div class="loading-text">{{ t('login.message.qrGenerating') }}</div>
      </div>

      <!-- 二维码图片 -->
      <div v-else class="qr-image-wrapper" :class="{ expired: qrStatus === 'expired' }">
        <img class="qr-img" :src="qrUrl" />

        <!-- 过期遮罩 -->
        <div v-if="qrStatus === 'expired'" class="expired-overlay">
          <div class="expired-text">{{ t('login.message.qrExpiredShort') }}</div>
          <n-button class="refresh-btn" type="primary" @click="refreshQr" :loading="isRefreshing">
            {{ isRefreshing ? t('login.button.refreshing') : t('login.button.refresh') }}
          </n-button>
        </div>

        <!-- 已扫码遮罩 -->
        <div v-if="qrStatus === 'scanned'" class="scanned-overlay">
          <div class="scanned-icon">✓</div>
          <div class="scanned-text">{{ t('login.message.qrScannedShort') }}</div>
        </div>
      </div>
    </div>

    <!-- 状态文本 -->
    <div class="text" :class="{ expired: qrStatus === 'expired', scanned: qrStatus === 'scanned' }">
      {{ getStatusText() }}
    </div>

    <!-- 单机便捷操作：保存二维码到相册 + 一键打开网易云音乐 -->
    <div v-if="qrStatus === 'active' || qrStatus === 'scanned'" class="qr-helper-actions">
      <button
        type="button"
        class="qr-helper-pill"
        :disabled="savingQr || !qrUrl"
        @click="handleSaveQr"
      >
        <i class="ri-download-2-line"></i>
        <span>{{ savingQr ? '保存中...' : '保存二维码到相册' }}</span>
      </button>
      <button
        type="button"
        class="qr-helper-pill accent"
        @click="handleOpenNeteaseApp"
      >
        <i class="ri-external-link-line"></i>
        <span>打开网易云音乐</span>
      </button>
    </div>

    <!-- 手动刷新按钮 -->
    <div v-if="qrStatus === 'active'" class="refresh-area">
      <n-button text class="manual-refresh" @click="refreshQr" :loading="isRefreshing">
        {{ t('login.button.refreshQr') }}
      </n-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.qr-login {
  animation-duration: 0.5s;
}

.login-title {
  @apply text-2xl font-bold mb-6 text-white;
}

.qr-container {
  @apply relative;
  width: 200px;
  height: 200px;
  @apply mx-auto;
}

.qr-loading {
  @apply flex flex-col items-center justify-center h-full;

  .loading-text {
    @apply mt-4 text-white text-sm;
  }
}

.qr-image-wrapper {
  @apply relative w-full h-full;

  &.expired {
    .qr-img {
      @apply opacity-30;
    }
  }
}

.qr-img {
  @apply w-full h-full rounded-2xl transition-all duration-300;
  object-fit: cover;
}

.expired-overlay {
  @apply absolute inset-0 flex flex-col items-center justify-center;
  @apply bg-black bg-opacity-50 rounded-2xl;

  .expired-text {
    @apply text-white text-sm mb-3;
  }

  .refresh-btn {
    @apply text-sm;
  }
}

.scanned-overlay {
  @apply absolute inset-0 flex flex-col items-center justify-center rounded-2xl;
  background: rgba(232, 146, 0, 0.88);

  .scanned-icon {
    @apply text-white text-4xl font-bold mb-2;
  }

  .scanned-text {
    @apply text-white text-sm;
  }
}

.text {
  @apply mt-4 text-white text-xs transition-colors duration-300;

  &.expired {
    @apply text-orange-200;
  }

  &.scanned {
    @apply text-amber-200;
  }
}

.refresh-area {
  @apply mt-2.5;

  .manual-refresh {
    @apply text-gray-300 hover:text-white text-xs;
  }
}

.qr-helper-actions {
  @apply mt-3 flex items-center justify-center gap-2 flex-wrap px-2;
}

.qr-helper-pill {
  @apply inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold text-white/95 transition-all active:scale-95;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);

  &.accent {
    background: linear-gradient(135deg, rgba(255, 209, 71, 0.32) 0%, rgba(235, 143, 0, 0.42) 100%);
    border-color: rgba(255, 214, 102, 0.55);
  }
}
</style>
