import { getSearch } from '@/api/search';
import type { SongResult } from '@/types/music';
import { upgradeExternalHttpToHttps } from '@/utils/imageUrl';
import {
  FALLBACK_TO_TEXT_MESSAGE,
  IMPORT_MATCH_CONCURRENCY,
  IMPORT_MATCH_DELAY_MS,
  type ImportedRawTrack,
  pickBestImportCandidate,
  runConcurrentPool
} from '@/utils/playlistImport';
import request from '@/utils/request';

export interface ExternalPlaylistParseResponse {
  code: number;
  ok: boolean;
  platform?: string;
  playlistName?: string;
  tracks?: ImportedRawTrack[];
  fallbackToText?: boolean;
  blocked?: boolean;
  message?: string;
}

export interface MatchedImportItem {
  key: string;
  raw: ImportedRawTrack;
  song: SongResult;
  score: number;
}

export interface MatchBatchProgress {
  done: number;
  total: number;
  matchedCount: number;
  unmatchedCount: number;
  currentTrack?: ImportedRawTrack;
}

export interface MatchBatchResult {
  matched: MatchedImportItem[];
  unmatched: ImportedRawTrack[];
  cancelled: boolean;
}

export async function parseExternalPlaylistLink(
  url: string
): Promise<ExternalPlaylistParseResponse> {
  try {
    const res: any = await request.post(
      '/playlist/import/external',
      { url },
      { params: { noLogin: true, noCookie: true }, noRetry: true, timeout: 15000 } as any
    );
    const data = res?.data;
    if (data && typeof data === 'object') {
      return data as ExternalPlaylistParseResponse;
    }
    return {
      code: 200,
      ok: false,
      fallbackToText: true,
      message: FALLBACK_TO_TEXT_MESSAGE
    };
  } catch (err: any) {
    const errData = err?.response?.data;
    if (errData && typeof errData === 'object' && errData.blocked) {
      return errData as ExternalPlaylistParseResponse;
    }
    return {
      code: 200,
      ok: false,
      fallbackToText: true,
      message: FALLBACK_TO_TEXT_MESSAGE
    };
  }
}

function normalizeNeteaseSongResult(s: any): SongResult {
  const ar = Array.isArray(s?.ar)
    ? s.ar
    : Array.isArray(s?.artists)
      ? s.artists
      : [];
  const al = s?.al || s?.album || { id: 0, name: '', picUrl: '' };
  const safePic = upgradeExternalHttpToHttps(s?.picUrl || al?.picUrl || '');
  return {
    ...s,
    id: s.id,
    name: String(s?.name || ''),
    picUrl: safePic,
    ar: ar.map((a: any) => ({ id: a?.id || 0, name: String(a?.name || '') })),
    al: {
      ...al,
      picUrl: upgradeExternalHttpToHttps(al?.picUrl || safePic)
    },
    dt: Number(s?.dt || s?.duration || 0),
    count: Number(s?.count) || 0,
    source: 'netease'
  } as SongResult;
}

async function fetchSongDetailsByIds(
  ids: number[],
  signal?: AbortSignal
): Promise<Map<number, SongResult>> {
  const out = new Map<number, SongResult>();
  if (ids.length === 0 || signal?.aborted) return out;

  const CHUNK_SIZE = 50;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    if (signal?.aborted) break;
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    try {
      const res: any = await request.get('/song/detail', {
        params: { ids: chunk.join(','), noLogin: true },
        noRetry: true
      } as any);
      const songs: any[] = Array.isArray(res?.data?.songs) ? res.data.songs : [];
      for (const s of songs) {
        const sid = Number(s?.id);
        if (Number.isFinite(sid) && sid > 0) {
          out.set(sid, normalizeNeteaseSongResult(s));
        }
      }
    } catch {
      // fall through to search fallback for missing IDs
    }
  }
  return out;
}

/**
 * 批量匹配解析出的曲目到当前曲库：
 * - 带有效 NetEase ID 的曲目优先通过批量 /song/detail 快速直连
 * - 其余曲目按最大并发 3 + 120ms 间隔控速搜索，并经防串歌/Live/翻唱打分器选最优解
 */
