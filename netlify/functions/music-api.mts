import type { Config, Context } from "@netlify/functions";
import fs from "node:fs";
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

const DEFAULT_CN_IP = "116.25.146.177";
const MAX_BODY_BYTES = 64 * 1024; // 限制单次请求体最大 64 KB，防资源滥用

/** 严格 CORS 来源白名单：仅允许自有部署域名与本地开发调试 */
const EXACT_ALLOWED_ORIGINS = new Set([
  "https://xiaopang-naiwa-music.netlify.app",
  "https://erryp8126-source.github.io",
]);

function isTrustedOrigin(origin: string): boolean {
  const normalized = origin.trim().replace(/\/+$/, "").toLowerCase();
  if (EXACT_ALLOWED_ORIGINS.has(normalized)) return true;
  if (/^https:\/\/[a-z0-9-]+--xiaopang-naiwa-music\.netlify\.app$/.test(normalized)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return false;
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

const AUTH_COOKIE_ROUTES = new Set([
  "/login/qr/check",
  "/login/cellphone",
  "/login/status",
  "/logout",
]);

let cachedAnonCookie = "";
let anonInitPromise: Promise<string> | null = null;

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
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

  if (!songName) {
    try {
      const anonCookie = await ensureAnonymousCookie();
      const detail = await ncmApi.song_detail({
        ids: id,
        cookie: anonCookie,
        realIP: DEFAULT_CN_IP,
      });
      const song = detail?.body?.songs?.[0];
      if (song) {
        songName = String(song.name || "").slice(0, 80);
        artistName = Array.isArray(song.ar)
          ? song.ar.map((a: any) => a.name).join(" ").slice(0, 80)
          : "";
      }
    } catch {
      // continue to direct lookup
    }
  }

  const tryGdMusic = async (source: string, trackId: string): Promise<string | null> => {
    try {
      const urlResp = await fetch(
        `https://music-api.gdstudio.xyz/api.php?types=url&source=${encodeURIComponent(source)}&id=${encodeURIComponent(trackId)}&br=320`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!urlResp.ok) return null;
      const json: any = await urlResp.json();
      const audioUrl = typeof json?.url === "string" ? json.url.trim() : "";
      if (audioUrl && audioUrl.startsWith("http")) {
        return audioUrl.replace(/^http:\/\/([^/]*\.126\.net\/)/i, "https://$1");
      }
    } catch {
      // ignore
    }
    return null;
  };

  const directUrl = await tryGdMusic("netease", id);
  if (directUrl) {
    return Response.json(
      { code: 200, message: "success", data: { url: directUrl, source: "gdmusic-netease" } },
      { status: 200, headers: corsHeaders }
    );
  }

  if (songName) {
    const keyword = `${songName} ${artistName}`.trim();
    for (const source of ["kuwo", "joox", "netease"]) {
      try {
        const searchResp = await fetch(
          `https://music-api.gdstudio.xyz/api.php?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=3&pages=1`,
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
        const matched = list[0];
        const trackId = matched?.url_id || matched?.id;
        if (!trackId) continue;
        const resolved = await tryGdMusic(source, String(trackId));
        if (resolved) {
          return Response.json(
            { code: 200, message: "success", data: { url: resolved, source: `gdmusic-${source}` } },
            { status: 200, headers: corsHeaders }
          );
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

export default async (req: Request, _context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (origin && !isTrustedOrigin(origin)) {
    return Response.json(
      { code: 403, msg: "Forbidden Origin" },
      { status: 403, headers: { Vary: "Origin" } }
    );
  }

  const corsHeaders = buildCorsHeaders(origin);

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

  if (apiPath === "/" || apiPath === "/health") {
    return Response.json(
      { ok: true, service: "xiaopang-naiwa-music-api", version: "5.1.4" },
      { status: 200, headers: corsHeaders }
    );
  }

  // 检查请求体体积上限（防大包滥用）
  const declaredLen = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return Response.json(
      { code: 413, msg: "Payload Too Large" },
      { status: 413, headers: corsHeaders }
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
          { status: 413, headers: corsHeaders }
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
        { status: 400, headers: corsHeaders }
      );
    }
  }

  // 严禁外部传入 proxy 或 realIP 滥用服务端做跳板/SSRF
  delete params.proxy;
  delete params.realIP;

  if (apiPath === "/music") {
    return handleMusicUnblock(params, corsHeaders);
  }

  if (!ALLOWED_ROUTES.has(apiPath)) {
    return Response.json(
      { code: 404, msg: `Route not allowed: ${apiPath}` },
      { status: 404, headers: corsHeaders }
    );
  }

  const moduleName = resolveModuleName(apiPath);
  const apiFn = ncmApi[moduleName];
  if (typeof apiFn !== "function") {
    return Response.json(
      { code: 404, msg: `Unknown API route: ${apiPath}` },
      { status: 404, headers: corsHeaders }
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

    const resHeaders = new Headers(corsHeaders);
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
        ...corsHeaders,
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
