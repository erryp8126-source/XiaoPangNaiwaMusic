package com.xiaopang.naiwamusic.player

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import com.xiaopang.naiwamusic.config.AppPrefs
import java.io.File

/**
 * 原生 ExoPlayer 边听边缓存管理器（支持配置 200 / 500 / 1024 / 2048 MB LRU 磁盘缓存，默认 500 MB）
 * - 仅对远端在线 HTTP(S) 音频流启用磁盘缓存，跳过本地文件与 127.0.0.1 回环流
 * - 开启 FLAG_IGNORE_CACHE_ON_ERROR，异常时自动透明回退网络播放，绝不中断听歌
 */
@OptIn(UnstableApi::class)
object AudioCacheManager {
    private const val TAG = "AudioCacheManager"
    private const val CACHE_DIR_NAME = "media_audio_cache"
    const val BYTES_PER_MB: Long = 1024L * 1024L

    data class CacheLimitUpdateResult(
        val maxMb: Int,
        val activeMaxMb: Int,
        val requiresRestart: Boolean
    )

    @Volatile
    private var simpleCache: SimpleCache? = null
    @Volatile
    private var activeCacheMaxMb: Int? = null
    private val lock = Any()

    fun normalizeMaxCacheMb(mb: Int): Int = AppPrefs.normalizeAudioCacheMaxMb(mb)

    fun maxBytesForMb(mb: Int): Long = normalizeMaxCacheMb(mb).toLong() * BYTES_PER_MB

    internal fun resolveUpdateRequiresRestart(
        cacheInitialized: Boolean,
        activeMaxMb: Int?,
        newMaxMb: Int
    ): Boolean {
        return cacheInitialized && activeMaxMb != null && activeMaxMb != newMaxMb
    }

    fun getMaxCacheMb(context: Context): Int {
        return AppPrefs(context.applicationContext).audioCacheMaxMb
    }

    /**
     * 更新音频缓存上限配置：
     * - SimpleCache 尚未创建时直接生效（requiresRestart = false）
     * - SimpleCache 已被 ExoPlayer / CacheDataSource 持有时，严禁销毁正在使用的实例以防文件锁崩溃，
     *   保存新上限并返回 requiresRestart = true（重启应用后生效）
     */
    fun setMaxCacheMb(context: Context, requestedMb: Int): CacheLimitUpdateResult {
        val normalizedMb = normalizeMaxCacheMb(requestedMb)
        return synchronized(lock) {
            AppPrefs(context.applicationContext).audioCacheMaxMb = normalizedMb
            val initialized = simpleCache != null
            val currentActiveMb = if (initialized) (activeCacheMaxMb ?: normalizedMb) else normalizedMb
            val requiresRestart = resolveUpdateRequiresRestart(initialized, activeCacheMaxMb, normalizedMb)
            Log.i(
                TAG,
                "Audio cache max updated: configured=${normalizedMb}MB, active=${currentActiveMb}MB, requiresRestart=$requiresRestart"
            )
            CacheLimitUpdateResult(
                maxMb = normalizedMb,
                activeMaxMb = currentActiveMb,
                requiresRestart = requiresRestart
            )
        }
    }

    fun getCache(context: Context): SimpleCache? {
        simpleCache?.let { return it }
        synchronized(lock) {
            simpleCache?.let { return it }
            return runCatching {
                val appCtx = context.applicationContext
                val dir = File(appCtx.cacheDir, CACHE_DIR_NAME)
                if (!dir.exists()) dir.mkdirs()
                val maxMb = getMaxCacheMb(appCtx)
                val maxBytes = maxBytesForMb(maxMb)
                val evictor = LeastRecentlyUsedCacheEvictor(maxBytes)
                val dbProvider = StandaloneDatabaseProvider(appCtx)
                SimpleCache(dir, evictor, dbProvider).also {
                    simpleCache = it
                    activeCacheMaxMb = maxMb
                    Log.i(TAG, "SimpleCache initialized at ${dir.absolutePath}, max=${maxMb}MB")
                }
            }.onFailure {
                Log.w(TAG, "SimpleCache init failed, fallback to direct streaming: ${it.message}")
            }.getOrNull()
        }
    }

