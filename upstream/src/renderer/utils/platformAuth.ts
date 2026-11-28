export const BILIBILI_SECRET_KEY = 'bilibili_auth_cookie';
export const QQMUSIC_SECRET_KEY = 'qqmusic_auth_cookie';
export const MULTI_PLATFORM_PROFILE_STORAGE_KEY = 'xiaopang_bound_platforms_v1';
export const CAPTCHA_COOLDOWN_SECONDS = 60;

export const PLATFORM_AUTH_ALLOWED_HOSTS: readonly string[] = [
  'passport.bilibili.com',
  'api.bilibili.com',
  'ssl.ptlogin2.qq.com',
  'ptlogin2.qq.com',
  'u.y.qq.com',
  'c.y.qq.com',
  'y.qq.com',
  'graph.qq.com'
];

export interface CaptchaSendValidation {
  ok: boolean;
  normalizedPhone: string;
  normalizedCtcode: string;
  error?: string;
}

export interface CaptchaLoginValidation {
  ok: boolean;
  normalizedPhone: string;
  normalizedCaptcha: string;
  normalizedCtcode: string;
  error?: string;
}

export interface BilibiliCookieExtractResult {
  cookie: string;
  sessdata: string;
  biliJct: string;
  dedeUserId: string;
}

export interface BilibiliQrPollResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'error';
  code: number;
  message: string;
  cookie?: string;
  dedeUserId?: string;
  redirectUrl?: string;
}

export interface QqPtuiCbResult {
  status: 'waiting' | 'scanned' | 'expired' | 'rejected' | 'confirmed' | 'risk_control';
  code: string;
  redirectUrl: string;
  nickname: string;
  message: string;
}

export interface QqCookieParseResult {
  ok: boolean;
  uid: string;
  normalizedCookie: string;
  error?: string;
}

export interface BoundPlatformProfile {
  uid: string;
  nickname: string;
  avatar: string;
  isVip?: boolean;
  boundAt: number;
}

export interface MultiPlatformIsolationState {
  netease: {
    token: string | null;
    user: Record<string, any> | null;
    loginType: string | null;
  };
  bilibili: BoundPlatformProfile | null;
  qq: BoundPlatformProfile | null;
}

const QQ_WHITELISTED_COOKIE_KEYS = new Set([
  'uin',
  'p_uin',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'pt4_token',
  'tmeLoginType',
  'euin'
]);

const QQ_REQUIRED_AUTH_KEYS = new Set([
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'pt4_token'
]);

const BILIBILI_WHITELISTED_COOKIE_KEYS = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5'
] as const;

export function isAllowedPlatformAuthHost(rawHost: string | null | undefined): boolean {
  const host = String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  if (!host) return false;
  return PLATFORM_AUTH_ALLOWED_HOSTS.includes(host);
}

export function validateCaptchaSendInput(
  phone: string,
  ctcode: string = '86'
): CaptchaSendValidation {
  const normalizedCtcode = String(ctcode || '86')
    .trim()
    .replace(/^\+/, '') || '86';
  const normalizedPhone = String(phone || '').replace(/[\s-]/g, '').trim();

  if (!/^\d{1,5}$/.test(normalizedCtcode)) {
    return {
      ok: false,
      normalizedPhone,
      normalizedCtcode: '86',
      error: '国家/地区区号格式不正确'
    };
  }

  if (!normalizedPhone) {
    return {
      ok: false,
      normalizedPhone,
      normalizedCtcode,
      error: '请输入手机号'
    };
  }

  if (normalizedCtcode === '86') {
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) {
      return {
        ok: false,
        normalizedPhone,
        normalizedCtcode,
        error: '请输入正确的 11 位中国大陆手机号'
      };
    }
  } else if (!/^\d{6,15}$/.test(normalizedPhone)) {
    return {
      ok: false,
      normalizedPhone,
      normalizedCtcode,
      error: '请输入有效的手机号码'
    };
  }

  return {
    ok: true,
    normalizedPhone,
    normalizedCtcode
  };
}

export function validateCaptchaLoginInput(
  phone: string,
  captcha: string,
  ctcode: string = '86'
): CaptchaLoginValidation {
  const phoneCheck = validateCaptchaSendInput(phone, ctcode);
  const normalizedCaptcha = String(captcha || '').trim();
  if (!phoneCheck.ok) {
    return {
      ok: false,
      normalizedPhone: phoneCheck.normalizedPhone,
      normalizedCaptcha,
      normalizedCtcode: phoneCheck.normalizedCtcode,
      error: phoneCheck.error
    };
  }

  if (!normalizedCaptcha) {
    return {
      ok: false,
      normalizedPhone: phoneCheck.normalizedPhone,
      normalizedCaptcha,
      normalizedCtcode: phoneCheck.normalizedCtcode,
      error: '请输入短信验证码'
    };
  }

  if (!/^\d{4,6}$/.test(normalizedCaptcha)) {
    return {
      ok: false,
      normalizedPhone: phoneCheck.normalizedPhone,
      normalizedCaptcha,
      normalizedCtcode: phoneCheck.normalizedCtcode,
      error: '请输入 4-6 位数字验证码'
    };
  }

  return {
    ok: true,
    normalizedPhone: phoneCheck.normalizedPhone,
    normalizedCaptcha,
    normalizedCtcode: phoneCheck.normalizedCtcode
  };
}

