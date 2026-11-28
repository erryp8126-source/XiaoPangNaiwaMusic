import type { Config, Context } from "@netlify/functions";
import { getDeployStore } from "@netlify/blobs";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// netease-cloud-music-api-alger 在模块加载时会同步读取 tmpdir/anonymous_token
const anonTokenPath = path.resolve(os.tmpdir(), "anonymous_token");
if (!fs.existsSync(anonTokenPath)) {
  try {
    fs.writeFileSync(anonTokenPath, "", "utf-8");
  } catch {
    // ignore
  }
}

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ncmApi: Record<string, any> = require("netease-cloud-music-api-alger");

export const FALLBACK_SERVICE_VERSION = "1.1.0";

function resolveServiceVersion(): string {
  try {
    const pkg = require("../../package.json") as { version?: string };
    const ver = typeof pkg?.version === "string" ? pkg.version.trim() : "";
    if (ver) return ver;
  } catch {
    // Bundled Lambda runtime without relative package.json falls back to synced version constant
  }
  return FALLBACK_SERVICE_VERSION;
}

export const SERVICE_VERSION = resolveServiceVersion();

const DEFAULT_CN_IP = "116.25.146.177";
const MAX_BODY_BYTES = 64 * 1024; // 限制单次请求体最大 64 KB，防资源滥用
const MAX_OUTBOUND_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);

/** 服务端外发音频解灰请求域名后缀白名单 */
export const OUTBOUND_AUDIO_ALLOWED_DOMAINS = new Set([
  "gdstudio.xyz",
  "163.com",
  "126.net",
  "kuwo.cn",
  "kugou.com",
  "migu.cn",
  "qq.com",
  "gtimg.cn",
  "joox.com",
]);

function isAllowedOutboundDomain(host: string, allowedSuffixes: Set<string>): boolean {
  const clean = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!clean) return false;
  for (const suffix of allowedSuffixes) {
    if (clean === suffix || clean.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

export function isPublicIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [b0, b1, b2] = nums;
  if (b0 === 0 || b0 === 10 || b0 === 127) return false;
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return false;
  if (b0 === 169 && b1 === 254) return false;
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return false;
  if (b0 === 192 && b1 === 0 && b2 === 0) return false;
  if (b0 === 192 && b1 === 168) return false;
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return false;
  if (b0 >= 224) return false;
  return true;
}

export function isPublicIPv6(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!normalized || net.isIPv6(normalized) === false) return false;
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return isPublicIPv4(mapped);
  }
  const firstHextet = parseInt(normalized.split(":")[0] || "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((firstHextet & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

function isPublicIpAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPublicIPv4(ip);
  if (family === 6) return isPublicIPv6(ip);
  return false;
}

export const MIN_VALID_AUDIO_BYTES = 800 * 1024;
export const MIN_SHORT_TRACK_AUDIO_BYTES = 80 * 1024;
export const SHORT_TRACK_DURATION_THRESHOLD_MS = 30_000;
const HEAD_FALLBACK_CODES = new Set([400, 403, 405, 501]);
const DISALLOWED_AUDIO_CONTENT_TYPES = new Set([
  "text/html",
  "application/json",
  "application/xml",
  "text/plain",
  "text/xml",
]);
const PUBLIC_MEDIA_BLOCKED_DOMAINS = new Set([
  "supabase.co",
  "localhost",
  "local",
  "internal",
]);

export function resolveMinValidAudioBytes(expectedDurationMs: number = 0): number {
  if (expectedDurationMs > 0 && expectedDurationMs < SHORT_TRACK_DURATION_THRESHOLD_MS) {
    return MIN_SHORT_TRACK_AUDIO_BYTES;
  }
  return MIN_VALID_AUDIO_BYTES;
}

export function isSuspiciousKuwoPlaceholderUrl(rawUrl: string): boolean {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (!lower.includes("kuwo") && !lower.includes("kwcdn")) return false;
  let target = lower;
  try {
    const parsed = new URL(trimmed);
    target = `${parsed.pathname}${parsed.search}`.toLowerCase() || lower;
  } catch {
    // keep raw lowercased url
  }
  return /(^|[/?&_=-])(audition|shiting|tishi|viptip|vip[_-]?tip|free[_-]?tip|notice|prompt|trylisten|try[_-]?listen|preview)([/?&_=.-]|$)/i.test(
    target
  );
}

