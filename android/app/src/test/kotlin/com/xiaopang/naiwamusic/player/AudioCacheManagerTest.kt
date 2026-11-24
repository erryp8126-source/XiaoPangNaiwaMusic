package com.xiaopang.naiwamusic.player

import com.xiaopang.naiwamusic.config.AppPrefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
}
