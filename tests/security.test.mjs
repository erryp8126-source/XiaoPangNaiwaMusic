import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const syncCryptoMod = await import(
  pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/syncCrypto.ts")).href
);
const musicApiMod = await import(
  pathToFileURL(path.join(repoRoot, "netlify/functions/music-api.mts")).href
);
const musicApiHandler = musicApiMod.default;
const musicApiConfig = musicApiMod.config;
const safeFetchWithRedirects = musicApiMod.safeFetchWithRedirects;

const TRUSTED_ORIGIN = "https://erryp8126-source.github.io";

test("syncCrypto: rejects cyclic sequences, any-length pure digits, short codes, and weak codes", () => {
  const weakCodes = [
    "123456",
    "12345678",
    "123456789012",
    "098765432109",
    "7890123456",
    "13579246801357",
    "87654321",
    "aaaaaaaaaa",
    "password12",
    "ABCDEFGH",
    "ABCDEFGHIJ",
    "A1234567890",
    "A1B2C3D4E", // 9 chars < 10
    "onlylettersxx",
    "xiaopang",
  ];
  for (const code of weakCodes) {
    const res = syncCryptoMod.validateSyncCode(code);
    assert.equal(res.valid, false, `Expected weak code "${code}" to be rejected`);
  }
});

test("syncCrypto: accepts strong generated and 10+ char alphanumeric codes", () => {
  const generated = syncCryptoMod.generateFriendlySyncCode();
  assert.match(generated, /^NAIWA-\d{4}-[2-9A-HJ-NP-Z]{6}$/);
  for (const code of [generated, "NAIWA-7392-K8M4", "MyNaiwa2026!"]) {
    const res = syncCryptoMod.validateSyncCode(code);
    assert.equal(res.valid, true, `Expected strong code "${code}" to be accepted: ${res.reason}`);
  }
});

test("syncCrypto: AES-256-GCM v2 (100k PBKDF2) round-trip and wrong-code rejection", async () => {
  const code = syncCryptoMod.generateFriendlySyncCode();
  const payload = JSON.stringify({ schema: "xiaopang-music-sync-v1", songs: [1, 2, 3] });
  const encrypted = await syncCryptoMod.encryptSyncPayload(payload, code);
  const env = JSON.parse(encrypted);

  assert.equal(env.v, 2);
  assert.equal(env.enc, "aes-gcm");
  assert.equal(env.iter, 100000);
  assert.ok(env.iv && env.ct);

  const decrypted = await syncCryptoMod.decryptSyncPayload(encrypted, code);
  assert.equal(decrypted, payload);

  await assert.rejects(
    () => syncCryptoMod.decryptSyncPayload(encrypted, "NAIWA-9999-ZZZZZZ"),
    "Decrypting with a wrong sync code must fail"
  );
});

test("syncCrypto: backward-compatible decryption of legacy v1 AES-GCM (15k PBKDF2), rejects xor-sha256 & plaintext", async () => {
  const code = "NAIWA-7392-K8M4";
  const plain = JSON.stringify({ legacy: true });
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("xiaopang-naiwa-aes-salt-v1"), iterations: 15000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const legacyEnvelope = JSON.stringify({
    v: 1,
    enc: "aes-gcm",
    iv: Buffer.from(iv).toString("base64"),
    ct: Buffer.from(ct).toString("base64"),
  });
  const decrypted = await syncCryptoMod.decryptSyncPayload(legacyEnvelope, code);
  assert.equal(decrypted, plain);

  const xorEnvelope = JSON.stringify({ v: 1, enc: "xor-sha256", ct: "AAAA" });
  await assert.rejects(
    () => syncCryptoMod.decryptSyncPayload(xorEnvelope, code),
    /已废弃|旧版|新口令/
  );

  const plaintextPayload = JSON.stringify({ schema: "xiaopang-music-sync-v1", updatedAt: 1 });
  await assert.rejects(
    () => syncCryptoMod.decryptSyncPayload(plaintextPayload, code),
    /已废弃|旧版|新口令/
  );
});

test("music-api: enforces strict Origin/Referer allowlist and dev-only localhost", async () => {
  const prevDev = process.env.NETLIFY_DEV;
  const prevSecret = process.env.APP_API_SECRET;
  delete process.env.NETLIFY_DEV;
  delete process.env.APP_API_SECRET;

  try {
    // Missing both Origin & Referer => 403
    const missingBoth = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health"),
      {}
    );
    assert.equal(missingBoth.status, 403);
    assert.equal(missingBoth.headers.get("access-control-allow-origin"), null);

    // Evil Origin => 403
    const evilGet = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: { Origin: "https://evil.example.com" },
      }),
      {}
    );
    assert.equal(evilGet.status, 403);
    assert.equal(evilGet.headers.get("access-control-allow-origin"), null);

    // Localhost blocked in production (NETLIFY_DEV !== 'true')
    const prodLocalhost = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: { Origin: "http://localhost:5173" },
      }),
      {}
    );
    assert.equal(prodLocalhost.status, 403);

    // Localhost allowed only when NETLIFY_DEV === 'true'
    process.env.NETLIFY_DEV = "true";
    const devLocalhost = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: { Origin: "http://localhost:5173", "x-nf-client-connection-ip": "198.51.100.10" },
      }),
      {}
    );
    assert.equal(devLocalhost.status, 200);
    delete process.env.NETLIFY_DEV;

    // Missing Origin falls back to Referer origin => 200
    const refererRes = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: {
          Referer: "https://xiaopang-naiwa-music.netlify.app/home?tab=1",
          "x-nf-client-connection-ip": "198.51.100.11",
        },
      }),
      {}
    );
    assert.equal(refererRes.status, 200);
    assert.equal(
      refererRes.headers.get("access-control-allow-origin"),
      "https://xiaopang-naiwa-music.netlify.app"
    );

    // Trusted Origin => 200
    const ghPagesRes = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: { Origin: TRUSTED_ORIGIN, "x-nf-client-connection-ip": "198.51.100.12" },
      }),
      {}
    );
    assert.equal(ghPagesRes.status, 200);
    assert.equal(ghPagesRes.headers.get("access-control-allow-origin"), TRUSTED_ORIGIN);
    assert.equal(ghPagesRes.headers.get("access-control-allow-credentials"), "true");
  } finally {
    if (prevDev !== undefined) process.env.NETLIFY_DEV = prevDev;
    else delete process.env.NETLIFY_DEV;
    if (prevSecret !== undefined) process.env.APP_API_SECRET = prevSecret;
    else delete process.env.APP_API_SECRET;
  }
});

test("music-api: enforces APP_API_SECRET auth (API key & HMAC) and per-IP window rate limiting", async () => {
  const prevSecret = process.env.APP_API_SECRET;
  const prevMax = process.env.RATE_LIMIT_MAX;
  const prevWin = process.env.RATE_LIMIT_WINDOW_SEC;

  try {
    process.env.APP_API_SECRET = "test-super-secret-key-2026";
    process.env.RATE_LIMIT_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_SEC = "60";

    // Missing secret => 401
    const noCred = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: { Origin: TRUSTED_ORIGIN, "x-nf-client-connection-ip": "203.0.113.50" },
      }),
      {}
    );
    assert.equal(noCred.status, 401);

    // Direct API key => 200 (1/2)
    const okKey = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: {
          Origin: TRUSTED_ORIGIN,
          "X-App-Api-Key": "test-super-secret-key-2026",
          "x-nf-client-connection-ip": "203.0.113.50",
        },
      }),
      {}
    );
    assert.equal(okKey.status, 200);

    // HMAC-SHA256 signature => 200 (2/2)
    const ts = String(Date.now());
    const sig = crypto
      .createHmac("sha256", "test-super-secret-key-2026")
      .update(`${ts}:GET:/health`)
      .digest("hex");
    const okHmac = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: {
          Origin: TRUSTED_ORIGIN,
          "X-App-Timestamp": ts,
          "X-App-Signature": sig,
          "x-nf-client-connection-ip": "203.0.113.50",
        },
      }),
      {}
    );
    assert.equal(okHmac.status, 200);

    // 3rd request from same IP within window => 429 Too Many Requests
    const limited = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        headers: {
          Origin: TRUSTED_ORIGIN,
          "X-App-Api-Key": "test-super-secret-key-2026",
          "x-nf-client-connection-ip": "203.0.113.50",
        },
      }),
      {}
    );
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  } finally {
    if (prevSecret !== undefined) process.env.APP_API_SECRET = prevSecret;
    else delete process.env.APP_API_SECRET;
    if (prevMax !== undefined) process.env.RATE_LIMIT_MAX = prevMax;
    else delete process.env.RATE_LIMIT_MAX;
    if (prevWin !== undefined) process.env.RATE_LIMIT_WINDOW_SEC = prevWin;
    else delete process.env.RATE_LIMIT_WINDOW_SEC;
  }
});

test("music-api: blocks unlisted NetEase routes, oversized payloads, and invalid unblock ids", async () => {
  const prevSecret = process.env.APP_API_SECRET;
  delete process.env.APP_API_SECRET;

  try {
    const baseHeaders = { Origin: TRUSTED_ORIGIN, "x-nf-client-connection-ip": "198.51.100.99" };

    const unlisted = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/activate/init/profile", {
        headers: baseHeaders,
      }),
      {}
    );
    assert.equal(unlisted.status, 404);

    const badMethod = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
        method: "DELETE",
        headers: baseHeaders,
      }),
      {}
    );
    assert.equal(badMethod.status, 405);

    const hugeBody = "x".repeat(70 * 1024);
    const oversized = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/playlist/create", {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: hugeBody,
      }),
      {}
    );
    assert.equal(oversized.status, 413);

    const badMusicId = await musicApiHandler(
      new Request("https://xiaopang-naiwa-music.netlify.app/api/music?id=../../etc/passwd", {
        headers: baseHeaders,
      }),
      {}
    );
    assert.equal(badMusicId.status, 400);

    assert.ok(musicApiConfig?.rateLimit?.windowLimit > 0, "Netlify rateLimit must be configured");
  } finally {
    if (prevSecret !== undefined) process.env.APP_API_SECRET = prevSecret;
  }
});

test("music-api: strips caller-supplied proxy and realIP params (query + JSON body + case variants) at runtime", async () => {
  const prevSecret = process.env.APP_API_SECRET;
  delete process.env.APP_API_SECRET;

  const ncmApi = require("netease-cloud-music-api-alger");
  const originalSearchDefault = ncmApi.search_default;
  let capturedCallParams = null;

  ncmApi.search_default = async (callParams) => {
    capturedCallParams = { ...callParams };
    return { status: 200, body: { code: 200, data: { showKeyword: "ok" } }, cookie: [] };
  };

  try {
    const res = await musicApiHandler(
      new Request(
        "https://xiaopang-naiwa-music.netlify.app/api/search/default?proxy=http://127.0.0.1:8888&realIP=127.0.0.1&PROXY=http://10.0.0.1&realip=169.254.169.254&cookie=MUSIC_A=unit_test_token",
        {
          method: "POST",
          headers: {
            Origin: TRUSTED_ORIGIN,
            "Content-Type": "application/json",
            "x-nf-client-connection-ip": "198.51.100.77",
          },
          body: JSON.stringify({
            proxy: "socks5://127.0.0.1:1080",
            realIP: "169.254.169.254",
            keywords: "周杰伦",
          }),
        }
      ),
      {}
    );

    assert.equal(res.status, 200);
    assert.ok(capturedCallParams, "search_default handler should have been invoked");
    assert.equal(capturedCallParams.proxy, undefined, "proxy query/body param must be stripped");
    assert.equal(capturedCallParams.PROXY, undefined, "uppercase PROXY param must be stripped");
    assert.equal(capturedCallParams.realip, undefined, "lowercase realip param must be stripped");
    assert.equal(
      capturedCallParams.realIP,
      "116.25.146.177",
      "realIP must be forced to server DEFAULT_CN_IP rather than caller-supplied value"
    );
    assert.equal(capturedCallParams.keywords, "周杰伦", "legitimate params must remain intact");
  } finally {
    ncmApi.search_default = originalSearchDefault;
    if (prevSecret !== undefined) process.env.APP_API_SECRET = prevSecret;
  }
});

