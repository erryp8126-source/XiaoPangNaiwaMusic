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

  for (const relPath of [
    "upstream/src/renderer/api/donation.ts",
    "upstream/src/renderer/components/Coffee.vue",
    "upstream/src/renderer/components/TrafficWarningDrawer.vue",
    "upstream/src/renderer/components/common/DonationList.vue",
    "upstream/src/renderer/components/common/MobileUpdateModal.vue",
    "upstream/src/shared/appUpdate.ts",
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
    assert.doesNotMatch(text, /donate\.alger\.fun/i, `${relPath} must not contain donate.alger.fun`);
    assert.doesNotMatch(text, /algerkong\/AlgerMusicPlayer/i, `${relPath} must not point to upstream repo`);
  }

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
