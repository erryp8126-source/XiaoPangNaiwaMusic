/**
 * 播放失败原因归类、用户可读提示与重试上限控制（纯 TypeScript，零 DOM 依赖）
 * - 严格限制单曲最大重试次数 <= 2，避免无限转圈或死循环重试
 */

export const MAX_SINGLE_TRACK_RETRIES = 2;

export type PlaybackFailureCode =
  | 'offline'
  | 'timeout'
  | 'no-source'
  | 'local-missing'
  | 'source-unavailable';

export interface PlaybackFailureDiagnosis {
  code: PlaybackFailureCode;
  userMessage: string;
  shouldRetry: boolean;
}

export interface ClassifyFailureInput {
  error?: unknown;
  hasUrl?: boolean;
  isOffline?: boolean;
  isLocal?: boolean;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name} ${error.message}`.trim();
  if (typeof error === 'object' && 'message' in (error as any)) {
    return String((error as any).message || '');
  }
  return String(error);
}

/**
 * 将底层音频错误、超时或解析为空归类为用户可读提示
 */
export function classifyPlaybackFailure(input: ClassifyFailureInput): PlaybackFailureDiagnosis {
  const msg = extractErrorMessage(input.error).toLowerCase();

  if (input.isLocal) {
    return {
      code: 'local-missing',
      userMessage: '本地音频文件已失效或被移动',
      shouldRetry: false
    };
  }

  if (input.isOffline) {
    return {
      code: 'offline',
      userMessage: '当前无网络连接，请检查网络或播放离线歌曲',
      shouldRetry: false
    };
  }

  if (
    /timeout|timed out|etimedout|econnaborted|abort|network timeout|deadline/.test(msg)
  ) {
    return {
      code: 'timeout',
      userMessage: '网络超时，请检查连接',
      shouldRetry: true
    };
  }

  if (
    input.hasUrl === false ||
    /no playable|no url|empty url|unavailable|copyright|404|403|无版权|暂无可播放|解析失败/.test(msg)
  ) {
    return {
      code: 'no-source',
      userMessage: '该歌曲暂无可播放的可用音源',
      shouldRetry: false
    };
  }

  if (/failed to fetch|networkerror|err_internet_disconnected|err_name_not_resolved/.test(msg)) {
    return {
      code: 'timeout',
      userMessage: '网络超时，请检查连接',
      shouldRetry: true
    };
  }

  return {
    code: 'source-unavailable',
    userMessage: '当前音源不可用，正在尝试切换备用源',
    shouldRetry: true
  };
}

/**
 * 判断单曲是否还允许继续重试（严格限制 <= MAX_SINGLE_TRACK_RETRIES = 2）
 */
export function shouldRetrySingleTrack(
  currentRetryCount: number,
  failureCode: PlaybackFailureCode
): boolean {
  if (currentRetryCount >= MAX_SINGLE_TRACK_RETRIES) return false;
  if (
    failureCode === 'offline' ||
    failureCode === 'no-source' ||
    failureCode === 'local-missing'
  ) {
    return false;
  }
  return true;
}

/**
 * 自动切换备用源时的用户可读轻量提示
 */
export function formatAutoFallbackMessage(sourceCategory?: string): string {
  if (sourceCategory === 'lx') {
    return '当前音源不可用，已自动切换备用 LX 源';
  }
  return '当前音源不可用，已自动切换备用源';
}