test("SSRF redirect guard: local HTTP server 302 -> http://127.0.0.1 and metadata IP are blocked at runtime", async () => {
  let secretHits = 0;
  let lastCrossHostHeaders = null;

  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    if (u.pathname === "/redirect-loopback") {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/ssrf-secret` });
      res.end();
      return;
    }
    if (u.pathname === "/redirect-metadata") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (u.pathname === "/redirect-unlisted") {
      res.writeHead(302, { Location: "https://evil.example.com/exfiltrate" });
      res.end();
      return;
    }
    if (u.pathname.startsWith("/hop/")) {
      const hop = Number(u.pathname.split("/")[2] || "0");
      res.writeHead(302, { Location: `http://music-api.gdstudio.xyz/hop/${hop + 1}` });
      res.end();
      return;
    }
    if (u.pathname === "/redirect-cross-host") {
      res.writeHead(302, { Location: "http://m7.music.126.net/ok-track" });
      res.end();
      return;
    }
    if (u.pathname === "/ok-track") {
      lastCrossHostHeaders = { ...req.headers };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (u.pathname === "/ssrf-secret") {
      secretHits += 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("SENSITIVE_INTERNAL_DATA");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert.ok(port > 0, "Temporary local test server must bind a valid port");

  // 路由白名单域名到本地模拟测试服务，但保留真实 IP 校验与非白名单/内网地址判定
  const simulatedDnsLookup = async (hostname) => {
    if (hostname === "music-api.gdstudio.xyz" || hostname === "m7.music.126.net") {
      return [{ address: "93.184.216.34", family: 4 }];
    }
    if (hostname === "rebind.gdstudio.xyz") {
      return [{ address: "127.0.0.1", family: 4 }];
    }
    return [{ address: "93.184.216.34", family: 4 }];
  };

  const localRoutedFetch = (url, init) => {
    const parsed = new URL(String(url));
    const localTarget = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
    return fetch(localTarget, init);
  };

  try {
    // 1. Direct loopback URL blocked immediately
    await assert.rejects(
      () => safeFetchWithRedirects(`http://127.0.0.1:${port}/ssrf-secret`),
      /SSRF blocked/
    );
    assert.equal(secretHits, 0);

    // 2. Allowed upstream returning real HTTP 302 -> http://127.0.0.1:<port>/ssrf-secret MUST be blocked
    await assert.rejects(
      () =>
        safeFetchWithRedirects(
          "http://music-api.gdstudio.xyz/redirect-loopback",
          {},
          { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
        ),
      /SSRF blocked/
    );
    assert.equal(secretHits, 0, "Redirect target http://127.0.0.1 must NEVER be requested");

    // 3. Allowed upstream returning 302 -> cloud metadata 169.254.169.254 MUST be blocked
    await assert.rejects(
      () =>
        safeFetchWithRedirects(
          "http://music-api.gdstudio.xyz/redirect-metadata",
          {},
          { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
        ),
      /SSRF blocked/
    );

    // 4. Allowed upstream returning 302 -> unlisted external host MUST be blocked
    await assert.rejects(
      () =>
        safeFetchWithRedirects(
          "http://music-api.gdstudio.xyz/redirect-unlisted",
          {},
          { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
        ),
      /SSRF blocked/
    );

    // 5. DNS rebinding where allowlisted domain resolves to 127.0.0.1 MUST be blocked
    await assert.rejects(
      () =>
        safeFetchWithRedirects(
          "http://rebind.gdstudio.xyz/ok-track",
          {},
          { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
        ),
      /SSRF blocked.*non-public IP/
    );

    // 6. Redirect loop exceeding maxRedirects (3 hops) MUST be blocked
    await assert.rejects(
      () =>
        safeFetchWithRedirects(
          "http://music-api.gdstudio.xyz/hop/0",
          {},
          { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
        ),
      /exceeded maximum redirect hops/
    );

    // 7. Legitimate 302 across allowlisted domains succeeds AND strips Authorization/Cookie headers
    const okResp = await safeFetchWithRedirects(
      "http://music-api.gdstudio.xyz/redirect-cross-host",
      {
        headers: {
          Authorization: "Bearer super-secret",
          Cookie: "MUSIC_U=secret_cookie",
          "X-Custom-Safe": "keep-me",
        },
      },
      { dnsLookup: simulatedDnsLookup, fetchImpl: localRoutedFetch }
    );
    assert.equal(okResp.status, 200);
    assert.equal(lastCrossHostHeaders?.authorization, undefined, "Authorization must be stripped cross-host");
    assert.equal(lastCrossHostHeaders?.cookie, undefined, "Cookie must be stripped cross-host");
    assert.equal(lastCrossHostHeaders?.["x-custom-safe"], "keep-me");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("repo security invariants: P0 local file narrowing, fail-closed tokens, SSRF redirect guards, Supabase rate-limits, CI", () => {
  // 1. Android local file narrowing & LocalAudioRegistry & playback SSRF Dns
  const androidServer = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/EmbeddedHttpServer.kt"),
    "utf-8"
  );
  assert.match(androidServer, /x-alger-token/);
  assert.match(androidServer, /if\s*\(authToken\.isBlank\(\)\)\s*return\s+false/);
  assert.match(androidServer, /DIRECTORY_MUSIC/);
  assert.match(androidServer, /DIRECTORY_DOWNLOADS/);
  assert.match(androidServer, /LocalAudioRegistry/);
  assert.match(androidServer, /\^content:\/\/media\/external\/audio\/media\/\\\\d\+\$/);
  assert.doesNotMatch(androidServer, /getExternalStorageDirectory/);
  assert.doesNotMatch(androidServer, /session\.headers\["origin"\]\s*\?:\s*"\*"/);
  assert.equal(
    fs.existsSync(path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/local/LocalAudioRegistry.kt")),
    true
  );

  // 2. iOS Fail-Closed token & startup order
  const iosServer = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/LocalHttpServer.swift"),
    "utf-8"
  );
  assert.match(iosServer, /guard\s+!authToken\.isEmpty\s+else\s*\{\s*return\s+false\s*\}/);
  assert.doesNotMatch(iosServer, /if\s+authToken\.isEmpty\s*\{\s*return\s+true\s*\}/);
  assert.doesNotMatch(iosServer, /req\.headers\["origin"\]\s*\?\?\s*"\*"/);

  const iosMainVc = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  assert.ok(
    iosMainVc.indexOf("services.httpServer.ensureAlive()") < iosMainVc.indexOf("setupWebView()"),
    "MainViewController must ensure LocalHttpServer is ready before setupWebView()"
  );

  // 3. Android & iOS SSRF redirect guards + domain allowlists + playback public-IP Dns
  const androidGuard = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/SafeHttpGuard.kt"),
    "utf-8"
  );
  assert.match(androidGuard, /InetAddress\.getAllByName/);
  assert.match(androidGuard, /isMulticastAddress/);
  assert.match(androidGuard, /executeWithSafeRedirects/);
  assert.match(androidGuard, /fun createPublicIpOnlyDns/);

  const androidPlayback = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/player/MusicPlaybackService.kt"),
    "utf-8"
  );
  assert.match(
    androidPlayback,
    /\.dns\(SafeHttpGuard\.createPublicIpOnlyDns\(\)\)/,
    "MusicPlaybackService httpClient must attach public-IP Dns guard"
  );

  for (const ktPath of [
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/MusicUnblockEngine.kt",
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/NeteaseApiClient.kt",
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/download/NativeDownloadManager.kt",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, ktPath), "utf-8");
    assert.match(src, /followRedirects\(false\)/, `${ktPath} must disable automatic redirects`);
    assert.match(src, /followSslRedirects\(false\)/, `${ktPath} must disable automatic SSL redirects`);
    assert.match(src, /SafeHttpGuard\.executeWithSafeRedirects/, `${ktPath} must use SafeHttpGuard`);
  }

  const iosGuard = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/SafeHttpGuard.swift"),
    "utf-8"
  );
  assert.match(iosGuard, /getaddrinfo/);
  assert.match(iosGuard, /willPerformHTTPRedirection/);

  for (const swiftPath of [
    "ios/XiaoPangNaiwaMusic/Server/MusicUnblockEngine.swift",
    "ios/XiaoPangNaiwaMusic/Server/NeteaseApiClient.swift",
    "ios/XiaoPangNaiwaMusic/Storage/LocalMusicAndDownloadManager.swift",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, swiftPath), "utf-8");
    assert.match(src, /SafeRedirectSessionDelegate/, `${swiftPath} must attach SafeRedirectSessionDelegate`);
  }

  // 5. Supabase server-side rate limits
  const schemaSql = fs.readFileSync(path.join(repoRoot, "sync-server/supabase/schema.sql"), "utf-8");
  assert.match(schemaSql, /create table if not exists public\.sync_rate_limits/i);
  assert.match(schemaSql, /alter table public\.sync_rate_limits enable row level security/i);
  assert.match(schemaSql, /revoke all on table public\.sync_rate_limits from public, anon, authenticated/i);
  assert.match(schemaSql, /x-forwarded-for/i);
  assert.match(schemaSql, /rate_limit_exceeded/i);

  // CI, build hardening, package migration & repo hygiene invariants
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/build-dual-platform.yml"),
    "utf-8"
  );
  assert.match(workflow, /^permissions:\r?\n\s+contents: read$/m);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.equal(fs.existsSync(path.join(repoRoot, "ci")), false, "Dead ci/ directory must remain removed");
  assert.equal(
    fs.existsSync(path.join(repoRoot, "upstream/package-lock.json")),
    true,
    "upstream/package-lock.json must exist for reproducible npm ci"
  );
  const upstreamGitignore = fs.readFileSync(path.join(repoRoot, "upstream/.gitignore"), "utf-8");
  assert.doesNotMatch(upstreamGitignore, /^package-lock\.json$/m);
  const netlifyTomlBuf = fs.readFileSync(path.join(repoRoot, "netlify.toml"));
  assert.notEqual(netlifyTomlBuf[0], 0xef, "netlify.toml must not start with UTF-8 BOM");
  assert.match(netlifyTomlBuf.toString("utf-8"), /\bnpm ci\b/);
  assert.equal(fs.existsSync(path.join(repoRoot, ".github/dependabot.yml")), true);

  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  assert.match(rootPkg.engines?.node || "", />=22\.6/, "package.json engines.node must specify >=22.6");

  const gradleKts = fs.readFileSync(path.join(repoRoot, "android/app/build.gradle.kts"), "utf-8");
  assert.match(gradleKts, /namespace\s*=\s*"com\.xiaopang\.naiwamusic"/);
  assert.match(gradleKts, /applicationId\s*=\s*"com\.xiaopang\.naiwamusic"/);
  assert.match(gradleKts, /isMinifyEnabled\s*=\s*true/);
  assert.match(gradleKts, /isShrinkResources\s*=\s*true/);
  assert.match(gradleKts, /GradleException/);

  const manifestXml = fs.readFileSync(path.join(repoRoot, "android/app/src/main/AndroidManifest.xml"), "utf-8");
  assert.match(manifestXml, /android:name="\.NaiwaApp"/);
  assert.match(manifestXml, /Theme\.XiaoPangNaiwaMusic/);

  const iosProjectYml = fs.readFileSync(path.join(repoRoot, "ios/project.yml"), "utf-8");
  assert.match(iosProjectYml, /bundleIdPrefix:\s*com\.xiaopang/);
  assert.match(iosProjectYml, /PRODUCT_BUNDLE_IDENTIFIER:\s*com\.xiaopang\.naiwamusic/);

  const iosStats = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Player/ListeningStatsTracker.swift"),
    "utf-8"
  );
  assert.match(iosStats, /xiaopang_listening_stats_v1/);
  assert.match(iosStats, /alger_listening_stats_v1/, "Must preserve legacy key migration for existing iOS users");
});

test("builtin music sources & de-branding: no obfuscated black-box script, default pyncmd, no plaintext donate links", () => {
  const obfuscatedPath = path.join(repoRoot, "upstream/src/renderer/assets/lx-sources/lx-yuningxi-pro.js");
  assert.equal(fs.existsSync(obfuscatedPath), false, "Obfuscated lx-yuningxi-pro.js must be removed");

  const setJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "upstream/src/main/set.json"), "utf-8"));
  assert.ok(setJson.enabledMusicSources.includes("pyncmd"), "set.json must enable pyncmd by default");
  assert.equal(
    setJson.enabledMusicSources.includes("lxMusic"),
    false,
    "set.json should not force-enable lxMusic without user-imported script"
  );

  const upstreamPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "upstream/package.json"), "utf-8"));
  assert.equal(upstreamPkg.name, "xiaopang-naiwa-music");
  assert.equal(upstreamPkg.homepage, "https://github.com/erryp8126-source/XiaoPangNaiwaMusic");
  assert.equal(upstreamPkg.build?.publish?.[0]?.owner, "erryp8126-source");
  assert.equal(upstreamPkg.build?.publish?.[0]?.repo, "XiaoPangNaiwaMusic");
  assert.equal(upstreamPkg.overrides?.["basic-ftp"], "^6.2.6");

  for (const removedLegacyFile of [
    "upstream/src/renderer/api/donation.ts",
    "upstream/src/renderer/components/Coffee.vue",
    "upstream/src/renderer/components/TrafficWarningDrawer.vue",
    "upstream/src/renderer/components/common/DonationList.vue",
    "upstream/src/renderer/views/set/tabs/DonationTab.vue",
    "upstream/src/renderer/assets/alipay.png",
    "upstream/src/renderer/assets/wechat.png",
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, removedLegacyFile)),
      false,
      `${removedLegacyFile} must be removed`
    );
  }

  for (const relPath of [
    "upstream/src/renderer/components/common/MobileUpdateModal.vue",
    "upstream/src/shared/appUpdate.ts",
    "upstream/src/renderer/layout/components/SearchBar.vue",
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
    assert.doesNotMatch(text, /donate\.alger\.fun/i, `${relPath} must not contain donate.alger.fun`);
    assert.doesNotMatch(text, /algerkong\/AlgerMusicPlayer/i, `${relPath} must not point to upstream repo`);
  }

  const searchBar = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/layout/components/SearchBar.vue"),
    "utf-8"
  );
  assert.doesNotMatch(searchBar, /<coffee|Coffee\.vue|alipay\.png|wechat\.png/i);
  assert.match(searchBar, /@click="toGithub"/);

  const playerCoreSrc = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playerCore.ts"),
    "utf-8"
  );
  assert.match(playerCoreSrc, /document\.title\s*=\s*'小庞奶娃音乐 - '\s*\+\s*title/);
  assert.doesNotMatch(playerCoreSrc, /document\.title\s*=\s*'AlgerMusic - '/);

  const androidUnblock = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/MusicUnblockEngine.kt"),
    "utf-8"
  );
  assert.match(androidUnblock, /private fun searchPyncmd/);
  assert.match(androidUnblock, /listOf\("pyncmd"/);

  const iosUnblock = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/MusicUnblockEngine.swift"),
    "utf-8"
  );
  assert.match(iosUnblock, /private func searchPyncmd/);
  assert.match(iosUnblock, /\["pyncmd"/);
});

