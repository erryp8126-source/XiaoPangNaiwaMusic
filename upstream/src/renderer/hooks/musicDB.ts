import useIndexedDB from '@/hooks/IndexDBHook';

export type MusicDBStoreName =
  | 'music'
  | 'music_lyric'
  | 'api_cache'
  | 'music_url_cache'
  | 'music_failed_cache';

type MusicDBStores = Record<MusicDBStoreName, Record<string, any>>;
type MusicDBInstance = Awaited<
  ReturnType<typeof useIndexedDB<MusicDBStoreName, MusicDBStores>>
>;

let musicDBPromise: Promise<MusicDBInstance> | null = null;

function createMusicDB(): Promise<MusicDBInstance> {
  return useIndexedDB<MusicDBStoreName, MusicDBStores>(
    'musicDB',
    [
      { name: 'music', keyPath: 'id' },
      { name: 'music_lyric', keyPath: 'id' },
      { name: 'api_cache', keyPath: 'id' },
      { name: 'music_url_cache', keyPath: 'id' },
      { name: 'music_failed_cache', keyPath: 'id' }
    ],
    3
  );
}

/**
 * 惰性初始化并复用 IndexedDB 实例，避免顶层 await 触发跨 chunk 循环依赖 TDZ 崩溃
 */
export function getMusicDB(): Promise<MusicDBInstance> {
  if (!musicDBPromise) {
    musicDBPromise = createMusicDB().catch((err) => {
      musicDBPromise = null;
      throw err;
    });
  }
  return musicDBPromise;
}

export const musicDB = {
  initDB: async () => {
    const db = await getMusicDB();
    return db.initDB();
  },
  addData: async <K extends MusicDBStoreName>(storeName: K, value: MusicDBStores[K]) => {
    const db = await getMusicDB();
    return db.addData(storeName, value);
  },
  saveData: async <K extends MusicDBStoreName>(storeName: K, value: MusicDBStores[K]) => {
    const db = await getMusicDB();
    return db.saveData(storeName, value);
  },
  getData: async <K extends MusicDBStoreName>(storeName: K, key: string | number) => {
    const db = await getMusicDB();
    return db.getData(storeName, key);
  },
  deleteData: async <K extends MusicDBStoreName>(storeName: K, key: string | number) => {
    const db = await getMusicDB();
    return db.deleteData(storeName, key);
  },
  getAllData: async <K extends MusicDBStoreName>(storeName: K) => {
    const db = await getMusicDB();
    return db.getAllData(storeName);
  },
  getDataWithPagination: async <K extends MusicDBStoreName>(
    storeName: K,
    page: number,
    pageSize: number
  ) => {
    const db = await getMusicDB();
    return db.getDataWithPagination(storeName, page, pageSize);
  }
};
