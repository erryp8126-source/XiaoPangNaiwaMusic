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
import java.io.File

/**
 * 原生 ExoPlayer 边听边缓存管理器（200 MB LRU 磁盘缓存）
 * - 仅对远端在线 HTTP(S) 音频流启用磁盘缓存，跳过本地文件与 127.0.0.1 回环流
 * - 开启 FLAG_IGNORE_CACHE_ON_ERROR，异常时自动透明回退网络播放，绝不中断听歌
 */
@OptIn(UnstableApi::class)
object AudioCacheManager {
    private const val TAG = "AudioCacheManager"
    private const val CACHE_DIR_NAME = "media_audio_cache"
    const val MAX_CACHE_BYTES: Long = 200L * 1024L * 1024L // 200 MB

    @Volatile
    private var simpleCache: SimpleCache? = null
    private val lock = Any()

    fun getCache(context: Context): SimpleCache? {
        simpleCache?.let { return it }
        synchronized(lock) {
            simpleCache?.let { return it }
            return runCatching {
                val dir = File(context.applicationContext.cacheDir, CACHE_DIR_NAME)
                if (!dir.exists()) dir.mkdirs()
                val evictor = LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES)
                val dbProvider = StandaloneDatabaseProvider(context.applicationContext)
                SimpleCache(dir, evictor, dbProvider).also {
                    simpleCache = it
                    Log.i(TAG, "SimpleCache initialized at ${dir.absolutePath}, max=${MAX_CACHE_BYTES / (1024 * 1024)}MB")
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
