import { isAndroid, saveImageViaNativeBridge } from '@/utils/androidBridge';

/**
 * 将 Base64 PNG 二维码保存到系统相册（原生端写 MediaStore Pictures，Web/PWA 触发下载）
 */
export async function saveQrImageToGallery(
  filenamePrefix: string,
  dataUrl: string
): Promise<{ ok: boolean; message: string }> {
  const cleanUrl = String(dataUrl || '').trim();
  if (!cleanUrl) {
    return { ok: false, message: '二维码尚未生成，请稍后再试' };
  }

  const filename = `${filenamePrefix}-${Date.now()}.png`;
  if (isAndroid()) {
    const res = await saveImageViaNativeBridge(filename, cleanUrl);
    if (res.success) {
      return { ok: true, message: '已保存二维码到系统相册' };
    }
    return { ok: false, message: res.error || '保存二维码失败' };
  }

  try {
    const link = document.createElement('a');
    link.href = cleanUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return { ok: true, message: '已下载二维码图片，请使用对应 App 扫一扫' };
  } catch {
    return { ok: false, message: '浏览器暂不支持直接下载，请长按二维码保存' };
  }
}

/**
 * 安全唤起外部音乐/社交客户端或应用包名（仅允许常见白名单 Scheme）
 */
export function launchExternalAppScheme(schemeUrl: string): void {
  const raw = String(schemeUrl || '').trim();
  if (!raw || typeof window === 'undefined') return;
  if (!/^(https?|orpheus|bilibili|mqqapi|qqmusic):\/\//i.test(raw)) return;

  if (typeof window.AlgerAndroid?.openExternalUrl === 'function') {
    window.AlgerAndroid.openExternalUrl(raw);
    return;
  }

  try {
    window.location.href = raw;
  } catch {
    // ignore
  }
}