test("batch 3 invariants: iOS download delegate, local picker & SHA-256 IDs, intelligence mode, capability flags, modular splits", () => {
  // 1. iOS async URLSessionDownloadDelegate + CryptoKit SHA-256 + separate totalFiles/supportedFiles
  const iosStorage = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Storage/LocalMusicAndDownloadManager.swift"),
    "utf-8"
  );
  assert.doesNotMatch(iosStorage, /DispatchSemaphore/, "iOS download manager must not block with DispatchSemaphore");
  assert.match(iosStorage, /URLSessionDownloadDelegate/);
  assert.match(iosStorage, /totalBytesExpectedToWrite/);
  assert.match(iosStorage, /import CryptoKit/);
  assert.match(iosStorage, /SHA256\.hash/);
  assert.doesNotMatch(iosStorage, /path\.hashValue/, "Must not use unstable Swift path.hashValue for persistent IDs");
  assert.match(iosStorage, /"totalFiles":\s*totalFiles/);
  assert.match(iosStorage, /"supportedFiles":\s*files\.count/);
  assert.match(iosStorage, /func importPickedAudioUrls/);

  // 2. iOS UIDocumentPickerViewController for local audio + explicit capability flags (no empty EQ break)
  const iosBridge = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridge, /supportsEq:\s*false/);
  assert.match(iosBridge, /supportsFloatingLyric:\s*false/);
  assert.match(iosBridge, /supportsBatteryOptimization:\s*false/);
  assert.match(iosBridge, /getCapabilities:/);
  assert.match(iosBridge, /onPickLocalAudioSources/);
  assert.doesNotMatch(iosBridge, /case "eqSetEnabled", "eqSetBandGain", "eqReset":/);

  const iosMainVc = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  assert.match(iosMainVc, /presentLocalAudioPicker/);
  assert.match(iosMainVc, /\[\.audio,\s*\.folder\]/);

  // 3. iOS intelligence mode (nativePlayMode == 3)
  const iosPlayer = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Player/AudioPlayerManager.swift"),
    "utf-8"
  );
  assert.match(iosPlayer, /playModeSnapshot == 3/);
  assert.match(iosPlayer, /fetchNativeIntelligenceSongs/);
  assert.match(iosPlayer, /intelligence-refill/);

  // 4. Android bridge capability declaration + frontend capability gating
  const androidBridgeKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/bridge/AndroidJsBridge.kt"),
    "utf-8"
  );
  assert.match(androidBridgeKt, /fun getCapabilities\(\): String/);

  for (const vuePath of [
    "upstream/src/renderer/views/set/tabs/PlaybackTab.vue",
    "upstream/src/renderer/views/set/tabs/NetworkTab.vue",
    "upstream/src/renderer/components/player/MobilePlayerSettings.vue",
    "upstream/src/renderer/components/player/AdvancedControlsPopover.vue",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, vuePath), "utf-8");
    assert.match(src, /getNativeCapabilities/, `${vuePath} must check platform capabilities`);
  }

  // 5. Large-file splits verified
  for (const splitFile of [
    "upstream/src/renderer/utils/bridge/types.ts",
    "upstream/src/renderer/utils/bridge/core.ts",
    "upstream/src/renderer/utils/bridge/ipcAdapter.ts",
    "upstream/src/renderer/utils/bridge/nativeHowl.ts",
    "upstream/src/renderer/utils/bridge/windowApi.ts",
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/lyric/LyricParser.kt",
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/lyric/FloatingLyricViews.kt",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, splitFile)), true, `${splitFile} must exist`);
  }
});

test("phase 1 runtime: coverColorExtractor dark-mode contrast >= 4.5:1 & 24x24 pixel clustering", async () => {
  const extractor = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/coverColorExtractor.ts")).href
  );

  // 1. 极亮纯白与高亮霓虹黄必须被自动压暗柔化，确保暗色模式下与 #FFFFFF 对比度 >= 4.5:1
  for (const brightRgb of [
    [255, 255, 255],
    [255, 255, 0],
    [180, 255, 230],
    [255, 210, 230],
  ]) {
    const safe = extractor.constrainForDarkReadability(brightRgb, 4.5);
    const ratio = extractor.contrastRatio(safe, [255, 255, 255]);
    assert.ok(
      ratio >= 4.5,
      `Expected constrained color for ${JSON.stringify(brightRgb)} to have contrast >= 4.5:1, got ${ratio.toFixed(2)}`
    );
  }

  // 2. 构造 24x24 双色封面像素缓冲（左暖橙红 + 右青蓝）验证主/次色聚类及对比度兜底
  const pixels = new Uint8ClampedArray(24 * 24 * 4);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const idx = (y * 24 + x) * 4;
      if (x < 15) {
        pixels[idx] = 245;
        pixels[idx + 1] = 148;
        pixels[idx + 2] = 66;
      } else {
        pixels[idx] = 64;
        pixels[idx + 1] = 188;
        pixels[idx + 2] = 240;
      }
      pixels[idx + 3] = 255;
    }
  }
  const palette = extractor.extractPaletteFromPixels(pixels);
  assert.ok(palette.contrastOnWhite >= 4.5, `Primary contrast ${palette.contrastOnWhite} must be >= 4.5`);
  assert.ok(
    extractor.contrastRatio(palette.secondaryRgb, [255, 255, 255]) >= 4.5,
    "Secondary contrast must also be >= 4.5"
  );
  assert.notDeepEqual(palette.primaryRgb, palette.secondaryRgb, "Two-tone cover should yield distinct primary & secondary colors");

  // 3. 无 DOM / 空 URL 时安全返回默认暗色极光调色板
  const fallback = await extractor.extractCoverPalette("");
  assert.deepEqual(fallback, extractor.DEFAULT_DYNAMIC_PALETTE);
});

test("phase 1 runtime: playbackMeta quality/source labels and cross-platform haptics/UX invariants", async () => {
  const metaMod = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/playbackMeta.ts")).href
  );

  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ br: 999000, type: "flac", fromDiskCache: true })
    ),
    "FLAC · 本地缓存"
  );
  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ br: 320000, rawSource: "official" })
    ),
    "320k · 官方源"
  );
  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ quality: "flac", strategy: "lxMusic", rawSource: "lx-wy", fallbackFrom: "official" })
    ),
    "FLAC · LX 源"
  );
  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ br: 128000, url: "local:///Music/demo.mp3", isLocal: true })
    ),
    "128k · 本地文件"
  );
  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ url: "local:///Downloads/song.flac", isDownloaded: true })
    ),
    "FLAC · 已下载"
  );
  assert.equal(
    metaMod.formatPlaybackBadgeText(
      metaMod.buildPlaybackMeta({ br: 320000, platform: "kuwo", strategy: "unblockMusic", fallbackFrom: "official" })
    ),
    "320k · 备用源"
  );

  // Android Haptics + Audio cache bridge checks
  const androidBridgeKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/bridge/AndroidJsBridge.kt"),
    "utf-8"
  );
  assert.match(androidBridgeKt, /@JavascriptInterface[\s\S]{0,60}fun triggerHaptic\(style: String\)/);
  assert.match(androidBridgeKt, /HapticFeedbackConstants\.CLOCK_TICK/);
  assert.match(androidBridgeKt, /HapticFeedbackConstants\.CONTEXT_CLICK/);
  assert.match(androidBridgeKt, /HapticFeedbackConstants\.CONFIRM/);
  assert.doesNotMatch(
    androidBridgeKt,
    /performHapticFeedback\([^)]*FLAG_IGNORE_GLOBAL_SETTING/,
    "Android triggerHaptic must respect system vibration/haptic settings"
  );
  assert.match(androidBridgeKt, /@JavascriptInterface[\s\S]{0,60}fun isAudioCached\(/);

  // iOS Haptics bridge check (system UIKit only, zero third-party deps)
  const iosBridgeSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridgeSwift, /triggerHaptic:\s*function\(style\)/);
  assert.match(iosBridgeSwift, /UIImpactFeedbackGenerator/);
  assert.match(iosBridgeSwift, /UISelectionFeedbackGenerator/);
  assert.match(iosBridgeSwift, /UINotificationFeedbackGenerator/);

  // Frontend Haptics, Dynamic Background toggle, and Audio Meta badge wiring
  const bridgeCore = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/utils/bridge/core.ts"),
    "utf-8"
  );
  assert.match(bridgeCore, /export function triggerHaptic\(/);

  const musicFullMobile = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/lyric/MusicFullMobile.vue"),
    "utf-8"
  );
  assert.match(musicFullMobile, /extractCoverPalette/);
  assert.match(musicFullMobile, /audio-meta-pill/);
  assert.match(musicFullMobile, /triggerHaptic\(/);

  const mobilePlayBar = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/player/MobilePlayBar.vue"),
    "utf-8"
  );
  assert.match(mobilePlayBar, /extractCoverPalette/);
  assert.match(mobilePlayBar, /mini-dynamic-bg/);
  assert.match(mobilePlayBar, /triggerHaptic\(/);

  const playbackTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/PlaybackTab.vue"),
    "utf-8"
  );
  assert.match(playbackTab, /enableDynamicBackground/);
  assert.match(playbackTab, /动态背景/);

  const playerCore = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playerCore.ts"),
    "utf-8"
  );
  assert.match(playerCore, /已自动切换备用/);
});

