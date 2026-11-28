package com.xiaopang.naiwamusic.lyric

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.Surface
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.xiaopang.naiwamusic.NaiwaApp
import com.xiaopang.naiwamusic.R
import com.xiaopang.naiwamusic.config.AppPrefs
import com.xiaopang.naiwamusic.player.MusicPlaybackService
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs

/**
 * 网易云风格手机端桌面歌词窗口管理器
 * - 纯净无底框透明悬浮，双行交替 + 逐字卡拉OK扫色 + 清晰黑描边投影
 * - 轻点展开半透明暗色播控栏（锁定 / 上一首 / 播放暂停 / 下一首 / 样式设置）
 * - 锁定后开启 FLAG_NOT_TOUCHABLE 触摸穿透，并在通知栏常驻一键解锁入口
 * - 歌词解析逻辑已拆分至 LyricParser.kt，自定义视图已拆分至 FloatingLyricViews.kt
 */
class FloatingLyricManager(
    context: Context,
    private val prefs: AppPrefs,
    onControlCommand: (String) -> Unit
) {
    @Volatile
    var onControlCommand: ((String) -> Unit)? = onControlCommand

    companion object {
        private const val TAG = "FloatingLyricManager"
        private const val UNLOCK_CHANNEL_ID = "alger_desktop_lyric_lock"
        private const val UNLOCK_NOTIFICATION_ID = 1002
        private const val AUTO_COLLAPSE_MS = 5000L

        val PRESET_COLORS = intArrayOf(
            0xFFE84C3D.toInt(), // 绯红
            0xFF56A8E8.toInt(), // 晴空蓝（默认）
            0xFF5CC47A.toInt(), // 翡翠绿
            0xFFE8A838.toInt(), // 奶娃金
            0xFF8E5CF6.toInt()  // 丁香紫
        )

        @Volatile
        var activeInstance: FloatingLyricManager? = null

        /**
         * 综合窗口实际像素尺寸、配置方向与显示屏旋转角度判断当前是否处于横屏态，
         * 避免切到其他全屏横屏视频/游戏 App（甚至关闭了系统自动旋转）时遗漏暂隐。
         */
        internal fun resolveIsLandscape(
            configOrientation: Int,
            displayWidthPx: Int,
            displayHeightPx: Int,
            displayRotation: Int?
        ): Boolean {
            if (displayWidthPx > 0 && displayHeightPx > 0 && displayWidthPx != displayHeightPx) {
                return displayWidthPx > displayHeightPx
            }
            return configOrientation == Configuration.ORIENTATION_LANDSCAPE ||
                displayRotation == Surface.ROTATION_90 ||
                displayRotation == Surface.ROTATION_270
        }
    }

    internal enum class OverlayAction {
        SHOW,
        HIDE_TEMPORARY_FOR_LANDSCAPE,
        HIDE_USER_DISABLED,
        NOOP
    }

    internal data class LandscapeOverlayTransition(
        val action: OverlayAction,
        val isUserEnabled: Boolean,
        val isHiddenForLandscape: Boolean,
        val shouldShowOverlay: Boolean,
        val shouldMutateUserPref: Boolean,
        val shouldNotifyMediaSession: Boolean
    )

    /**
     * 桌面歌词横屏自动暂隐纯状态机：
     * - 横屏触发临时隐藏时，绝不改动 userEnabled 用户主开关或媒体会话按钮状态
     * - 切回竖屏时，仅在 userEnabled 为 true 且此前因横屏被暂隐时恢复悬浮窗
     * - 横屏期间若用户手动关闭桌面歌词，则清掉暂隐标记，切回竖屏后不再自动弹回
     */
    internal class LandscapeVisibilityController(
        initialUserEnabled: Boolean = false,
        initialHideInLandscape: Boolean = AppPrefs.DEFAULT_FLOATING_LYRIC_HIDE_IN_LANDSCAPE,
        initialLandscape: Boolean = false
    ) {
        var userEnabled: Boolean = initialUserEnabled
            private set
        var hideInLandscape: Boolean = initialHideInLandscape
            private set
        var isLandscape: Boolean = initialLandscape
            private set
        var isHiddenForLandscape: Boolean = false
            private set
        var isOverlayVisible: Boolean = false
            private set

        fun isLogicallyEnabled(): Boolean = userEnabled

        fun syncHideInLandscape(hide: Boolean) {
            hideInLandscape = hide
        }

        fun onUserSetEnabled(
            enabled: Boolean,
            hasOverlayPermission: Boolean,
            landscape: Boolean
        ): LandscapeOverlayTransition {
            isLandscape = landscape
            if (!enabled || !hasOverlayPermission) {
                userEnabled = false
                isHiddenForLandscape = false
                isOverlayVisible = false
                return LandscapeOverlayTransition(
                    action = OverlayAction.HIDE_USER_DISABLED,
                    isUserEnabled = false,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = true,
                    shouldNotifyMediaSession = true
                )
            }

            userEnabled = true
            return if (hideInLandscape && landscape) {
                isHiddenForLandscape = true
                isOverlayVisible = false
                LandscapeOverlayTransition(
                    action = OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE,
                    isUserEnabled = true,
                    isHiddenForLandscape = true,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = true,
                    shouldNotifyMediaSession = true
                )
            } else {
                isHiddenForLandscape = false
                isOverlayVisible = true
                LandscapeOverlayTransition(
                    action = OverlayAction.SHOW,
                    isUserEnabled = true,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = true,
                    shouldMutateUserPref = true,
                    shouldNotifyMediaSession = true
                )
            }
        }

        fun onConfigurationOrientationChanged(
            landscape: Boolean,
            hasOverlayPermission: Boolean
        ): LandscapeOverlayTransition {
            isLandscape = landscape
            if (!userEnabled) {
                isHiddenForLandscape = false
                return LandscapeOverlayTransition(
                    action = OverlayAction.NOOP,
                    isUserEnabled = false,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }

            if (landscape && hideInLandscape) {
                return if (isOverlayVisible || !isHiddenForLandscape) {
                    isHiddenForLandscape = true
                    isOverlayVisible = false
                    LandscapeOverlayTransition(
                        action = OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE,
                        isUserEnabled = true,
                        isHiddenForLandscape = true,
                        shouldShowOverlay = false,
                        shouldMutateUserPref = false,
                        shouldNotifyMediaSession = false
                    )
                } else {
                    LandscapeOverlayTransition(
                        action = OverlayAction.NOOP,
                        isUserEnabled = true,
                        isHiddenForLandscape = true,
                        shouldShowOverlay = false,
                        shouldMutateUserPref = false,
                        shouldNotifyMediaSession = false
                    )
                }
            }

            if (!landscape && isHiddenForLandscape) {
                return if (hasOverlayPermission) {
                    isHiddenForLandscape = false
                    isOverlayVisible = true
                    LandscapeOverlayTransition(
                        action = OverlayAction.SHOW,
                        isUserEnabled = true,
                        isHiddenForLandscape = false,
                        shouldShowOverlay = true,
                        shouldMutateUserPref = false,
                        shouldNotifyMediaSession = false
                    )
                } else {
                    isHiddenForLandscape = false
                    isOverlayVisible = false
                    LandscapeOverlayTransition(
                        action = OverlayAction.NOOP,
                        isUserEnabled = true,
                        isHiddenForLandscape = false,
                        shouldShowOverlay = false,
                        shouldMutateUserPref = false,
                        shouldNotifyMediaSession = false
                    )
                }
            }

            return LandscapeOverlayTransition(
                action = OverlayAction.NOOP,
                isUserEnabled = userEnabled,
                isHiddenForLandscape = isHiddenForLandscape,
                shouldShowOverlay = isOverlayVisible,
                shouldMutateUserPref = false,
                shouldNotifyMediaSession = false
            )
        }

        fun onHideInLandscapeChanged(
            hide: Boolean,
            landscape: Boolean,
            hasOverlayPermission: Boolean
        ): LandscapeOverlayTransition {
            hideInLandscape = hide
            isLandscape = landscape
            if (!userEnabled) {
                return LandscapeOverlayTransition(
                    action = OverlayAction.NOOP,
                    isUserEnabled = false,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }
            if (hide && landscape) {
                isHiddenForLandscape = true
                isOverlayVisible = false
                return LandscapeOverlayTransition(
                    action = OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE,
                    isUserEnabled = true,
                    isHiddenForLandscape = true,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }
            if (!hide && isHiddenForLandscape && hasOverlayPermission) {
                isHiddenForLandscape = false
                isOverlayVisible = true
                return LandscapeOverlayTransition(
                    action = OverlayAction.SHOW,
                    isUserEnabled = true,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = true,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }
            return LandscapeOverlayTransition(
                action = OverlayAction.NOOP,
                isUserEnabled = userEnabled,
                isHiddenForLandscape = isHiddenForLandscape,
                shouldShowOverlay = isOverlayVisible,
                shouldMutateUserPref = false,
                shouldNotifyMediaSession = false
            )
        }

        fun onShowRequested(
            hasOverlayPermission: Boolean,
            landscape: Boolean
        ): LandscapeOverlayTransition {
            if (!hasOverlayPermission) {
                return LandscapeOverlayTransition(
                    action = OverlayAction.NOOP,
                    isUserEnabled = userEnabled,
                    isHiddenForLandscape = isHiddenForLandscape,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }
            userEnabled = true
            isLandscape = landscape
            return if (hideInLandscape && landscape) {
                isHiddenForLandscape = true
                isOverlayVisible = false
                LandscapeOverlayTransition(
                    action = OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE,
                    isUserEnabled = true,
                    isHiddenForLandscape = true,
                    shouldShowOverlay = false,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            } else {
                isHiddenForLandscape = false
                isOverlayVisible = true
                LandscapeOverlayTransition(
                    action = OverlayAction.SHOW,
                    isUserEnabled = true,
                    isHiddenForLandscape = false,
                    shouldShowOverlay = true,
                    shouldMutateUserPref = false,
                    shouldNotifyMediaSession = false
                )
            }
        }

        fun onForceHide() {
            isOverlayVisible = false
            isHiddenForLandscape = false
            userEnabled = false
        }
    }

    internal data class TrackChangeDecision(
        val trackChanged: Boolean,
        val shouldFetchNativeLyrics: Boolean
    )

    internal class LyricTrackState {
        var currentSongId: String = ""
            private set
        var currentSongTitle: String = "小庞奶娃音乐"
            private set
        var currentSongArtist: String = ""
            private set
        var lyricLinesSongId: String = ""
            private set
        var lyricLines: List<LyricLine> = emptyList()
            private set
        var fallbackTopText: String = "小庞奶娃音乐"
            private set
        var fallbackBottomText: String = ""
            private set

        fun onTrackChanged(songId: String, title: String, artist: String): TrackChangeDecision {
            val cleanTitle = title.ifBlank { "小庞奶娃音乐" }
            val staleLyricOwner =
                lyricLinesSongId.isNotBlank() && songId.isNotBlank() && lyricLinesSongId != songId
            val changed =
                songId != currentSongId || cleanTitle != currentSongTitle || staleLyricOwner
            currentSongId = songId
            currentSongTitle = cleanTitle
            currentSongArtist = artist

            if (changed || (songId.isBlank() && lyricLines.isNotEmpty())) {
                if (songId.isBlank() || lyricLinesSongId != songId) {
                    lyricLines = emptyList()
                    lyricLinesSongId = ""
                }
                fallbackTopText = cleanTitle
                fallbackBottomText = artist
            }

            val hasYrcForThisSong =
                songId.isNotBlank() &&
                    lyricLinesSongId == songId &&
                    lyricLines.any { it.words.isNotEmpty() }
            val shouldFetch =
                songId.isNotBlank() && songId.all { it.isDigit() } && !hasYrcForThisSong
            return TrackChangeDecision(
                trackChanged = changed,
                shouldFetchNativeLyrics = shouldFetch
            )
        }

        fun applyJsLyrics(songId: String, songTitle: String, parsed: List<LyricLine>): Boolean {
            val cleanSongId = songId.trim()
            if (cleanSongId.isNotBlank() &&
                lyricLinesSongId == cleanSongId &&
                lyricLines.any { it.words.isNotEmpty() }
            ) {
                currentSongId = cleanSongId
                if (songTitle.isNotBlank()) currentSongTitle = songTitle
                return false
            }

            if (songTitle.isNotBlank()) currentSongTitle = songTitle
            if (cleanSongId.isNotBlank()) {
                if (lyricLinesSongId.isNotBlank() && lyricLinesSongId != cleanSongId) {
                    lyricLines = emptyList()
                    lyricLinesSongId = ""
                }
                currentSongId = cleanSongId
            }

            if (parsed.isEmpty()) return false
            lyricLines = parsed
            lyricLinesSongId = cleanSongId.ifBlank { currentSongId }
            return true
        }

        fun applyNativeLyrics(songId: String, parsed: List<LyricLine>): Boolean {
            if (parsed.isEmpty() || songId.isBlank() || songId != currentSongId) {
                return false
            }
            lyricLines = parsed
            lyricLinesSongId = songId
            return true
        }

        fun updateFallback(text: String, translation: String, songTitle: String) {
            if (songTitle.isNotBlank()) currentSongTitle = songTitle
            if (lyricLines.isEmpty()) {
                fallbackTopText = text.ifBlank { songTitle.ifBlank { "小庞奶娃音乐" } }
                fallbackBottomText = translation.ifBlank { currentSongArtist }
            }
        }
    }

    private val appContext = context.applicationContext
    private val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val displayManager = appContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var rootView: LinearLayout? = null
    private var topLineView: KaraokeLyricLineView? = null
    private var bottomLineView: KaraokeLyricLineView? = null
    private var closeBtn: VectorIconButton? = null
    private var controlBar: LinearLayout? = null
    private var playPauseBtn: VectorIconButton? = null
    private var styleBar: LinearLayout? = null
    private var transToggleBtn: TextView? = null
    private val colorDotViews = mutableListOf<ColorDotView>()
    private var layoutParams: WindowManager.LayoutParams? = null

    @Volatile
    private var isShowing = false
    @Volatile
    private var isReleased = false
    @Volatile
    private var shouldBeAttached = false
    @Volatile
    private var isHiddenForLandscape = false
    @Volatile
    private var isPlayingState = false
    private var isExpanded = false
    private var isStyleExpanded = false
    private var isLocked = false

    private val landscapeLock = Any()
    private val landscapeController = LandscapeVisibilityController(
        initialUserEnabled = prefs.floatingLyricEnabled,
        initialHideInLandscape = prefs.floatingLyricHideInLandscape,
        initialLandscape = isCurrentlyLandscape()
    )
    private var isConfigCallbackRegistered = false
    private val configCallbacks = object : ComponentCallbacks {
        override fun onConfigurationChanged(newConfig: Configuration) {
            onLandscapeStateChanged(isCurrentlyLandscape(newConfig.orientation))
        }

        override fun onLowMemory() = Unit
    }
    private var isDisplayListenerRegistered = false
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) = Unit
        override fun onDisplayChanged(displayId: Int) {
            if (displayId == Display.DEFAULT_DISPLAY) {
                onLandscapeStateChanged(isCurrentlyLandscape())
            }
        }
    }

    private var highlightColor: Int = prefs.floatingLyricColor
    private var lyricTextSizeSp: Float = prefs.floatingLyricTextSize
    private var showTranslation: Boolean = prefs.floatingLyricShowTranslation

    private val lyricState = LyricTrackState()
    private var lyricFetchJob: Job? = null

    private val autoCollapseRunnable = Runnable {
        if (isExpanded) {
            setExpanded(false)
        }
    }

    private val lyricTicker = object : Runnable {
        override fun run() {
            if (!isShowing) return
            renderFromNativePosition()
            if (isPlayingState) {
                mainHandler.postDelayed(this, 50L)
            }
        }
    }

    init {
        activeInstance = this
        ensureConfigCallbacksRegistered()
    }

    private fun isCurrentlyLandscape(
        overrideOrientation: Int = appContext.resources.configuration.orientation
    ): Boolean {
        var widthPx = 0
        var heightPx = 0
        var rotation: Int? = null
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bounds = wm.maximumWindowMetrics.bounds
                widthPx = bounds.width()
                heightPx = bounds.height()
            } else {
                @Suppress("DEPRECATION")
                val display = displayManager?.getDisplay(Display.DEFAULT_DISPLAY) ?: wm.defaultDisplay
                if (display != null) {
                    val metrics = DisplayMetrics()
                    @Suppress("DEPRECATION")
                    display.getRealMetrics(metrics)
                    widthPx = metrics.widthPixels
                    heightPx = metrics.heightPixels
                }
            }
            val defaultDisplay = displayManager?.getDisplay(Display.DEFAULT_DISPLAY)
                ?: run {
                    @Suppress("DEPRECATION")
                    wm.defaultDisplay
                }
            rotation = defaultDisplay?.rotation
        }
        if (widthPx <= 0 || heightPx <= 0) {
            val dm = appContext.resources.displayMetrics
            widthPx = dm.widthPixels
            heightPx = dm.heightPixels
        }
        return resolveIsLandscape(
            configOrientation = overrideOrientation,
            displayWidthPx = widthPx,
            displayHeightPx = heightPx,
            displayRotation = rotation
        )
    }

    private fun ensureConfigCallbacksRegistered() {
        synchronized(landscapeLock) {
            if (!isConfigCallbackRegistered) {
                runCatching {
                    appContext.registerComponentCallbacks(configCallbacks)
                    isConfigCallbackRegistered = true
                }.onFailure {
                    Log.w(TAG, "registerComponentCallbacks failed: ${it.message}")
                }
            }
            if (!isDisplayListenerRegistered) {
                runCatching {
                    displayManager?.registerDisplayListener(displayListener, mainHandler)
                    if (displayManager != null) {
                        isDisplayListenerRegistered = true
                    }
                }.onFailure {
                    Log.w(TAG, "registerDisplayListener failed: ${it.message}")
                }
            }
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    fun isEnabled(): Boolean = isShowing || isHiddenForLandscape

    fun isHiddenForLandscapeState(): Boolean = isHiddenForLandscape

    fun isLockedState(): Boolean = isLocked

    fun setEnabled(enabled: Boolean, openSettingsOnDenied: Boolean = true): Boolean {
        if (!enabled) {
            hide()
            prefs.floatingLyricEnabled = false
            MusicPlaybackService.instance?.onFloatingLyricStateChanged(false)
            return false
        }
        if (!Settings.canDrawOverlays(appContext)) {
            val isLocked = runCatching {
                (appContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
                    ?.isKeyguardLocked == true
            }.getOrDefault(false)
            mainHandler.post {
                runCatching {
                    Toast.makeText(
                        appContext,
                        "请授予「显示在其他应用上层」权限以开启桌面歌词",
                        Toast.LENGTH_LONG
                    ).show()
                }
                if (openSettingsOnDenied && !isLocked) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${appContext.packageName}")
                    ).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    runCatching { appContext.startActivity(intent) }
                }
            }
            synchronized(landscapeLock) {
                landscapeController.onUserSetEnabled(false, hasOverlayPermission = false, landscape = isCurrentlyLandscape())
            }
            isHiddenForLandscape = false
            prefs.floatingLyricEnabled = false
            MusicPlaybackService.instance?.onFloatingLyricStateChanged(false)
            return false
        }

        ensureConfigCallbacksRegistered()
        val transition = synchronized(landscapeLock) {
            landscapeController.syncHideInLandscape(prefs.floatingLyricHideInLandscape)
            landscapeController.onUserSetEnabled(
                enabled = true,
                hasOverlayPermission = true,
                landscape = isCurrentlyLandscape()
            )
        }
        isHiddenForLandscape = transition.isHiddenForLandscape
        prefs.floatingLyricEnabled = true
        MusicPlaybackService.instance?.onFloatingLyricStateChanged(true)

        if (transition.action == OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE) {
            hideOverlayViewOnly()
            runOnMain {
                runCatching {
                    Toast.makeText(
                        appContext,
                        "已开启桌面歌词（横屏时自动隐藏，竖屏后自动显示）",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            return true
        }

        attachOverlayView()
        if (Looper.myLooper() == Looper.getMainLooper() && !isShowing) {
            synchronized(landscapeLock) {
                landscapeController.onForceHide()
            }
            isHiddenForLandscape = false
            prefs.floatingLyricEnabled = false
            MusicPlaybackService.instance?.onFloatingLyricStateChanged(false)
            return false
        }
        return true
    }

    fun show() {
        ensureConfigCallbacksRegistered()
        if (!Settings.canDrawOverlays(appContext)) return
        val transition = synchronized(landscapeLock) {
            landscapeController.syncHideInLandscape(prefs.floatingLyricHideInLandscape)
            landscapeController.onShowRequested(
                hasOverlayPermission = true,
                landscape = isCurrentlyLandscape()
            )
        }
        isHiddenForLandscape = transition.isHiddenForLandscape
        when (transition.action) {
            OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE -> hideOverlayViewOnly()
            OverlayAction.SHOW -> attachOverlayView()
            else -> Unit
        }
    }

    fun onOrientationChanged(orientation: Int) {
        onLandscapeStateChanged(isCurrentlyLandscape(orientation))
    }

    private fun onLandscapeStateChanged(landscape: Boolean) {
        runOnMain {
            if (!prefs.floatingLyricEnabled) {
                synchronized(landscapeLock) {
                    landscapeController.onForceHide()
                }
                isHiddenForLandscape = false
                return@runOnMain
            }
            val transition = synchronized(landscapeLock) {
                landscapeController.syncHideInLandscape(prefs.floatingLyricHideInLandscape)
                landscapeController.onConfigurationOrientationChanged(
                    landscape = landscape,
                    hasOverlayPermission = Settings.canDrawOverlays(appContext)
                )
            }
            isHiddenForLandscape = transition.isHiddenForLandscape
            when (transition.action) {
                OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE -> hideOverlayViewOnly()
                OverlayAction.SHOW -> attachOverlayView()
                else -> Unit
            }
        }
    }

    fun getStyleConfigJson(): String {
        val hex = String.format(Locale.US, "#%06X", 0xFFFFFF and prefs.floatingLyricColor)
        return JSONObject().apply {
            put("color", hex)
            put("textSizeSp", prefs.floatingLyricTextSize.toDouble())
            put("showTranslation", prefs.floatingLyricShowTranslation)
            put("locked", isLocked)
        }.toString()
    }

    fun updateStyleFromJs(
        colorHex: String?,
        textSizeSp: Float?,
        showTranslationFlag: Boolean?
    ): String {
        val parsedColor = colorHex?.trim()?.takeIf { it.isNotEmpty() }?.let { raw ->
            runCatching { Color.parseColor(raw) }.getOrNull()
        }
        if (parsedColor != null) {
            prefs.floatingLyricColor = parsedColor
            highlightColor = parsedColor
        }
        val clampedSize = textSizeSp?.takeIf { !it.isNaN() }?.coerceIn(14f, 26f)
        if (clampedSize != null) {
            prefs.floatingLyricTextSize = clampedSize
            lyricTextSizeSp = clampedSize
        }
        if (showTranslationFlag != null) {
            prefs.floatingLyricShowTranslation = showTranslationFlag
            showTranslation = showTranslationFlag
        }
        runOnMain {
            if (parsedColor != null) {
                topLineView?.setHighlightColor(parsedColor)
                bottomLineView?.setHighlightColor(parsedColor)
                colorDotViews.forEach { it.isActiveDot = (it.dotColor == parsedColor) }
            }
            if (clampedSize != null) {
                topLineView?.setTextSizeSp(clampedSize)
                bottomLineView?.setTextSizeSp(clampedSize)
            }
            transToggleBtn?.setTextColor(
                if (showTranslation) highlightColor else 0x88FFFFFF.toInt()
            )
            if (isShowing) {
                renderFromNativePosition()
            }
        }
        return getStyleConfigJson()
    }

    fun onHideInLandscapeSettingChanged(enabled: Boolean) {
        runOnMain {
            val transition = synchronized(landscapeLock) {
                landscapeController.onHideInLandscapeChanged(
                    hide = enabled,
                    landscape = isCurrentlyLandscape(),
                    hasOverlayPermission = Settings.canDrawOverlays(appContext)
                )
            }
            isHiddenForLandscape = transition.isHiddenForLandscape
            when (transition.action) {
                OverlayAction.HIDE_TEMPORARY_FOR_LANDSCAPE -> hideOverlayViewOnly()
                OverlayAction.SHOW -> {
                    if (prefs.floatingLyricEnabled) {
                        attachOverlayView()
                    }
                }
                else -> Unit
            }
        }
    }

    fun detachControlCommand(handler: ((String) -> Unit)? = null) {
        if (handler == null || onControlCommand === handler) {
            onControlCommand = null
        }
    }

    fun hasAttachedActivity(): Boolean = onControlCommand != null

    fun isReleasedState(): Boolean = isReleased

    private fun dispatchControlCommand(cmd: String) {
        val handler = onControlCommand
        if (handler != null) {
            handler(cmd)
            return
        }
        val svc = MusicPlaybackService.instance ?: return
        when (cmd) {
            "next" -> svc.handleExternalTrackCommand("nexttrack", 1)
            "prev" -> svc.handleExternalTrackCommand("previoustrack", -1)
            "playpause" -> svc.togglePlayPauseFromOverlay()
        }
    }

    fun suspendForServiceStop() {
        shouldBeAttached = false
        runOnMain {
            lyricFetchJob?.cancel()
            lyricFetchJob = null
        }
        isHiddenForLandscape = false
        hideOverlayViewOnly()
    }

    fun release() {
        isReleased = true
        shouldBeAttached = false
        onControlCommand = null
        runOnMain {
            lyricFetchJob?.cancel()
            lyricFetchJob = null
        }
        synchronized(landscapeLock) {
            if (isConfigCallbackRegistered) {
                runCatching { appContext.unregisterComponentCallbacks(configCallbacks) }
                isConfigCallbackRegistered = false
            }
            if (isDisplayListenerRegistered) {
                runCatching { displayManager?.unregisterDisplayListener(displayListener) }
                isDisplayListenerRegistered = false
            }
        }
        hide()
        if (activeInstance === this) {
            activeInstance = null
        }
    }

    private fun attachOverlayView() {
        if (isReleased) return
        shouldBeAttached = true
        runOnMain {
            if (isReleased || !shouldBeAttached || isShowing || !prefs.floatingLyricEnabled) {
                return@runOnMain
            }
            val stillVisible = synchronized(landscapeLock) { landscapeController.isOverlayVisible }
            if (!stillVisible) return@runOnMain
            if (!Settings.canDrawOverlays(appContext)) return@runOnMain

            highlightColor = prefs.floatingLyricColor
            lyricTextSizeSp = prefs.floatingLyricTextSize
            showTranslation = prefs.floatingLyricShowTranslation
            isExpanded = false
            isStyleExpanded = false
            isLocked = false
            cancelUnlockNotification()

            val dp = appContext.resources.displayMetrics.density

            val container = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setBackgroundColor(Color.TRANSPARENT)
                setPadding(0, (8 * dp).toInt(), 0, (10 * dp).toInt())
            }

            val lyricZone = FrameLayout(appContext).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            val linesStack = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                val sidePad = (46 * dp).toInt()
                setPadding(sidePad, (4 * dp).toInt(), sidePad, (4 * dp).toInt())
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER
                )
            }

            val topView = KaraokeLyricLineView(appContext).apply {
                setHighlightColor(highlightColor)
                setTextSizeSp(lyricTextSizeSp)
                setLineData(lyricState.fallbackTopText, active = true, progress = 1f)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            val bottomView = KaraokeLyricLineView(appContext).apply {
                setHighlightColor(highlightColor)
                setTextSizeSp(lyricTextSizeSp)
                setLineData(lyricState.fallbackBottomText, active = false, progress = 0f)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = (6 * dp).toInt()
                }
            }

            linesStack.addView(topView)
            linesStack.addView(bottomView)

            val cornerSize = (48 * dp).toInt()
            val xBtn = VectorIconButton(appContext, FloatingIconType.CLOSE).apply {
                visibility = View.INVISIBLE
                layoutParams = FrameLayout.LayoutParams(cornerSize, cornerSize, Gravity.END or Gravity.TOP).apply {
                    marginEnd = (2 * dp).toInt()
                }
                setOnClickListener {
                    this@FloatingLyricManager.setEnabled(false)
                    dispatchControlCommand("close")
                }
            }

            lyricZone.addView(linesStack)
            lyricZone.addView(xBtn)
            xBtn.bringToFront()

            val bar = buildControlBar(dp)
            val sBar = buildStyleBar(dp)

            container.addView(lyricZone)
            container.addView(bar)
            container.addView(sBar)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 0
                y = prefs.floatingLyricY
            }

            attachDragListener(container, linesStack, params, dp)

            runCatching {
                wm.addView(container, params)
                rootView = container
                topLineView = topView
                bottomLineView = bottomView
                closeBtn = xBtn
                controlBar = bar
                styleBar = sBar
                layoutParams = params
                isShowing = true

                val svc = MusicPlaybackService.instance
                if (svc != null) {
                    isPlayingState = svc.isCurrentlyPlaying()
                    playPauseBtn?.iconType =
                        if (isPlayingState) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE
                    val activeId = svc.getCurrentSongId()
                    val activeTitle = svc.getCurrentSongTitle()
                    val activeArtist = svc.getCurrentSongArtist()
                    if (activeId.isNotBlank() || activeTitle.isNotBlank()) {
                        onNativeTrackChanged(activeId, activeTitle, activeArtist)
                    }
                }
                startOrStopTicker()
            }.onFailure {
                Log.e(TAG, "Failed to add desktop lyric overlay: ${it.message}")
            }
        }
    }

    private fun buildControlBar(dp: Float): LinearLayout {
        val bar = LinearLayout(appContext).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            val padH = (12 * dp).toInt()
            setPadding(padH, (10 * dp).toInt(), padH, (6 * dp).toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        fun addControlBtn(type: FloatingIconType, heightDp: Int = 46, onClick: () -> Unit): VectorIconButton {
            val btn = VectorIconButton(appContext, type).apply {
                layoutParams = LinearLayout.LayoutParams(0, (heightDp * dp).toInt(), 1f)
                setOnClickListener {
                    resetAutoCollapseTimer()
                    onClick()
                }
            }
            bar.addView(btn)
            return btn
        }

        addControlBtn(FloatingIconType.LOCK) { setLocked(true) }
        addControlBtn(FloatingIconType.PREV) { dispatchControlCommand("prev") }
        playPauseBtn = addControlBtn(
            if (isPlayingState) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE,
            heightDp = 50
        ) {
            dispatchControlCommand("playpause")
        }
        addControlBtn(FloatingIconType.NEXT) { dispatchControlCommand("next") }
        addControlBtn(FloatingIconType.SETTINGS) {
            isStyleExpanded = !isStyleExpanded
            styleBar?.visibility = if (isStyleExpanded) View.VISIBLE else View.GONE
            resetAutoCollapseTimer()
        }
        return bar
    }

    private fun buildStyleBar(dp: Float): LinearLayout {
        val sBar = LinearLayout(appContext).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = View.GONE
            val padH = (14 * dp).toInt()
            setPadding(padH, (6 * dp).toInt(), padH, (6 * dp).toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        colorDotViews.clear()
        for (color in PRESET_COLORS) {
            val dot = ColorDotView(appContext, color).apply {
                isActiveDot = (color == highlightColor)
                layoutParams = LinearLayout.LayoutParams(0, (40 * dp).toInt(), 1f)
                setOnClickListener {
                    applyHighlightColor(color)
                    resetAutoCollapseTimer()
                }
            }
            colorDotViews.add(dot)
            sBar.addView(dot)
        }

        fun makeSizeBtn(label: String, delta: Float): TextView {
            return TextView(appContext).apply {
                text = label
                setTextColor(Color.WHITE)
                textSize = 16f
                typeface = Typeface.SERIF
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, (40 * dp).toInt(), 1f)
                setOnClickListener {
                    applyTextSize(lyricTextSizeSp + delta)
                    resetAutoCollapseTimer()
                }
            }
        }

        sBar.addView(makeSizeBtn("T+", 2f))
        sBar.addView(makeSizeBtn("T-", -2f))

        val trBtn = TextView(appContext).apply {
            text = "译"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(if (showTranslation) highlightColor else 0x88FFFFFF.toInt())
            layoutParams = LinearLayout.LayoutParams(0, (40 * dp).toInt(), 1f)
            setOnClickListener {
                showTranslation = !showTranslation
                prefs.floatingLyricShowTranslation = showTranslation
                setTextColor(if (showTranslation) highlightColor else 0x88FFFFFF.toInt())
                renderFromNativePosition()
                resetAutoCollapseTimer()
                Toast.makeText(
                    appContext,
                    if (showTranslation) "桌面歌词翻译：已开启" else "桌面歌词翻译：已关闭",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
        transToggleBtn = trBtn
        sBar.addView(trBtn)
        return sBar
    }

    private fun attachDragListener(
        container: LinearLayout,
        linesStack: LinearLayout,
        params: WindowManager.LayoutParams,
        dp: Float
    ) {
        var initialY = 0
        var initialTouchY = 0f
        var moved = false
        val touchSlop = (6 * dp)

        val dragTouchListener = View.OnTouchListener { _, event ->
            if (isLocked) return@OnTouchListener false
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialY = params.y
                    initialTouchY = event.rawY
                    moved = false
                    if (isExpanded) resetAutoCollapseTimer()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dy = event.rawY - initialTouchY
                    if (abs(dy) > touchSlop) moved = true
                    if (moved) {
                        val maxY = (appContext.resources.displayMetrics.heightPixels - (120 * dp).toInt()).coerceAtLeast(100)
                        params.y = (initialY + dy.toInt()).coerceIn((36 * dp).toInt(), maxY)
                        runCatching { wm.updateViewLayout(container, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) {
                        prefs.floatingLyricY = params.y
                    } else {
                        setExpanded(!isExpanded)
                    }
                    true
                }
                else -> false
            }
        }

        linesStack.setOnTouchListener(dragTouchListener)
        container.setOnTouchListener(dragTouchListener)
    }

    private fun setExpanded(expand: Boolean) {
        isExpanded = expand
        mainHandler.removeCallbacks(autoCollapseRunnable)
        if (!expand) {
            isStyleExpanded = false
        }
        rootView?.setBackgroundColor(if (expand) 0x7A000000 else Color.TRANSPARENT)
        closeBtn?.visibility = if (expand) View.VISIBLE else View.INVISIBLE
        controlBar?.visibility = if (expand) View.VISIBLE else View.GONE
        styleBar?.visibility = if (expand && isStyleExpanded) View.VISIBLE else View.GONE

        if (expand) {
            resetAutoCollapseTimer()
        }
    }

    private fun resetAutoCollapseTimer() {
        mainHandler.removeCallbacks(autoCollapseRunnable)
        if (isExpanded) {
            mainHandler.postDelayed(autoCollapseRunnable, AUTO_COLLAPSE_MS)
        }
    }

    fun setLocked(locked: Boolean) {
        mainHandler.post {
            isLocked = locked
            val view = rootView ?: return@post
            val params = layoutParams ?: return@post

            if (locked) {
                setExpanded(false)
                params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                runCatching { wm.updateViewLayout(view, params) }
                showUnlockNotification()
                Toast.makeText(appContext, "桌面歌词已锁定，可在通知栏点击解锁", Toast.LENGTH_SHORT).show()
            } else {
                params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                runCatching { wm.updateViewLayout(view, params) }
                cancelUnlockNotification()
                setExpanded(true)
                Toast.makeText(appContext, "桌面歌词已解锁", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun applyHighlightColor(color: Int) {
        highlightColor = color
        prefs.floatingLyricColor = color
        topLineView?.setHighlightColor(color)
        bottomLineView?.setHighlightColor(color)
        colorDotViews.forEach { it.isActiveDot = (it.dotColor == color) }
        if (showTranslation) {
            transToggleBtn?.setTextColor(color)
        }
        renderFromNativePosition()
    }

    private fun applyTextSize(newSizeSp: Float) {
        val clamped = newSizeSp.coerceIn(14f, 26f)
        lyricTextSizeSp = clamped
        prefs.floatingLyricTextSize = clamped
        topLineView?.setTextSizeSp(clamped)
        bottomLineView?.setTextSizeSp(clamped)
    }

    // ==================== 播放状态与原生歌词驱动 ====================

    fun onNativePlayStateChanged(playing: Boolean) {
        isPlayingState = playing
        mainHandler.post {
            playPauseBtn?.iconType =
                if (playing) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE
            startOrStopTicker()
        }
    }

    fun onNativeTrackChanged(songId: String, title: String, artist: String) {
        runOnMain {
            if (isReleased) return@runOnMain
            val decision = lyricState.onTrackChanged(songId, title, artist)
            if (decision.trackChanged) {
                lyricFetchJob?.cancel()
                lyricFetchJob = null
                topLineView?.setLineData(lyricState.fallbackTopText, active = true, progress = 1f)
                bottomLineView?.setLineData(lyricState.fallbackBottomText, active = false, progress = 0f)
            }
            if (isShowing) {
                renderFromNativePosition()
            }
            if (decision.shouldFetchNativeLyrics) {
                fetchLyricsNatively(songId)
            }
        }
    }

    /**
     * 前端同步已解析歌词行（用于本地歌曲或前端即时秒开歌词）
     * 格式：[{"t":12340,"d":3200,"text":"..."}, ...]
     */
    fun syncLyricLinesFromJs(songId: String, songTitle: String, linesJson: String) {
        val parsed = LyricParser.parseJsLyricLines(linesJson)
        runOnMain {
            if (isReleased) return@runOnMain
            if (lyricState.applyJsLyrics(songId, songTitle, parsed)) {
                renderFromNativePosition()
                startOrStopTicker()
            }
        }
    }

    /**
     * 兼容旧桥接接口（本地无时间轴歌曲 / 兜底更新）
     */
    fun updateLyric(text: String, translation: String, songTitle: String, isPlaying: Boolean) {
        isPlayingState = isPlaying
        runOnMain {
            if (isReleased) return@runOnMain
            playPauseBtn?.iconType =
                if (isPlaying) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE
            lyricState.updateFallback(text, translation, songTitle)
            if (!isShowing) return@runOnMain
            if (lyricState.lyricLines.isEmpty()) {
                topLineView?.setLineData(lyricState.fallbackTopText, active = true, progress = 1f)
                bottomLineView?.setLineData(lyricState.fallbackBottomText, active = false, progress = 0f)
            }
            startOrStopTicker()
        }
    }

    private fun fetchLyricsNatively(songId: String) {
        lyricFetchJob?.cancel()
        lyricFetchJob = ioScope.launch {
            runCatching {
                val res = NaiwaApp.instance.ncmClient.dispatch("/lyric/new", mapOf("id" to songId))
                if (res.status != 200 || res.body.isBlank()) return@launch

                val root = JsonParser.parseString(res.body).asJsonObject
                val yrcRaw = root.get("yrc")?.takeIf { it.isJsonObject }?.asJsonObject
                    ?.get("lyric")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val lrcRaw = root.get("lrc")?.takeIf { it.isJsonObject }?.asJsonObject
                    ?.get("lyric")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val tlyricRaw = root.get("tlyric")?.takeIf { it.isJsonObject }?.asJsonObject
                    ?.get("lyric")?.takeIf { !it.isJsonNull }?.asString ?: ""

                val parsedYrc = if (yrcRaw.isNotBlank()) LyricParser.parseYrc(yrcRaw) else emptyList()
                val baseLines = if (parsedYrc.isNotEmpty()) parsedYrc else LyricParser.parseLrc(lrcRaw)
                val parsed = if (tlyricRaw.isNotBlank() && baseLines.isNotEmpty()) {
                    LyricParser.mergeTranslations(baseLines, LyricParser.parseLrc(tlyricRaw))
                } else {
                    baseLines
                }

                if (parsed.isNotEmpty()) {
                    runOnMain {
                        if (isReleased) return@runOnMain
                        if (lyricState.applyNativeLyrics(songId, parsed)) {
                            renderFromNativePosition()
                            startOrStopTicker()
                        }
                    }
                }
            }.onFailure {
                Log.w(TAG, "Native lyric fetch failed for $songId: ${it.message}")
            }
        }
    }

    private fun startOrStopTicker() {
        mainHandler.removeCallbacks(lyricTicker)
        if (isShowing) {
            renderFromNativePosition()
            if (isPlayingState) {
                mainHandler.postDelayed(lyricTicker, 50L)
            }
        }
    }

    private fun renderFromNativePosition() {
        if (!isShowing) return
        val lines = lyricState.lyricLines
        if (lines.isEmpty()) {
            topLineView?.setLineData(lyricState.fallbackTopText, active = true, progress = 1f)
            bottomLineView?.setLineData(lyricState.fallbackBottomText, active = false, progress = 0f)
            return
        }

        val posMs = MusicPlaybackService.instance?.getCurrentPositionMs() ?: 0L
        val idx = LyricParser.findLineIndex(lines, posMs)

        if (idx < 0) {
            topLineView?.setLineData(lines.getOrNull(0)?.text ?: lyricState.currentSongTitle, active = true, progress = 1f)
            bottomLineView?.setLineData(lines.getOrNull(1)?.text ?: "", active = false, progress = 0f)
            return
        }

        val activeLine = lines[idx]
        val nextLine = lines.getOrNull(idx + 1)
        val rawProgress = LyricParser.computeLineProgress(activeLine, posMs)
        val progress = if (!isPlayingState && rawProgress < 0.2f) 1f else rawProgress

        if (showTranslation && activeLine.translation.isNotBlank()) {
            topLineView?.setLineData(activeLine.text, active = true, progress = progress)
            bottomLineView?.setLineData(activeLine.translation, active = false, progress = 0f)
        } else if (idx % 2 == 0) {
            topLineView?.setLineData(activeLine.text, active = true, progress = progress)
            bottomLineView?.setLineData(nextLine?.text ?: "", active = false, progress = 0f)
        } else {
            topLineView?.setLineData(nextLine?.text ?: "", active = false, progress = 0f)
            bottomLineView?.setLineData(activeLine.text, active = true, progress = progress)
        }
    }

    // ==================== 锁定状态通知栏一键解锁 ====================

    private fun showUnlockNotification() {
        runCatching {
            val nm = appContext.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    UNLOCK_CHANNEL_ID,
                    "桌面歌词解锁控制",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "锁定桌面歌词后，用于一键点击解锁"
                    setShowBadge(false)
                }
                nm.createNotificationChannel(ch)
            }

            val unlockIntent = Intent(appContext, MusicPlaybackService::class.java).apply {
                action = MusicPlaybackService.ACTION_UNLOCK_LYRIC
            }
            val pending = PendingIntent.getService(
                appContext,
                202,
                unlockIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(appContext, UNLOCK_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_music_note)
                .setContentTitle("桌面歌词已锁定")
                .setContentText("点击此处即可解锁并调整桌面歌词")
                .setContentIntent(pending)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

            nm.notify(UNLOCK_NOTIFICATION_ID, notification)
        }
    }

    private fun cancelUnlockNotification() {
        runCatching {
            val nm = appContext.getSystemService(NotificationManager::class.java)
            nm.cancel(UNLOCK_NOTIFICATION_ID)
        }
    }

    fun hide() {
        shouldBeAttached = false
        synchronized(landscapeLock) {
            landscapeController.onForceHide()
        }
        isHiddenForLandscape = false
        hideOverlayViewOnly()
    }

    private fun hideOverlayViewOnly() {
        shouldBeAttached = false
        runOnMain {
            mainHandler.removeCallbacks(autoCollapseRunnable)
            mainHandler.removeCallbacks(lyricTicker)
            cancelUnlockNotification()
            val view = rootView
            if (view != null) {
                runCatching { wm.removeView(view) }
            }
            rootView = null
            topLineView = null
            bottomLineView = null
            closeBtn = null
            controlBar = null
            playPauseBtn = null
            styleBar = null
            transToggleBtn = null
            colorDotViews.clear()
            layoutParams = null
            isShowing = false
            isExpanded = false
            isStyleExpanded = false
            isLocked = false
        }
    }
}