export function computeCaptchaCooldownRemaining(
  cooldownUntilMs: number,
  nowMs: number = Date.now()
): number {
  if (!Number.isFinite(cooldownUntilMs) || cooldownUntilMs <= nowMs) {
    return 0;
  }
  return Math.max(0, Math.ceil((cooldownUntilMs - nowMs) / 1000));
}

function parseSetCookieListToRecord(setCookies?: string[] | string): Record<string, string> {
  const out: Record<string, string> = {};
  const list = Array.isArray(setCookies)
    ? setCookies
    : typeof setCookies === 'string' && setCookies
      ? [setCookies]
      : [];

  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const firstPair = raw.split(';')[0]?.trim() || '';
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = firstPair.slice(0, eqIdx).trim();
    const val = firstPair.slice(eqIdx + 1).trim();
    if (key && val) {
      out[key] = val;
    }
  }
  return out;
}

export function extractBilibiliAuthCookies(
  setCookies?: string[] | string,
  redirectUrl?: string
): BilibiliCookieExtractResult {
  const jar = parseSetCookieListToRecord(setCookies);

  if (redirectUrl) {
    try {
      const parsed = new URL(redirectUrl);
      for (const key of BILIBILI_WHITELISTED_COOKIE_KEYS) {
        const val = parsed.searchParams.get(key)?.trim();
        if (val && !jar[key]) {
          jar[key] = val;
        }
      }
    } catch {
      // ignore invalid redirect url
    }
  }

  const orderedPairs: string[] = [];
  for (const key of BILIBILI_WHITELISTED_COOKIE_KEYS) {
    const val = jar[key];
    if (val) {
      orderedPairs.push(`${key}=${val}`);
    }
  }

  return {
    cookie: orderedPairs.join('; '),
    sessdata: jar.SESSDATA || '',
    biliJct: jar.bili_jct || '',
    dedeUserId: jar.DedeUserID || ''
  };
}

export function parseBilibiliQrPollState(
  payload: any,
  setCookies?: string[] | string
): BilibiliQrPollResult {
  const outerCode = Number(payload?.code);
  const innerData = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const pollCode = Number(innerData?.code ?? outerCode);
  const rawMessage = String(innerData?.message || payload?.message || '').trim();

  if (pollCode === 86101) {
    return {
      status: 'waiting',
      code: 86101,
      message: '等待使用哔哩哔哩 App 扫码'
    };
  }

  if (pollCode === 86090) {
    return {
      status: 'scanned',
      code: 86090,
      message: '已扫码，请在手机 B 站确认登录'
    };
  }

  if (pollCode === 86038) {
    return {
      status: 'expired',
      code: 86038,
      message: '二维码已过期，请点击刷新'
    };
  }

  if (pollCode === 0) {
    const redirectUrl = typeof innerData?.url === 'string' ? innerData.url : '';
    const extracted = extractBilibiliAuthCookies(setCookies, redirectUrl);
    if (!extracted.sessdata) {
      return {
        status: 'error',
        code: 0,
        message: '未能获取 B 站登录凭据，请刷新二维码重试'
      };
    }
    return {
      status: 'confirmed',
      code: 0,
      message: 'B 站扫码成功，正在同步账号信息',
      cookie: extracted.cookie,
      dedeUserId: extracted.dedeUserId,
      redirectUrl
    };
  }

  return {
    status: 'error',
    code: Number.isFinite(pollCode) ? pollCode : -1,
    message: rawMessage || '获取 B 站扫码状态失败，请刷新重试'
  };
}

/**
 * QQ ptlogin2 hash33 算法，根据 qrsig 计算 ptqrtoken
 */
export function computeQqPtqrToken(qrsig: string): number {
  let e = 0;
  for (let i = 0; i < qrsig.length; i++) {
    e += (e << 5) + qrsig.charCodeAt(i);
  }
  return e & 2147483647;
}