export function parseTotalBytesFromHeaders(
  statusCode: number,
  headers: Headers
): number | null {
  if (statusCode === 206) {
    const range = (headers.get("content-range") || "").trim();
    const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(range);
    if (!match) return null;
    const total = Number(match[1]);
    return Number.isFinite(total) && total >= 0 ? total : null;
  }
  const cl = (headers.get("content-length") || "").trim();
  if (!cl) return null;
  const parsed = Number(cl);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isDisallowedAudioContentType(contentType: string | null): boolean {
  const normalized = (contentType || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!normalized) return false;
  return DISALLOWED_AUDIO_CONTENT_TYPES.has(normalized);
}

export interface SafeFetchOptions {
  allowedSuffixes?: Set<string>;
  allowAnyPublicHost?: boolean;
  maxRedirects?: number;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  fetchImpl?: typeof fetch;
}

export async function validateOutboundUrl(
  rawUrl: string,
  options: Pick<SafeFetchOptions, "allowedSuffixes" | "allowAnyPublicHost" | "dnsLookup"> = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF blocked: invalid URL "${rawUrl}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF blocked: disallowed scheme "${parsed.protocol}"`);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowedSuffixes = options.allowedSuffixes ?? OUTBOUND_AUDIO_ALLOWED_DOMAINS;
  const allowAnyPublicHost = options.allowAnyPublicHost === true;

  if (net.isIP(host)) {
    if (!isPublicIpAddress(host)) {
      throw new Error(`SSRF blocked: non-public IP literal "${host}"`);
    }
    if (!allowAnyPublicHost && !isAllowedOutboundDomain(host, allowedSuffixes)) {
      throw new Error(`SSRF blocked: IP literal not in domain allowlist "${host}"`);
    }
    return parsed;
  }

  if (allowAnyPublicHost) {
    if (isAllowedOutboundDomain(host, PUBLIC_MEDIA_BLOCKED_DOMAINS)) {
      throw new Error(`SSRF blocked: restricted host "${host}"`);
    }
  } else if (!isAllowedOutboundDomain(host, allowedSuffixes)) {
    throw new Error(`SSRF blocked: host "${host}" is not in allowlist`);
  }

  const lookupFn =
    options.dnsLookup ??
    ((h: string) => dns.lookup(h, { all: true, verbatim: true }) as Promise<Array<{ address: string; family: number }>>);

  const records = await lookupFn(host);
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`SSRF blocked: DNS resolution returned no addresses for "${host}"`);
  }
  for (const rec of records) {
    if (!isPublicIpAddress(rec.address)) {
      throw new Error(`SSRF blocked: host "${host}" resolved to non-public IP "${rec.address}"`);
    }
  }
  return parsed;
}

/**
 * 服务端安全外发 fetch：关闭自动跳转，逐跳校验域名白名单与全部 DNS 解析 IP（最多 3 跳），跨域名剥离敏感头
 */
export async function safeFetchWithRedirects(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? MAX_OUTBOUND_REDIRECTS;
  const fetchFn = options.fetchImpl ?? fetch;

  let currentUrl = (await validateOutboundUrl(rawUrl, options)).toString();
  let currentHeaders = new Headers(init.headers);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const resp = await fetchFn(currentUrl, {
      ...init,
      headers: currentHeaders,
      redirect: "manual",
    });

    if (!REDIRECT_STATUS_CODES.has(resp.status)) {
      return resp;
    }

    if (hop >= maxRedirects) {
      throw new Error(`SSRF blocked: exceeded maximum redirect hops (${maxRedirects})`);
    }

    const location = resp.headers.get("location")?.trim();
    if (!location) {
      return resp;
    }

    const prevHost = new URL(currentUrl).hostname.toLowerCase();
    const resolvedNext = new URL(location, currentUrl).toString();
    const validatedNext = await validateOutboundUrl(resolvedNext, options);

    if (validatedNext.hostname.toLowerCase() !== prevHost) {
      currentHeaders = new Headers(currentHeaders);
      currentHeaders.delete("authorization");
      currentHeaders.delete("cookie");
    }
    currentUrl = validatedNext.toString();
  }

  throw new Error(`SSRF blocked: exceeded maximum redirect hops (${maxRedirects})`);
}

/** 严格 CORS 来源白名单：生产环境仅允许自有部署域名；仅 NETLIFY_DEV=true 时放行本地调试 */
const EXACT_ALLOWED_ORIGINS = new Set([
  "https://xiaopang-naiwa-music.netlify.app",
  "https://erryp8126-source.github.io",
]);

function isTrustedOrigin(origin: string): boolean {
  const normalized = origin.trim().replace(/\/+$/, "").toLowerCase();
  if (EXACT_ALLOWED_ORIGINS.has(normalized)) return true;
  if (/^https:\/\/[a-z0-9-]+--xiaopang-naiwa-music\.netlify\.app$/.test(normalized)) return true;
  if (process.env.NETLIFY_DEV === "true" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
    return true;
  }
  return false;
}

/** 优先提取 Origin，缺失时回退提取 Referer 的 origin */
function extractRequestOrigin(req: Request): string | null {
  const originHeader = req.headers.get("origin")?.trim();
  if (originHeader) return originHeader;

  const refererHeader = req.headers.get("referer")?.trim();
  if (refererHeader) {
    try {
      const parsed = new URL(refererHeader);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      return null;
    }
  }
  return null;
}

let warnedNoApiSecret = false;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 服务端鉴权：
 * - 若配置了环境变量 APP_API_SECRET，强制校验 X-App-Api-Key 或 HMAC-SHA256 签名（X-App-Timestamp + X-App-Signature）
 * - 未配置时仅允许已通过严格 Origin/Referer 白名单校验的可信前端来源，并记录一次告警日志
 */
