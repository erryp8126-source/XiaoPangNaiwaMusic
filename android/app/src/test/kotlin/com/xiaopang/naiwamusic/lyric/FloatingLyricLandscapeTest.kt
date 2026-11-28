package com.xiaopang.naiwamusic.lyric

import android.content.res.Configuration
import android.view.Surface
import com.xiaopang.naiwamusic.config.AppPrefs
import com.xiaopang.naiwamusic.lyric.FloatingLyricManager.LandscapeVisibilityController
import com.xiaopang.naiwamusic.lyric.FloatingLyricManager.OverlayAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FloatingLyricLandscapeTest {

    @Test
    fun defaultsToDisabledSoLandscapeKeepsShowingUntilUserEnablesSetting() {
        assertFalse(AppPrefs.DEFAULT_FLOATING_LYRIC_HIDE_IN_LANDSCAPE)
        val controller = LandscapeVisibilityController()
        assertFalse(controller.hideInLandscape)

        val enabled = controller.onUserSetEnabled(
            enabled = true,
            hasOverlayPermission = true,
            landscape = false
        )
        assertEquals(OverlayAction.SHOW, enabled.action)

        val rotatedLandscape = controller.onConfigurationOrientationChanged(
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.NOOP, rotatedLandscape.action)
        assertTrue(rotatedLandscape.shouldShowOverlay)
        assertFalse(controller.isHiddenForLandscape)

        // 用户按需开启横屏自动隐藏后，当前横屏立即暂隐
        val optedIn = controller.onHideInLandscapeChanged(
            hide = true,
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE, optedIn.action)
        assertTrue(controller.isHiddenForLandscape)
        assertTrue(controller.isLogicallyEnabled())
    }

    @Test
    fun landscapeTemporarilyHidesWithoutMutatingUserMasterSwitchAndRestoresInPortrait() {
        val controller = LandscapeVisibilityController(
            initialUserEnabled = false,
            initialHideInLandscape = true,
            initialLandscape = false
        )

        val enabledTransition = controller.onUserSetEnabled(
            enabled = true,
            hasOverlayPermission = true,
            landscape = false
        )
        assertEquals(OverlayAction.SHOW, enabledTransition.action)
        assertTrue(enabledTransition.isUserEnabled)
        assertFalse(enabledTransition.isHiddenForLandscape)
        assertTrue(enabledTransition.shouldMutateUserPref)
        assertTrue(controller.isLogicallyEnabled())

        // 切换到横屏：仅临时隐藏视图，绝不关闭用户主开关与通知栏「词」开关
        val toLandscape = controller.onConfigurationOrientationChanged(
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE, toLandscape.action)
        assertTrue(toLandscape.isUserEnabled)
        assertTrue(toLandscape.isHiddenForLandscape)
        assertFalse(toLandscape.shouldShowOverlay)
        assertFalse(toLandscape.shouldMutateUserPref)
        assertFalse(toLandscape.shouldNotifyMediaSession)
        assertTrue(controller.isLogicallyEnabled())

        // 切回竖屏：自动恢复悬浮显示，依然无需改动用户主开关
        val backToPortrait = controller.onConfigurationOrientationChanged(
            landscape = false,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.SHOW, backToPortrait.action)
        assertTrue(backToPortrait.isUserEnabled)
        assertFalse(backToPortrait.isHiddenForLandscape)
        assertTrue(backToPortrait.shouldShowOverlay)
        assertFalse(backToPortrait.shouldMutateUserPref)
        assertFalse(backToPortrait.shouldNotifyMediaSession)
    }

    @Test
    fun manualCloseDuringLandscapeClearsHiddenFlagSoPortraitWillNotResurrect() {
        val controller = LandscapeVisibilityController(
            initialUserEnabled = false,
            initialHideInLandscape = true,
            initialLandscape = false
        )
        controller.onUserSetEnabled(enabled = true, hasOverlayPermission = true, landscape = false)
        controller.onConfigurationOrientationChanged(landscape = true, hasOverlayPermission = true)
        assertTrue(controller.isHiddenForLandscape)

        val manualClose = controller.onUserSetEnabled(
            enabled = false,
            hasOverlayPermission = true,
            landscape = true
        )
        assertEquals(OverlayAction.HIDE_USER_DISABLED, manualClose.action)
        assertFalse(manualClose.isUserEnabled)
        assertFalse(manualClose.isHiddenForLandscape)
        assertTrue(manualClose.shouldMutateUserPref)
        assertTrue(manualClose.shouldNotifyMediaSession)
        assertFalse(controller.isLogicallyEnabled())

        val backToPortrait = controller.onConfigurationOrientationChanged(
            landscape = false,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.NOOP, backToPortrait.action)
        assertFalse(backToPortrait.shouldShowOverlay)
        assertFalse(controller.isLogicallyEnabled())
    }

    @Test
    fun enablingWhileAlreadyLandscapeHonorsAutoHideRuleAndShowsLaterInPortrait() {
        val controller = LandscapeVisibilityController(
            initialUserEnabled = false,
            initialHideInLandscape = true,
            initialLandscape = true
        )

        val enableInLandscape = controller.onUserSetEnabled(
            enabled = true,
            hasOverlayPermission = true,
            landscape = true
        )
        assertEquals(OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE, enableInLandscape.action)
        assertTrue(enableInLandscape.isUserEnabled)
        assertTrue(enableInLandscape.isHiddenForLandscape)
        assertFalse(enableInLandscape.shouldShowOverlay)
        assertTrue(enableInLandscape.shouldMutateUserPref)
        assertTrue(enableInLandscape.shouldNotifyMediaSession)
        assertTrue(controller.isLogicallyEnabled())

        val rotateToPortrait = controller.onConfigurationOrientationChanged(
            landscape = false,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.SHOW, rotateToPortrait.action)
        assertTrue(rotateToPortrait.shouldShowOverlay)
        assertFalse(rotateToPortrait.isHiddenForLandscape)
    }

    @Test
    fun togglingHideInLandscapeSettingUpdatesCurrentOverlayVisibilitySafely() {
        val controller = LandscapeVisibilityController(
            initialUserEnabled = false,
            initialHideInLandscape = false,
            initialLandscape = true
        )
        val enabled = controller.onUserSetEnabled(
            enabled = true,
            hasOverlayPermission = true,
            landscape = true
        )
        assertEquals(OverlayAction.SHOW, enabled.action)

        // hideInLandscape=false 时横屏仍持续显示
        val stillVisible = controller.onConfigurationOrientationChanged(
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.NOOP, stillVisible.action)
        assertTrue(stillVisible.shouldShowOverlay)

        // 用户在横屏下开启「横屏自动隐藏」：立刻暂隐且保留主开关
        val enableAutoHide = controller.onHideInLandscapeChanged(
            hide = true,
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE, enableAutoHide.action)
        assertTrue(controller.isLogicallyEnabled())
        assertTrue(controller.isHiddenForLandscape)

        // 用户在横屏下关闭「横屏自动隐藏」：立刻恢复显示
        val disableAutoHide = controller.onHideInLandscapeChanged(
            hide = false,
            landscape = true,
            hasOverlayPermission = true
        )
        assertEquals(OverlayAction.SHOW, disableAutoHide.action)
        assertFalse(controller.isHiddenForLandscape)
        assertTrue(disableAutoHide.shouldShowOverlay)
    }

    @Test
    fun resolveIsLandscapeUsesDisplayGeometryAndRotationWhenBackgroundConfigLags() {
        // 竖屏手机正常尺寸
        assertFalse(
            FloatingLyricManager.resolveIsLandscape(
                configOrientation = Configuration.ORIENTATION_PORTRAIT,
                displayWidthPx = 1080,
                displayHeightPx = 2400,
                displayRotation = Surface.ROTATION_0
            )
        )

        // 切到其他全屏横屏视频/游戏 App 时，即使后台 Configuration 仍报 ORIENTATION_PORTRAIT，也应识别为横屏
        assertTrue(
            FloatingLyricManager.resolveIsLandscape(
                configOrientation = Configuration.ORIENTATION_PORTRAIT,
                displayWidthPx = 2400,
                displayHeightPx = 1080,
                displayRotation = Surface.ROTATION_90
            )
        )

        // 平板天然横屏（宽 > 高）
        assertTrue(
            FloatingLyricManager.resolveIsLandscape(
                configOrientation = Configuration.ORIENTATION_LANDSCAPE,
                displayWidthPx = 2560,
                displayHeightPx = 1600,
                displayRotation = Surface.ROTATION_0
            )
        )

        // 尺寸不可用时退回 Configuration 与 Surface rotation
        assertTrue(
            FloatingLyricManager.resolveIsLandscape(
                configOrientation = Configuration.ORIENTATION_PORTRAIT,
                displayWidthPx = 0,
                displayHeightPx = 0,
                displayRotation = Surface.ROTATION_270
            )
        )
        assertFalse(
            FloatingLyricManager.resolveIsLandscape(
                configOrientation = Configuration.ORIENTATION_PORTRAIT,
                displayWidthPx = 0,
                displayHeightPx = 0,
                displayRotation = Surface.ROTATION_0
            )
        )
    }

    @Test
    fun lyricTrackStateClearsStaleYrcAndDoesNotFreezeOnTrackSwitch() {
        val state = FloatingLyricManager.LyricTrackState()
        val yrcSongA = listOf(
            LyricLine(
                startMs = 0L,
                durationMs = 2000L,
                text = "Song A line 1",
                words = listOf(WordSegment(0L, 1000L, 6))
            )
        )
        val jsSongA = listOf(LyricLine(startMs = 0L, durationMs = 2000L, text = "Song A JS fallback"))
        val jsSongB = listOf(LyricLine(startMs = 0L, durationMs = 2500L, text = "Song B first line"))

        val initA = state.onTrackChanged("1001", "Song A", "Artist A")
        assertTrue(initA.trackChanged)
        assertTrue(initA.shouldFetchNativeLyrics)
        assertTrue(state.applyNativeLyrics("1001", yrcSongA))
        assertEquals("1001", state.lyricLinesSongId)

        // Same-song JS lines must NOT downgrade existing YRC for Song A
        assertFalse(state.applyJsLyrics("1001", "Song A", jsSongA))
        assertEquals("1001", state.lyricLinesSongId)
        assertEquals("Song A line 1", state.lyricLines.first().text)

        // Switching to Song B where JS sync arrives BEFORE onNativeTrackChanged must NOT freeze on Song A YRC
        assertTrue(state.applyJsLyrics("2002", "Song B", jsSongB))
        assertEquals("2002", state.lyricLinesSongId)
        assertEquals("Song B first line", state.lyricLines.first().text)

        // Subsequent onNativeTrackChanged for Song B preserves Song B's JS lines and still requests native YRC upgrade
        val settleB = state.onTrackChanged("2002", "Song B", "Artist B")
        assertFalse(settleB.trackChanged)
        assertTrue(settleB.shouldFetchNativeLyrics)
        assertEquals("2002", state.lyricLinesSongId)
        assertEquals("Song B first line", state.lyricLines.first().text)

        // Switching to Song C when onNativeTrackChanged runs first clears Song B lyrics immediately
        val switchC = state.onTrackChanged("3003", "Song C", "Artist C")
        assertTrue(switchC.trackChanged)
        assertTrue(switchC.shouldFetchNativeLyrics)
        assertEquals("", state.lyricLinesSongId)
        assertTrue(state.lyricLines.isEmpty())
        assertEquals("Song C", state.fallbackTopText)

        // Late native lyric callback from Song A must be rejected after switching to Song C
        assertFalse(state.applyNativeLyrics("1001", yrcSongA))
        assertEquals("", state.lyricLinesSongId)
        assertTrue(state.lyricLines.isEmpty())
    }
}