test("phase 2 runtime: cloudSyncMerge conflict detection & smart merge prevents cross-device data loss", async () => {
  const mergeMod = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/cloudSyncMerge.ts")).href
  );

  const baseSnapshot = {
    schema: "xiaopang-music-sync-v1",
    revision: 2,
    clientUpdatedAt: 1000,
    updatedAt: 1000,
    deviceId: "dev_android_a",
    deviceName: "Android",
    favoriteList: [1001, 1002],
    dislikeList: [9001],
    customPlaylists: [
      {
        id: "pl_1",
        name: "通勤歌单",
        updatedAt: 1000,
        tracks: [{ id: 1001, name: "基础曲目" }],
      },
    ],
    playHistory: {
      musicHistory: [{ id: 1001, name: "基础曲目", count: 2, lastPlayTime: 900 }],
      playlistHistory: [],
      albumHistory: [],
      podcastHistory: [],
      podcastRadioHistory: [],
    },
    listeningStats: {
      totalSeconds: 600,
      dailySeconds: { "2026-11-21": 600 },
      hourlySeconds: Array.from({ length: 24 }, (_, i) => (i === 20 ? 600 : 0)),
      songs: {
        "1001": { id: "1001", name: "基础曲目", artist: "歌手甲", cover: "", seconds: 600, plays: 2 },
      },
      artists: { 歌手甲: 600 },
    },
    preferences: {
      updatedAt: 1000,
      data: { crossfadeEnabled: false, crossfadeDurationSec: 1.5, volumeNormalizationEnabled: false },
    },
  };

  const baselineDigest = mergeMod.computeSyncSnapshotDigest(baseSnapshot);

  // Device A (local) concurrently adds favorite 2001, playlist track 2001, history 2001, older prefs ts=2000
  const localDeviceA = {
    ...baseSnapshot,
    revision: 2,
    clientUpdatedAt: 2000,
    updatedAt: 2000,
    deviceId: "dev_android_a",
    deviceName: "Android",
    favoriteList: [1001, 1002, 2001],
    customPlaylists: [
      {
        id: "pl_1",
        name: "通勤歌单",
        updatedAt: 2000,
        tracks: [
          { id: 1001, name: "基础曲目" },
          { id: 2001, name: "设备A新增收藏" },
        ],
      },
    ],
    playHistory: {
      ...baseSnapshot.playHistory,
      musicHistory: [
        { id: 2001, name: "设备A新增收藏", count: 1, lastPlayTime: 2000 },
        { id: 1001, name: "基础曲目", count: 4, lastPlayTime: 1800 },
      ],
    },
    listeningStats: {
      totalSeconds: 900,
      dailySeconds: { "2026-11-21": 600, "2026-11-22": 300 },
      hourlySeconds: Array.from({ length: 24 }, (_, i) => (i === 20 ? 600 : i === 9 ? 300 : 0)),
      songs: {
        "1001": { id: "1001", name: "基础曲目", artist: "歌手甲", cover: "", seconds: 720, plays: 4 },
        "2001": { id: "2001", name: "设备A新增收藏", artist: "歌手A", cover: "", seconds: 180, plays: 1 },
      },
      artists: { 歌手甲: 720, 歌手A: 180 },
    },
    preferences: {
      updatedAt: 2000,
      data: { crossfadeEnabled: false, crossfadeDurationSec: 1.5, volumeNormalizationEnabled: false },
    },
  };

  // Device B (remote) concurrently adds favorite 3001, playlist track 3001 + new pl_2, history 3001, newer prefs ts=3000
  const remoteDeviceB = {
    ...baseSnapshot,
    revision: 3,
    clientUpdatedAt: 3000,
    updatedAt: 3000,
    deviceId: "dev_ios_b",
    deviceName: "iOS",
    favoriteList: [1001, 1002, 3001],
    dislikeList: [9001, 9002],
    customPlaylists: [
      {
        id: "pl_1",
        name: "通勤歌单（已改名）",
        updatedAt: 3000,
        tracks: [
          { id: 1001, name: "基础曲目" },
          { id: 3001, name: "设备B新增收藏" },
        ],
      },
      {
        id: "pl_2",
        name: "夜跑歌单",
        updatedAt: 3000,
        tracks: [{ id: 3002, name: "夜跑节奏" }],
      },
    ],
    playHistory: {
      ...baseSnapshot.playHistory,
      musicHistory: [
        { id: 3001, name: "设备B新增收藏", count: 3, lastPlayTime: 3000 },
        { id: 1001, name: "基础曲目", count: 3, lastPlayTime: 2500 },
      ],
    },
    listeningStats: {
      totalSeconds: 1100,
      dailySeconds: { "2026-11-21": 700, "2026-11-22": 400 },
      hourlySeconds: Array.from({ length: 24 }, (_, i) => (i === 20 ? 700 : i === 22 ? 400 : 0)),
      songs: {
        "1001": { id: "1001", name: "基础曲目", artist: "歌手甲", cover: "", seconds: 700, plays: 3 },
        "3001": { id: "3001", name: "设备B新增收藏", artist: "歌手B", cover: "", seconds: 400, plays: 3 },
      },
      artists: { 歌手甲: 700, 歌手B: 400 },
    },
    preferences: {
      updatedAt: 3000,
      data: { crossfadeEnabled: true, crossfadeDurationSec: 3, volumeNormalizationEnabled: true },
    },
  };

  // 1. Concurrent modifications must trigger conflict detection
  const conflict = mergeMod.detectSyncConflict({
    localSnapshot: localDeviceA,
    remoteSnapshot: remoteDeviceB,
    remoteUpdatedAt: 3000,
    lastRemoteUpdatedAt: 1000,
    lastSyncedRevision: 2,
    lastSyncedLocalDigest: baselineDigest,
    currentDeviceId: "dev_android_a",
  });
  assert.equal(conflict.hasConflict, true, "Two devices modifying concurrently must trigger conflict");
  assert.equal(conflict.reason, "concurrent-modification");

  // 2. Identical snapshots or local-only updates must NOT falsely trigger conflict
  const identicalCheck = mergeMod.detectSyncConflict({
    localSnapshot: baseSnapshot,
    remoteSnapshot: baseSnapshot,
    remoteUpdatedAt: 1000,
    lastRemoteUpdatedAt: 1000,
    lastSyncedRevision: 2,
    lastSyncedLocalDigest: baselineDigest,
    currentDeviceId: "dev_android_a",
  });
  assert.equal(identicalCheck.hasConflict, false);
  assert.equal(identicalCheck.reason, "already-identical");

  const localOnlyCheck = mergeMod.detectSyncConflict({
    localSnapshot: localDeviceA,
    remoteSnapshot: baseSnapshot,
    remoteUpdatedAt: 1000,
    lastRemoteUpdatedAt: 1000,
    lastSyncedRevision: 2,
    lastSyncedLocalDigest: baselineDigest,
    currentDeviceId: "dev_android_a",
  });
  assert.equal(localOnlyCheck.hasConflict, false);
  assert.equal(localOnlyCheck.reason, "local-only-updated");

  // 3. Smart merge preserves ALL favorites, playlist tracks, history, stats max, and newer preferences
  const merged = mergeMod.smartMergeCloudSnapshots(localDeviceA, remoteDeviceB, 4000);
  assert.equal(merged.revision, 4, "Revision must increment monotonically to max(local, remote) + 1");
  assert.equal(merged.clientUpdatedAt, 4000);

  // Favorites: union of both devices, no duplicates, zero loss
  const favSet = new Set(merged.favoriteList.map(String));
  assert.deepEqual([...favSet].sort(), ["1001", "1002", "2001", "3001"]);
  assert.equal(merged.favoriteList.length, 4);
  assert.deepEqual(merged.dislikeList.map(String).sort(), ["9001", "9002"]);

  // Custom playlists: pl_1 tracks union (1001, 2001, 3001), newer name wins, plus pl_2 preserved
  assert.equal(merged.customPlaylists.length, 2);
  const pl1 = merged.customPlaylists.find((p) => p.id === "pl_1");
  assert.ok(pl1);
  assert.equal(pl1.name, "通勤歌单（已改名）");
  assert.deepEqual(
    pl1.tracks.map((t) => String(t.id)).sort(),
    ["1001", "2001", "3001"]
  );
  assert.ok(merged.customPlaylists.find((p) => p.id === "pl_2"));

  // Play history: union of both devices, shared song retains max count & newer lastPlayTime
  const histIds = merged.playHistory.musicHistory.map((s) => String(s.id));
  assert.deepEqual([...histIds].sort(), ["1001", "2001", "3001"]);
  const song1001 = merged.playHistory.musicHistory.find((s) => s.id === 1001);
  assert.equal(song1001.count, 4);
  assert.equal(song1001.lastPlayTime, 2500);

  // Listening stats: idempotent max merge
  assert.equal(merged.listeningStats.dailySeconds["2026-11-21"], 700);
  assert.equal(merged.listeningStats.dailySeconds["2026-11-22"], 400);
  assert.equal(merged.listeningStats.hourlySeconds[9], 300);
  assert.equal(merged.listeningStats.hourlySeconds[22], 400);
  assert.equal(merged.listeningStats.songs["2001"].seconds, 180);
  assert.equal(merged.listeningStats.songs["3001"].seconds, 400);

  // Preferences: newer updatedAt (3000 from Device B > 2000 from Device A) wins
  assert.equal(merged.preferences.updatedAt, 3000);
  assert.equal(merged.preferences.data.crossfadeEnabled, true);
  assert.equal(merged.preferences.data.crossfadeDurationSec, 3);
  assert.equal(merged.preferences.data.volumeNormalizationEnabled, true);
});

test("phase 2 runtime: listeningReportCard aggregates week/month stats, peak hour, Top 5 songs & Top 3 artists", async () => {
  const reportMod = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/listeningReportCard.ts")).href
  );

  const mockStats = {
    totalSeconds: 42000,
    dailySeconds: {
      "2026-11-22": 1800,
      "2026-11-20": 3600,
      "2026-11-01": 7200, // in 30-day month window, outside 7-day week window
      "2026-09-01": 9000, // outside both windows
    },
    hourlySeconds: Array.from({ length: 24 }, (_, h) => (h === 23 ? 5400 : h === 8 ? 1200 : 0)),
    songs: {
      s1: { id: "s1", name: "晴天", artist: "周杰伦", cover: "", seconds: 3600, plays: 12 },
      s2: { id: "s2", name: "稻香", artist: "周杰伦", cover: "", seconds: 2400, plays: 9 },
      s3: { id: "s3", name: "夜曲", artist: "周杰伦", cover: "", seconds: 1800, plays: 7 },
      s4: { id: "s4", name: "富士山下", artist: "陈奕迅", cover: "", seconds: 1500, plays: 5 },
      s5: { id: "s5", name: "海阔天空", artist: "Beyond", cover: "", seconds: 1200, plays: 4 },
      s6: { id: "s6", name: "第六首应被截断", artist: "林俊杰", cover: "", seconds: 900, plays: 3 },
    },
    artists: {
      周杰伦: 7800,
      陈奕迅: 3900,
      Beyond: 1950,
      林俊杰: 900,
    },
  };

  const fixedNow = new Date(2026, 10, 22, 18, 0, 0);
  const weekSummary = reportMod.buildListeningReportSummary(mockStats, "week", fixedNow);
  assert.equal(weekSummary.periodTitle, "本周听歌报告");
  assert.equal(weekSummary.periodSeconds, 5400);
  assert.equal(weekSummary.activeDays, 2);
  assert.equal(weekSummary.peakHour, 23);
  assert.equal(weekSummary.topSongs.length, 5);
  assert.equal(weekSummary.topSongs[0].name, "晴天");
  assert.equal(weekSummary.topArtists.length, 3);
  assert.equal(weekSummary.topArtists[0].name, "周杰伦");
  assert.equal(weekSummary.topArtists[0].percent, 100);
  assert.equal(weekSummary.topArtists[1].percent, 50);
  assert.equal(weekSummary.badgeTitle, "旋律挚友");

  const monthSummary = reportMod.buildListeningReportSummary(mockStats, "month", fixedNow);
  assert.equal(monthSummary.periodTitle, "本月听歌报告");
  assert.equal(monthSummary.periodSeconds, 12600);
  assert.equal(monthSummary.activeDays, 3);
  assert.equal(reportMod.formatReportDuration(5400), "1 小时 30 分");
});

test("phase 2 invariants: Android/iOS offline IDs, crossfade & loudness, report export, and 3-choice conflict UI", () => {
  // 1. Android native Phase 2 hooks
  const androidCache = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/player/AudioCacheManager.kt"),
    "utf-8"
  );
  assert.match(androidCache, /fun getCachedSongIds\(/);

  const androidDl = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/download/NativeDownloadManager.kt"),
    "utf-8"
  );
  assert.match(androidDl, /fun getDownloadedSongIds\(/);
  assert.match(androidDl, /fun saveImageToGallery\(/);

  const androidPlayer = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/player/MusicPlaybackService.kt"),
    "utf-8"
  );
  assert.match(androidPlayer, /LoudnessEnhancer/);
  assert.match(androidPlayer, /fun setAudioEnhancement\(/);
  assert.match(androidPlayer, /animateVolumeTo\(/);

  const androidBridge = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/bridge/AndroidJsBridge.kt"),
    "utf-8"
  );
  assert.match(androidBridge, /@JavascriptInterface[\s\S]{0,60}fun getOfflinePlayableIds\(/);
  assert.match(androidBridge, /@JavascriptInterface[\s\S]{0,60}fun audioSetAudioEnhancement\(/);
  assert.match(androidBridge, /"save-image-file"/);

  // 2. iOS native Phase 2 hooks (zero third-party deps)
  const iosStorage = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Storage/LocalMusicAndDownloadManager.swift"),
    "utf-8"
  );
  assert.match(iosStorage, /func getOfflinePlayableIds\(/);
  assert.match(iosStorage, /\.xiaopang_downloads_index\.json/);

  const iosPlayer = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Player/AudioPlayerManager.swift"),
    "utf-8"
  );
  assert.match(iosPlayer, /func setAudioEnhancement\(/);
  assert.match(iosPlayer, /DispatchSourceTimer/);
  assert.match(iosPlayer, /cancelVolumeFade\(/);

  const iosBridge = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridge, /audioSetAudioEnhancement/);
  assert.match(iosBridge, /case "get-offline-playable-ids":/);
  assert.match(iosBridge, /case "save-image-file":/);

  const iosMainVc = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  assert.match(iosMainVc, /presentShareSheetForImage/);
  assert.match(iosMainVc, /UIActivityViewController/);

  const iosPlist = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Info.plist"),
    "utf-8"
  );
  assert.match(iosPlist, /NSPhotoLibraryAddUsageDescription/);

  // 3. Frontend offline banner, filter, crossfade/loudness, report card, and 3-choice sync conflict dialog
  assert.equal(
    fs.existsSync(path.join(repoRoot, "upstream/src/renderer/components/common/OfflineBanner.vue")),
    true
  );
  for (const layoutPath of [
    "upstream/src/renderer/layout/AppLayout.vue",
    "upstream/src/renderer/layout/MobileLayout.vue",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, layoutPath), "utf-8");
    assert.match(src, /OfflineBanner/);
  }
  for (const listPath of [
    "upstream/src/renderer/views/music/MusicListPage.vue",
    "upstream/src/renderer/views/mobile-search-result/index.vue",
    "upstream/src/renderer/views/search/SearchResult.vue",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, listPath), "utf-8");
    assert.match(src, /仅看离线可播/);
  }

  const playbackTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/PlaybackTab.vue"),
    "utf-8"
  );
  assert.match(playbackTab, /crossfadeEnabled/);
  assert.match(playbackTab, /volumeNormalizationEnabled/);

  const statsPanel = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/stats/ListeningStatsPanel.vue"),
    "utf-8"
  );
  assert.match(statsPanel, /renderListeningReportCanvas/);
  assert.match(statsPanel, /生成报告卡/);

  const cloudSyncTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/CloudSyncTab.vue"),
    "utf-8"
  );
  assert.match(cloudSyncTab, /智能合并（推荐）/);
  assert.match(cloudSyncTab, /以云端为准/);
  assert.match(cloudSyncTab, /覆盖云端/);
});

