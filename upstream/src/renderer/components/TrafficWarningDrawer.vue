<template>
  <n-drawer
    v-model:show="showDrawer"
    :width="isMobile ? '100%' : '800px'"
    :height="isMobile ? '100%' : '100%'"
    :placement="isMobile ? 'bottom' : 'right'"
    @after-leave="handleDrawerClose"
    :z-index="999999999"
    :mask-closable="false"
  >
    <n-drawer-content
      title="欢迎使用小庞奶娃音乐"
      closable
      :native-scrollbar="false"
      class="mac-style-drawer"
    >
      <div class="drawer-container">
        <div class="warning-content">
          <div class="warning-message">
            <h3>获取完整体验</h3>
            <p class="platform-support">
              <span> <i class="ri-android-line mr-1"></i>Android </span>
              <span> <i class="ri-apple-line mr-1"></i>iOS </span>
              <span> <i class="ri-global-line mr-1"></i>Safari PWA </span>
            </p>
            <p class="description">
              可在 GitHub Releases 获取最新 Android APK / iOS IPA 安装包，或直接使用 Safari PWA。
            </p>
          </div>

          <div class="action-links">
            <a
              href="https://github.com/erryp8126-source/XiaoPangNaiwaMusic"
              target="_blank"
              class="doc-link"
            >
              <i class="ri-github-line mr-1"></i> 项目主页
            </a>
            <a
              href="https://github.com/erryp8126-source/XiaoPangNaiwaMusic/releases/latest"
              target="_blank"
              class="download-link"
            >
              <i class="ri-download-2-line mr-1"></i> 前往下载
            </a>
          </div>

          <div class="qrcode-section">
            <img class="qrcode" src="@/assets/gzh.png" alt="公众号" />
            <p>关注公众号获取最新版本与更新信息</p>
          </div>

          <div class="support-section">
            <h4>支持项目</h4>
            <p class="support-desc">您的支持是我们持续改进的动力</p>
            <div class="payment-options">
              <div class="payment-option">
                <div class="payment-icon wechat">
                  <img src="@/assets/wechat.png" alt="微信支付" />
                </div>
                <span>微信支付</span>
              </div>
              <div class="payment-option">
                <div class="payment-icon alipay">
                  <img src="@/assets/alipay.png" alt="支付宝" />
                </div>
                <span>支付宝</span>
              </div>
            </div>
          </div>

          <div class="drawer-actions">
            <n-button secondary class="action-button" @click="markAsDonated">已支持</n-button>
            <n-button type="primary" class="action-button primary" @click="remindLater"
              >稍后提醒</n-button
            >
          </div>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { isMobile } from '@/utils';

// 控制抽屉显示状态
const showDrawer = ref(false);

// 处理抽屉关闭后的操作
const handleDrawerClose = () => {
  // 抽屉关闭后的逻辑
};

// 一天后提醒
const remindLater = () => {
  const now = new Date();
  localStorage.setItem('trafficDonated4RemindLater', now.toISOString());
  showDrawer.value = false;
};

// 标记为已捐赠（永久不再提示）
const markAsDonated = () => {
  localStorage.setItem('trafficDonated4Never', '1');
  showDrawer.value = false;
};
// 已禁用上游自动推广弹窗，仅保留兼容组件导出
onMounted(() => {
  showDrawer.value = false;
});
</script>

<style scoped lang="scss">
.traffic-warning-trigger {
  display: inline-block;

  .mac-style-button {
    background-color: rgba(0, 0, 0, 0.05);
    color: #333;
    transition: all 0.2s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.1);
    }
  }
}

.mac-style-drawer {
  border-radius: 10px 0 0 10px;
  overflow: hidden;
  position: relative;
}

.drawer-container {
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.warning-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.app-icon {
  width: 100px;
  height: 100px;
  margin-bottom: 12px;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 14px;
  }
}

.warning-message {
  text-align: center;
  max-width: 520px;

  h3 {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 18px;
    color: #333;
  }

  .platform-support {
    display: flex;
    justify-content: center;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 16px;

    span {
      display: flex;
      align-items: center;
      font-size: 16px;
      color: #444;
    }
  }

  .description {
    font-size: 16px;
    line-height: 1.6;
    color: #444;
    margin: 0 auto;
  }
}

.action-links {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
  margin: 6px 0;

  a {
    display: inline-flex;
    align-items: center;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 16px;
    text-decoration: none;
    transition: all 0.2s ease;

    &.doc-link {
      color: #555;
      background-color: rgba(0, 0, 0, 0.05);

      &:hover {
        background-color: rgba(0, 0, 0, 0.1);
      }
    }

    &.download-link {
      color: #fff;
      background-color: #007aff;

      &:hover {
        background-color: #0062cc;
      }
    }
  }
}

.qrcode-section {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;

  .qrcode {
    width: 180px;
    height: 180px;
    border-radius: 10px;
    padding: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    background: white;
  }

  p {
    margin-top: 14px;
    font-size: 15px;
    color: #0062cc;
  }
}

.support-section {
  width: 100%;
  text-align: center;

  h4 {
    font-size: 22px;
    font-weight: 600;
    color: #333;
    margin-bottom: 8px;
  }

  .support-desc {
    font-size: 15px;
    color: #555;
    margin-bottom: 20px;
  }
}

.payment-options {
  display: flex;
  justify-content: center;
  gap: 100px;
  flex-wrap: wrap;
  padding-bottom: 100px;
}

.payment-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  .payment-icon {
    width: 220px;
    height: 220px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  span {
    font-size: 15px;
    color: #444;
  }
}

.drawer-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 30px;
  width: 100%;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px;
  background-color: #fff;
  z-index: 999999999;

  .action-button {
    min-width: 110px;
    border-radius: 8px;
    font-size: 16px;
    padding: 8px 16px;

    &.primary {
      background-color: #007aff;
      color: white;

      &:hover {
        background-color: #0062cc;
      }
    }
  }
}

@media (max-width: 768px) {
  .warning-message {
    h3 {
      font-size: 20px;
    }

    .platform-support {
      gap: 12px;
    }

    .description {
      font-size: 13px;
    }
  }

  .app-icon {
    width: 64px;
    height: 64px;
  }

  .qrcode-section {
    .qrcode {
      width: 140px;
      height: 140px;
    }
  }

  .payment-option {
    .payment-icon {
      width: 190px;
      height: 190px;
    }
  }

  .drawer-actions {
    flex-wrap: wrap;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px;
    background-color: #fff;
    z-index: 999999999;

    .action-button {
      flex: 1 0 auto;
    }
  }
}
</style>
