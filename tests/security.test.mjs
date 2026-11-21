import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const syncCryptoMod = await import(
  pathToFileURL(path.join(repoRoot, "upstream/src/renderer/utils/syncCrypto.ts")).href
);
const musicApiMod = await import(
  pathToFileURL(path.join(repoRoot, "netlify/functions/music-api.mts")).href
);
const musicApiHandler = musicApiMod.default;
const musicApiConfig = musicApiMod.config;

test("syncCrypto: rejects weak and guessable sync codes", () => {
  const weakCodes = [
    "123456",
    "12345678",
    "87654321",
    "aaaaaaaa",
    "password",
    "ABCDEFGH",
    "11223344",
    "onlyletters",
    "xiaopang",
  ];
  for (const code of weakCodes) {
    const res = syncCryptoMod.validateSyncCode(code);
    assert.equal(res.valid, false, `Expected weak code "${code}" to be rejected`);
  }
});

test("syncCrypto: accepts strong generated and legacy codes", () => {
  const generated = syncCryptoMod.generateFriendlySyncCode();
  assert.match(generated, /^NAIWA-\d{4}-[2-9A-HJ-NP-Z]{6}$/);
  for (const code of [generated, "NAIWA-7392-K8M4", "MyNaiwa2026!", "123456789012"]) {
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

test("syncCrypto: backward-compatible decryption of legacy v1 (15k PBKDF2) envelopes", async () => {
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
});

test("music-api: enforces strict CORS origin allowlist", async () => {
  const evilGet = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
      headers: { Origin: "https://evil.example.com" },
    }),
    {}
  );
  assert.equal(evilGet.status, 403);
  assert.equal(evilGet.headers.get("access-control-allow-origin"), null);

  const evilOptions = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/personalized", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" },
    }),
    {}
  );
  assert.equal(evilOptions.status, 403);

  const ghPagesRes = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/health", {
      headers: { Origin: "https://erryp8126-source.github.io" },
    }),
    {}
  );
  assert.equal(ghPagesRes.status, 200);
  assert.equal(ghPagesRes.headers.get("access-control-allow-origin"), "https://erryp8126-source.github.io");
  assert.equal(ghPagesRes.headers.get("access-control-allow-credentials"), "true");
});

test("music-api: blocks unlisted NetEase routes, oversized payloads, and invalid unblock ids", async () => {
  const unlisted = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/activate/init/profile"),
    {}
  );
  assert.equal(unlisted.status, 404);

  const badMethod = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/health", { method: "DELETE" }),
    {}
  );
  assert.equal(badMethod.status, 405);

  const hugeBody = "x".repeat(70 * 1024);
  const oversized = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/playlist/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: hugeBody,
    }),
    {}
  );
  assert.equal(oversized.status, 413);

  const badMusicId = await musicApiHandler(
    new Request("https://xiaopang-naiwa-music.netlify.app/api/music?id=../../etc/passwd"),
    {}
  );
  assert.equal(badMusicId.status, 400);

  assert.ok(musicApiConfig?.rateLimit?.windowLimit > 0, "Netlify rateLimit must be configured");
});

test("repo security invariants: native loopback auth, least-privilege CI, no dead ci/ folder", () => {
  const androidServer = fs.readFileSync(
    path.join(repoRoot, "android/app/src/main/kotlin/com/alger/musicplayer/server/EmbeddedHttpServer.kt"),
    "utf-8"
  );
  assert.match(androidServer, /x-alger-token/);
  assert.match(androidServer, /isAllowedAudioFile/);
  assert.doesNotMatch(androidServer, /session\.headers\["origin"\]\s*\?:\s*"\*"/);

  const iosServer = fs.readFileSync(
    path.join(repoRoot, "ios/XiaoPangNaiwaMusic/Server/LocalHttpServer.swift"),
    "utf-8"
  );
  assert.match(iosServer, /x-alger-token/);
  assert.match(iosServer, /isAllowedAudioFile/);
  assert.doesNotMatch(iosServer, /req\.headers\["origin"\]\s*\?\?\s*"\*"/);

  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/build-dual-platform.yml"),
    "utf-8"
  );
  assert.match(workflow, /^permissions:\r?\n\s+contents: read$/m);
  assert.equal(fs.existsSync(path.join(repoRoot, "ci")), false, "Dead ci/ directory must remain removed");
  assert.equal(
    fs.existsSync(path.join(repoRoot, "upstream/package-lock.json")),
    true,
    "upstream/package-lock.json must exist for reproducible npm ci"
  );

  const upstreamGitignore = fs.readFileSync(path.join(repoRoot, "upstream/.gitignore"), "utf-8");
  assert.doesNotMatch(upstreamGitignore, /^package-lock\.json$/m, "upstream/.gitignore must not ignore package-lock.json");

  const netlifyTomlBuf = fs.readFileSync(path.join(repoRoot, "netlify.toml"));
  assert.notEqual(netlifyTomlBuf[0], 0xef, "netlify.toml must not start with UTF-8 BOM");
  assert.match(netlifyTomlBuf.toString("utf-8"), /\bnpm ci\b/, "netlify.toml must use npm ci");
  assert.equal(fs.existsSync(path.join(repoRoot, ".github/dependabot.yml")), true, "Dependabot config must exist");
});