test("phase 2.5 runtime: playbackDiagnostics failure explanations & strict <= 2 retry cap", async () => {
  const diag = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/playbackDiagnostics.ts")).href
  );

  assert.equal(diag.MAX_SINGLE_TRACK_RETRIES, 2, "Single-track retry cap must be strictly <= 2");

  const offlineRes = diag.classifyPlaybackFailure({ isOffline: true });
  assert.equal(offlineRes.code, "offline");
  assert.equal(offlineRes.shouldRetry, false);
  assert.equal(diag.shouldRetrySingleTrack(0, offlineRes.code), false);

  const timeoutRes = diag.classifyPlaybackFailure({ error: new Error("Request timeout ETIMEDOUT"), hasUrl: true });
  assert.equal(timeoutRes.code, "timeout");
  assert.equal(timeoutRes.userMessage, "网络超时，请检查连接");
  assert.equal(diag.shouldRetrySingleTrack(0, timeoutRes.code), true);
  assert.equal(diag.shouldRetrySingleTrack(1, timeoutRes.code), true);
  assert.equal(diag.shouldRetrySingleTrack(2, timeoutRes.code), false, "Must stop retrying once count reaches 2");

  const noSourceRes = diag.classifyPlaybackFailure({ hasUrl: false });
  assert.equal(noSourceRes.code, "no-source");
  assert.equal(noSourceRes.userMessage, "该歌曲暂无可播放的可用音源");
  assert.equal(diag.shouldRetrySingleTrack(0, noSourceRes.code), false);

  const localMissingRes = diag.classifyPlaybackFailure({ isLocal: true });
  assert.equal(localMissingRes.code, "local-missing");
  assert.equal(diag.shouldRetrySingleTrack(0, localMissingRes.code), false);

  assert.equal(diag.formatAutoFallbackMessage("unblock"), "当前音源不可用，已自动切换备用源");
  assert.equal(diag.formatAutoFallbackMessage("lx"), "当前音源不可用，已自动切换备用 LX 源");
});

test("phase 2.5 runtime: cloudSyncMerge conflict diff preview & local snapshot ring buffer pruning", async () => {
  const mergeMod = await import(
    pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/cloudSyncMerge.ts")).href
  );

  const localSnap = {
    schema: "xiaopang-music-sync-v1",
    revision: 3,
    clientUpdatedAt: 2000,
    updatedAt: 2000,
    deviceName: "我的 Android",
    favoriteList: [100, 200, 300],
    playHistory: {
      musicHistory: [
        { id: 100, name: "共有" },
        { id: 400, name: "本机历史新增" },
      ],
    },
    customPlaylists: [],
  };
  const remoteSnap = {
    schema: "xiaopang-music-sync-v1",
    revision: 4,
    clientUpdatedAt: 3000,
    updatedAt: 3000,
    deviceName: "我的 iPhone",
    favoriteList: [100, 500],
    playHistory: {
      musicHistory: [
        { id: 100, name: "共有" },
        { id: 600, name: "云端历史新增1" },
        { id: 700, name: "云端历史新增2" },
      ],
    },
    customPlaylists: [],
  };

  const diff = mergeMod.computeSyncConflictDiff(localSnap, remoteSnap);
  assert.equal(diff.localOnlyFavorites, 2); // 200, 300
  assert.equal(diff.remoteOnlyFavorites, 1); // 500
  assert.equal(diff.localAddedTotal, 3); // 200, 300, 400
  assert.equal(diff.remoteAddedTotal, 3); // 500, 600, 700

  // Verify local backup ring buffer keeps only latest 5 snapshots sorted descending
  const rawBackups = Array.from({ length: 8 }, (_, idx) => ({
    id: `bak_${idx}`,
    createdAt: 1000 + idx * 100,
    reason: "before-merge",
    revision: idx + 1,
    deviceName: "Test",
    favoritesCount: idx,
    songsCount: idx,
    snapshot: localSnap,
  }));
  const pruned = mergeMod.pruneBackupSnapshots(rawBackups, 5);
  assert.equal(pruned.length, 5);
  assert.deepEqual(
    pruned.map((b) => b.id),
    ["bak_7", "bak_6", "bak_5", "bak_4", "bak_3"]
  );
});

test("phase 2.5 invariants: source folding, unified music library, sync rollback/encrypted backup, cold resume, queue edit, onboarding & visual subtraction", () => {
  // 1. Source folding & speed test inside advanced disclosure
  const playbackTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/PlaybackTab.vue"),
    "utf-8"
  );
  assert.match(playbackTab, /自动选择最佳音源/);
  assert.match(playbackTab, /高级音源设置/);
  assert.match(playbackTab, /showAdvancedSources\s*=\s*ref\(false\)/);
  assert.match(playbackTab, /runSourceSpeedTest/);

  const playlistStore = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playlist.ts"),
    "utf-8"
  );
  assert.match(playlistStore, /SINGLE_TRACK_MAX_RETRIES\s*=\s*MAX_SINGLE_TRACK_RETRIES/);
  assert.match(playlistStore, /const reorderPlayList =/);
  assert.match(playlistStore, /const saveCurrentQueueAsCustomPlaylist =/);

  // 2. Unified My Music Library with 5 tabs, storage, invalid marker, safe batch delete
  const libraryPath = path.join(repoRoot, "upstream/src/renderer/views/library/MyMusicLibrary.vue");
  assert.equal(fs.existsSync(libraryPath), true, "MyMusicLibrary.vue must exist");
  const librarySrc = fs.readFileSync(libraryPath, "utf-8");
  for (const label of ["已下载", "手机本地", "已缓存", "最近播放", "收藏", "总存储占用", "文件已失效", "批量删除"]) {
    assert.ok(librarySrc.includes(label), `MyMusicLibrary.vue must include "${label}"`);
  }
  const otherRouter = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/router/other.ts"),
    "utf-8"
  );
  assert.match(otherRouter, /path:\s*'\/library'/);

  // 3. Cloud sync polish: editable device name, conflict diff preview, local rollback, encrypted backup JSON
  const cloudSyncTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/CloudSyncTab.vue"),
    "utf-8"
  );
  assert.match(cloudSyncTab, /当前设备：/);
  assert.match(cloudSyncTab, /本机新增/);
  assert.match(cloudSyncTab, /云端新增/);
  assert.match(cloudSyncTab, /一键回滚/);
  assert.match(cloudSyncTab, /一键导出加密备份（JSON）/);

  const cloudSyncStore = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/cloudSync.ts"),
    "utf-8"
  );
  assert.match(cloudSyncStore, /exportEncryptedBackupJsonString/);
  assert.match(cloudSyncStore, /rollbackToBackup/);
  assert.match(cloudSyncStore, /xiaopang-encrypted-backup-v1/);

  // 4. Queue editing, 3-step onboarding with Skip, cold-start resume, and visual subtraction
  const queueDrawer = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/player/PlayingListDrawer.vue"),
    "utf-8"
  );
  assert.match(queueDrawer, /存为歌单/);
  assert.match(queueDrawer, /next-up-bar/);
  assert.match(queueDrawer, /swipe-remove-bg/);
  assert.match(queueDrawer, /reorderPlayList/);

  const onboardingPath = path.join(repoRoot, "upstream/src/renderer/components/common/OnboardingGuideModal.vue");
  assert.equal(fs.existsSync(onboardingPath), true, "OnboardingGuideModal.vue must exist");
  const onboardingSrc = fs.readFileSync(onboardingPath, "utf-8");
  assert.match(onboardingSrc, /跳过/);
  assert.match(onboardingSrc, /3/);

  const musicFull = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/lyric/MusicFullMobile.vue"),
    "utf-8"
  );
  assert.doesNotMatch(musicFull, /class="top-center-pill"/, "Redundant brand pill removed from vinyl player");

  const mobilePlayerSettings = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/player/MobilePlayerSettings.vue"),
    "utf-8"
  );
  assert.match(mobilePlayerSettings, /当前音源详情/);
  assert.match(mobilePlayerSettings, /清理缓存/);

  const homeHero = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/home/components/HomeHero.vue"),
    "utf-8"
  );
  assert.match(homeHero, /showMoreHomeDrawer/);
  assert.match(homeHero, /我的音乐库/);
});

test("toast UX upgrade: global frosted-glass capsule toast replaces native Toast and removes swipe text popups", () => {
  const toastPath = path.join(repoRoot, "upstream/src/renderer/components/common/AppFloatingToast.vue");
  assert.equal(fs.existsSync(toastPath), true, "AppFloatingToast.vue must exist");
  const toastSrc = fs.readFileSync(toastPath, "utf-8");
  assert.match(toastSrc, /rgba\(18,\s*20,\s*26,\s*0\.78\)/);
  assert.match(toastSrc, /blur\(16px\)/);
  assert.match(toastSrc, /calc\(env\(safe-area-inset-top,\s*24px\)\s*\+\s*56px\)/);

  const appVue = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/App.vue"),
    "utf-8"
  );
  assert.match(appVue, /<app-floating-toast\s*\/>/);

  const shortcutToastTs = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/utils/shortcutToast.ts"),
    "utf-8"
  );
  assert.match(shortcutToastTs, /export const floatingToastState/);
  assert.match(shortcutToastTs, /1500/);

  const musicFull = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/lyric/MusicFullMobile.vue"),
    "utf-8"
  );
  assert.doesNotMatch(musicFull, /showBottomToast\('下一首'\)/);
  assert.doesNotMatch(musicFull, /showBottomToast\('上一首'\)/);

  for (const relPath of [
    "upstream/src/renderer/components/player/MobilePlayerSettings.vue",
    "upstream/src/renderer/views/set/tabs/PlaybackTab.vue",
    "upstream/src/renderer/utils/bridge/ipcAdapter.ts",
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
    assert.doesNotMatch(src, /AlgerAndroid[\s\S]{0,12}\.showToast\(/, `${relPath} must use in-app frosted toast instead of AlgerAndroid.showToast`);
  }
});

test("mobile drawer layering & auto-close: all <n-drawer> tags exceed MobilePlayBar z-index (9500) and HomeHero closes on navigation", () => {
  const homeHero = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/home/components/HomeHero.vue"),
    "utf-8"
  );
  assert.match(homeHero, /<n-drawer[\s\S]*?:z-index="12000"/);
  assert.match(homeHero, /route\.fullPath[\s\S]{0,120}showMoreHomeDrawer\.value\s*=\s*false/);
  assert.match(homeHero, /onDeactivated\(\(\)\s*=>\s*\{[\s\S]{0,80}showMoreHomeDrawer\.value\s*=\s*false/);

  // Recursively verify every <n-drawer> in upstream/src/renderer has an explicit z-index > 9500
  const rendererDir = path.join(repoRoot, "upstream/src/renderer");
  const vueFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".vue")) vueFiles.push(full);
    }
  };
  walk(rendererDir);

  let drawerCount = 0;
  for (const file of vueFiles) {
    const src = fs.readFileSync(file, "utf-8");
    const matches = src.matchAll(/<n-drawer(?=[\s>])[^>]*>/g);
    for (const m of matches) {
      drawerCount += 1;
      const tag = m[0];
      const zMatch = tag.match(/:?z-index="(\d+)"/);
      assert.ok(zMatch, `${path.relative(repoRoot, file)} <n-drawer> must set explicit :z-index`);
      assert.ok(
        Number(zMatch[1]) > 9500,
        `${path.relative(repoRoot, file)} <n-drawer> z-index (${zMatch[1]}) must be > 9500`
      );
    }
  }
  assert.ok(drawerCount >= 8, `Expected at least 8 <n-drawer> tags in renderer, found ${drawerCount}`);
});