    fun buildDataSourceFactory(
        context: Context,
        httpFactory: DataSource.Factory
    ): DataSource.Factory {
        val appCtx = context.applicationContext
        val directFactory = DefaultDataSource.Factory(appCtx, httpFactory)
        val cache = getCache(appCtx) ?: return directFactory

        val cacheSinkFactory = CacheDataSink.Factory()
            .setCache(cache)
            .setFragmentSize(CacheDataSink.DEFAULT_FRAGMENT_SIZE)

        val cacheFactory = CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(httpFactory)
            .setCacheReadDataSourceFactory(FileDataSource.Factory())
            .setCacheWriteDataSinkFactory(cacheSinkFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        return DataSource.Factory {
            SmartCacheDataSource(cacheFactory.createDataSource(), directFactory.createDataSource())
        }
    }

    fun isCached(context: Context, cacheKey: String): Boolean {
        if (cacheKey.isBlank()) return false
        val cache = getCache(context) ?: return false
        return runCatching {
            val spans = cache.getCachedSpans(cacheKey)
            spans.isNotEmpty() && spans.any { it.isCached && it.length > 0L }
        }.getOrDefault(false)
    }

    /**
     * 聚合 SimpleCache 中所有实际已有缓存数据块的歌曲 ID（解析 song_<songId>_<quality> 键）
     */
    fun getCachedSongIds(context: Context): Set<String> {
        val cache = getCache(context) ?: return emptySet()
        return runCatching {
            val ids = LinkedHashSet<String>()
            val keys = cache.keys.toList()
            for (key in keys) {
                if (!key.startsWith("song_")) continue
                val spans = cache.getCachedSpans(key)
                val hasData = spans.isNotEmpty() && spans.any { it.isCached && it.length > 0L }
                if (!hasData) continue
                val rest = key.removePrefix("song_")
                val lastUnderscore = rest.lastIndexOf('_')
                val songId = if (lastUnderscore > 0) rest.substring(0, lastUnderscore) else rest
                if (songId.isNotBlank()) {
                    ids.add(songId)
                }
            }
            ids
        }.getOrDefault(emptySet())
    }

    fun getCacheSizeBytes(context: Context): Long {
        val active = simpleCache
        if (active != null) {
            return runCatching { active.cacheSpace.coerceAtLeast(0L) }.getOrDefault(0L)
        }
        val dir = File(context.applicationContext.cacheDir, CACHE_DIR_NAME)
        if (!dir.exists()) return 0L
        return runCatching {
            dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        }.getOrDefault(0L)
    }

    fun clearCache(context: Context): Boolean {
        return synchronized(lock) {
            runCatching {
                val active = simpleCache
                if (active != null) {
                    val keys = active.keys.toList()
                    for (k in keys) {
                        runCatching { active.removeResource(k) }
                    }
                } else {
                    val dir = File(context.applicationContext.cacheDir, CACHE_DIR_NAME)
                    if (dir.exists()) {
                        dir.deleteRecursively()
                    }
                }
                true
            }.onFailure {
                Log.w(TAG, "Clear audio cache failed: ${it.message}")
            }.getOrDefault(false)
        }
    }

    private class SmartCacheDataSource(
        private val cachedSource: DataSource,
        private val directSource: DataSource
    ) : DataSource {
        private var activeSource: DataSource? = null
        private val listeners = mutableListOf<TransferListener>()

        override fun addTransferListener(transferListener: TransferListener) {
            listeners.add(transferListener)
            cachedSource.addTransferListener(transferListener)
            directSource.addTransferListener(transferListener)
        }

        override fun open(dataSpec: DataSpec): Long {
            val uri = dataSpec.uri
            val scheme = uri.scheme?.lowercase() ?: ""
            val host = uri.host?.lowercase() ?: ""
            val isRemoteHttp = (scheme == "http" || scheme == "https") &&
                host != "127.0.0.1" && host != "localhost"
            val chosen = if (isRemoteHttp) cachedSource else directSource
            activeSource = chosen
            return chosen.open(dataSpec)
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            return activeSource?.read(buffer, offset, length) ?: -1
        }

        override fun getUri(): Uri? = activeSource?.uri

        override fun getResponseHeaders(): Map<String, List<String>> {
            return activeSource?.responseHeaders ?: emptyMap()
        }

        override fun close() {
            activeSource?.close()
            activeSource = null
        }
    }
}
