/**
 * 落雪音乐加密工具
 * 实现 lx.utils.crypto API
 *
 * 提供 MD5、AES、RSA、SHA 等加密功能
 */

import CryptoJS from 'crypto-js';
import { JSEncrypt } from 'jsencrypt';

export type CryptoInput = string | Uint8Array | ArrayBuffer | ArrayBufferView | CryptoJS.lib.WordArray;
export type BinaryInput = string | Uint8Array | ArrayBuffer | ArrayBufferView;

const bytesToWordArray = (bytes: Uint8Array): CryptoJS.lib.WordArray => {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] || 0) << 24) |
        ((bytes[i + 1] || 0) << 16) |
        ((bytes[i + 2] || 0) << 8) |
        (bytes[i + 3] || 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
};

const toWordArray = (input: CryptoInput): CryptoJS.lib.WordArray => {
  if (typeof input === 'string') {
    return CryptoJS.enc.Utf8.parse(input);
  }
  if (input instanceof Uint8Array) {
    return bytesToWordArray(input);
  }
  if (input instanceof ArrayBuffer) {
    return bytesToWordArray(new Uint8Array(input));
  }
  if (ArrayBuffer.isView(input)) {
    return bytesToWordArray(
      new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    );
  }
  return input;
};

const toBytes = (input: BinaryInput): Uint8Array => {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
};

const wordArrayToBytes = (wordArray: CryptoJS.lib.WordArray): Uint8Array => {
  const words = Array.isArray(wordArray?.words) ? wordArray.words : [];
  const rawSigBytes = Number(wordArray?.sigBytes ?? 0);
  const clampedBytes = Math.max(
    0,
    Math.min(Number.isFinite(rawSigBytes) ? rawSigBytes : 0, words.length * 4)
  );
  const result = new Uint8Array(clampedBytes);
  for (let i = 0; i < clampedBytes; i++) {
    result[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return result;
};

const bytesToBinaryString = (bytes: Uint8Array): string => {
  const CHUNK_SIZE = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return out;
};

const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) & 0xff;
  }
  return out;
};

/**
 * MD5 哈希
 */
export const md5 = (str: string): string => {
  return CryptoJS.MD5(str).toString();
};

/**
 * 生成随机字节（返回16进制字符串）
 */
export const randomBytes = (size: number): string => {
  const array = new Uint8Array(size);
  crypto.getRandomValues(array);
  return bytesToHex(array);
};

/**
 * AES 加密
 *
 * @param buffer - 要加密的数据（字符串或 Buffer）
 * @param mode - 加密模式（如 'cbc' 或 'aes-128-ecb'）
 * @param key - 密钥（字符串、Uint8Array 或 WordArray）
 * @param iv - 初始化向量（字符串、Uint8Array 或 WordArray）
 * @returns 加密后的 Buffer（Uint8Array）
 */
export const aesEncrypt = (
  buffer: BinaryInput | CryptoJS.lib.WordArray,
  mode: string,
  key: CryptoInput,
  iv?: CryptoInput | null
): Uint8Array => {
  try {
    const wordArray = toWordArray(buffer);
    const keyWordArray = toWordArray(key);
    const modeObj = getModeFromString(mode);

    const options: {
      iv?: CryptoJS.lib.WordArray;
      mode: CryptoJS.lib.Mode;
      padding: typeof CryptoJS.pad.Pkcs7;
    } = {
      mode: modeObj,
      padding: CryptoJS.pad.Pkcs7
    };
    if (modeObj !== CryptoJS.mode.ECB && iv !== undefined && iv !== null) {
      options.iv = toWordArray(iv);
    }

    const encrypted = CryptoJS.AES.encrypt(wordArray, keyWordArray, options);
    return wordArrayToBytes(encrypted.ciphertext);
  } catch (error) {
    console.error('[lxCrypto] AES 加密失败:', error);
    throw error;
  }
};

/**
 * AES 解密
 */
export const aesDecrypt = (
  buffer: BinaryInput | CryptoJS.lib.WordArray,
  mode: string,
  key: CryptoInput,
  iv?: CryptoInput | null
): Uint8Array => {
  try {
    const ciphertext = toWordArray(buffer);
    const keyWordArray = toWordArray(key);
    const modeObj = getModeFromString(mode);

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext
    });

    const options: {
      iv?: CryptoJS.lib.WordArray;
      mode: CryptoJS.lib.Mode;
      padding: typeof CryptoJS.pad.Pkcs7;
    } = {
      mode: modeObj,
      padding: CryptoJS.pad.Pkcs7
    };
    if (modeObj !== CryptoJS.mode.ECB && iv !== undefined && iv !== null) {
      options.iv = toWordArray(iv);
    }

    const decrypted = CryptoJS.AES.decrypt(cipherParams, keyWordArray, options);
    return wordArrayToBytes(decrypted);
  } catch (error) {
    console.error('[lxCrypto] AES 解密失败:', error);
    throw error;
  }
};

/**
 * RSA 加密（PKCS#1 v1.5 二进制字节安全实现，避免 UTF-8 破坏任意二进制密文/密钥）
 *
 * @param buffer - 要加密的数据
 * @param publicKey - RSA 公钥（PEM 格式）
 * @returns 加密后的数据（Uint8Array）
 */
