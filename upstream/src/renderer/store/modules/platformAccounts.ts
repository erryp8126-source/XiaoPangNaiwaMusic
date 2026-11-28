import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  isAndroid,
  nativeSecureGetSecret,
  nativeSecureRemoveSecret,
  nativeSecureSetSecret
} from '@/utils/androidBridge';
import {
  BILIBILI_SECRET_KEY,
  type BoundPlatformProfile,
  MULTI_PLATFORM_PROFILE_STORAGE_KEY,
  QQMUSIC_SECRET_KEY
} from '@/utils/platformAuth';

interface StoredPlatformMeta {
  bilibili: BoundPlatformProfile | null;
  qq: BoundPlatformProfile | null;
}

function readStoredProfiles(): StoredPlatformMeta {
  if (typeof localStorage === 'undefined') {
    return { bilibili: null, qq: null };
  }
  try {
    const raw = localStorage.getItem(MULTI_PLATFORM_PROFILE_STORAGE_KEY);
    if (!raw) return { bilibili: null, qq: null };
    const parsed = JSON.parse(raw);
    const normalize = (p: any): BoundPlatformProfile | null => {
      if (!p || typeof p !== 'object' || !p.uid) return null;
      return {
        uid: String(p.uid),
        nickname: String(p.nickname || ''),
        avatar: String(p.avatar || ''),
        isVip: Boolean(p.isVip),
        boundAt: Number(p.boundAt) || Date.now()
      };
    };
    return {
      bilibili: normalize(parsed?.bilibili),
      qq: normalize(parsed?.qq)
    };
  } catch {
    return { bilibili: null, qq: null };
  }
}

function writeStoredProfiles(meta: StoredPlatformMeta): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MULTI_PLATFORM_PROFILE_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // ignore storage quota errors
  }
}

function readNativeOrSessionSecret(key: string, memoryFallback: string): string {
  if (memoryFallback) return memoryFallback;
  if (isAndroid()) {
    const nativeSecret = nativeSecureGetSecret(key);
    if (nativeSecret) return nativeSecret;
  }
  return '';
}

/**
 * 第三方扩展平台（B 站 / QQ 音乐）独立账号绑定 Store：
 * - 非敏感展示资料仅存脱敏元信息，绝不把 SESSDATA / qm_keyst 等凭据落盘 localStorage
 * - 原生端（Android Keystore / iOS Keychain）加密托管全部 Cookie 凭据，Web 端仅驻留当前会话内存
 * - 任何绑定/解绑动作绝不影响网易云主账号登录态
 */
export const usePlatformAccountsStore = defineStore('platformAccounts', () => {
  const initialProfiles = readStoredProfiles();
  const bilibiliProfile = ref<BoundPlatformProfile | null>(initialProfiles.bilibili);
  const qqProfile = ref<BoundPlatformProfile | null>(initialProfiles.qq);

  // Web/PWA 仅内存驻留，原生端由 SecureCredentialStore / Keychain 硬件加密托管
  const bilibiliSessionCookie = ref('');
  const qqSessionCookie = ref('');

  const persistProfiles = () => {
    writeStoredProfiles({
      bilibili: bilibiliProfile.value,
      qq: qqProfile.value
    });
  };

  const getBilibiliCookie = (): string =>
    readNativeOrSessionSecret(BILIBILI_SECRET_KEY, bilibiliSessionCookie.value);

  const getQqCookie = (): string =>
    readNativeOrSessionSecret(QQMUSIC_SECRET_KEY, qqSessionCookie.value);

  const isBilibiliBound = computed(() =>
    Boolean(bilibiliProfile.value?.uid && (isAndroid() || bilibiliSessionCookie.value || getBilibiliCookie()))
  );

  const isQqBound = computed(() =>
    Boolean(qqProfile.value?.uid && (isAndroid() || qqSessionCookie.value || getQqCookie()))
  );

  const bindBilibili = (profile: Omit<BoundPlatformProfile, 'boundAt'>, cookie: string) => {
    const cleanCookie = String(cookie || '').trim();
    if (!cleanCookie) return;
    bilibiliSessionCookie.value = cleanCookie;
    if (isAndroid()) {
      nativeSecureSetSecret(BILIBILI_SECRET_KEY, cleanCookie);
    }
    bilibiliProfile.value = {
      uid: String(profile.uid || ''),
      nickname: String(profile.nickname || '哔哩哔哩用户'),
      avatar: String(profile.avatar || ''),
      isVip: Boolean(profile.isVip),
      boundAt: Date.now()
    };
    persistProfiles();
  };

  const unbindBilibili = () => {
    bilibiliSessionCookie.value = '';
    if (isAndroid()) {
      nativeSecureRemoveSecret(BILIBILI_SECRET_KEY);
    }
    bilibiliProfile.value = null;
    persistProfiles();
  };

  const bindQq = (profile: Omit<BoundPlatformProfile, 'boundAt'>, cookie: string) => {
    const cleanCookie = String(cookie || '').trim();
    if (!cleanCookie) return;
    qqSessionCookie.value = cleanCookie;
    if (isAndroid()) {
      nativeSecureSetSecret(QQMUSIC_SECRET_KEY, cleanCookie);
    }
    qqProfile.value = {
      uid: String(profile.uid || ''),
      nickname: String(profile.nickname || 'QQ 音乐用户'),
      avatar: String(profile.avatar || ''),
      isVip: Boolean(profile.isVip),
      boundAt: Date.now()
    };
    persistProfiles();
  };

  const unbindQq = () => {
    qqSessionCookie.value = '';
    if (isAndroid()) {
      nativeSecureRemoveSecret(QQMUSIC_SECRET_KEY);
    }
    qqProfile.value = null;
    persistProfiles();
  };

  return {
    bilibiliProfile,
    qqProfile,
    isBilibiliBound,
    isQqBound,
    getBilibiliCookie,
    getQqCookie,
    bindBilibili,
    unbindBilibili,
    bindQq,
    unbindQq
  };
});
