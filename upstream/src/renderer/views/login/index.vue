<template>
  <div class="login-page">
    <div class="phone-login" :class="setAnimationClass('animate__fadeInDown')">
      <div class="bg"></div>
      <div class="content">
        <!-- 奶娃品牌头徽 -->
        <div class="login-brand">
          <img :src="mascotIcon" alt="小庞奶娃音乐" class="login-brand-icon" />
          <div class="login-brand-name">小庞奶娃音乐</div>
        </div>

        <!-- Tab导航 -->
        <div class="login-tabs" :class="setAnimationClass('animate__fadeInUp')">
          <div
            v-for="tab in loginTabs"
            :key="tab.key"
            class="tab-item"
            :class="{ active: activeMode === tab.key }"
            @click="switchToMode(tab.key)"
          >
            {{ tab.label }}
          </div>
        </div>

        <!-- 登录内容区域 -->
        <div class="login-content">
          <!-- 过渡动画包装器 -->
          <transition
            name="login-content"
            mode="out-in"
            enter-active-class="animate__animated animate__fadeIn"
            leave-active-class="animate__animated animate__fadeOut"
          >
            <!-- 二维码登录组件 -->
            <div v-if="activeMode === LoginMode.QR && !isTransitioning" key="qr" class="phone">
              <qr-login @login-success="handleLoginSuccess" @login-error="handleLoginError" />
            </div>

            <!-- 手机号登录 -->
            <div
              v-else-if="activeMode === LoginMode.PHONE && !isTransitioning"
              key="phone"
              class="phone"
            >
              <div class="login-title">{{ t('login.title.phone') }}</div>
              <div class="phone-page">
                <input
                  v-model="phone"
                  class="phone-input"
                  type="text"
                  :placeholder="t('login.placeholder.phone')"
                />
                <input
                  v-model="password"
                  class="phone-input"
                  type="password"
                  :placeholder="t('login.placeholder.password')"
                />
              </div>
              <div class="text">{{ t('login.phoneTip') }}</div>
              <n-button class="btn-login" @click="loginPhone()">{{
                t('login.button.login')
              }}</n-button>
            </div>

            <!-- UID登录组件 -->
            <div
              v-else-if="activeMode === LoginMode.UID && !isTransitioning"
              key="uid"
              class="phone"
            >
              <uid-login @login-success="handleLoginSuccess" @login-error="handleLoginError" />
            </div>

            <!-- Cookie登录组件 -->
            <div
              v-else-if="activeMode === LoginMode.COOKIE && !isTransitioning"
              key="token"
              class="phone"
            >
              <cookie-login @login-success="handleLoginSuccess" @login-error="handleLoginError" />
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { loginByCellphone } from '@/api/login';
import mascotIcon from '@/assets/icon.png';
import CookieLogin from '@/components/login/CookieLogin.vue';
import QrLogin from '@/components/login/QrLogin.vue';
import UidLogin from '@/components/login/UidLogin.vue';
import { useUserStore } from '@/store/modules/user';
import { setAnimationClass } from '@/utils';

defineOptions({
  name: 'Login'
});

// 登录模式枚举
enum LoginMode {
  QR = 'qr',
  PHONE = 'phone',
  UID = 'uid',
  COOKIE = 'cookie'
}

const { t } = useI18n();
const message = useMessage();
const router = useRouter();
const userStore = useUserStore();

// 当前激活的登录模式
const activeMode = ref<LoginMode>(LoginMode.QR);
// 用于控制内容切换动画
const isTransitioning = ref(false);

// 登录选项配置
const loginTabs = computed(() => [
  { key: LoginMode.QR, label: t('login.title.qr') },
  { key: LoginMode.COOKIE, label: t('login.title.cookie') },
  { key: LoginMode.UID, label: t('login.title.uid') }
]);

// 手机号登录
const phone = ref('');
const password = ref('');
const loginPhone = async () => {
  try {
    if (!phone.value.trim()) {
      message.error(t('login.message.phoneRequired'));
      return;
    }
    if (!password.value.trim()) {
      message.error(t('login.message.passwordRequired'));
      return;
    }

    const { data } = await loginByCellphone(phone.value, password.value);
    if (data.code === 200) {
      message.success(t('login.message.loginSuccess'));
      userStore.setUser(data.profile);
      localStorage.setItem('token', data.cookie);
      setTimeout(() => {
        router.push('/user');
      }, 1000);
    } else {
      message.error(t('login.message.phoneLoginFailed'));
    }
  } catch (error) {
    message.error(t('login.message.phoneLoginFailed'));
    console.error(t('login.message.loginFailed') + ':', error);
  }
};

