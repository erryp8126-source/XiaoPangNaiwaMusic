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

    @Test
    fun appendCoverSizeParamRespectsExistingQueryParamsAndLocalCovers() {
        assertEquals(
            "https://p1.music.126.net/cover.jpg?param=300y300",
            MusicPlaybackService.appendCoverSizeParam(
                "https://p1.music.126.net/cover.jpg",
                isLocalCover = false
            )
        )
        assertEquals(
            "https://p1.music.126.net/cover.jpg?imageView=1&param=300y300",
            MusicPlaybackService.appendCoverSizeParam(
                "https://p1.music.126.net/cover.jpg?imageView=1",
                isLocalCover = false
            )
        )
        assertEquals(
            "https://p1.music.126.net/cover.jpg?param=500y500",
            MusicPlaybackService.appendCoverSizeParam(
                "https://p1.music.126.net/cover.jpg?param=500y500",
                isLocalCover = false
            )
        )
        assertEquals(
            "http://127.0.0.1:30488/local-cover?path=abc",
            MusicPlaybackService.appendCoverSizeParam(
                "http://127.0.0.1:30488/local-cover?path=abc",
                isLocalCover = true
            )
        )
    }
}
