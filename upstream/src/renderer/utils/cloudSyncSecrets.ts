/**
 * 云同步敏感凭据隔离与迁移工具
 * - 将 github.token / webdav.password / quick.syncCode 从明文 localStorage 中剥离
 * - 原生端（Android Keystore / iOS Keychain）自动兼容迁移旧明文并抹除 localStorage，此后仅存硬件加密存储
 * - Web / PWA 端敏感凭据仅驻留当次会话内存，绝不回写 localStorage
 */

export const SECRET_KEY_GITHUB_TOKEN = 'cloud_sync_github_token';
export const SECRET_KEY_WEBDAV_PASSWORD = 'cloud_sync_webdav_password';
export const SECRET_KEY_QUICK_SYNC_CODE = 'cloud_sync_quick_code';

export interface CloudSyncConfigLike {
  provider?: string;
  customDeviceName?: string;
  autoSyncOnLaunch?: boolean;
  autoSyncOnPlay?: boolean;
  syncHistory?: boolean;
  syncFavorites?: boolean;
  syncListeningStats?: boolean;
  quick: {
    syncCode: string;
    customSupabaseUrl: string;
    customSupabaseAnonKey: string;
  };
  webdav: {
    serverUrl: string;
    username: string;
    password: string;
    folderPath: string;
    fileName: string;
  };
  github: {
    token: string;
    gistId: string;
  };
  [key: string]: any;
}

export interface SecretStoreAdapter {
  getSecret(key: string): string;
  setSecret(key: string, value: string): boolean;
  removeSecret(key: string): boolean;
}

function cloneObj<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

export function sanitizeCloudSyncConfigForStorage<T extends CloudSyncConfigLike>(cfg: T): T {
  const cloned = cloneObj(cfg);
  cloned.quick = { ...cloned.quick, syncCode: '' };
  cloned.webdav = { ...cloned.webdav, password: '' };
  cloned.github = { ...cloned.github, token: '' };
  return cloned;
}

export function hydrateAndMigrateCloudSyncConfig<T extends CloudSyncConfigLike>(params: {
  rawStoredJson: string | null;
  defaultConfig: T;
  isNativeEnv: boolean;
  secretStore: SecretStoreAdapter;
  writeStorage: (sanitizedJson: string) => void;
}): T {
  const { rawStoredJson, defaultConfig, isNativeEnv, secretStore, writeStorage } = params;

  let merged: T = cloneObj(defaultConfig);
  let legacyQuickCode = '';
  let legacyWebdavPassword = '';
  let legacyGithubToken = '';
  let hadLegacyPlaintextSecrets = false;

  if (rawStoredJson) {
    try {
      const parsed = JSON.parse(rawStoredJson);
      if (parsed && typeof parsed === 'object') {
        merged = {
          ...cloneObj(defaultConfig),
          ...parsed,
          quick: { ...cloneObj(defaultConfig.quick), ...(parsed.quick || {}) },
          webdav: { ...cloneObj(defaultConfig.webdav), ...(parsed.webdav || {}) },
          github: { ...cloneObj(defaultConfig.github), ...(parsed.github || {}) }
        };
        legacyQuickCode = String(parsed.quick?.syncCode || '');
        legacyWebdavPassword = String(parsed.webdav?.password || '');
        legacyGithubToken = String(parsed.github?.token || '');
        hadLegacyPlaintextSecrets = Boolean(
          legacyQuickCode || legacyWebdavPassword || legacyGithubToken
        );
      }
    } catch {
      merged = cloneObj(defaultConfig);
    }
  }

  if (isNativeEnv) {
    if (legacyQuickCode) {
      secretStore.setSecret(SECRET_KEY_QUICK_SYNC_CODE, legacyQuickCode);
    }
    if (legacyWebdavPassword) {
      secretStore.setSecret(SECRET_KEY_WEBDAV_PASSWORD, legacyWebdavPassword);
    }
    if (legacyGithubToken) {
      secretStore.setSecret(SECRET_KEY_GITHUB_TOKEN, legacyGithubToken);
    }

    const storedQuickCode = secretStore.getSecret(SECRET_KEY_QUICK_SYNC_CODE);
    const storedWebdavPassword = secretStore.getSecret(SECRET_KEY_WEBDAV_PASSWORD);
    const storedGithubToken = secretStore.getSecret(SECRET_KEY_GITHUB_TOKEN);

    merged.quick.syncCode = storedQuickCode || legacyQuickCode || '';
    merged.webdav.password = storedWebdavPassword || legacyWebdavPassword || '';
    merged.github.token = storedGithubToken || legacyGithubToken || '';
  }

  // 一旦发现旧 localStorage 残留明文敏感凭据，立即覆写为脱敏配置
  if (hadLegacyPlaintextSecrets) {
    try {
      writeStorage(JSON.stringify(sanitizeCloudSyncConfigForStorage(merged)));
    } catch {
      // ignore storage errors
    }
  }

  return merged;
}

export function persistCloudSyncConfigSecurely<T extends CloudSyncConfigLike>(params: {
  config: T;
  isNativeEnv: boolean;
  secretStore: SecretStoreAdapter;
  writeStorage: (sanitizedJson: string) => void;
}): string {
  const { config, isNativeEnv, secretStore, writeStorage } = params;

  if (isNativeEnv) {
    const syncCode = String(config.quick?.syncCode || '');
    const webdavPwd = String(config.webdav?.password || '');
    const githubToken = String(config.github?.token || '');

    if (syncCode) secretStore.setSecret(SECRET_KEY_QUICK_SYNC_CODE, syncCode);
    else secretStore.removeSecret(SECRET_KEY_QUICK_SYNC_CODE);

    if (webdavPwd) secretStore.setSecret(SECRET_KEY_WEBDAV_PASSWORD, webdavPwd);
    else secretStore.removeSecret(SECRET_KEY_WEBDAV_PASSWORD);

    if (githubToken) secretStore.setSecret(SECRET_KEY_GITHUB_TOKEN, githubToken);
    else secretStore.removeSecret(SECRET_KEY_GITHUB_TOKEN);
  }

  const sanitizedJson = JSON.stringify(sanitizeCloudSyncConfigForStorage(config));
  try {
    writeStorage(sanitizedJson);
  } catch {
    // ignore storage errors
  }
  return sanitizedJson;
}
