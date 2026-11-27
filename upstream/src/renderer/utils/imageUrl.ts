/**
 * 外部图片/媒体 URL 安全规范化工具（纯逻辑，零 Vue/DOM 依赖，可直接单测）
 * - 将所有外部 http:// 或协议相对 // 资源升级为 https://（如 p1.music.126.net 等 CDN）
 * - 显式保留本地回环 http://127.0.0.1 / http://localhost / http://[::1]、data:、blob:、local://、/images/ 等本地地址
 */

const LOOPBACK_HTTP_RE = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const LOOPBACK_PROTO_REL_RE = /^\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const SAFE_DIRECT_PREFIXES = [
  'data:',
  'blob:',
  'local://',
  'http://127.0.0.1',
  'http://localhost',
  'http://[::1]',
  'https://appassets.',
  '/images/'
];

export function upgradeExternalHttpToHttps(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  if (LOOPBACK_HTTP_RE.test(trimmed) || LOOPBACK_PROTO_REL_RE.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  if (/^http:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice(7)}`;
  }

  return trimmed;
}

export function normalizeImgUrl(url: string | undefined, size: string = ''): string {
  const safeUrl = upgradeExternalHttpToHttps(url);
  if (!safeUrl) return '';

  const lower = safeUrl.toLowerCase();
  if (SAFE_DIRECT_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return safeUrl;
  }

  if (safeUrl.includes('thumbnail')) {
    if (!size) return safeUrl;
    return safeUrl.replace(/thumbnail=\d+y\d+(?!.*thumbnail)/, `thumbnail=${size}`);
  }

  if (!size) return safeUrl;
  if (safeUrl.includes('?')) {
    if (/[?&]param=/i.test(safeUrl)) return safeUrl;
    return `${safeUrl}&param=${size}`;
  }
  return `${safeUrl}?param=${size}`;
}
