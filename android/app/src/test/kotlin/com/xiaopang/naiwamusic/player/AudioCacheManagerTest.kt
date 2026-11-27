package com.xiaopang.naiwamusic.player

import androidx.media3.datasource.cache.Cache
import com.xiaopang.naiwamusic.config.AppPrefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

class AudioCacheManagerTest {
    @Test
    fun exposesAllowedTiersAndDefault500MbLimit() {
        assertEquals(500, AppPrefs.DEFAULT_AUDIO_CACHE_MAX_MB)
        assertEquals(listOf(200, 500, 1024, 2048), AppPrefs.AUDIO_CACHE_MAX_MB_OPTIONS)
    }

    @Test
    fun acceptsValidTiersAndFallsBackToDefaultOnInvalidValues() {
        for (tier in listOf(200, 500, 1024, 2048)) {
            assertEquals(tier, AppPrefs.normalizeAudioCacheMaxMb(tier))
            assertEquals(tier, AudioCacheManager.normalizeMaxCacheMb(tier))
            assertEquals(tier.toLong() * 1024L * 1024L, AudioCacheManager.maxBytesForMb(tier))
        }

        val defaultBytes = 500L * 1024L * 1024L
        for (invalid in listOf(-1, 0, 100, 300, 4096, Int.MIN_VALUE, Int.MAX_VALUE)) {
            assertEquals(500, AppPrefs.normalizeAudioCacheMaxMb(invalid))
            assertEquals(500, AudioCacheManager.normalizeMaxCacheMb(invalid))
            assertEquals(defaultBytes, AudioCacheManager.maxBytesForMb(invalid))
        }
    }

    @Test
    fun determinesRestartRequirementWithoutReleasingActiveCache() {
        assertFalse(AudioCacheManager.resolveUpdateRequiresRestart(false, null, 1024))
        assertFalse(AudioCacheManager.resolveUpdateRequiresRestart(false, 500, 1024))
        assertFalse(AudioCacheManager.resolveUpdateRequiresRestart(true, null, 1024))
        assertFalse(AudioCacheManager.resolveUpdateRequiresRestart(true, 500, 500))
        assertTrue(AudioCacheManager.resolveUpdateRequiresRestart(true, 500, 1024))
        assertTrue(AudioCacheManager.resolveUpdateRequiresRestart(true, 2048, 200))
    }

    @Test
    fun requires800KbMinimumCachedBytesForValidTrack() {
        assertEquals(800L * 1024L, AudioCacheManager.MIN_VALID_CACHED_BYTES)
        assertFalse(AudioCacheManager.hasSufficientCachedBytes(0L))
        assertFalse(AudioCacheManager.hasSufficientCachedBytes(460_800L))
        assertFalse(AudioCacheManager.hasSufficientCachedBytes(800L * 1024L - 1L))
        assertTrue(AudioCacheManager.hasSufficientCachedBytes(800L * 1024L))
        assertTrue(AudioCacheManager.hasSufficientCachedBytes(3L * 1024L * 1024L))
    }

    @Test
    fun triggersShortAudioDirtyCacheRecoveryOnlyForUnexpectedShortRemoteStreamsWithRetryCap() {
        assertTrue(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 11_000L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )
        assertTrue(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 25_000L,
                expectedDurationMs = 0L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )

        // > 25s、未知/0时长或极短合法曲目（< 30s）不误触发
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 25_001L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 0L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = Long.MIN_VALUE + 1L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 11_000L,
                expectedDurationMs = 15_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = true
            )
        )

        // 单曲防死循环计数与本地文件排除
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 11_000L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 1,
                isRemoteHttpUrl = true
            )
        )
        assertFalse(
            MusicPlaybackService.shouldTriggerShortAudioRecovery(
                actualDurationMs = 11_000L,
                expectedDurationMs = 210_000L,
                retryCountForTrack = 0,
                isRemoteHttpUrl = false
            )
        )
    }

    @Test
    fun wipesCorruptedCacheDirectoryAndRetriesOnceOnRecoverableInitFailure() {
        val tempDir = Files.createTempDirectory("naiwa-cache-heal-ok").toFile()
        try {
            val corruptedIndex = File(tempDir, "cached_content_index.exi").apply {
                writeText("corrupted_binary_header")
            }
            assertTrue(corruptedIndex.exists())

            var attempts = 0
            var resetInvoked = false
            val result = AudioCacheManager.initCacheWithSelfHeal(
                cacheDir = tempDir,
                initializer = { dir ->
                    attempts++
                    if (attempts == 1) {
                        throw Cache.CacheException("Corrupted SimpleCache index")
                    }
                    assertTrue(dir.exists())
                    assertFalse(File(dir, "cached_content_index.exi").exists())
                    "recovered-cache"
                },
                onReset = { _, err ->
                    resetInvoked = err is Cache.CacheException
                }
            )

            assertEquals("recovered-cache", result)
            assertEquals(2, attempts)
            assertTrue(resetInvoked)
            assertTrue(tempDir.exists())

            // IOException / IllegalStateException 同样触发自愈并在二次失败时安全返回 null
            var ioAttempts = 0
            val ioFallback = AudioCacheManager.initCacheWithSelfHeal<String>(
                cacheDir = tempDir,
                initializer = {
                    ioAttempts++
                    throw IOException("disk index corrupt")
                }
            )
            assertNull(ioFallback)
            assertEquals(2, ioAttempts)

            // 非缓存损坏类异常不得清空缓存目录
            val keepFile = File(tempDir, "keep_marker.dat").apply { writeText("ok") }
            var nonRecAttempts = 0
            val nonRecResult = AudioCacheManager.initCacheWithSelfHeal<String>(
                cacheDir = tempDir,
                initializer = {
                    nonRecAttempts++
                    throw IllegalArgumentException("bad config")
                }
            )
            assertNull(nonRecResult)
            assertEquals(1, nonRecAttempts)
            assertTrue(keepFile.exists())
        } finally {
            tempDir.deleteRecursively()
        }
    }
}