export async function matchImportedTracksBatch(
  rawTracks: ImportedRawTrack[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: MatchBatchProgress) => void;
  } = {}
): Promise<MatchBatchResult> {
  const total = rawTracks.length;
  if (total === 0) {
    return { matched: [], unmatched: [], cancelled: false };
  }

  const slotResults: Array<MatchedImportItem | null> = new Array(total).fill(null);
  let doneCount = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;

  const idQueue: Array<{ idx: number; track: ImportedRawTrack }> = [];
  const searchQueue: Array<{ idx: number; track: ImportedRawTrack }> = [];

  rawTracks.forEach((track, idx) => {
    if (track.neteaseId && track.neteaseId > 0) {
      idQueue.push({ idx, track });
    } else {
      searchQueue.push({ idx, track });
    }
  });

  if (idQueue.length > 0 && !options.signal?.aborted) {
    const detailMap = await fetchSongDetailsByIds(
      idQueue.map((item) => item.track.neteaseId as number),
      options.signal
    );
    for (const item of idQueue) {
      if (options.signal?.aborted) break;
      const hit = detailMap.get(item.track.neteaseId as number);
      if (hit) {
        slotResults[item.idx] = {
          key: `imp-${item.idx}-${hit.id}`,
          raw: item.track,
          song: hit,
          score: 120
        };
        doneCount++;
        matchedCount++;
        options.onProgress?.({
          done: doneCount,
          total,
          matchedCount,
          unmatchedCount,
          currentTrack: item.track
        });
      } else {
        searchQueue.push(item);
      }
    }
  }

  if (searchQueue.length > 0 && !options.signal?.aborted) {
    await runConcurrentPool(
      searchQueue,
      {
        concurrency: IMPORT_MATCH_CONCURRENCY,
        delayMs: IMPORT_MATCH_DELAY_MS,
        signal: options.signal,
        onProgress: (_, __, currentEntry) => {
          options.onProgress?.({
            done: doneCount,
            total,
            matchedCount,
            unmatchedCount,
            currentTrack: currentEntry?.track
          });
        }
      },
      async (entry) => {
        if (options.signal?.aborted) return null;
        const { idx, track } = entry;
        const cleanArtist = track.artist ? track.artist.replace(/[/、&|]+/g, ' ').trim() : '';
        const keywords = cleanArtist ? `${track.title} ${cleanArtist}` : track.title;

        try {
          const res: any = await getSearch({
            keywords,
            type: 1,
            limit: 8
          });
          if (options.signal?.aborted) return null;

          const songs: any[] = Array.isArray(res?.data?.result?.songs) ? res.data.result.songs : [];
          const picked = pickBestImportCandidate(
            songs,
            (s: any) => ({
              title: String(s?.name || ''),
              artists: Array.isArray(s?.ar)
                ? s.ar.map((a: any) => a?.name).filter(Boolean).join(' ')
                : Array.isArray(s?.artists)
                  ? s.artists.map((a: any) => a?.name).filter(Boolean).join(' ')
                  : '',
              durationMs: Number(s?.dt || s?.duration || 0)
            }),
            {
              targetTitle: track.title,
              targetArtists: track.artist,
              expectedDurationMs: track.durationMs
            }
          );

          doneCount++;
          if (picked) {
            const song = normalizeNeteaseSongResult(picked.item);
            slotResults[idx] = {
              key: `imp-${idx}-${song.id}`,
              raw: track,
              song,
              score: picked.score
            };
            matchedCount++;
            return slotResults[idx];
          }
          unmatchedCount++;
          return null;
        } catch {
          if (!options.signal?.aborted) {
            doneCount++;
            unmatchedCount++;
          }
          return null;
        }
      }
    );
  }

  const matched: MatchedImportItem[] = [];
  const unmatched: ImportedRawTrack[] = [];
  const seenSongIds = new Set<string>();

  for (let i = 0; i < total; i++) {
    const hit = slotResults[i];
    if (hit) {
      const sidKey = String(hit.song.id);
      if (!seenSongIds.has(sidKey)) {
        seenSongIds.add(sidKey);
        matched.push(hit);
      }
    } else if (!options.signal?.aborted) {
      unmatched.push(rawTracks[i]);
    }
  }

  return {
    matched,
    unmatched,
    cancelled: Boolean(options.signal?.aborted)
  };
}