function verifyApiCredential(req: Request, apiPath: string): boolean {
  const secret = (process.env.APP_API_SECRET || "").trim();
  if (!secret) {
    if (!warnedNoApiSecret) {
      warnedNoApiSecret = true;
      console.warn(
        "[music-api] APP_API_SECRET is not configured; allowing trusted Origin/Referer requests only."
      );
    }
    return true;
  }

  const providedKey = req.headers.get("x-app-api-key")?.trim();
  if (providedKey && timingSafeEqualStr(providedKey, secret)) {
    return true;
  }

  const tsRaw = req.headers.get("x-app-timestamp")?.trim();
  const sigRaw = req.headers.get("x-app-signature")?.trim()?.toLowerCase();
  if (tsRaw && sigRaw) {
    const tsNum = Number(tsRaw);
    if (Number.isFinite(tsNum)) {
      const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
      if (Math.abs(Date.now() - tsMs) <= 5 * 60 * 1000) {
        const expected = crypto
          .createHmac("sha256", secret)
          .update(`${tsRaw}:${req.method.toUpperCase()}:${apiPath}`)
          .digest("hex");
        if (timingSafeEqualStr(sigRaw, expected)) {
          return true;
        }
      }
    }
  }

  return false;
}

const memoryRateLimitMap = new Map<string, { count: number; expiresAt: number }>();

function extractClientIp(req: Request, context?: Context): string {
  const nfIp = req.headers.get("x-nf-client-connection-ip")?.trim();
  if (nfIp) return nfIp;
  const ctxIp = typeof (context as any)?.ip === "string" ? String((context as any).ip).trim() : "";
  if (ctxIp) return ctxIp;
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return "unknown";
}

export const UNBLOCK_ROUTES = new Set(["/music", "/music/unblock"]);

export const AUTH_COOKIE_ROUTES = new Set([
  "/login/qr/check",
  "/login/cellphone",
  "/login/status",
  "/logout",
]);

export const WRITE_RATE_LIMIT_ROUTES = new Set([
  ...AUTH_COOKIE_ROUTES,
  "/login/qr/key",
  "/login/qr/create",
  "/like",
  "/scrobble",
  "/fm_trash",
  "/recommend/songs/dislike",
  "/playlist/create",
  "/playlist/tracks",
  "/playlist/subscribe",
  "/playlist/import/name/task/create",
  "/album/sub",
  "/dj/sub",
]);

export type RateLimitTier = "standard" | "unblock" | "write";

export interface RateLimitPolicy {
  tier: RateLimitTier;
  maxReq: number;
  windowSec: number;
}

export function resolveRateLimitPolicy(apiPath: string): RateLimitPolicy {
  const cleanPath = apiPath.replace(/\/+$/, "") || "/";
  const baseWindowSec = Math.max(1, Number(process.env.RATE_LIMIT_WINDOW_SEC || 60) || 60);
  const strictWindowSec = Math.max(
    1,
    Number(process.env.RATE_LIMIT_STRICT_WINDOW_SEC || baseWindowSec) || baseWindowSec
  );

  if (UNBLOCK_ROUTES.has(cleanPath)) {
    const maxReq = Math.max(
      1,
      Number(process.env.RATE_LIMIT_UNBLOCK_MAX || process.env.RATE_LIMIT_STRICT_MAX || 30) || 30
    );
    return { tier: "unblock", maxReq, windowSec: strictWindowSec };
  }

  if (AUTH_COOKIE_ROUTES.has(cleanPath) || WRITE_RATE_LIMIT_ROUTES.has(cleanPath)) {
    const maxReq = Math.max(
      1,
      Number(process.env.RATE_LIMIT_WRITE_MAX || process.env.RATE_LIMIT_STRICT_MAX || 30) || 30
    );
    return { tier: "write", maxReq, windowSec: strictWindowSec };
  }

  const maxReq = Math.max(1, Number(process.env.RATE_LIMIT_MAX || 120) || 120);
  return { tier: "standard", maxReq, windowSec: baseWindowSec };
}