test("immersive launch runtime: launchPolicy resolves defaults, external-audio gating & silent NotAllowedError detection", async () => {
  const launchPolicyUrl = pathToFileURL(
    path.join(repoRoot, "upstream/src/renderer/utils/launchPolicy.ts")
  ).href;
  const {
    getEffectiveLaunchHomeMode,
    getEffectiveLaunchAutoPlayMode,
    shouldAutoPlayOnLaunch,
    isAutoplayBlockedError
  } = await import(launchPolicyUrl);

  // 启动首页模式默认沉浸黑胶，显式选择 classic 时切经典页
  assert.equal(getEffectiveLaunchHomeMode(undefined), "immersive");
  assert.equal(getEffectiveLaunchHomeMode({}), "immersive");
  assert.equal(getEffectiveLaunchHomeMode({ launchHomeMode: "immersive" }), "immersive");
  assert.equal(getEffectiveLaunchHomeMode({ launchHomeMode: "classic" }), "classic");

  // 自动播放策略默认：原生端默认 always，非原生端兼容旧 autoPlay 布尔值且默认 off
  assert.equal(getEffectiveLaunchAutoPlayMode({}, true), "always");
  assert.equal(getEffectiveLaunchAutoPlayMode({ launchAutoPlayMode: "" }, true), "always");
  assert.equal(getEffectiveLaunchAutoPlayMode({ launchAutoPlayMode: "external-audio" }, true), "external-audio");
  assert.equal(getEffectiveLaunchAutoPlayMode({ launchAutoPlayMode: "off" }, true), "off");
  assert.equal(getEffectiveLaunchAutoPlayMode({}, false), "off");
  assert.equal(getEffectiveLaunchAutoPlayMode({ autoPlay: true }, false), "always");

  // 耳机/蓝牙条件判定
  assert.equal(shouldAutoPlayOnLaunch({ mode: "always", isExternalAudioConnected: false }), true);
  assert.equal(shouldAutoPlayOnLaunch({ mode: "external-audio", isExternalAudioConnected: true }), true);
  assert.equal(shouldAutoPlayOnLaunch({ mode: "external-audio", isExternalAudioConnected: false }), false);
  assert.equal(shouldAutoPlayOnLaunch({ mode: "off", isExternalAudioConnected: true }), false);

  // Web / Safari PWA Autoplay 拦截识别
  const domNotAllowed = Object.assign(
    new Error("The request is not allowed by the user agent or the platform in the current context."),
    { name: "NotAllowedError" }
  );
  assert.equal(isAutoplayBlockedError(domNotAllowed), true);
  assert.equal(isAutoplayBlockedError("play() failed because the user didn't interact with the document first"), true);
  assert.equal(isAutoplayBlockedError("Playback was unable to start"), true);
  assert.equal(isAutoplayBlockedError(new Error("Network timeout 504")), false);
});

test("immersive launch invariants: vinyl view, anti-conflict bottom bar, native audio output bridges & silent autoplay", () => {
  // 1. 沉浸黑胶首页组件与关键能力
  const vinylPath = path.join(repoRoot, "upstream/src/renderer/views/home/components/ImmersiveVinylHome.vue");
  assert.equal(fs.existsSync(vinylPath), true, "ImmersiveVinylHome.vue must exist");
  const vinylSrc = fs.readFileSync(vinylPath, "utf-8");
  assert.match(vinylSrc, /extractCoverPalette/, "Must reuse coverColorExtractor.ts");
  assert.match(vinylSrc, /formatPlaybackBadgeText/, "Must reuse playbackMeta.ts");
  assert.match(vinylSrc, /triggerHaptic/, "Must trigger native haptics on swipe/actions");
  assert.match(vinylSrc, /tonearm-anchor/, "Must render animated vinyl tonearm");
  assert.match(vinylSrc, /vinyl-platter/, "Must render rotating vinyl platter");
  assert.match(vinylSrc, /心动/);
  assert.match(vinylSrc, /发现/);
  assert.match(vinylSrc, /音乐库/);
  assert.match(vinylSrc, /<mobile-player-settings/);

  // 2. 底栏防冲突与深色透明导航栏联动
  const mobileLayout = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/layout/MobileLayout.vue"),
    "utf-8"
  );
  assert.match(mobileLayout, /isImmersiveHomeActive/);
  assert.match(mobileLayout, /provide\('isImmersiveHomeActive'/);
  assert.match(mobileLayout, /is-immersive-dark/);

  const mobilePlayBar = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/player/MobilePlayBar.vue"),
    "utf-8"
  );
  assert.match(mobilePlayBar, /isImmersiveHomeActive/);
  assert.match(mobilePlayBar, /v-if="!playerStore\.musicFull && !isImmersiveHomeActive"/);

  const appMenu = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/layout/components/AppMenu.vue"),
    "utf-8"
  );
  assert.match(appMenu, /is-immersive-dark/);
  assert.match(appMenu, /setHomeDisplayMode\('classic'\)/);

  // 3. 设置项持久化与 PlaybackTab UI
  const playbackTab = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/views/set/tabs/PlaybackTab.vue"),
    "utf-8"
  );
  assert.match(playbackTab, /启动首页模式/);
  assert.match(playbackTab, /沉浸黑胶（默认）/);
  assert.match(playbackTab, /经典发现首页/);
  assert.match(playbackTab, /打开 App 自动播放/);
  assert.match(playbackTab, /始终自动播放（原生端默认）/);
  assert.match(playbackTab, /仅连接耳机或蓝牙时/);

  // 4. Android & iOS 原生耳机/蓝牙输出检测桥接
  const androidBridgeKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/bridge/AndroidJsBridge.kt"),
    "utf-8"
  );
  assert.match(androidBridgeKt, /@JavascriptInterface\s+fun\s+isAudioOutputExternal\(\):\s*Boolean/);
  assert.match(androidBridgeKt, /AudioManager\.GET_DEVICES_OUTPUTS/);

  const iosBridgeSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridgeSwift, /AVAudioSession\.sharedInstance\(\)\.currentRoute\.outputs/);
  assert.match(iosBridgeSwift, /isAudioOutputExternal:\s*function\(\)/);

  // 5. 冷启动首曲填充与 Web Autoplay 静默降级
  const playerCore = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playerCore.ts"),
    "utf-8"
  );
  assert.match(playerCore, /seedInitialLaunchTrack/);
  assert.match(playerCore, /isExternalAudioOutputConnected/);
  assert.match(playerCore, /autoplay_blocked/);
  assert.match(playerCore, /isAutoplayBlockedError/);

  const audioService = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/services/audioService.ts"),
    "utf-8"
  );
  assert.match(audioService, /isAutoplayBlockedError/);
  assert.match(audioService, /autoplay_blocked/);
});

test("playlist index sync runtime & invariants: next -> prev always returns to initial track across empty, shuffled, and drifted queues", async () => {
  const syncModUrl = pathToFileURL(
    path.join(repoRoot, "upstream/src/renderer/utils/playlistIndexSync.ts")
  ).href;
  const { syncPlaylistIndexWithCurrentTrack, resolveSeededFirstSong } = await import(syncModUrl);

  const trackA = { id: 101, name: "Initial Track A", source: "netease" };
  const trackB = { id: 202, name: "Rec Track B", source: "netease" };
  const trackC = { id: 303, name: "Rec Track C", source: "netease" };
  const trackX = { id: 999, name: "Unlisted Track X", source: "netease" };

  // 场景 1：首次启动队列为空、已有初始曲目 A -> 先保留 A 在 playList[0]，再追加推荐 B/C -> 下一首(B) -> 上一首(A)
  let queue = [];
  let idx = 0;
  if (queue.length === 0 && trackA.id) {
    queue = [{ ...trackA }];
    idx = 0;
  }
  queue = [...queue, trackB, trackC];
  let aligned = syncPlaylistIndexWithCurrentTrack(queue, idx, trackA);
  assert.equal(aligned.playList[0].id, trackA.id);
  assert.equal(aligned.playListIndex, 0);
  const nextIdx1 = (aligned.playListIndex + 1) % aligned.playList.length;
  const currentAfterNext1 = aligned.playList[nextIdx1];
  assert.equal(currentAfterNext1.id, trackB.id);
  aligned = syncPlaylistIndexWithCurrentTrack(aligned.playList, nextIdx1, currentAfterNext1);
  const prevIdx1 = (aligned.playListIndex - 1 + aligned.playList.length) % aligned.playList.length;
  assert.equal(aligned.playList[prevIdx1].id, trackA.id, "Next then Prev must strictly return to initial track A");

  // 场景 2：随机模式洗牌后冷启动首曲与 playList[playListIndex] 对齐
  const normalized = [trackA, trackB, trackC];
  const shuffled = [trackC, trackA, trackB];
  const seeded = resolveSeededFirstSong(shuffled, 0, normalized);
  assert.equal(seeded.firstSong.id, trackC.id);
  assert.equal(seeded.playList[seeded.playListIndex].id, seeded.firstSong.id);
  const nextIdx2 = (seeded.playListIndex + 1) % seeded.playList.length;
  const prevIdx2 = (nextIdx2 - 1 + seeded.playList.length) % seeded.playList.length;
  assert.equal(seeded.playList[prevIdx2].id, seeded.firstSong.id);

  // 场景 3：playListIndex 漂移（正在播 trackC，但 playListIndex 卡在 0）-> 校准到真实索引 2 -> 下一首(0) -> 上一首(2: trackC)
  const drifted = syncPlaylistIndexWithCurrentTrack([trackA, trackB, trackC], 0, trackC);
  assert.equal(drifted.mutated, false);
  assert.equal(drifted.playListIndex, 2);
  const nextIdx3 = (drifted.playListIndex + 1) % drifted.playList.length;
  assert.equal(drifted.playList[nextIdx3].id, trackA.id);
  const backAligned3 = syncPlaylistIndexWithCurrentTrack(drifted.playList, nextIdx3, drifted.playList[nextIdx3]);
  const prevIdx3 = (backAligned3.playListIndex - 1 + backAligned3.playList.length) % backAligned3.playList.length;
  assert.equal(backAligned3.playList[prevIdx3].id, trackC.id);

  // 场景 4：当前曲目 trackX 不在队列中 -> 插入到当前索引位 -> 下一首 -> 上一首严格回到 trackX
  const inserted = syncPlaylistIndexWithCurrentTrack([trackA, trackB], 1, trackX);
  assert.equal(inserted.mutated, true);
  assert.equal(inserted.playListIndex, 1);
  assert.equal(inserted.playList[1].id, trackX.id);
  assert.equal(inserted.playList.length, 3);
  const nextIdx4 = (inserted.playListIndex + 1) % inserted.playList.length;
  assert.equal(inserted.playList[nextIdx4].id, trackB.id);
  const prevIdx4 = (nextIdx4 - 1 + inserted.playList.length) % inserted.playList.length;
  assert.equal(inserted.playList[prevIdx4].id, trackX.id);

  // 静态源码契约校验：playlist.ts 与 playerCore.ts 接线顺序正确
  const playlistSrc = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playlist.ts"),
    "utf-8"
  );
  assert.match(
    playlistSrc,
    /if\s*\(playList\.value\.length\s*===\s*0\)\s*\{[\s\S]{0,180}playList\.value\s*=\s*\[\{\s*\.\.\.playerCore\.playMusic\s*\}\];[\s\S]{0,120}appendRecommendedSongsIfNeeded\(/,
    "_nextPlay must preserve initial playMusic at playList[0] BEFORE calling appendRecommendedSongsIfNeeded"
  );
  assert.match(playlistSrc, /alignQueueIndexWithCurrentTrack\(playerCore\.playMusic\)/);

  const playerCoreSrc = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/playerCore.ts"),
    "utf-8"
  );
  assert.match(playerCoreSrc, /resolveSeededFirstSong\(/);
});

test("global overlay z-index invariants: all <n-modal>, <n-drawer>, ResponsiveModal & Naive UI containers exceed bottom bar (9500)", () => {
  const rendererDir = path.join(repoRoot, "upstream/src/renderer");
  const vueFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".vue")) vueFiles.push(full);
    }
  };
  walk(rendererDir);

  let modalCount = 0;
  let drawerCount = 0;
  for (const file of vueFiles) {
    const src = fs.readFileSync(file, "utf-8");
    const rel = path.relative(repoRoot, file);

    for (const m of src.matchAll(/<n-modal(?=[\s>])[^>]*>/g)) {
      modalCount += 1;
      const zMatch = m[0].match(/:?z-index="(\d+)"/);
      assert.ok(zMatch, `${rel} <n-modal> must set explicit :z-index`);
      assert.ok(
        Number(zMatch[1]) > 10000,
        `${rel} <n-modal> z-index (${zMatch[1]}) must be > 10000`
      );
    }

    for (const m of src.matchAll(/<n-drawer(?=[\s>])[^>]*>/g)) {
      drawerCount += 1;
      const zMatch = m[0].match(/:?z-index="(\d+)"/);
      assert.ok(zMatch, `${rel} <n-drawer> must set explicit :z-index`);
      const zVal = Number(zMatch[1]);
      assert.ok(zVal > 9500, `${rel} <n-drawer> z-index (${zVal}) must be > 9500`);
      if (!rel.endsWith("MusicFull.vue") && !rel.endsWith("MusicFullMobile.vue")) {
        assert.ok(zVal > 10000, `${rel} <n-drawer> z-index (${zVal}) must be > 10000`);
      }
    }
  }

  assert.ok(modalCount >= 14, `Expected at least 14 <n-modal> tags, found ${modalCount}`);
  assert.ok(drawerCount >= 8, `Expected at least 8 <n-drawer> tags, found ${drawerCount}`);

  // ResponsiveModal 必须高于 9500（不再停留在 z-[1000]）
  const responsiveModal = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/common/ResponsiveModal.vue"),
    "utf-8"
  );
  assert.doesNotMatch(responsiveModal, /z-\[1000\]/);
  assert.match(responsiveModal, /z-\[12000\]/);

  // 听歌报告弹窗需具备小屏限高滚动保护，避免保存/分享按钮被截断
  const statsPanel = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/stats/ListeningStatsPanel.vue"),
    "utf-8"
  );
  assert.match(statsPanel, /<n-modal[\s\S]{0,160}:z-index="12000"/);
  assert.match(statsPanel, /max-height:\s*82vh;\s*overflow-y:\s*auto/);

  // 全局 Provider & CSS 容器兜底高于 9500（覆盖 useDialog / useMessage / createDiscreteApi）
  const appVue = fs.readFileSync(path.join(repoRoot, "upstream/src/renderer/App.vue"), "utf-8");
  assert.match(appVue, /<n-message-provider[^>]*zIndex:\s*100020/);

  const mobileCss = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/assets/css/mobile.css"),
    "utf-8"
  );
  assert.match(mobileCss, /\.n-modal-container[\s\S]{0,80}z-index:\s*12500\s*!important/);
  assert.match(mobileCss, /\.n-drawer-container[\s\S]{0,100}z-index:\s*12000\s*!important/);
  assert.match(mobileCss, /\.n-message-container\s*\{[\s\S]{0,60}z-index:\s*100020\s*!important/);
});

