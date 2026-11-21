/**
 * 同步口令客户端端到端加密工具（零知识设计）
 * - syncId = SHA-256("xiaopang-naiwa-sync-id-v1:" + normalizedCode)，服务端永远看不到原始口令
 * - 数据正文使用 PBKDF2 + AES-256-GCM 加密后上传，仅持有口令的设备可解密
 */

const ID_DOMAIN_PREFIX = 'xiaopang-naiwa-sync-id-v1:';
const AES_SALT_TEXT = 'xiaopang-naiwa-aes-salt-v1';
const FRIENDLY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 规范化同步口令：去首尾空格、转大写、去除多余空白
 */
export function normalizeSyncCode(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

const COMMON_WEAK_CODES = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '00000000',
  '11111111',
  '88888888',
  'PASSWORD',
  'PASSWORD123',
  'QWERTYUI',
  'QWERTY123',
  'ABCDEFGH',
  'XIAOPANG',
  'NAIWAMUSIC',
  'ALGERMUSIC'
]);

function isSequentialString(s: string): boolean {
  if (s.length < 4) return false;
  let asc = true;
  let desc = true;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/**
 * 校验同步口令强度：
 * - 至少 8 位（兼容已生成的 NAIWA-xxxx-xxxx 等口令）
 * - 拦截纯短数字、全重复字符、顺子/倒顺子与常见弱口令，避免无鉴权猜解风险
 */
export function validateSyncCode(raw: string): { valid: boolean; reason?: string } {
  const normalized = normalizeSyncCode(raw);
  if (normalized.length < 8) {
    return { valid: false, reason: '同步口令至少需要 8 位字符（建议使用一键生成的随机口令）' };
  }
  if (normalized.length > 64) {
    return { valid: false, reason: '同步口令长度不能超过 64 位' };
  }
  const stripped = normalized.replace(/[-_]/g, '');
  if (new Set(stripped).size <= 2) {
    return { valid: false, reason: '口令过于简单（重复字符过多），请换一个更复杂的口令' };
  }
  if (COMMON_WEAK_CODES.has(stripped) || isSequentialString(stripped)) {
    return { valid: false, reason: '口令过于常见或为连续字符，容易被猜中，请使用更强的口令' };
  }
  if (/^\d+$/.test(stripped) && stripped.length < 12) {
    return { valid: false, reason: '纯数字口令至少需要 12 位，建议混入字母或直接一键生成' };
  }
  const hasLetter = /[A-Z]/.test(stripped);
  const hasDigit = /\d/.test(stripped);
  if (!hasLetter && !hasDigit) {
    return { valid: false, reason: '口令需包含字母或数字' };
  }
  if (stripped.length < 12 && !(hasLetter && hasDigit)) {
    return { valid: false, reason: '不足 12 位的自定义口令需同时包含字母和数字，以防被猜中' };
  }
  return { valid: true };
}

/**
 * 生成好记又高熵的默认专属同步口令，例如 NAIWA-7392-K8M4P2（熵值 > 10^13）
 */
export function generateFriendlySyncCode(): string {
  const randomBytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let digits = '';
  for (let i = 0; i < 4; i++) {
    digits += String(randomBytes[i] % 10);
  }
  let suffix = '';
  for (let i = 4; i < 10; i++) {
    suffix += FRIENDLY_ALPHABET[randomBytes[i] % FRIENDLY_ALPHABET.length];
  }
  return `NAIWA-${digits}-${suffix}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * 纯 JS SHA-256 兜底（当某些非 HTTPS 调试 WebView 无 crypto.subtle 时确保永不报错）
 */
function sha256Fallback(messageBytes: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  const bitLen = messageBytes.length * 8;
  const padLen = ((messageBytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(messageBytes);
  padded[messageBytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((W[i - 15] >>> 7) | (W[i - 15] << 25)) ^
        ((W[i - 15] >>> 18) | (W[i - 15] << 14)) ^
        (W[i - 15] >>> 3);
      const s1 =
        ((W[i - 2] >>> 17) | (W[i - 2] << 15)) ^
        ((W[i - 2] >>> 19) | (W[i - 2] << 13)) ^
        (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outDv.setUint32(i * 4, H[i], false);
  }
  return out;
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return new Uint8Array(buf);
    } catch {
      // fallback
    }
  }
  return sha256Fallback(data);
}

/**
 * 根据同步口令派生 64 位十六进制 syncId（不可逆，服务端无法反推原始口令）
 */
export async function deriveSyncId(rawCode: string): Promise<string> {
  const normalized = normalizeSyncCode(rawCode);
  const hash = await sha256Bytes(`${ID_DOMAIN_PREFIX}${normalized}`);
  return bytesToHex(hash);
}

const LEGACY_PBKDF2_ITERATIONS = 15000;
const CURRENT_PBKDF2_ITERATIONS = 100000;

async function deriveAesKey(rawCode: string, iterations = CURRENT_PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const normalized = normalizeSyncCode(rawCode);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(normalized),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(AES_SALT_TEXT),
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 使用同步口令在端侧 AES-256-GCM 加密 JSON 字符串（PBKDF2 100,000 轮，严禁降级为弱异或混淆上传）
 */
export async function encryptSyncPayload(plainJson: string, rawCode: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前环境不支持 WebCrypto AES-256-GCM 加密，请通过 HTTPS 网页或手机客户端进行云同步');
  }
  const bytes = new TextEncoder().encode(plainJson);
  const key = await deriveAesKey(rawCode, CURRENT_PBKDF2_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return JSON.stringify({
    v: 2,
    enc: 'aes-gcm',
    iter: CURRENT_PBKDF2_ITERATIONS,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuf))
  });
}

/**
 * 解密服务端返回的密文包（自动兼容 v1 15,000 轮与 v2 100,000 轮密文）
 */
export async function decryptSyncPayload(envelopeStr: string, rawCode: string): Promise<string> {
  const envelope = JSON.parse(envelopeStr);
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('云端数据包格式异常');
  }

  if (envelope.enc === 'aes-gcm' && envelope.iv && envelope.ct) {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('当前环境不支持 AES-GCM 解密，请使用 HTTPS 或手机客户端打开');
    }
    const iter =
      typeof envelope.iter === 'number' && envelope.iter >= 10000 && envelope.iter <= 1000000
        ? envelope.iter
        : LEGACY_PBKDF2_ITERATIONS;
    const key = await deriveAesKey(rawCode, iter);
    const iv = base64ToBytes(envelope.iv);
    const ct = base64ToBytes(envelope.ct);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plainBuf);
  }

  if (envelope.enc === 'xor-sha256' && envelope.ct) {
    const keyHash = await sha256Bytes(`xor-key:${normalizeSyncCode(rawCode)}`);
    const masked = base64ToBytes(envelope.ct);
    const plain = new Uint8Array(masked.length);
    for (let i = 0; i < masked.length; i++) {
      plain[i] = masked[i] ^ keyHash[i % keyHash.length];
    }
    return new TextDecoder().decode(plain);
  }

  // 兼容明文 JSON
  if (envelope.schema === 'xiaopang-music-sync-v1') {
    return envelopeStr;
  }

  throw new Error('无法解密云端数据，请确认同步口令是否正确');
}
