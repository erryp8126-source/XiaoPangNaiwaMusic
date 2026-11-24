package com.xiaopang.naiwamusic.player

import com.xiaopang.naiwamusic.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaSessionCustomActionsTest {
    @Test
    fun recognizesSupportedCustomCommandsAndRejectsUnknown() {
        assertTrue(
            MusicPlaybackService.isSupportedCustomCommand(
                MusicPlaybackService.CUSTOM_CMD_TOGGLE_FAVORITE
            )
        )
        assertTrue(
            MusicPlaybackService.isSupportedCustomCommand(
                MusicPlaybackService.CUSTOM_CMD_TOGGLE_LYRIC
            )
        )
        assertFalse(
            MusicPlaybackService.isSupportedCustomCommand(
                "com.xiaopang.naiwamusic.UNKNOWN_ACTION"
            )
        )
        assertFalse(MusicPlaybackService.isSupportedCustomCommand(""))
    }

    @Test
    fun resolvesMonochromeVectorIconsForFavoriteAndLyricStates() {
        assertEquals(
            R.drawable.ic_media_heart_filled,
            MusicPlaybackService.resolveFavoriteIconRes(true)
        )
        assertEquals(
            R.drawable.ic_media_heart_outline,
            MusicPlaybackService.resolveFavoriteIconRes(false)
        )
        assertEquals(
            R.drawable.ic_media_lyric_on,
            MusicPlaybackService.resolveLyricIconRes(true)
        )
        assertEquals(
            R.drawable.ic_media_lyric_off,
            MusicPlaybackService.resolveLyricIconRes(false)
        )
    }
}