test("security hardening: zero v-html XSS vectors, Android WebView locked down, and Keystore/Keychain secret isolation", async () => {
  // 1. 全库清零 v-html（包含歌曲名、艺人简介、更新说明等所有 Vue 组件）
  const rendererDir = path.join(repoRoot, "upstream/src/renderer");
  const allFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(vue|ts|tsx|js)$/.test(entry.name)) allFiles.push(full);
    }
  };
  walk(rendererDir);
  for (const file of allFiles) {
    const src = fs.readFileSync(file, "utf-8");
    const rel = path.relative(repoRoot, file);
    assert.doesNotMatch(src, /\bv-html\s*=/, `${rel} must not contain dangerous v-html directive`);
    if (file.endsWith(".vue")) {
      assert.doesNotMatch(src, /\bv-html\b/, `${rel} must not contain v-html anywhere`);
    }
  }

  // 验证恶意 XSS payload 在安全发布说明解析器中不会生成任何可执行 HTML / 危险协议
  const safeNotesUrl = pathToFileURL(
    path.join(repoRoot, "upstream/src/renderer/utils/safeReleaseNotes.ts")
  ).href;
  const { parseSafeReleaseNotes, sanitizeInlineReleaseText } = await import(safeNotesUrl);

  const maliciousMarkdown = [
    "# v1.0.0 <img src=x onerror=alert(1)>",
    "- 新增功能 <script>window.AlgerAndroid.exitApp()</script> 完成",
    "- [点我领奖](javascript:alert(document.cookie))",
    "<iframe src=\"https://evil.example\"></iframe>普通更新文本"
  ].join("\n");

  const blocks = parseSafeReleaseNotes(maliciousMarkdown);
  assert.equal(blocks.length, 4);
  const joined = blocks.map((b) => b.text).join("\n");
  assert.doesNotMatch(joined, /<script|<iframe|<img|onerror=|javascript:/i);
  assert.match(joined, /v1\.0\.0/);
  assert.match(joined, /新增功能/);
  assert.match(joined, /点我领奖/);
  assert.equal(
    sanitizeInlineReleaseText("<img src=x onerror=alert(1)>Safe Song"),
    "Safe Song"
  );

  // 2. Android WebView 权限收紧：关闭 file/content 访问，禁止 MIXED_CONTENT_ALWAYS_ALLOW
  const mainActivity = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/MainActivity.kt"),
    "utf-8"
  );
  assert.match(mainActivity, /allowFileAccess\s*=\s*false/);
  assert.match(mainActivity, /allowContentAccess\s*=\s*false/);
  assert.doesNotMatch(mainActivity, /MIXED_CONTENT_ALWAYS_ALLOW/);
  assert.match(mainActivity, /MIXED_CONTENT_COMPATIBILITY_MODE/);

  // 3. 原生 Keystore (Android) / Keychain (iOS) 敏感凭据存储桥接与前端隔离迁移
  const secureStoreKt = path.join(
    repoRoot,
    "android/app/src/main/kotlin/com/xiaopang/naiwamusic/config/SecureCredentialStore.kt"
  );
  assert.equal(fs.existsSync(secureStoreKt), true, "SecureCredentialStore.kt must exist");
  const secureStoreKtSrc = fs.readFileSync(secureStoreKt, "utf-8");
  assert.match(secureStoreKtSrc, /AndroidKeyStore/);
  assert.match(secureStoreKtSrc, /AES\/GCM\/NoPadding/);

  const androidBridgeKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/bridge/AndroidJsBridge.kt"),
    "utf-8"
  );
  assert.match(androidBridgeKt, /@JavascriptInterface\s+fun\s+secureSetSecret\(/);
  assert.match(androidBridgeKt, /@JavascriptInterface\s+fun\s+secureGetSecret\(/);
  assert.match(androidBridgeKt, /@JavascriptInterface\s+fun\s+secureRemoveSecret\(/);

  const appPrefsSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Config/AppPrefs.swift"),
    "utf-8"
  );
  assert.match(appPrefsSwift, /import Security/);
  assert.match(appPrefsSwift, /SecItemAdd/);
  assert.match(appPrefsSwift, /SecItemCopyMatching/);

  const iosBridgeSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridgeSwift, /secureSetSecret:\s*function\(/);
  assert.match(iosBridgeSwift, /secureGetSecret:\s*function\(/);
  assert.match(iosBridgeSwift, /secureRemoveSecret:\s*function\(/);

  const secretsModUrl = pathToFileURL(
    path.join(repoRoot, "upstream/src/renderer/utils/cloudSyncSecrets.ts")
  ).href;
  const {
    SECRET_KEY_GITHUB_TOKEN,
    SECRET_KEY_WEBDAV_PASSWORD,
    SECRET_KEY_QUICK_SYNC_CODE,
    sanitizeCloudSyncConfigForStorage,
    hydrateAndMigrateCloudSyncConfig,
    persistCloudSyncConfigSecurely
  } = await import(secretsModUrl);

  const memNative = new Map();
  const mockNativeStore = {
    getSecret: (k) => memNative.get(k) || "",
    setSecret: (k, v) => {
      memNative.set(k, v);
      return true;
    },
    removeSecret: (k) => {
      memNative.delete(k);
      return true;
    }
  };
  const defaultCfg = {
    provider: "quick",
    quick: { syncCode: "", customSupabaseUrl: "", customSupabaseAnonKey: "" },
    webdav: { serverUrl: "", username: "u", password: "", folderPath: "/", fileName: "sync.json" },
    github: { token: "", gistId: "g1" }
  };

  // 3a. 保存时敏感凭据绝不落明文到 localStorage JSON
  let persistedLocalJson = "";
  const activeCfg = {
    ...defaultCfg,
    quick: { ...defaultCfg.quick, syncCode: "ABCD-1234-EFGH" },
    webdav: { ...defaultCfg.webdav, password: "dav_secret_password" },
    github: { ...defaultCfg.github, token: "ghp_super_secret_token" }
  };
  persistCloudSyncConfigSecurely({
    config: activeCfg,
    isNativeEnv: true,
    secretStore: mockNativeStore,
    writeStorage: (json) => {
      persistedLocalJson = json;
    }
  });
  assert.equal(persistedLocalJson.includes("ghp_super_secret_token"), false);
  assert.equal(persistedLocalJson.includes("dav_secret_password"), false);
  assert.equal(persistedLocalJson.includes("ABCD-1234-EFGH"), false);
  assert.equal(memNative.get(SECRET_KEY_GITHUB_TOKEN), "ghp_super_secret_token");
  assert.equal(memNative.get(SECRET_KEY_WEBDAV_PASSWORD), "dav_secret_password");
  assert.equal(memNative.get(SECRET_KEY_QUICK_SYNC_CODE), "ABCD-1234-EFGH");

  // 3b. 启动时兼容迁移旧 localStorage 明文并立刻清除 localStorage 明文
  const memNativeMigrated = new Map();
  const mockMigrationStore = {
    getSecret: (k) => memNativeMigrated.get(k) || "",
    setSecret: (k, v) => {
      memNativeMigrated.set(k, v);
      return true;
    },
    removeSecret: (k) => memNativeMigrated.delete(k)
  };
  let rewrittenJson = "";
  const hydrated = hydrateAndMigrateCloudSyncConfig({
    rawStoredJson: JSON.stringify(activeCfg),
    defaultConfig: defaultCfg,
    isNativeEnv: true,
    secretStore: mockMigrationStore,
    writeStorage: (json) => {
      rewrittenJson = json;
    }
  });
  assert.equal(hydrated.github.token, "ghp_super_secret_token");
  assert.equal(hydrated.webdav.password, "dav_secret_password");
  assert.equal(hydrated.quick.syncCode, "ABCD-1234-EFGH");
  assert.equal(memNativeMigrated.get(SECRET_KEY_GITHUB_TOKEN), "ghp_super_secret_token");
  assert.equal(rewrittenJson.includes("ghp_super_secret_token"), false, "Legacy token must be wiped from localStorage");
  assert.equal(rewrittenJson.includes("dav_secret_password"), false, "Legacy password must be wiped from localStorage");
  assert.equal(rewrittenJson.includes("ABCD-EFGH-1234") || rewrittenJson.includes("ABCD-1234-EFGH"), false);

  // 3c. Web/PWA 模式同样绝不把 github.token / webdav.password 写入 localStorage
  let webLocalJson = "";
  persistCloudSyncConfigSecurely({
    config: activeCfg,
    isNativeEnv: false,
    secretStore: mockNativeStore,
    writeStorage: (json) => {
      webLocalJson = json;
    }
  });
  const stripped = sanitizeCloudSyncConfigForStorage(activeCfg);
  assert.equal(stripped.github.token, "");
  assert.equal(stripped.webdav.password, "");
  assert.equal(webLocalJson.includes("ghp_super_secret_token"), false);
  assert.equal(webLocalJson.includes("dav_secret_password"), false);

  const cloudSyncTs = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/cloudSync.ts"),
    "utf-8"
  );
  assert.match(cloudSyncTs, /hydrateAndMigrateCloudSyncConfig/);
  assert.match(cloudSyncTs, /persistCloudSyncConfigSecurely/);
  assert.doesNotMatch(cloudSyncTs, /localStorage\.setItem\(CONFIG_STORAGE_KEY,\s*JSON\.stringify\(config\.value\)\)/);
});

test("network recovery: Android/iOS native listeners and frontend interceptor clear stale OfflineBanner", () => {
  const mainActivityKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/MainActivity.kt"),
    "utf-8"
  );
  assert.match(mainActivityKt, /registerDefaultNetworkCallback/);
  assert.match(mainActivityKt, /NET_CAPABILITY_INTERNET/);
  assert.match(mainActivityKt, /setNetworkAvailable/);
  assert.match(mainActivityKt, /network-status-changed/);
  assert.match(mainActivityKt, /unregisterNetworkCallback/);

  const mainViewControllerSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  assert.match(mainViewControllerSwift, /NWPathMonitor/);
  assert.match(mainViewControllerSwift, /path\.status\s*==\s*\.satisfied/);
  assert.match(mainViewControllerSwift, /network-status-changed/);
  assert.match(mainViewControllerSwift, /pathMonitor\?\.cancel\(\)/);

  const offlineAvailabilityTs = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/store/modules/offlineAvailability.ts"),
    "utf-8"
  );
  assert.match(offlineAvailabilityTs, /network-status-changed/);
  assert.match(offlineAvailabilityTs, /visibilitychange/);
  assert.match(offlineAvailabilityTs, /addEventListener\(['"]focus['"]/);
  assert.match(offlineAvailabilityTs, /markOnline/);

  const requestTs = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/utils/request.ts"),
    "utf-8"
  );
  assert.match(requestTs, /useOfflineAvailabilityStore\(\)\.markOnline\(\)/);
});

test("desktop dark theme & sidebar layout: native color-scheme, charcoal dark palette, PlayBar contrast & non-overlapping Logo", () => {
  const indexHtml = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/index.html"),
    "utf-8"
  );
  assert.match(indexHtml, /<meta\s+name=["']color-scheme["']\s+content=["']light dark["']/i);
  assert.match(indexHtml, /#09090B/i);

  const indexCss = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/index.css"),
    "utf-8"
  );
  assert.match(indexCss, /:root\s*\{[\s\S]*color-scheme:\s*light;/i);
  assert.match(indexCss, /:root\.dark,\s*\.theme-dark\s*\{[\s\S]*color-scheme:\s*dark;/i);
  assert.match(indexCss, /#09090b/i);
  assert.match(indexCss, /#0f0f13/i);
  assert.match(indexCss, /#131316/i);
  assert.match(indexCss, /#1c1c22/i);
  assert.match(indexCss, /--naiwa-sky-glow:\s*transparent;/i);
  assert.match(indexCss, /--naiwa-sun-glow:\s*transparent;/i);

  const playBarVue = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/components/player/PlayBar.vue"),
    "utf-8"
  );
  assert.doesNotMatch(playBarVue, /\.music-play-bar[\s\S]*dark:shadow-gray-300/);
  assert.match(playBarVue, /dark:bg-\[#0F0F13\]\/\[0\.94\]/);
  assert.match(playBarVue, /dark:shadow-black\/60/);
  assert.match(playBarVue, /dark:border-t\s+dark:border-white\/10/);

  const appMenuVue = fs.readFileSync(
    path.join(repoRoot, "upstream/src/renderer/layout/components/AppMenu.vue"),
    "utf-8"
  );
  assert.match(appMenuVue, /\.app-menu\s*\{[\s\S]*flex-col/);
  assert.match(appMenuVue, /\.app-menu-header\s*\{[\s\S]*h-12[\s\S]*mb-4/);
  assert.match(appMenuVue, /\.app-menu-logo\s*\{[\s\S]*w-9\s+h-9/);
});

test("iOS WebView security: Fail-Closed navigation allowlist and origin-checked JS bridge", () => {
  const mainVcSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  const decideBlock = mainVcSwift.slice(
    mainVcSwift.indexOf("decidePolicyFor navigationAction"),
    mainVcSwift.indexOf("createWebViewWith configuration")
  );
  assert.match(decideBlock, /IOSJsBridge\.isAllowedWebViewNavigationUrl/);
  assert.match(decideBlock, /decisionHandler\(\.cancel\)\s*\}\s*[\r\n]+\s*func webView\(/);
  const lastDecisionAllow = decideBlock.lastIndexOf("decisionHandler(.allow)");
  const lastDecisionCancel = decideBlock.lastIndexOf("decisionHandler(.cancel)");
  assert.ok(lastDecisionCancel > lastDecisionAllow, "decidePolicyFor must end with Fail-Closed decisionHandler(.cancel)");

  const iosBridgeSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Bridge/IOSJsBridge.swift"),
    "utf-8"
  );
  assert.match(iosBridgeSwift, /window\.location\.protocol\s*!==\s*'http:'\s*\|\|\s*window\.location\.hostname\s*!==\s*'127\.0\.0\.1'/);
  assert.match(iosBridgeSwift, /url\.scheme\?\.lowercased\(\)\s*==\s*"http"[\s\S]*url\.host\s*==\s*"127\.0\.0\.1"[\s\S]*url\.port\s*==\s*localPort/);
  assert.match(iosBridgeSwift, /url\.absoluteString\s*==\s*"about:blank"/);
});

test("release prep: saveTextFile isolated to Backups/ with .json/.txt allowlist & v1.0.0/Node 22 metadata synced", () => {
  const androidDlKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/download/NativeDownloadManager.kt"),
    "utf-8"
  );
  const ktSaveBlock = androidDlKt.slice(androidDlKt.indexOf("fun saveTextFile("), androidDlKt.indexOf("fun saveImageToGallery("));
  assert.match(ktSaveBlock, /File\(getDownloadDir\(\),\s*"Backups"\)/);
  assert.match(ktSaveBlock, /endsWith\("\.json"\)\s*\|\|\s*lower\.endsWith\("\.txt"\)/);

  const iosDlSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Storage/LocalMusicAndDownloadManager.swift"),
    "utf-8"
  );
  const swiftSaveBlock = iosDlSwift.slice(iosDlSwift.indexOf("func saveTextFile("), iosDlSwift.indexOf("func importPickedAudioUrls("));
  assert.match(swiftSaveBlock, /appendingPathComponent\("Backups"/);
  assert.match(swiftSaveBlock, /hasSuffix\("\.json"\)\s*\|\|\s*lower\.hasSuffix\("\.txt"\)/);

  const readmeMd = fs.readFileSync(path.join(repoRoot, "README.md"), "utf-8");
  assert.doesNotMatch(readmeMd, /v5\.1\.4/);
  assert.match(readmeMd, /XiaoPangNaiwaMusic-v1\.0\.\d+-unsigned\.ipa/);

  const buildApkPs1 = fs.readFileSync(path.join(repoRoot, "build_apk.ps1"), "utf-8");
  assert.doesNotMatch(buildApkPs1, /"5\.1\.3"/);
  assert.match(buildApkPs1, /else\s*\{\s*"1\.0\.0"\s*\}/);

  const buildPwaPs1 = fs.readFileSync(path.join(repoRoot, "build_pwa.ps1"), "utf-8");
  assert.doesNotMatch(buildPwaPs1, /"5\.1\.3"/);
  assert.match(buildPwaPs1, /else\s*\{\s*"1\.0\.0"\s*\}/);

  const netlifyToml = fs.readFileSync(path.join(repoRoot, "netlify.toml"), "utf-8");
  assert.match(netlifyToml, /NODE_VERSION\s*=\s*"22"/);
});

test("v1.0.1 patch: VPN FakeIP (198.18.0.0/15) allowed, private SSRF still blocked, CDN HEAD probe public-IP only & versions 1.0.1", () => {
  const androidGuard = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/SafeHttpGuard.kt"),
    "utf-8"
  );
  assert.doesNotMatch(androidGuard, /b0\s*==\s*198\s*&&\s*\(b1\s*==\s*18\s*\|\|\s*b1\s*==\s*19\)/);
  assert.match(androidGuard, /if\s*\(b0\s*==\s*192\s*&&\s*b1\s*==\s*168\)\s*return\s*false/);
  assert.match(androidGuard, /if\s*\(b0\s*==\s*169\s*&&\s*b1\s*==\s*254\)\s*return\s*false/);
  assert.match(androidGuard, /fun executePublicMediaWithSafeRedirects\(/);

  const androidUnblock = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/server/MusicUnblockEngine.kt"),
    "utf-8"
  );
  const ktProbeBlock = androidUnblock.slice(
    androidUnblock.indexOf("fun checkAudioUrlReachable("),
    androidUnblock.indexOf("fun httpGetText(")
  );
  assert.match(ktProbeBlock, /executePublicMediaWithSafeRedirects\(\s*mediaProbeClient/);

  const iosGuard = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/SafeHttpGuard.swift"),
    "utf-8"
  );
  assert.doesNotMatch(iosGuard, /b0\s*==\s*198\s*&&\s*\(b1\s*==\s*18\s*\|\|\s*b1\s*==\s*19\)/);
  assert.match(iosGuard, /if\s*b0\s*==\s*192\s*&&\s*b1\s*==\s*168\s*\{\s*return\s*false\s*\}/);
  assert.match(iosGuard, /if\s*b0\s*==\s*169\s*&&\s*b1\s*==\s*254\s*\{\s*return\s*false\s*\}/);
  assert.match(iosGuard, /static func validatePublicHttpUrlAndResolve\(/);

  const iosUnblock = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/MusicUnblockEngine.swift"),
    "utf-8"
  );
  const swiftProbeBlock = iosUnblock.slice(
    iosUnblock.indexOf("func checkAudioUrlReachable("),
    iosUnblock.indexOf("func httpGetText(")
  );
  assert.match(swiftProbeBlock, /SafeHttpGuard\.validatePublicHttpUrlAndResolve/);
  assert.match(swiftProbeBlock, /mediaProbeSession\.dataTask/);

  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  const upstreamPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "upstream/package.json"), "utf-8"));
  assert.equal(rootPkg.version, "1.0.1");
  assert.equal(upstreamPkg.version, "1.0.1");

  const gradleKts = fs.readFileSync(path.join(repoRoot, "android/app/build.gradle.kts"), "utf-8");
  assert.match(gradleKts, /versionCode\s*=\s*10001/);
  assert.match(gradleKts, /versionName\s*=\s*"1\.0\.1"/);

  const projectYml = fs.readFileSync(path.join(repoRoot, "ios/project.yml"), "utf-8");
  assert.match(projectYml, /MARKETING_VERSION:\s*"1\.0\.1"/);
  assert.match(projectYml, /CURRENT_PROJECT_VERSION:\s*"10001"/);
  const readmeMd = fs.readFileSync(path.join(repoRoot, "README.md"), "utf-8");
  assert.match(readmeMd, /\(v1\.0\.1\)/);
  assert.match(readmeMd, /XiaoPangNaiwaMusic-v1\.0\.1-unsigned\.ipa/);
});

test("dark mode overhaul: zero :global(.dark) selectors, neutral charcoal tokens & warm gold SearchBar accents", () => {
  const rendererRoot = path.join(repoRoot, "upstream/src/renderer");
  const collectStyleFiles = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectStyleFiles(fullPath));
      } else if (/\.(vue|css|scss)$/i.test(entry.name)) {
        out.push(fullPath);
      }
    }
    return out;
  };

  for (const filePath of collectStyleFiles(rendererRoot)) {
    const content = fs.readFileSync(filePath, "utf-8");
    assert.doesNotMatch(
      content,
      /:global\(\.dark\)/,
      `Found broken :global(.dark) selector in ${path.relative(repoRoot, filePath)}`
    );
  }

  const mobileHeaderVue = fs.readFileSync(path.join(rendererRoot, "layout/components/MobileHeader.vue"), "utf-8");
  assert.match(mobileHeaderVue, /html\.dark\s+\.mobile-header/);

  const mobilePlayBarVue = fs.readFileSync(path.join(rendererRoot, "components/player/MobilePlayBar.vue"), "utf-8");
  assert.match(mobilePlayBarVue, /html\.dark\s+\.mobile-play-bar/);

  const appMenuVue = fs.readFileSync(path.join(rendererRoot, "layout/components/AppMenu.vue"), "utf-8");
  assert.match(appMenuVue, /html\.dark\s+\.mobile-dock/);

  const homeIndexVue = fs.readFileSync(path.join(rendererRoot, "views/home/index.vue"), "utf-8");
  assert.match(homeIndexVue, /html\.dark\s+\.classic-mode-switcher/);
  assert.match(homeIndexVue, /html\.dark\s+\.home-search-pill/);

  const searchBarVue = fs.readFileSync(path.join(rendererRoot, "layout/components/SearchBar.vue"), "utf-8");
  assert.doesNotMatch(
    searchBarVue,
    /(#22c55e|#16a34a|#dcfce7|#f0fdf4|#bbf7d0|#166534|rgba\(\s*34,\s*197,\s*94)/i
  );
  assert.match(searchBarVue, /\.tab-slider-bg\s*\{[\s\S]*#e89200/i);
  assert.match(searchBarVue, /\.dark\s+\.tab-slider-bg\s*\{[\s\S]*#ffc533/i);

  const indexCss = fs.readFileSync(path.join(rendererRoot, "index.css"), "utf-8");
  assert.match(indexCss, /--text-color-100:\s*#fafafa;/i);
  assert.match(indexCss, /--text-color-200:\s*#a1a1aa;/i);

  const appVue = fs.readFileSync(path.join(rendererRoot, "App.vue"), "utf-8");
  assert.match(appVue, /#09090B/i);
  assert.match(appVue, /#131316/i);
  assert.match(appVue, /#1C1C22/i);

  const mainActivityKt = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/xiaopang/naiwamusic/MainActivity.kt"),
    "utf-8"
  );
  assert.match(mainActivityKt, /Color\.parseColor\(if\s*\(isDarkBackground\)\s*"#09090B"/);

  const mainVcSwift = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/MainViewController.swift"),
    "utf-8"
  );
  assert.match(mainVcSwift, /red:\s*9\s*\/\s*255\.0,\s*green:\s*9\s*\/\s*255\.0,\s*blue:\s*11\s*\/\s*255\.0/);
});