export const rsaEncrypt = (buffer: BinaryInput, publicKey: string): Uint8Array => {
  try {
    const encrypt = new JSEncrypt();
    encrypt.setPublicKey(publicKey);

    const rsaKey = (encrypt as any).getKey?.();
    if (!rsaKey || !rsaKey.n || typeof rsaKey.doPublic !== 'function') {
      throw new Error('Invalid RSA public key');
    }

    const plainBytes = toBytes(buffer);
    const modulusByteLen = (rsaKey.n.bitLength() + 7) >> 3;
    if (plainBytes.length > modulusByteLen - 11) {
      throw new Error('Message too long for RSA');
    }

    // RFC 8017 PKCS#1 v1.5 type 2 block: 0x00 || 0x02 || non-zero random PS || 0x00 || M
    const padded = new Uint8Array(modulusByteLen);
    padded[0] = 0x00;
    padded[1] = 0x02;
    const psLen = modulusByteLen - plainBytes.length - 3;
    const randBuf = new Uint8Array(psLen);
    crypto.getRandomValues(randBuf);
    for (let i = 0; i < psLen; i++) {
      let b = randBuf[i];
      while (b === 0) {
        const single = new Uint8Array(1);
        crypto.getRandomValues(single);
        b = single[0];
      }
      padded[2 + i] = b;
    }
    padded[2 + psLen] = 0x00;
    padded.set(plainBytes, 3 + psLen);

    const BigIntCtor = rsaKey.n.constructor;
    const m = new BigIntCtor(bytesToHex(padded), 16);
    const c = rsaKey.doPublic(m);
    if (!c) {
      throw new Error('RSA encryption failed');
    }

    const cHex = String(c.toString(16))
      .padStart(modulusByteLen * 2, '0')
      .slice(-(modulusByteLen * 2));
    return hexToBytes(cHex);
  } catch (error) {
    console.error('[lxCrypto] RSA 加密失败:', error);
    throw error;
  }
};

/**
 * RSA 解密（PKCS#1 v1.5 二进制字节安全实现）
 */
export const rsaDecrypt = (buffer: BinaryInput, privateKey: string): Uint8Array => {
  try {
    const decrypt = new JSEncrypt();
    decrypt.setPrivateKey(privateKey);

    const rsaKey = (decrypt as any).getKey?.();
    if (!rsaKey || !rsaKey.n || !rsaKey.d || typeof rsaKey.doPrivate !== 'function') {
      throw new Error('Invalid RSA private key');
    }

    const cipherBytes = toBytes(buffer);
    const modulusByteLen = (rsaKey.n.bitLength() + 7) >> 3;
    if (cipherBytes.length === 0 || cipherBytes.length > modulusByteLen) {
      throw new Error('RSA decryption failed');
    }

    const BigIntCtor = rsaKey.n.constructor;
    const c = new BigIntCtor(bytesToHex(cipherBytes), 16);
    const m = rsaKey.doPrivate(c);
    if (!m) {
      throw new Error('RSA decryption failed');
    }

    const mHex = String(m.toString(16))
      .padStart(modulusByteLen * 2, '0')
      .slice(-(modulusByteLen * 2));
    const padded = hexToBytes(mHex);

    if (padded.length !== modulusByteLen || padded[0] !== 0x00 || padded[1] !== 0x02) {
      throw new Error('RSA decryption failed');
    }
    const sepIdx = padded.indexOf(0x00, 2);
    if (sepIdx < 10) {
      throw new Error('RSA decryption failed');
    }

    return padded.slice(sepIdx + 1);
  } catch (error) {
    console.error('[lxCrypto] RSA 解密失败:', error);
    throw error;
  }
};

/**
 * 从字符串获取加密模式（支持 'ecb' / 'aes-128-ecb' / 'aes-256-cbc' 等命名）
 */
const getModeFromString = (mode: string): CryptoJS.lib.Mode => {
  const raw = String(mode || '').trim().toLowerCase();
  const suffix = raw.includes('-') ? raw.split('-').pop() || raw : raw;
  switch (suffix) {
    case 'cbc':
      return CryptoJS.mode.CBC;
    case 'cfb':
      return CryptoJS.mode.CFB;
    case 'ctr':
      return CryptoJS.mode.CTR;
    case 'ofb':
      return CryptoJS.mode.OFB;
    case 'ecb':
      return CryptoJS.mode.ECB;
    default:
      console.warn(`[lxCrypto] 未知的加密模式: ${mode}, 使用 CBC`);
      return CryptoJS.mode.CBC;
  }
};

/**
 * SHA1 哈希
 */
export const sha1 = (str: string): string => {
  return CryptoJS.SHA1(str).toString();
};

/**
 * SHA256 哈希
 */
export const sha256 = (str: string): string => {
  return CryptoJS.SHA256(str).toString();
};

/**
 * Base64 编码（UTF-8 字节安全，支持任意 Unicode 字符串与二进制缓冲区）
 */
export const base64Encode = (data: BinaryInput): string => {
  const bytes = toBytes(data);
  return btoa(bytesToBinaryString(bytes));
};

/**
 * Base64 解码
 */
export const base64Decode = (str: string): Uint8Array => {
  const binaryString = atob(str);
  const result = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    result[i] = binaryString.charCodeAt(i);
  }
  return result;
};
