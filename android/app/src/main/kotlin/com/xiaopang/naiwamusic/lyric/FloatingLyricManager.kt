package com.xiaopang.naiwamusic.lyric

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
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
    @Volatile
    var onControlCommand: (String) -> Unit
) {
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
    }

    private val appContext = context.applicationContext
    private val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
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
    private var isPlayingState = false
    private var isExpanded = false
    private var isStyleExpanded = false
    private var isLocked = false

    private var highlightColor: Int = prefs.floatingLyricColor
    private var lyricTextSizeSp: Float = prefs.floatingLyricTextSize
    private var showTranslation: Boolean = prefs.floatingLyricShowTranslation

    @Volatile
    private var currentSongId: String = ""
    @Volatile
    private var currentSongTitle: String = "小庞奶娃音乐"
    @Volatile
    private var currentSongArtist: String = ""
    @Volatile
    private var lyricLines: List<LyricLine> = emptyList()
    private var lyricFetchJob: Job? = null

    private var fallbackTopText: String = "小庞奶娃音乐"
    private var fallbackBottomText: String = ""

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
    }

    fun isEnabled(): Boolean = isShowing

    fun isLockedState(): Boolean = isLocked

    fun setEnabled(enabled: Boolean): Boolean {
        if (!enabled) {
            hide()
            prefs.floatingLyricEnabled = false
            return false
        }
        if (!Settings.canDrawOverlays(appContext)) {
            mainHandler.post {
                Toast.makeText(
                    appContext,
                    "请授予「显示在其他应用上层」权限以开启桌面歌词",
                    Toast.LENGTH_LONG
                ).show()
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${appContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                runCatching { appContext.startActivity(intent) }
            }
            prefs.floatingLyricEnabled = false
            return false
        }
        show()
        prefs.floatingLyricEnabled = true
        return true
    }

    fun show() {
        mainHandler.post {
            if (isShowing) return@post
            if (!Settings.canDrawOverlays(appContext)) return@post

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
                setLineData(fallbackTopText, active = true, progress = 1f)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            }

            val bottomView = KaraokeLyricLineView(appContext).apply {
                setHighlightColor(highlightColor)
                setTextSizeSp(lyricTextSizeSp)
                setLineData(fallbackBottomText, active = false, progress = 0f)
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
                    onControlCommand("close")
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
        addControlBtn(FloatingIconType.PREV) { onControlCommand("prev") }
        playPauseBtn = addControlBtn(
            if (isPlayingState) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE,
            heightDp = 50
        ) {
            onControlCommand("playpause")
        }
        addControlBtn(FloatingIconType.NEXT) { onControlCommand("next") }
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
        val cleanTitle = title.ifBlank { "小庞奶娃音乐" }
        val changed = songId != currentSongId || cleanTitle != currentSongTitle
        currentSongId = songId
        currentSongTitle = cleanTitle
        currentSongArtist = artist

        if (changed) {
            lyricLines = emptyList()
            fallbackTopText = cleanTitle
            fallbackBottomText = artist
            mainHandler.post {
                topLineView?.setLineData(fallbackTopText, active = true, progress = 1f)
                bottomLineView?.setLineData(fallbackBottomText, active = false, progress = 0f)
            }
        }

        if (songId.isNotBlank() && songId.all { it.isDigit() } && !lyricLines.any { it.words.isNotEmpty() }) {
            fetchLyricsNatively(songId)
        }
    }

    /**
     * 前端同步已解析歌词行（用于本地歌曲或前端即时秒开歌词）
     * 格式：[{"t":12340,"d":3200,"text":"..."}, ...]
     */
    fun syncLyricLinesFromJs(songId: String, songTitle: String, linesJson: String) {
        if (songTitle.isNotBlank()) currentSongTitle = songTitle
        if (songId.isNotBlank()) currentSongId = songId

        val parsed = LyricParser.parseJsLyricLines(linesJson)
        if (parsed.isNotEmpty()) {
            // 若原生已成功拿到带逐字时间戳的 YRC 歌词且同一首歌，不降级覆盖
            if (lyricLines.any { it.words.isNotEmpty() } && songId == currentSongId) {
                return
            }
            lyricLines = parsed
            mainHandler.post { renderFromNativePosition() }
        }
    }

    /**
     * 兼容旧桥接接口（本地无时间轴歌曲 / 兜底更新）
     */
    fun updateLyric(text: String, translation: String, songTitle: String, isPlaying: Boolean) {
        isPlayingState = isPlaying
        if (songTitle.isNotBlank()) currentSongTitle = songTitle
        mainHandler.post {
            playPauseBtn?.iconType =
                if (isPlaying) FloatingIconType.PAUSE_CIRCLE else FloatingIconType.PLAY_CIRCLE
            if (!isShowing) return@post
            if (lyricLines.isEmpty()) {
                fallbackTopText = text.ifBlank { songTitle.ifBlank { "小庞奶娃音乐" } }
                fallbackBottomText = translation.ifBlank { currentSongArtist }
                topLineView?.setLineData(fallbackTopText, active = true, progress = 1f)
                bottomLineView?.setLineData(fallbackBottomText, active = false, progress = 0f)
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
                if (songId != currentSongId) return@launch

                val root = JsonParser.parseString(res.body).asJsonObject
                val yrcRaw = root.getAsJsonObject("yrc")?.get("lyric")?.asString ?: ""
                val lrcRaw = root.getAsJsonObject("lrc")?.get("lyric")?.asString ?: ""
                val tlyricRaw = root.getAsJsonObject("tlyric")?.get("lyric")?.asString ?: ""

                val parsedYrc = if (yrcRaw.isNotBlank()) LyricParser.parseYrc(yrcRaw) else emptyList()
                val baseLines = if (parsedYrc.isNotEmpty()) parsedYrc else LyricParser.parseLrc(lrcRaw)
                val parsed = if (tlyricRaw.isNotBlank() && baseLines.isNotEmpty()) {
                    LyricParser.mergeTranslations(baseLines, LyricParser.parseLrc(tlyricRaw))
                } else {
                    baseLines
                }

                if (parsed.isNotEmpty() && songId == currentSongId) {
                    lyricLines = parsed
                    mainHandler.post {
                        renderFromNativePosition()
                        startOrStopTicker()
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
        val lines = lyricLines
        if (lines.isEmpty()) {
            topLineView?.setLineData(fallbackTopText, active = true, progress = 1f)
            bottomLineView?.setLineData(fallbackBottomText, active = false, progress = 0f)
            return
        }

        val posMs = MusicPlaybackService.instance?.getCurrentPositionMs() ?: 0L
        val idx = LyricParser.findLineIndex(lines, posMs)

        if (idx < 0) {
            topLineView?.setLineData(lines.getOrNull(0)?.text ?: currentSongTitle, active = true, progress = 1f)
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
        mainHandler.post {
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