interface RateLimitDecision {
  allowed: boolean;
  tier: RateLimitTier;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/**
 * 按客户端 IP（x-nf-client-connection-ip）及路由级别（standard / unblock / write）执行分桶窗口限流：
 * 1. 优先使用可配置的外部 Redis REST 存储（RATE_LIMIT_REDIS_REST_URL + RATE_LIMIT_REDIS_REST_TOKEN）
 * 2. 其次使用 Netlify Blobs 部署隔离存储（避免 Serverless 冷启动清零计数）
 * 3. 本地测试或无 Blobs 运行时优雅回退至进程内存窗口计数
 */
async function checkIpRateLimit(clientIp: string, apiPath: string = "/"): Promise<RateLimitDecision> {
  const { tier, maxReq, windowSec } = resolveRateLimitPolicy(apiPath);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowBucket = Math.floor(nowSec / windowSec);
  const retryAfterSec = Math.max(1, (windowBucket + 1) * windowSec - nowSec);
  const ipHash = crypto.createHash("sha256").update(clientIp).digest("hex").slice(0, 24);
  const key = `rl_${tier}_${windowBucket}_${ipHash}`;

  // 1. 可选外部 Redis REST 存储
  const redisUrl = (process.env.RATE_LIMIT_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const redisToken = (process.env.RATE_LIMIT_REDIS_REST_TOKEN || "").trim();
  if (redisUrl && redisToken) {
    try {
      const resp = await fetch(`${redisUrl}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${redisToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, windowSec + 5],
        ]),
        signal: AbortSignal.timeout(2500),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        const count = Number(Array.isArray(data) ? data[0]?.result : 0);
        if (Number.isFinite(count) && count > 0) {
          return {
            allowed: count <= maxReq,
            tier,
            limit: maxReq,
            remaining: Math.max(0, maxReq - count),
            retryAfterSec,
          };
        }
      }
    } catch {
      // fall through to Netlify Blobs / memory
    }
  }

  // 2. Netlify Blobs 持久化窗口计数（跨冷启动生效）
  try {
    const store = getDeployStore({ name: "music-api-ratelimit", consistency: "strong" });
    const existing = (await store.get(key, { type: "json" })) as { count?: number } | null;
    const nextCount = (Number(existing?.count) || 0) + 1;
    await store.setJSON(key, { count: nextCount, windowBucket, updatedAt: Date.now() });
    return {
      allowed: nextCount <= maxReq,
      tier,
      limit: maxReq,
      remaining: Math.max(0, maxReq - nextCount),
      retryAfterSec,
    };
  } catch {
    // 非 Netlify 运行时（如本地单测）自动回退进程内存窗口
  }

  const nowMs = Date.now();
  if (memoryRateLimitMap.size > 2000) {
    for (const [k, entry] of memoryRateLimitMap.entries()) {
      if (entry.expiresAt <= nowMs) memoryRateLimitMap.delete(k);
    }
  }
  const current = memoryRateLimitMap.get(key);
  const nextCount = current && current.expiresAt > nowMs ? current.count + 1 : 1;
  memoryRateLimitMap.set(key, { count: nextCount, expiresAt: nowMs + windowSec * 1000 });
  return {
    allowed: nextCount <= maxReq,
    tier,
    limit: maxReq,
    remaining: Math.max(0, maxReq - nextCount),
    retryAfterSec,
  };
}

/** 仅开放前端实际调用的网易云路由白名单，杜绝将 250+ 全量接口暴露为任意开放代理 */
const ALLOWED_ROUTES = new Set([
  // 认证与账号
  "/login/qr/key",
  "/login/qr/create",
  "/login/qr/check",
  "/login/status",
  "/login/cellphone",
  "/logout",
  "/user/account",
  "/user/detail",
  "/user/playlist",
  "/user/record",
  "/user/follows",
  "/user/followeds",
  // 首页与推荐
  "/banner",
  "/personalized",
  "/personalized/newsong",
  "/personalized/mv",
  "/personalized/privatecontent",
  "/personalized/djprogram",
  "/recommend/songs",
  "/recommend/songs/dislike",
  "/history/recommend/songs",
  "/history/recommend/songs/detail",
  "/personal_fm",
  "/fm_trash",
  // 搜索
  "/cloudsearch",
  "/search/default",
  "/search/hot/detail",
  "/search/suggest",
  // 歌曲、歌词与互动
  "/song/detail",
  "/song/url/v1",
  "/song/download/url/v1",
  "/song/music/detail",
  "/lyric/new",
  "/like",
  "/likelist",
  "/scrobble",
  "/playmode/intelligence/list",
  // 歌单、榜单与专辑
  "/playlist/catlist",
  "/playlist/detail",
  "/playlist/create",
  "/playlist/tracks",
  "/playlist/subscribe",
  "/playlist/import/name/task/create",
  "/playlist/import/task/status",
  "/top/playlist",
  "/top/playlist/highquality",
  "/toplist",
  "/album",
  "/album/new",
  "/album/newest",
  "/album/sub",
  "/album/sublist",
  "/top/album",
  // 歌手与 MV
  "/artist/detail",
  "/artist/songs",
  "/artist/album",
  "/artist/new/song",
  "/top/artists",
  "/mv/all",
  "/mv/detail",
  "/mv/url",
  // 播客 / 电台
  "/dj/banner",
  "/dj/catelist",
  "/dj/category/recommend",
  "/dj/detail",
  "/dj/personalize/recommend",
  "/dj/program",
  "/dj/program/detail",
  "/dj/radio/hot",
  "/dj/recommend",
  "/dj/recommend/type",
  "/dj/sub",
  "/dj/sublist",
  "/dj/today/perfered",
  "/dj/toplist",
  "/comment/dj",
  // 最近播放
  "/record/recent/song",
  "/record/recent/playlist",
  "/record/recent/album",
  "/record/recent/dj",
]);

// AUTH_COOKIE_ROUTES defined & exported above near resolveRateLimitPolicy

let cachedAnonCookie = "";
let anonInitPromise: Promise<string> | null = null;

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, X-App-Api-Key, X-App-Timestamp, X-App-Signature",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Referer",
  };
  if (origin && isTrustedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function parseCookieHeader(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function mergeCookieString(base: Record<string, string>, extra?: string | Record<string, string>): string {
  const merged: Record<string, string> = { ...base };
  if (typeof extra === "string" && extra.trim()) {
    Object.assign(merged, parseCookieHeader(extra));
  } else if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) merged[k] = String(v);
    }
  }
  return Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function ensureAnonymousCookie(): Promise<string> {
  if (cachedAnonCookie) return cachedAnonCookie;
  if (anonInitPromise) return anonInitPromise;
  anonInitPromise = (async () => {
    try {
      const res = await ncmApi.register_anonimous({ realIP: DEFAULT_CN_IP });
      const cookies: string[] = Array.isArray(res?.cookie) ? res.cookie : [];
      const joined = cookies.map((c) => c.split(";")[0]).join("; ");
      const parsed = parseCookieHeader(joined);
      if (parsed.MUSIC_A) {
        cachedAnonCookie = `MUSIC_A=${parsed.MUSIC_A}`;
        try {
          fs.writeFileSync(anonTokenPath, parsed.MUSIC_A, "utf-8");
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore anonymous init failure
    } finally {
      anonInitPromise = null;
    }
    return cachedAnonCookie;
  })();
  return anonInitPromise;
}

function upgradeNeteaseUrlsToHttps(body: any): any {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.data)) {
    for (const item of body.data) {
      if (item && typeof item.url === "string" && item.url.startsWith("http://")) {
        if (item.url.includes(".music.126.net/") || item.url.includes(".126.net/")) {
          item.url = item.url.replace(/^http:\/\//i, "https://");
        }
      }
    }
  } else if (body.data && typeof body.data.url === "string" && body.data.url.startsWith("http://")) {
    if (body.data.url.includes(".music.126.net/") || body.data.url.includes(".126.net/")) {
      body.data.url = body.data.url.replace(/^http:\/\//i, "https://");
    }
  }
  return body;
}

export async function checkAudioUrlReachable(
  rawUrl: string,
  options: {
    expectedDurationMs?: number;
    fetchImpl?: typeof fetch;
    dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  } = {}
): Promise<boolean> {
  if (isSuspiciousKuwoPlaceholderUrl(rawUrl)) return false;
  const minValidBytes = resolveMinValidAudioBytes(options.expectedDurationMs ?? 0);
  const fetchOptions: SafeFetchOptions = {
    allowAnyPublicHost: true,
    fetchImpl: options.fetchImpl,
    dnsLookup: options.dnsLookup,
  };
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  try {
    const headResp = await safeFetchWithRedirects(
      rawUrl,
      {
        method: "HEAD",
        headers: baseHeaders,
        signal: AbortSignal.timeout(5000),
      },
      fetchOptions
    );
    await headResp.body?.cancel?.().catch(() => {});

    if (isDisallowedAudioContentType(headResp.headers.get("content-type"))) {
      return false;
    }

    let shouldFallbackToRangeGet = false;
    if (headResp.ok) {
      const totalBytes = parseTotalBytesFromHeaders(headResp.status, headResp.headers);
      if (totalBytes !== null && totalBytes > 0) {
        return totalBytes >= minValidBytes;
      }
      shouldFallbackToRangeGet = true;
    } else if (HEAD_FALLBACK_CODES.has(headResp.status)) {
      shouldFallbackToRangeGet = true;
    } else {
      return false;
    }

    if (!shouldFallbackToRangeGet) return false;

    const rangeResp = await safeFetchWithRedirects(
      rawUrl,
      {
        method: "GET",
        headers: {
          ...baseHeaders,
          Range: "bytes=0-1",
        },
        signal: AbortSignal.timeout(5000),
      },
      fetchOptions
    );
    await rangeResp.body?.cancel?.().catch(() => {});

    if (rangeResp.status !== 200 && rangeResp.status !== 206) {
      return false;
    }
    if (isDisallowedAudioContentType(rangeResp.headers.get("content-type"))) {
      return false;
    }
    const totalBytes = parseTotalBytesFromHeaders(rangeResp.status, rangeResp.headers);
    if (totalBytes !== null) {
      return totalBytes >= minValidBytes;
    }
    return true;
  } catch {
    return false;
  }
}

export const MIN_CANDIDATE_PASS_SCORE = 35;
export const REJECT_CANDIDATE_SCORE = -1_000_000;
const MAX_SEARCH_CANDIDATES = 8;
const MAX_PROBING_CANDIDATES = 3;

const LIVE_VERSION_REGEX = /(?<![a-z])live(?![a-z])|现场/i;
const SEVERE_VERSION_PATTERNS = [
  /(?<![a-z])dj(?![a-z])/i,
  /(?<![a-z])remix(?![a-z])/i,
  /(?<![a-z])cover(?![a-z])/i,
  /(?<![a-z])instrumental(?![a-z])/i,
  /(?<![a-z])karaoke(?![a-z])/i,
  /(?<![a-z])ktv(?![a-z])/i,
  /(?<![a-z])slowed(?![a-z])/i,
  /(?<![a-z])sped\s+up(?![a-z])/i,
  /(?<![a-z])speed\s+up(?![a-z])/i,
  /伴奏/,
  /翻唱/,
  /片段/,
  /铃声/,
  /纯音乐/,
  /试听/,
  /串烧/,
  /高潮版/,
];

function normalizeTrackText(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const decoded = raw
    .replace(/&amp;/gi, "&")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ");
  let mapped = "";
  for (const ch of decoded) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      mapped += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000 || ch === "《" || ch === "》") {
      mapped += " ";
    } else if (ch === "【" || ch === "「") {
      mapped += "[";
    } else if (ch === "】" || ch === "」") {
      mapped += "]";
    } else {
      mapped += ch;
    }
  }
  return mapped.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripBracketSuffixes(normalized: string): string {
  if (!normalized) return "";
  const cleaned = normalized
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(
      /\s+-\s+(?:live|现场|dj|remix|伴奏|翻唱|cover|片段|铃声|纯音乐|instrumental|karaoke|ktv|试听|串烧|高潮版|slowed|sped\s+up|speed\s+up|ver\.?|version|edit|mix|acoustic).*$/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || normalized;
}

function compactTrackText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitArtistTokens(artists: string): string[] {
  const norm = normalizeTrackText(artists);
  if (!norm) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of norm.split(/[\s/,&、+·;；|]+/)) {
    const token = compactTrackText(stripBracketSuffixes(part));
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export function parseDurationToMs(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 10_000 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmed);
  if (clock) {
    const p1 = Number(clock[1] || 0);
    const p2 = Number(clock[2] || 0);
    const p3 = clock[3] ? Number(clock[3]) : null;
    return p3 !== null ? (p1 * 3600 + p2 * 60 + p3) * 1000 : (p1 * 60 + p2) * 1000;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 10_000 ? Math.round(num * 1000) : Math.round(num);
}

export function scoreCandidateMatch(params: {
  targetTitle: string;
  targetArtists: string;
  expectedDurationMs?: number;
  candidateTitle: string;
  candidateArtists: string;
  candidateDurationMs?: number;
}): number {
  const targetRawNorm = normalizeTrackText(params.targetTitle);
  const candRawNorm = normalizeTrackText(params.candidateTitle);
  const targetCoreStr = stripBracketSuffixes(targetRawNorm);
  const candCoreStr = stripBracketSuffixes(candRawNorm);

  const targetRawCompact = compactTrackText(targetRawNorm);
  const candRawCompact = compactTrackText(candRawNorm);
  const targetCore = compactTrackText(targetCoreStr) || targetRawCompact;
  const candCore = compactTrackText(candCoreStr) || candRawCompact;

  let score = 0;

  if (targetCore) {
    if (!candCore) return REJECT_CANDIDATE_SCORE;
    if (candCore === targetCore || (candRawCompact && candRawCompact === targetRawCompact)) {
      score += 60;
      if (candRawCompact === targetRawCompact) score += 10;
    } else if (targetCore.length >= 2 && candCore.includes(targetCore)) {
      score += 42;
    } else if (
      candCore.length >= 2 &&
      targetCore.includes(candCore) &&
      candCore.length / targetCore.length >= 0.5
    ) {
      score += 32;
    } else {
      const targetTokens = (targetCoreStr.match(/[\p{L}\p{N}]{2,}/gu) || []).map((t) =>
        compactTrackText(t)
      );
      if (targetTokens.length >= 2 && targetTokens.every((t) => candCore.includes(t))) {
        score += 30;
      } else {
        return REJECT_CANDIDATE_SCORE;
      }
    }
  }

  const targetArtistTokens = splitArtistTokens(params.targetArtists);
  const candArtistTokens = splitArtistTokens(params.candidateArtists);
  if (targetArtistTokens.length > 0 && candArtistTokens.length > 0) {
    const matched = targetArtistTokens.filter((t) =>
      candArtistTokens.some(
        (c) => c === t || (Math.min(c.length, t.length) >= 2 && (c.includes(t) || t.includes(c)))
      )
    ).length;
    if (matched === targetArtistTokens.length) {
      score += 40;
    } else if (matched > 0) {
      score += 30;
    } else {
      score -= 65;
    }
  }

  if (LIVE_VERSION_REGEX.test(candRawNorm) && !LIVE_VERSION_REGEX.test(targetRawNorm)) {
    score -= 45;
  }
  const hasUndesiredVersion = SEVERE_VERSION_PATTERNS.some(
    (pat) => pat.test(candRawNorm) && !pat.test(targetRawNorm)
  );
  if (hasUndesiredVersion) {
    score -= 105;
  }

  const expectedDurationMs = params.expectedDurationMs ?? 0;
  const candidateDurationMs = params.candidateDurationMs ?? 0;
  if (expectedDurationMs > SHORT_TRACK_DURATION_THRESHOLD_MS && candidateDurationMs > 0) {
    const diffMs = Math.abs(candidateDurationMs - expectedDurationMs);
    const ratio = diffMs / expectedDurationMs;
    if (diffMs <= 15_000) {
      score += 25;
    } else if (ratio <= 0.2) {
      score += 10;
    } else if (ratio <= 0.35) {
      score -= 15;
    } else {
      score -= 85;
    }
  }

  return score;
}

export function rankCandidates<T>(
  items: T[],
  extractor: (item: T) => { title: string; artists: string; durationMs?: number },
  target: { targetTitle: string; targetArtists: string; expectedDurationMs?: number }
): Array<{ item: T; score: number }> {
  return items
    .slice(0, MAX_SEARCH_CANDIDATES)
    .map((item, idx) => {
      const info = extractor(item);
      const score = scoreCandidateMatch({
        targetTitle: target.targetTitle,
        targetArtists: target.targetArtists,
        expectedDurationMs: target.expectedDurationMs ?? 0,
        candidateTitle: info.title,
        candidateArtists: info.artists,
        candidateDurationMs: info.durationMs ?? 0,
      });
      return { item, score, idx };
    })
    .filter((entry) => entry.score >= MIN_CANDIDATE_PASS_SCORE)
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.idx - b.idx))
    .map(({ item, score }) => ({ item, score }));
}

async function handleMusicUnblock(params: Record<string, any>, corsHeaders: Record<string, string>): Promise<Response> {
  const id = String(params.id || "").trim();
  if (!/^\d{1,16}$/.test(id)) {
    return Response.json(
      { code: 400, message: "Invalid song id", data: null },
      { status: 400, headers: corsHeaders }
    );
  }

  let songName = String(params.name || "").trim().slice(0, 80);
  let artistName = String(params.artist || "").trim().slice(0, 80);
  let expectedDurationMs = Number(params.dt || params.duration || 0) || 0;

  if (!songName || expectedDurationMs <= 0) {
    try {
      const anonCookie = await ensureAnonymousCookie();
      const detail = await ncmApi.song_detail({
        ids: id,
        cookie: anonCookie,
        realIP: DEFAULT_CN_IP,
      });
      const song = detail?.body?.songs?.[0];
      if (song) {
        if (!songName) {
          songName = String(song.name || "").slice(0, 80);
        }
        if (!artistName) {
          artistName = Array.isArray(song.ar)
            ? song.ar.map((a: any) => a.name).join(" ").slice(0, 80)
            : "";
        }
        if (expectedDurationMs <= 0 && Number(song.dt) > 0) {
          expectedDurationMs = Number(song.dt);
        }
      }
    } catch {
      // continue to direct lookup
    }
  }

  const tryGdMusic = async (source: string, trackId: string, br: string = "320"): Promise<string | null> => {
    try {
      const urlResp = await safeFetchWithRedirects(
        `https://music-api.gdstudio.xyz/api.php?types=url&source=${encodeURIComponent(source)}&id=${encodeURIComponent(trackId)}&br=${encodeURIComponent(br)}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!urlResp.ok) return null;
      const json: any = await urlResp.json();
      const rawAudioUrl = typeof json?.url === "string" ? json.url.trim() : "";
      if (rawAudioUrl && rawAudioUrl.startsWith("http")) {
        const audioUrl = rawAudioUrl.replace(/^http:\/\/([^/]*\.126\.net\/)/i, "https://$1");
        if (await checkAudioUrlReachable(audioUrl, { expectedDurationMs })) {
          return audioUrl;
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  // 默认优先 pyncmd 通道（精准网易云 ID 无损 -> 320k）
  const directUrl = (await tryGdMusic("netease", id, "999")) || (await tryGdMusic("netease", id, "320"));
  if (directUrl) {
    return Response.json(
      { code: 200, message: "success", data: { url: directUrl, source: "pyncmd" } },
      { status: 200, headers: corsHeaders }
    );
  }

  if (songName) {
    const keyword = `${songName} ${artistName}`.trim();
    for (const source of ["joox", "netease", "kuwo"]) {
      try {
        const searchResp = await safeFetchWithRedirects(
          `https://music-api.gdstudio.xyz/api.php?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${MAX_SEARCH_CANDIDATES}&pages=1`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            signal: AbortSignal.timeout(6500),
          }
        );
        if (!searchResp.ok) continue;
        const list: any = await searchResp.json();
        if (!Array.isArray(list) || list.length === 0) continue;
        const ranked = rankCandidates(
          list,
          (matched: any) => ({
            title: String(matched?.name || ""),
            artists: Array.isArray(matched?.artist)
              ? matched.artist
                  .map((a: any) => (typeof a === "string" ? a : a?.name || ""))
                  .filter(Boolean)
                  .join(" ")
              : String(matched?.artist || ""),
            durationMs: parseDurationToMs(matched?.duration ?? matched?.dt ?? matched?.time),
          }),
          { targetTitle: songName, targetArtists: artistName, expectedDurationMs }
        );
        for (const { item: matched } of ranked.slice(0, MAX_PROBING_CANDIDATES)) {
          const trackId = matched?.url_id || matched?.id;
          if (!trackId) continue;
          const resolved = await tryGdMusic(source, String(trackId));
          if (resolved) {
            return Response.json(
              { code: 200, message: "success", data: { url: resolved, source: `gdmusic-${source}` } },
              { status: 200, headers: corsHeaders }
            );
          }
        }
      } catch {
        // try next source
      }
    }
  }

  return Response.json(
    { code: 404, message: "未能解析到可用音源", data: null },
    { status: 200, headers: corsHeaders }
  );
}

const SPECIAL_ROUTES: Record<string, string> = {
  "/fm_trash": "fm_trash",
  "/personal_fm": "personal_fm",
};

function resolveModuleName(apiPath: string): string {
  const clean = apiPath.replace(/\/+$/, "") || "/";
  if (SPECIAL_ROUTES[clean]) return SPECIAL_ROUTES[clean];
  return clean.replace(/^\/+/, "").replace(/\//g, "_");
}

export default async (req: Request, context: Context): Promise<Response> => {
  const resolvedOrigin = extractRequestOrigin(req);
  if (!resolvedOrigin || !isTrustedOrigin(resolvedOrigin)) {
    return Response.json(
      { code: 403, msg: "Forbidden Origin" },
      { status: 403, headers: { Vary: "Origin, Referer" } }
    );
  }

  const corsHeaders = buildCorsHeaders(resolvedOrigin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") {
    return Response.json(
      { code: 405, msg: "Method Not Allowed" },
      { status: 405, headers: corsHeaders }
    );
  }

  const reqUrl = new URL(req.url);
  let apiPath = reqUrl.pathname
    .replace(/^\/\.netlify\/functions\/music-api/, "")
    .replace(/^\/api(?=\/|$)/, "")
    .replace(/\/+$/, "");
  if (!apiPath.startsWith("/")) apiPath = `/${apiPath}`;

  if (!verifyApiCredential(req, apiPath)) {
    return Response.json(
      { code: 401, msg: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  const clientIp = extractClientIp(req, context);
  const rl = await checkIpRateLimit(clientIp, apiPath);
  const rateHeaders: Record<string, string> = {
    ...corsHeaders,
    "X-RateLimit-Tier": rl.tier,
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
  };
  if (!rl.allowed) {
    return Response.json(
      { code: 429, msg: "Too Many Requests" },
      {
        status: 429,
        headers: {
          ...rateHeaders,
          "Retry-After": String(rl.retryAfterSec),
        },
      }
    );
  }

  if (apiPath === "/" || apiPath === "/health") {
    const commit = (process.env.COMMIT_REF || "").trim().slice(0, 7) || "local";
    return Response.json(
      {
        ok: true,
        service: "xiaopang-naiwa-music-api",
        version: SERVICE_VERSION,
        commit,
      },
      { status: 200, headers: rateHeaders }
    );
  }

  // 检查请求体体积上限（防大包滥用）
  const declaredLen = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return Response.json(
      { code: 413, msg: "Payload Too Large" },
      { status: 413, headers: rateHeaders }
    );
  }

  const params: Record<string, any> = {};
  reqUrl.searchParams.forEach((value, key) => {
    if (value.length <= 8192) {
      params[key] = value;
    }
  });

  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";
    try {
      const rawText = await req.text();
      if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
        return Response.json(
          { code: 413, msg: "Payload Too Large" },
          { status: 413, headers: rateHeaders }
        );
      }
      if (rawText.trim()) {
        if (contentType.includes("application/json")) {
          const jsonBody = JSON.parse(rawText);
          if (jsonBody && typeof jsonBody === "object" && !Array.isArray(jsonBody)) {
            Object.assign(params, jsonBody);
          }
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const form = new URLSearchParams(rawText);
          form.forEach((value, key) => {
            params[key] = value;
          });
        }
      }
    } catch {
      return Response.json(
        { code: 400, msg: "Malformed request body" },
        { status: 400, headers: rateHeaders }
      );
    }
  }

  // 严禁外部传入 proxy 或 realIP（含大小写变体）滥用服务端做跳板/SSRF
  for (const key of Object.keys(params)) {
    if (/^(proxy|realip)$/i.test(key)) {
      delete params[key];
    }
  }

  if (UNBLOCK_ROUTES.has(apiPath)) {
    return handleMusicUnblock(params, rateHeaders);
  }

  if (!ALLOWED_ROUTES.has(apiPath)) {
    return Response.json(
      { code: 404, msg: `Route not allowed: ${apiPath}` },
      { status: 404, headers: rateHeaders }
    );
  }

  const moduleName = resolveModuleName(apiPath);
  const apiFn = ncmApi[moduleName];
  if (typeof apiFn !== "function") {
    return Response.json(
      { code: 404, msg: `Unknown API route: ${apiPath}` },
      { status: 404, headers: rateHeaders }
    );
  }

  const headerCookies = parseCookieHeader(req.headers.get("cookie"));
  let cookieStr = mergeCookieString(headerCookies, params.cookie);
  if (!cookieStr.includes("MUSIC_U=") && !cookieStr.includes("MUSIC_A=")) {
    const anon = await ensureAnonymousCookie();
    if (anon) {
      cookieStr = mergeCookieString(parseCookieHeader(anon), cookieStr);
    }
  }

  const callParams: Record<string, any> = {
    ...params,
    cookie: cookieStr,
    realIP: DEFAULT_CN_IP,
  };

  try {
    const result = await apiFn(callParams);
    let body = result?.body ?? {};
    const status = Number(result?.status) || 200;

    if (apiPath.startsWith("/song/url") || apiPath.startsWith("/song/download/url")) {
      body = upgradeNeteaseUrlsToHttps(body);
    }

    const resHeaders = new Headers(rateHeaders);
    resHeaders.set("Content-Type", "application/json; charset=utf-8");

    if (
      req.method === "GET" &&
      status === 200 &&
      ["/personalized", "/personalized/newsong", "/search/hot/detail", "/toplist", "/banner", "/top/playlist"].includes(
        apiPath
      )
    ) {
      resHeaders.set("Cache-Control", "public, max-age=60");
    } else {
      resHeaders.set("Cache-Control", "no-store");
    }

    // 仅在登录/登出认证类路由上按需回写 Set-Cookie，避免普通浏览接口不必要地透传 Cookie
    const setCookies: string[] = Array.isArray(result?.cookie) ? result.cookie : [];
    if (AUTH_COOKIE_ROUTES.has(apiPath) && !params.noCookie && setCookies.length > 0) {
      for (const rawCookie of setCookies) {
        if (typeof rawCookie === "string" && rawCookie.trim()) {
          const patched = rawCookie.includes("SameSite=")
            ? rawCookie
            : `${rawCookie}; SameSite=None; Secure`;
          resHeaders.append("Set-Cookie", patched);
        }
      }
    }

    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: resHeaders,
    });
  } catch (err: any) {
    const errStatus = Number(err?.status) || 500;
    const errBody = err?.body || {
      code: errStatus,
      msg: err?.message || "Upstream NetEase API request failed",
    };
    return new Response(typeof errBody === "string" ? errBody : JSON.stringify(errBody), {
      status: errStatus >= 200 && errStatus < 600 ? errStatus : 500,
      headers: {
        ...rateHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
};

export const config: Config = {
  path: "/api/*",
  rateLimit: {
    windowLimit: 180,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
    action: "rate_limit",
  },
};