// 切换登录模式（带动画效果）
const switchToMode = (mode: LoginMode) => {
  if (mode === activeMode.value) return;

  isTransitioning.value = true;
  setTimeout(() => {
    activeMode.value = mode;
    setTimeout(() => {
      isTransitioning.value = false;
    }, 50);
  }, 150);
};

// 通用登录成功处理
const handleLoginSuccess = (userProfile: any, loginType: string) => {
  // 更新 userStore（这会同时更新 store 状态和 localStorage 中的用户数据）
  userStore.setUser(userProfile);

  // 设置登录类型到 userStore 和 localStorage
  userStore.setLoginType(loginType as any);

  // 设置其他相关状态
  const token = loginType !== 'uid' ? localStorage.getItem('token') : undefined;

  if (token) {
    localStorage.setItem('token', token);
  }

  if (loginType === 'uid') {
    localStorage.setItem('uidLogin', 'true');
  }

  setTimeout(() => {
    router.push('/user');
  }, 1000);
};

// 通用登录错误处理
const handleLoginError = (error: string) => {
  console.error(t('login.message.loginFailed') + ':', error);
};
</script>

<style lang="scss" scoped>
.login-page {
  @apply flex flex-col items-center justify-center w-full py-4 pb-32;
  background: transparent;
}

.login-brand {
  @apply flex items-center gap-2.5 mb-5;

  .login-brand-icon {
    @apply w-11 h-11 rounded-2xl object-cover shadow-lg;
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.2),
      0 0 0 2px rgba(255, 224, 128, 0.7);
  }

  .login-brand-name {
    @apply text-lg font-extrabold text-white tracking-wide drop-shadow-sm;
  }
}

.login-title {
  @apply text-xl font-bold mb-5 text-white;
}

.text {
  @apply mt-4 text-white/85 text-xs;
}

.phone-login {
  width: 350px;
  min-height: 530px;
  @apply rounded-[28px] relative overflow-hidden;
  background: linear-gradient(150deg, #1b3a5c 0%, #246a96 46%, #d98200 100%);
  box-shadow:
    0 20px 48px rgba(36, 106, 150, 0.28),
    inset 0 1px 1px rgba(255, 255, 255, 0.35);
  animation-duration: 0.6s;

  .bg {
    @apply absolute inset-0 pointer-events-none;
    background-image:
      radial-gradient(circle at 18% 12%, rgba(167, 232, 255, 0.36) 0%, transparent 45%),
      radial-gradient(circle at 86% 82%, rgba(255, 214, 92, 0.45) 0%, transparent 50%);
  }

  .content {
    @apply relative w-full h-full px-5 py-6 flex flex-col items-center justify-center text-center;

    .login-tabs {
      @apply flex mb-5 rounded-2xl p-1;
      width: 100%;
      max-width: 310px;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      animation-duration: 0.5s;

      .tab-item {
        @apply flex-1 py-2 px-2.5 text-xs md:text-sm text-white/85 text-center cursor-pointer rounded-xl transition-all duration-200 font-semibold;

        &.active {
          background: linear-gradient(135deg, #ffd147 0%, #eb8f00 100%);
          @apply text-white font-bold;
          box-shadow: 0 4px 12px rgba(232, 146, 0, 0.35);
        }
      }
    }

    .login-content {
      @apply flex-1 flex items-center justify-center w-full;
      min-height: 290px;
    }

    .phone {
      animation-duration: 0.45s;
      width: 100%;
      max-width: 290px;

      &-page {
        @apply bg-white/95 dark:bg-slate-800/95;
        width: 260px;
        @apply rounded-2xl overflow-hidden shadow-md;
        margin: 0 auto;
      }

      &-input {
        height: 44px;
        @apply w-full px-4 outline-none;
        @apply text-slate-900 dark:text-white bg-transparent;
        @apply border-b border-slate-200 dark:border-slate-700;
        @apply placeholder-slate-400;
        transition: all 0.2s ease;

        &:focus {
          @apply border-amber-500;
        }
      }
    }

    .btn-login {
      width: 260px;
      height: 42px;
      @apply mt-8 text-white font-bold rounded-full border-none transition-all duration-200;
      background: linear-gradient(135deg, #ffd147 0%, #eb8f00 100%);
      box-shadow: 0 8px 20px rgba(232, 146, 0, 0.35);

      &:active {
        transform: scale(0.96);
      }
    }
  }
}

/* 登录内容切换动画 */
.login-content-enter-active,
.login-content-leave-active {
  animation-duration: 0.25s;
}

.login-content-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.login-content-leave-to {
  opacity: 0;
  transform: translateY(-14px);
}

.mobile {
  .login-page {
    @apply pt-2;
  }

  .phone-login {
    width: 90vw;
    max-width: 360px;
    min-height: 500px;
  }
}
</style>
