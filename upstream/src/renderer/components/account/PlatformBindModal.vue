<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-[999985] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div
        class="w-full max-w-[440px] max-h-[88vh] overflow-y-auto rounded-3xl bg-white dark:bg-[#131316] border border-slate-200/80 dark:border-white/[0.08] shadow-2xl p-5 text-slate-900 dark:text-[#FAFAFA]"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-2.5">
            <div
              class="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-sm flex-shrink-0"
              :class="
                platform === 'bilibili'
                  ? 'bg-pink-500'
                  : 'bg-emerald-500'
              "
            >
              <i
                :class="platform === 'bilibili' ? 'ri-bilibili-line text-lg' : 'ri-qq-line text-lg'"
              ></i>
            </div>
            <div>
              <h3 class="text-base font-bold leading-snug">
                {{ platform === 'bilibili' ? '绑定 B 站（Bilibili）账号' : '绑定 QQ 音乐账号' }}
              </h3>
              <p class="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                独立扩展授权，不影响网易云主账号与本地歌单
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            class="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-white/[0.08] transition-colors flex-shrink-0"
            @click="handleClose"
          >
            <i class="ri-close-line text-lg"></i>
          </button>
        </div>

        <!-- QR Container -->
        <div
          class="rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/70 dark:border-white/[0.06] p-4 flex flex-col items-center"
        >
          <div class="relative w-44 h-44 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-sm">
            <img
              v-if="qrImgUrl"
              :src="qrImgUrl"
              :alt="platform === 'bilibili' ? 'B 站扫码登录二维码' : 'QQ 音乐扫码登录二维码'"
              class="w-full h-full object-contain rounded-lg select-none"
            />
            <div
              v-else-if="loadingQr"
              class="flex flex-col items-center justify-center gap-2 text-slate-400"
            >
              <i class="ri-loader-4-line animate-spin text-2xl"></i>
              <span class="text-xs">正在生成二维码...</span>
            </div>
            <div
              v-else
              class="flex flex-col items-center justify-center gap-2 text-slate-400 text-center px-2"
            >
              <i class="ri-qr-code-line text-2xl"></i>
              <span class="text-xs">二维码加载失败</span>
            </div>

            <!-- Scanned / Expired Overlay -->
            <div
              v-if="qrStatus === 'scanned'"
              class="absolute inset-0 rounded-2xl bg-white/92 dark:bg-zinc-900/92 flex flex-col items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 px-3 text-center"
            >
              <i class="ri-checkbox-circle-fill text-3xl"></i>
              <span class="text-xs font-semibold">已扫码，请在手机端确认</span>
            </div>
            <div
              v-else-if="
                qrStatus === 'expired' ||
                qrStatus === 'rejected' ||
                qrStatus === 'risk_control' ||
                qrStatus === 'error'
              "
              class="absolute inset-0 rounded-2xl bg-white/92 dark:bg-zinc-900/92 flex flex-col items-center justify-center gap-2 px-3 text-center"
            >
              <i class="ri-refresh-line text-2xl text-amber-500"></i>
              <span class="text-xs font-medium text-slate-700 dark:text-zinc-200">
                {{ statusHint }}
              </span>
              <button
                type="button"
                class="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all"
                @click="loadQrCode"
              >
                重新获取二维码
              </button>
            </div>
          </div>

          <!-- Status Line -->
          <p class="mt-3 text-xs font-medium text-center text-slate-600 dark:text-zinc-300 leading-relaxed">
            {{ statusHint }}
          </p>

          <!-- Helper Buttons -->
          <div class="mt-3 flex flex-wrap items-center justify-center gap-2 w-full">
            <button
              type="button"
              :disabled="!qrImgUrl || savingQr"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-50 active:scale-95 transition-all"
              @click="handleSaveQr"
            >
              <i class="ri-download-2-line text-sm"></i>
              <span>{{ savingQr ? '保存中...' : '保存二维码到相册' }}</span>
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-all"
              :class="
                platform === 'bilibili'
                  ? 'bg-pink-50 dark:bg-pink-500/15 border-pink-200 dark:border-pink-400/30 text-pink-700 dark:text-pink-300'
                  : 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300'
              "
              @click="handleOpenClientApp"
            >
              <i class="ri-external-link-line text-sm"></i>
              <span>{{ platform === 'bilibili' ? '打开哔哩哔哩' : '打开手机 QQ' }}</span>
            </button>

            <button
              type="button"
              :disabled="loadingQr"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 disabled:opacity-50 transition-colors"
              @click="loadQrCode"
            >
              <i class="ri-refresh-line text-sm"></i>
              <span>刷新</span>
            </button>
          </div>
        </div>

        <!-- Collapsible QQ Cookie Fallback -->
        <div
          v-if="platform === 'qq'"
          class="mt-3 rounded-2xl bg-slate-50/90 dark:bg-[#1C1C22] border border-slate-200/70 dark:border-white/[0.06] overflow-hidden"
        >
          <button
            type="button"
            class="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100/60 dark:hover:bg-white/[0.03] transition-colors"
            @click="showManualCookie = !showManualCookie"
          >
            <span class="flex items-center gap-1.5">
              <i class="ri-key-2-line text-amber-500 dark:text-[#FFC533]"></i>
              <span>手动粘贴 QQ 音乐 Cookie（扫码受风控时推荐）</span>
            </span>
            <i
              :class="showManualCookie ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
              class="text-base text-slate-400"
            ></i>
          </button>

          <div v-if="showManualCookie" class="px-4 pb-4 space-y-2.5 border-t border-slate-200/60 dark:border-white/[0.06] pt-3">
            <p class="text-[11px] leading-relaxed text-slate-500 dark:text-zinc-400">
              在浏览器登录 <span class="font-medium text-slate-700 dark:text-zinc-300">y.qq.com</span>，复制请求头中包含
              <code class="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/[0.08]">uin</code> 与
              <code class="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/[0.08]">qm_keyst</code> /
              <code class="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/[0.08]">qqmusic_key</code> /
              <code class="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/[0.08]">p_skey</code>
              的 Cookie；凭据仅加密托管于系统安全存储区，绝不明文落盘或上传日志。
            </p>

            <textarea
              v-model="manualCookieInput"
              rows="3"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="例如：uin=o12345678; qm_keyst=Q_H_L_...; qqmusic_key=..."
              class="w-full rounded-xl p-2.5 text-xs bg-white dark:bg-[#131316] border border-slate-200 dark:border-white/[0.1] text-slate-800 dark:text-[#FAFAFA] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 dark:focus:border-[#FFC533]"
            ></textarea>

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                :disabled="verifyingManualCookie"
                class="px-4 py-2 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 active:scale-95 transition-all"
                @click="handleSubmitManualQqCookie"
              >
                {{ verifyingManualCookie ? '正在校验...' : '验证并绑定 QQ 音乐' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import QRCode from 'qrcode';
import { onBeforeUnmount, ref, watch } from 'vue';

import {
  generateBilibiliQr,
  generateQqQr,
  pollBilibiliQr,
  pollQqQr,
  verifyQqProfile
} from '@/api/platformBind';
import { usePlatformAccountsStore } from '@/store/modules/platformAccounts';
import { registerAndroidBackHandler } from '@/utils/androidBridge';
import { type BoundPlatformProfile, parseQqMusicCookieInput } from '@/utils/platformAuth';
import { launchExternalAppScheme, saveQrImageToGallery } from '@/utils/qrActions';

defineOptions({
  name: 'PlatformBindModal'
});

const props = defineProps<{
  show: boolean;
  platform: 'bilibili' | 'qq';
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'bound', payload: { platform: 'bilibili' | 'qq'; profile: BoundPlatformProfile }): void;
}>();

const message = useMessage();
const platformAccountsStore = usePlatformAccountsStore();

type PollStatus =
  | 'loading'
  | 'waiting'
  | 'scanned'
  | 'expired'
  | 'rejected'
  | 'risk_control'
  | 'confirmed'
  | 'error';

const loadingQr = ref(false);
const savingQr = ref(false);
const verifyingManualCookie = ref(false);
const showManualCookie = ref(false);
const manualCookieInput = ref('');
const qrImgUrl = ref('');
const qrSessionKey = ref('');
const qrStatus = ref<PollStatus>('loading');
const statusHint = ref('正在生成登录二维码...');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unregisterBackHandler: (() => void) | null = null;
let sessionNonce = 0;

const stopPolling = () => {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

const cleanupBackHandler = () => {
  if (unregisterBackHandler) {
    unregisterBackHandler();
    unregisterBackHandler = null;
  }
};

const handleClose = () => {
  sessionNonce++;
  stopPolling();
  cleanupBackHandler();
  manualCookieInput.value = '';
  emit('update:show', false);
};

const pollOnce = async (currentNonce: number) => {
  if (!props.show || currentNonce !== sessionNonce || !qrSessionKey.value) return;

  try {
    if (props.platform === 'bilibili') {
      const res: any = await pollBilibiliQr(qrSessionKey.value);
      if (currentNonce !== sessionNonce) return;
      const body = res?.data || {};
      const status = String(body.status || 'error') as PollStatus;
      qrStatus.value = status;
      statusHint.value = body.message || statusHint.value;

      if (status === 'confirmed' && body.cookie) {
        stopPolling();
        const profile: BoundPlatformProfile = {
          uid: String(body.profile?.uid || ''),
          nickname: String(body.profile?.nickname || '哔哩哔哩用户'),
          avatar: String(body.profile?.avatar || ''),
          isVip: Boolean(body.profile?.isVip),
          boundAt: Date.now()
        };
        platformAccountsStore.bindBilibili(profile, String(body.cookie));
        message.success('B 站账号绑定成功（不影响网易云主账号）');
        emit('bound', { platform: 'bilibili', profile });
        handleClose();
      } else if (status === 'expired' || status === 'error') {
        stopPolling();
      }
      return;
    }

    const res: any = await pollQqQr(qrSessionKey.value);
    if (currentNonce !== sessionNonce) return;
    const body = res?.data || {};
    const status = String(body.status || 'error') as PollStatus;
    qrStatus.value = status;
    statusHint.value = body.message || statusHint.value;

    if (status === 'confirmed' && body.cookie) {
      stopPolling();
      const profile: BoundPlatformProfile = {
        uid: String(body.profile?.uid || ''),
        nickname: String(body.profile?.nickname || 'QQ 音乐用户'),
        avatar: String(body.profile?.avatar || ''),
        boundAt: Date.now()
      };
      platformAccountsStore.bindQq(profile, String(body.cookie));
      message.success('QQ 音乐绑定成功（不影响网易云主账号）');
      emit('bound', { platform: 'qq', profile });
      handleClose();
    } else if (status === 'risk_control') {
      stopPolling();
      showManualCookie.value = true;
    } else if (status === 'expired' || status === 'rejected' || status === 'error') {
      stopPolling();
    }
  } catch {
    if (currentNonce !== sessionNonce) return;
    qrStatus.value = 'error';
    statusHint.value =
      props.platform === 'qq'
        ? '轮询 QQ 扫码状态失败，建议刷新二维码或使用下方手动 Cookie'
        : '轮询 B 站扫码状态失败，请点击刷新重试';
    stopPolling();
    if (props.platform === 'qq') {
      showManualCookie.value = true;
    }
  }
};

const loadQrCode = async () => {
  const currentNonce = ++sessionNonce;
  stopPolling();
  loadingQr.value = true;
  qrImgUrl.value = '';
  qrSessionKey.value = '';
  qrStatus.value = 'loading';
  statusHint.value =
    props.platform === 'bilibili' ? '正在获取 B 站登录二维码...' : '正在获取 QQ 登录二维码...';

  try {
    if (props.platform === 'bilibili') {
      const res: any = await generateBilibiliQr();
      if (currentNonce !== sessionNonce) return;
      const payload = res?.data?.data || {};
      const key = String(payload.qrcode_key || '').trim();
      let img = String(payload.qrImg || '').trim();
      const rawUrl = String(payload.url || '').trim();
      if (!img && rawUrl) {
        img = await QRCode.toDataURL(rawUrl, { width: 240, margin: 2 });
      }
      if (!key || !img) {
        throw new Error(res?.data?.message || '获取 B 站二维码失败');
      }
      qrSessionKey.value = key;
      qrImgUrl.value = img;
      qrStatus.value = 'waiting';
      statusHint.value = '请使用哔哩哔哩 App 扫码，或保存图片后扫一扫';
    } else {
      const res: any = await generateQqQr();
      if (currentNonce !== sessionNonce) return;
      const payload = res?.data?.data || {};
      const qrsig = String(payload.qrsig || '').trim();
      const img = String(payload.qrImg || '').trim();
      if (!qrsig || !img) {
        throw new Error(res?.data?.message || '获取 QQ 二维码失败');
      }
      qrSessionKey.value = qrsig;
      qrImgUrl.value = img;
      qrStatus.value = 'waiting';
      statusHint.value = '请使用手机 QQ 扫码确认授权';
    }

    pollTimer = setInterval(() => {
      void pollOnce(currentNonce);
    }, 2500);
  } catch (err: any) {
    if (currentNonce !== sessionNonce) return;
    qrStatus.value = props.platform === 'qq' ? 'risk_control' : 'error';
    statusHint.value =
      err?.message ||
      (props.platform === 'qq'
        ? '获取 QQ 二维码失败，请尝试手动粘贴 Cookie'
        : '获取 B 站二维码失败，请点击重试');
    if (props.platform === 'qq') {
      showManualCookie.value = true;
    }
  } finally {
    if (currentNonce === sessionNonce) {
      loadingQr.value = false;
    }
  }
};

const handleSaveQr = async () => {
  if (!qrImgUrl.value || savingQr.value) return;
  savingQr.value = true;
  try {
    const result = await saveQrImageToGallery(
      props.platform === 'bilibili' ? 'bilibili-bind-qr' : 'qqmusic-bind-qr',
      qrImgUrl.value
    );
    if (result.ok) {
      message.success(result.message);
    } else {
      message.error(result.message);
    }
  } finally {
    savingQr.value = false;
  }
};

const handleOpenClientApp = () => {
  launchExternalAppScheme(props.platform === 'bilibili' ? 'bilibili://' : 'mqqapi://');
};

const handleSubmitManualQqCookie = async () => {
  if (verifyingManualCookie.value) return;
  const parsed = parseQqMusicCookieInput(manualCookieInput.value);
  if (!parsed.ok) {
    message.warning(parsed.error || '请检查 QQ 音乐 Cookie 格式');
    return;
  }

  verifyingManualCookie.value = true;
  try {
    const res: any = await verifyQqProfile(parsed.normalizedCookie);
    const body = res?.data || {};
    if (body.code === 200 && body.profile) {
      manualCookieInput.value = '';
      const profile: BoundPlatformProfile = {
        uid: String(body.profile.uid || parsed.uid),
        nickname: String(body.profile.nickname || `QQ 音乐用户 ${parsed.uid}`),
        avatar: String(body.profile.avatar || ''),
        boundAt: Date.now()
      };
      platformAccountsStore.bindQq(profile, String(body.cookie || parsed.normalizedCookie));
      message.success('QQ 音乐绑定成功（Cookie 已加密托管）');
      emit('bound', { platform: 'qq', profile });
      handleClose();
    } else {
      message.error(body.message || '验证 Cookie 失败，请确认未过期');
    }
  } catch (err: any) {
    const errMsg = err?.response?.data?.message || '验证 QQ 音乐 Cookie 失败，请稍后重试';
    message.error(errMsg);
  } finally {
    verifyingManualCookie.value = false;
  }
};

watch(
  () => [props.show, props.platform] as const,
  ([visible]) => {
    cleanupBackHandler();
    if (visible) {
      showManualCookie.value = false;
      manualCookieInput.value = '';
      unregisterBackHandler = registerAndroidBackHandler(() => {
        handleClose();
        return true;
      }, 115);
      void loadQrCode();
    } else {
      sessionNonce++;
      stopPolling();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  sessionNonce++;
  stopPolling();
  cleanupBackHandler();
  manualCookieInput.value = '';
});
</script>
