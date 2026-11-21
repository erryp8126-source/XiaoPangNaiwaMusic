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

let cachedAnonCookie = "";
let anonInitPromise: Promise<string> | null = null;

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Cookie",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
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
  if (!id) {
    return Response.json(
      { code: 400, message: "Missing song id", data: null },
      { status: 400, headers: corsHeaders }
    );
  }

  let songName = String(params.name || "").trim();
  let artistName = String(params.artist || "").trim();

  // 如果前端只传了 id，则先通过网易云 song_detail 自动反查歌名与歌手，提升跨平台匹配准确率
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
        songName = song.name || "";
        artistName = Array.isArray(song.ar) ? song.ar.map((a: any) => a.name).join(" ") : "";
      }
    } catch {
      // continue to direct GDMusic netease id lookup
    }
  }

  // 1. 优先尝试 GD音乐台（直接支持网易云 ID + 酷我/酷狗/咪咕多源检索，且多数直接返回 HTTPS 链接）
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

  // 1a. 先用网易云原 ID 直查 GDMusic
  const directUrl = await tryGdMusic("netease", id);
  if (directUrl) {
    return Response.json(
      { code: 200, message: "success", data: { url: directUrl, source: "gdmusic-netease" } },
      { status: 200, headers: corsHeaders }
    );
  }

  // 1b. 用歌名+歌手跨源检索 kuwo / joox / migu
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
  "/daily_signin": "daily_signin",
  "/fm_trash": "fm_trash",
  "/personal_fm": "personal_fm",
};

function resolveModuleName(apiPath: string): string {
  const clean = apiPath.replace(/\/+$/, "") || "/";
  if (SPECIAL_ROUTES[clean]) return SPECIAL_ROUTES[clean];
  return clean.replace(/^\/+/, "").replace(/\//g, "_");
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const reqUrl = new URL(req.url);
  // 兼容 /api/xxx 与 /.netlify/functions/music-api/xxx
  let apiPath = reqUrl.pathname
    .replace(/^\/\.netlify\/functions\/music-api/, "")
    .replace(/^\/api(?=\/|$)/, "");
  if (!apiPath.startsWith("/")) apiPath = `/${apiPath}`;

  if (apiPath === "/" || apiPath === "/health") {
    return Response.json(
      { ok: true, service: "xiaopang-naiwa-music-api", version: "5.1.3" },
      { status: 200, headers: corsHeaders }
    );
  }

  // 解析 Query + JSON/Form Body 参数
  const params: Record<string, any> = {};
  reqUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        const jsonBody = await req.json();
        if (jsonBody && typeof jsonBody === "object") {
          Object.assign(params, jsonBody);
        }
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        const form = new URLSearchParams(text);
        form.forEach((value, key) => {
          params[key] = value;
        });
      }
    } catch {
      // ignore empty/malformed body
    }
  }

  // 专属多平台音源解析入口（Web / Safari PWA 播放 VIP/灰歌回退）
  if (apiPath === "/music") {
    return handleMusicUnblock(params, corsHeaders);
  }

  const moduleName = resolveModuleName(apiPath);
  const apiFn = ncmApi[moduleName];
  if (typeof apiFn !== "function") {
    return Response.json(
      { code: 404, msg: `Unknown API route: ${apiPath}` },
      { status: 404, headers: corsHeaders }
    );
  }

  // 合并浏览器 Cookie、显式传参 cookie 与匿名 MUSIC_A Cookie
  const headerCookies = parseCookieHeader(req.headers.get("cookie"));
  let cookieStr = mergeCookieString(headerCookies, params.cookie);
  if (!cookieStr.includes("MUSIC_U=") && !cookieStr.includes("MUSIC_A=") && moduleName !== "register_anonimous") {
    const anon = await ensureAnonymousCookie();
    if (anon) {
      cookieStr = mergeCookieString(parseCookieHeader(anon), cookieStr);
    }
  }

  const callParams: Record<string, any> = {
    ...params,
    cookie: cookieStr,
    realIP: params.realIP || DEFAULT_CN_IP,
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

    // 静态列表类接口适度开启短缓存，提升首页秒开体验
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

    const setCookies: string[] = Array.isArray(result?.cookie) ? result.cookie : [];
    if (!params.noCookie && setCookies.length > 0) {
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
};
