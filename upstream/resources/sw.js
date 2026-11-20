// 小庞奶娃音乐 - 轻量 PWA Service Worker（仅在 Web / iPhone Safari PWA 模式下启用）
const CACHE_NAME = 'xiaopang-naiwa-pwa-v1';
const CORE_ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 跳过跨域 API、音频流和本地回环接口，仅缓存同源静态前端资源
  if (url.origin !== self.location.origin) return;
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (/\.(js|css|png|jpg|jpeg|svg|woff2?|ttf|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