export function parseQqPtuiCB(rawText: string): QqPtuiCbResult {
  const match = /ptuiCB\(([^)]*)\)/.exec(String(rawText || ''));
  if (!match) {
    return {
      status: 'risk_control',
      code: 'invalid',
      redirectUrl: '',
      nickname: '',
      message: 'QQ 安全校验暂未放行扫码，建议展开下方「手动粘贴 QQ 音乐 Cookie」完成绑定'
    };
  }

  const rawArgs = match[1];
  const args: string[] = [];
  const tokenRe = /'((?:\\.|[^'\\])*)'/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawArgs)) !== null) {
    args.push(m[1].replace(/\\'/g, "'"));
  }

  const code = String(args[0] || '').trim();
  const redirectUrl = String(args[2] || '').trim();
  const msg = String(args[4] || '').trim();
  const nickname = String(args[5] || '').trim();

  switch (code) {
    case '66':
      return {
        status: 'waiting',
        code,
        redirectUrl: '',
        nickname: '',
        message: '等待使用手机 QQ 扫码'
      };
    case '67':
      return {
        status: 'scanned',
        code,
        redirectUrl: '',
        nickname,
        message: '已扫码，请在手机 QQ 上确认授权'
      };
    case '65':
      return {
        status: 'expired',
        code,
        redirectUrl: '',
        nickname: '',
        message: '二维码已失效，请点击刷新'
      };
    case '68':
      return {
        status: 'rejected',
        code,
        redirectUrl: '',
        nickname: '',
        message: '您已在手机 QQ 中取消授权'
      };
    case '0':
      return {
        status: 'confirmed',
        code,
        redirectUrl,
        nickname,
        message: 'QQ 扫码成功，正在完成音乐凭据授权'
      };
    default:
      return {
        status: 'risk_control',
        code: code || 'unknown',
        redirectUrl: '',
        nickname: '',
        message: msg
          ? `QQ 登录暂受风控限制（${msg}），建议使用下方「手动粘贴 Cookie」完成绑定`
          : 'QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 Cookie」完成绑定'
      };
  }
}

export function normalizeQqUin(rawUin: string | null | undefined): string {
  const clean = String(rawUin || '')
    .trim()
    .replace(/^[oq]+/i, '')
    .replace(/^0+/, '');
  return /^\d{5,15}$/.test(clean) ? clean : '';
}

export function parseQqMusicCookieInput(rawCookie: string): QqCookieParseResult {
  const sanitized = String(rawCookie || '').replace(/[\r\n\0]/g, ';').trim();
  if (!sanitized) {
    return {
      ok: false,
      uid: '',
      normalizedCookie: '',
      error: '请先粘贴有效的 QQ 音乐 Cookie'
    };
  }

  const jar: Record<string, string> = {};
  for (const part of sanitized.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const rawKey = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!rawKey || !rawVal || /[\r\n\0]/.test(rawVal)) continue;

    // 匹配大小写变体但统一映射至标准键名
    for (const allowedKey of QQ_WHITELISTED_COOKIE_KEYS) {
      if (rawKey.toLowerCase() === allowedKey.toLowerCase()) {
        jar[allowedKey] = rawVal;
        break;
      }
    }
  }

  const uid = normalizeQqUin(jar.uin) || normalizeQqUin(jar.p_uin) || String(jar.euin || '').trim();
  const hasAuthKey = Array.from(QQ_REQUIRED_AUTH_KEYS).some((k) => Boolean(jar[k]));

  if (!hasAuthKey) {
    return {
      ok: false,
      uid: '',
      normalizedCookie: '',
      error: '未检测到 QQ 音乐鉴权字段（需包含 qm_keyst / qqmusic_key / p_skey 等）'
    };
  }

  if (!uid) {
    return {
      ok: false,
      uid: '',
      normalizedCookie: '',
      error: '未检测到 QQ 号字段（需包含 uin 或 p_uin）'
    };
  }

  const orderedPairs: string[] = [];
  for (const key of QQ_WHITELISTED_COOKIE_KEYS) {
    if (jar[key]) {
      orderedPairs.push(`${key}=${jar[key]}`);
    }
  }

  return {
    ok: true,
    uid,
    normalizedCookie: orderedPairs.join('; ')
  };
}

export function redactPlatformSecrets(rawText: string): string {
  if (!rawText) return '';
  let out = rawText;
  out = out.replace(
    /\b(Cookie|Set-Cookie)["']?\s*[:=]\s*["']?[^\r\n"']+/gi,
    '$1=[REDACTED]'
  );
  out = out.replace(
    /\b(SESSDATA|bili_jct|DedeUserID__ckMd5|DedeUserID|qm_keyst|qqmusic_key|p_skey|skey|pt4_token|qrsig|ptsigx|MUSIC_U|MUSIC_A|MUSIC_R_T|MUSIC_A_T|__csrf|NMTID)["']?\s*[:=]\s*["']?[^\s;,&"'\r\n]+/gi,
    '$1=[REDACTED]'
  );
  return out;
}

export function unbindPlatformIsolation(
  state: MultiPlatformIsolationState,
  platform: 'bilibili' | 'qq'
): MultiPlatformIsolationState {
  return {
    netease: {
      token: state.netease.token,
      user: state.netease.user ? { ...state.netease.user } : null,
      loginType: state.netease.loginType
    },
    bilibili: platform === 'bilibili' ? null : state.bilibili ? { ...state.bilibili } : null,
    qq: platform === 'qq' ? null : state.qq ? { ...state.qq } : null
  };
}
