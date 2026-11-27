package com.xiaopang.naiwamusic.player

import android.content.Context
import android.database.sqlite.SQLiteException
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
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import com.xiaopang.naiwamusic.config.AppPrefs
import java.io.File
import java.io.IOException

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
    const val MIN_VALID_CACHED_BYTES: Long = 800L * 1024L

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

    internal fun hasSufficientCachedBytes(
        totalCachedBytes: Long,
        minBytes: Long = MIN_VALID_CACHED_BYTES
    ): Boolean = totalCachedBytes >= minBytes

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
            val appCtx = context.applicationContext
            val dir = File(appCtx.cacheDir, CACHE_DIR_NAME)
            val maxMb = getMaxCacheMb(appCtx)
            val maxBytes = maxBytesForMb(maxMb)
            return initCacheWithSelfHeal(
                cacheDir = dir,
                initializer = { targetDir ->
                    val evictor = LeastRecentlyUsedCacheEvictor(maxBytes)
                    val dbProvider = StandaloneDatabaseProvider(appCtx)
                    SimpleCache(targetDir, evictor, dbProvider)
                },
                onReset = { _, err ->
                    if (containsSqliteError(err)) {
                        runCatching { appCtx.deleteDatabase("exoplayer_internal.db") }
                    }
                    runCatching {
                        Log.w(
                            TAG,
                            "SimpleCache corrupted (${err.javaClass.simpleName}), wiped cache dir and reinitialized: ${err.message}"
                        )
                    }
                }
            )?.also { initialized ->
                simpleCache = initialized
                activeCacheMaxMb = maxMb
                runCatching {
                    Log.i(TAG, "SimpleCache initialized at ${dir.absolutePath}, max=${maxMb}MB")
                }
            }
        }
    }

    internal fun containsSqliteError(throwable: Throwable): Boolean {
        var cur: Throwable? = throwable
        var depth = 0
        while (cur != null && depth < 10) {
            if (cur is SQLiteException) return true
            cur = cur.cause
            depth++
        }
        return false
    }

    internal fun isRecoverableCacheInitError(throwable: Throwable): Boolean {
        var cur: Throwable? = throwable
        var depth = 0
        while (cur != null && depth < 10) {
            if (cur is Cache.CacheException ||
                cur is IllegalStateException ||
                cur is IOException ||
                cur is SQLiteException
            ) {
                return true
            }
            cur = cur.cause
            depth++
        }
        return false
    }

    /**
     * 缓存初始化自愈逻辑（无 Android 上下文依赖，可在 JVM 单测直接覆盖）：
     * 首次初始化若因索引/文件/数据库损坏抛错，立即递归清理目录后重试初始化一次；
     * 再次失败则返回 null，交由上层透明回退网络直连流，绝不因缓存损坏导致冷启动循环闪退。
     */
    internal fun <T> initCacheWithSelfHeal(
        cacheDir: File,
        initializer: (File) -> T,
        onReset: (File, Throwable) -> Unit = { _, _ -> }
    ): T? {
        runCatching { if (!cacheDir.exists()) cacheDir.mkdirs() }
        val firstError = try {
            return initializer(cacheDir)
        } catch (t: Throwable) {
            t
        }

        if (!isRecoverableCacheInitError(firstError)) {
            runCatching {
                Log.w(TAG, "SimpleCache init failed (non-recoverable): ${firstError.message}")
            }
            return null
        }

        runCatching {
            if (cacheDir.exists()) {
                cacheDir.deleteRecursively()
            }
            cacheDir.mkdirs()
        }
        runCatching { onReset(cacheDir, firstError) }

        return try {
            initializer(cacheDir)
        } catch (retryError: Throwable) {
            runCatching {
                Log.w(
                    TAG,
                    "SimpleCache init failed after self-heal, fallback to direct streaming: ${retryError.message}"
                )
            }
            null
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
            val totalCachedBytes = cache.getCachedSpans(cacheKey)
                .asSequence()
                .filter { it.isCached && it.length > 0L }
                .sumOf { it.length }
            hasSufficientCachedBytes(totalCachedBytes)
        }.getOrDefault(false)
    }

    fun evictCacheKey(context: Context, cacheKey: String): Boolean {
        if (cacheKey.isBlank()) return false
        val cache = getCache(context) ?: return false
        return synchronized(lock) {
            runCatching {
                cache.removeResource(cacheKey)
                runCatching { Log.i(TAG, "Evicted dirty/short audio cache key: $cacheKey") }
                true
            }.onFailure {
                runCatching { Log.w(TAG, "Evict audio cache key failed ($cacheKey): ${it.message}") }
            }.getOrDefault(false)
        }
    }

    /**
     * 聚合 SimpleCache 中所有实际已有有效缓存数据块的歌曲 ID（解析 song_<songId>_<quality> 键）
     */
    fun getCachedSongIds(context: Context): Set<String> {
        val cache = getCache(context) ?: return emptySet()
        return runCatching {
            val ids = LinkedHashSet<String>()
            val keys = cache.keys.toList()
            for (key in keys) {
                if (!key.startsWith("song_")) continue
                val totalCachedBytes = cache.getCachedSpans(key)
                    .asSequence()
                    .filter { it.isCached && it.length > 0L }
                    .sumOf { it.length }
                if (!hasSufficientCachedBytes(totalCachedBytes)) continue
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
