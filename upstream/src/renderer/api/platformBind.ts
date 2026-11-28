import request from '@/utils/request';

const NO_AUTH_GUARD_PARAMS = { noLogin: true, noCookie: true };

export interface BilibiliFavFolder {
  id: number;
  title: string;
  mediaCount: number;
}

export interface BilibiliFavResource {
  id: number;
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  durationSec: number;
  authorName: string;
}

export interface QqBoundPlaylistSummary {
  tid: string;
  name: string;
  cover: string;
  songCount: number;
}

export interface QqBoundPlaylistTrack {
  id: number;
  mid: string;
  name: string;
  artists: Array<{ id: number; name: string }>;
  albumName: string;
  albumMid: string;
  durationMs: number;
  picUrl: string;
}

export function generateBilibiliQr() {
  return request.get('/bind/bilibili/qr/generate', {
    params: { ...NO_AUTH_GUARD_PARAMS },
    noRetry: true
  } as any);
}

export function pollBilibiliQr(qrcodeKey: string) {
  return request.post(
    '/bind/bilibili/qr/poll',
    { qrcode_key: qrcodeKey },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function fetchBilibiliNav(cookie: string) {
  return request.post(
    '/bind/bilibili/nav',
    { cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function fetchBilibiliFavFolders(uid: string, cookie: string) {
  return request.post(
    '/bind/bilibili/fav/folders',
    { uid, cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function fetchBilibiliFavResources(
  mediaId: number | string,
  pn: number,
  ps: number,
  cookie: string
) {
  return request.post(
    '/bind/bilibili/fav/resources',
    { mediaId: String(mediaId), pn, ps, cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function resolveBilibiliAudioUrl(params: {
  bvid: string;
  cid?: number | string;
  cookie?: string;
}) {
  return request.post(
    '/bind/bilibili/audio/resolve',
    {
      bvid: params.bvid,
      cid: params.cid ? String(params.cid) : '',
      cookie: params.cookie || ''
    },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function generateQqQr() {
  return request.get('/bind/qq/qr/generate', {
    params: { ...NO_AUTH_GUARD_PARAMS },
    noRetry: true
  } as any);
}

export function pollQqQr(qrsig: string) {
  return request.post(
    '/bind/qq/qr/poll',
    { qrsig },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function verifyQqProfile(cookie: string) {
  return request.post(
    '/bind/qq/profile',
    { cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function fetchQqPlaylists(uid: string, cookie: string) {
  return request.post(
    '/bind/qq/playlists',
    { uid, cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function fetchQqPlaylistDetail(tid: string, cookie: string) {
  return request.post(
    '/bind/qq/playlist/detail',
    { tid, cookie },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true } as any
  );
}

export function resolveQqBoundUnblockUrl(params: {
  name: string;
  artist?: string;
  dt?: number;
  cookie: string;
}) {
  return request.post(
    '/bind/qq/unblock',
    {
      name: params.name,
      artist: params.artist || '',
      dt: params.dt ? String(params.dt) : '0',
      cookie: params.cookie
    },
    { params: { ...NO_AUTH_GUARD_PARAMS }, noRetry: true, timeout: 10000 } as any
  );
}
