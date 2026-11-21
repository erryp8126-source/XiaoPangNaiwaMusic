package com.alger.musicplayer.lyric

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
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
import com.alger.musicplayer.AlgerApp
import com.alger.musicplayer.R
import com.alger.musicplayer.config.AppPrefs
import com.alger.musicplayer.player.MusicPlaybackService
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * 网易云风格手机端桌面歌词引擎
 * - 默认纯净无底框透明悬浮，双行交替 + 逐字卡拉OK扫色 + 清晰黑描边投影
 * - 轻点展开半透明暗色播控栏（左上返回App、右上关闭、底部 锁定 / 上一首 / 播放暂停 / 下一首 / 设置）
 * - 点击齿轮展开 5 色配色球 + 字号 T+ / T- 调节，自动持久化
 * - 锁定后开启 FLAG_NOT_TOUCHABLE 触摸完全穿透，并在通知栏常驻一键解锁入口
 * - 原生内置 YRC/LRC 解析与 50ms 实时推进，即使切回手机桌面或后台自动切歌仍流畅滚动扫色
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

    private data class WordSegment(
        val startMs: Long,
        val durationMs: Long,
        val endCharIndex: Int
    )

    private data class LyricLine(
        val startMs: Long,
        val durationMs: Long,
        val text: String,
        val translation: String = "",
        val words: List<WordSegment> = emptyList()
    )

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

    // 当前曲目与原生歌词缓存
    @Volatile
    private var currentSongId: String = ""
    @Volatile
    private var currentSongTitle: String = "小庞奶娃音乐"
    @Volatile
    private var currentSongArtist: String = ""
    @Volatile
    private var lyricLines: List<LyricLine> = emptyList()
    private var lyricFetchJob: Job? = null

    // 兜底单行文本（当本地歌曲无时间轴歌词或尚未拉取到时使用）
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

            // 根容器：默认完全透明无底框；展开控制栏时切换半透明暗色背景
            val container = LinearLayout(appContext).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setBackgroundColor(Color.TRANSPARENT)
                setPadding(0, (8 * dp).toInt(), 0, (10 * dp).toInt())
            }

            // ===== 顶部区域：左上返回 App + 中间双行卡拉OK歌词 + 右上关闭 × =====
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
            val xBtn = VectorIconButton(appContext, IconType.CLOSE).apply {
                visibility = View.INVISIBLE
                layoutParams = FrameLayout.LayoutParams(cornerSize, cornerSize, Gravity.END or Gravity.TOP).apply {
                    marginEnd = (2 * dp).toInt()
                }
                setOnClickListener {
                    // 注意：apply 块内 this 是 VectorIconButton(View)，必须显式调用外层 FloatingLyricManager.setEnabled(false)
                    this@FloatingLyricManager.setEnabled(false)
                    onControlCommand("close")
                }
            }

            lyricZone.addView(linesStack)
            lyricZone.addView(xBtn)
            xBtn.bringToFront()

            // ===== 第二排：5 个极简线框播控按钮（锁定 / 上一首 / 播放暂停 / 下一首 / 设置） =====
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

            fun addControlBtn(type: IconType, heightDp: Int = 46, onClick: () -> Unit): VectorIconButton {
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

            addControlBtn(IconType.LOCK) { setLocked(true) }
            addControlBtn(IconType.PREV) { onControlCommand("prev") }
            val ppBtn = addControlBtn(
                if (isPlayingState) IconType.PAUSE_CIRCLE else IconType.PLAY_CIRCLE,
                heightDp = 50
            ) {
                onControlCommand("playpause")
            }
            addControlBtn(IconType.NEXT) { onControlCommand("next") }
            addControlBtn(IconType.SETTINGS) {
                isStyleExpanded = !isStyleExpanded
                styleBar?.visibility = if (isStyleExpanded) View.VISIBLE else View.GONE
                resetAutoCollapseTimer()
            }

            // ===== 第三排：5 个圆形配色球 + 字号 T+ / T- =====
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

            // 触摸交互：上下拖拽调整位置 + 轻点展开/收起半透明播控栏
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

            runCatching {
                wm.addView(container, params)
                rootView = container
                topLineView = topView
                bottomLineView = bottomView
                closeBtn = xBtn
                controlBar = bar
                playPauseBtn = ppBtn
                styleBar = sBar
                layoutParams = params
                isShowing = true

                // 立即同步当前播放服务里的歌曲、状态与位置
                val svc = MusicPlaybackService.instance
                if (svc != null) {
                    isPlayingState = svc.isCurrentlyPlaying()
                    ppBtn.iconType = if (isPlayingState) IconType.PAUSE_CIRCLE else IconType.PLAY_CIRCLE
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
            playPauseBtn?.iconType = if (playing) IconType.PAUSE_CIRCLE else IconType.PLAY_CIRCLE
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

        val parsed = runCatching {
            val arr = JsonParser.parseString(linesJson).asJsonArray
            val list = mutableListOf<LyricLine>()
            for (i in 0 until arr.size()) {
                val obj = arr[i].asJsonObject
                val text = obj.get("text")?.asString?.trim() ?: ""
                if (text.isBlank()) continue
                val startMs = obj.get("t")?.asLong ?: continue
                val durMs = obj.get("d")?.asLong ?: 0L
                val tr = obj.get("tr")?.asString?.trim() ?: ""
                list.add(LyricLine(startMs = startMs, durationMs = durMs, text = text, translation = tr))
            }
            fillMissingDurations(list)
        }.getOrElse { emptyList() }

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
            playPauseBtn?.iconType = if (isPlaying) IconType.PAUSE_CIRCLE else IconType.PLAY_CIRCLE
            if (!isShowing) return@post
            // 若已有原生时间轴歌词，优先由 50ms 原生时钟驱动双行卡拉OK扫色
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
                val res = AlgerApp.instance.ncmClient.dispatch("/lyric/new", mapOf("id" to songId))
                if (res.status != 200 || res.body.isBlank()) return@launch
                if (songId != currentSongId) return@launch

                val root = JsonParser.parseString(res.body).asJsonObject
                val yrcRaw = root.getAsJsonObject("yrc")?.get("lyric")?.asString ?: ""
                val lrcRaw = root.getAsJsonObject("lrc")?.get("lyric")?.asString ?: ""
                val tlyricRaw = root.getAsJsonObject("tlyric")?.get("lyric")?.asString ?: ""

                val parsedYrc = if (yrcRaw.isNotBlank()) parseYrc(yrcRaw) else emptyList()
                val baseLines = if (parsedYrc.isNotEmpty()) parsedYrc else parseLrc(lrcRaw)
                val parsed = if (tlyricRaw.isNotBlank() && baseLines.isNotEmpty()) {
                    mergeTranslations(baseLines, parseLrc(tlyricRaw))
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

        // 二分查找当前所处歌词行
        var idx = -1
        var lo = 0
        var hi = lines.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (lines[mid].startMs <= posMs) {
                idx = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }

        if (idx < 0) {
            // 歌曲前奏阶段：第一句使用当前选中高亮色预览，方便切换配色球时立刻看到颜色变化
            topLineView?.setLineData(lines.getOrNull(0)?.text ?: currentSongTitle, active = true, progress = 1f)
            bottomLineView?.setLineData(lines.getOrNull(1)?.text ?: "", active = false, progress = 0f)
            return
        }

        val activeLine = lines[idx]
        val nextLine = lines.getOrNull(idx + 1)
        val rawProgress = computeLineProgress(activeLine, posMs)
        // 暂停且停留在句首时直接全句显示选中高亮色，确保切换 5 色球时无论播放还是暂停都立即可见
        val progress = if (!isPlayingState && rawProgress < 0.2f) 1f else rawProgress

        // 开启翻译且当前句有翻译时：上行原词逐字扫色 + 下行中文翻译；否则走经典双行交替模式
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

    private fun mergeTranslations(baseLines: List<LyricLine>, transLines: List<LyricLine>): List<LyricLine> {
        if (transLines.isEmpty()) return baseLines
        return baseLines.map { line ->
            val best = transLines.minByOrNull { abs(it.startMs - line.startMs) }
            if (best != null && abs(best.startMs - line.startMs) <= 1200L) {
                line.copy(translation = best.text)
            } else {
                line
            }
        }
    }

    private fun computeLineProgress(line: LyricLine, posMs: Long): Float {
        if (line.text.isEmpty()) return 0f
        if (line.words.isNotEmpty()) {
            val totalChars = line.text.length.toFloat()
            var prevChars = 0
            for (w in line.words) {
                if (posMs < w.startMs) {
                    return (prevChars / totalChars).coerceIn(0f, 1f)
                }
                val endMs = w.startMs + w.durationMs.coerceAtLeast(1L)
                if (posMs <= endMs) {
                    val frac = ((posMs - w.startMs).toFloat() / w.durationMs.coerceAtLeast(1L).toFloat()).coerceIn(0f, 1f)
                    val curChars = prevChars + (w.endCharIndex - prevChars) * frac
                    return (curChars / totalChars).coerceIn(0f, 1f)
                }
                prevChars = w.endCharIndex
            }
            return 1f
        }

        val dur = line.durationMs.coerceAtLeast(400L)
        return ((posMs - line.startMs).toFloat() / dur.toFloat()).coerceIn(0f, 1f)
    }

    // ==================== YRC & LRC 解析器 ====================

    private fun parseYrc(raw: String): List<LyricLine> {
        val lineRegex = Regex("""^\[(\d+),(\d+)](.*)$""")
        val wordRegex = Regex("""\((\d+),(\d+),\d+\)([^(]*)""")
        val result = mutableListOf<LyricLine>()

        for (rawLine in raw.lines()) {
            val trimmed = rawLine.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("{")) continue
            val m = lineRegex.matchEntire(trimmed) ?: continue
            val startMs = m.groupValues[1].toLongOrNull() ?: continue
            val durMs = m.groupValues[2].toLongOrNull() ?: 3000L
            val body = m.groupValues[3]

            val sb = StringBuilder()
            val words = mutableListOf<WordSegment>()
            for (wm in wordRegex.findAll(body)) {
                val ws = wm.groupValues[1].toLongOrNull() ?: startMs
                val wd = wm.groupValues[2].toLongOrNull() ?: 200L
                val token = wm.groupValues[3]
                if (token.isNotEmpty()) {
                    sb.append(token)
                    words.add(WordSegment(ws, wd, sb.length))
                }
            }
            val fullText = sb.toString().trim()
            if (fullText.isNotEmpty()) {
                result.add(LyricLine(startMs, durMs.coerceAtLeast(400L), fullText, "", words))
            }
        }
        result.sortBy { it.startMs }
        return result
    }

    private fun parseLrc(raw: String): List<LyricLine> {
        val tagRegex = Regex("""\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]""")
        val temp = mutableListOf<Pair<Long, String>>()

        for (rawLine in raw.lines()) {
            val trimmed = rawLine.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("{")) continue
            val matches = tagRegex.findAll(trimmed).toList()
            if (matches.isEmpty()) continue
            val text = tagRegex.replace(trimmed, "").trim()
            if (text.isEmpty()) continue

            for (m in matches) {
                val min = m.groupValues[1].toLongOrNull() ?: continue
                val sec = m.groupValues[2].toLongOrNull() ?: continue
                val fracStr = m.groupValues[3]
                val ms = when (fracStr.length) {
                    0 -> 0L
                    1 -> (fracStr.toLongOrNull() ?: 0L) * 100L
                    2 -> (fracStr.toLongOrNull() ?: 0L) * 10L
                    else -> fracStr.take(3).toLongOrNull() ?: 0L
                }
                temp.add((min * 60_000L + sec * 1_000L + ms) to text)
            }
        }
        temp.sortBy { it.first }
        val lines = temp.map { LyricLine(it.first, 0L, it.second) }
        return fillMissingDurations(lines)
    }

    private fun fillMissingDurations(lines: List<LyricLine>): List<LyricLine> {
        if (lines.isEmpty()) return emptyList()
        return lines.mapIndexed { idx, item ->
            val nextStart = lines.getOrNull(idx + 1)?.startMs
            val spanMs = if (nextStart != null && nextStart > item.startMs) {
                (nextStart - item.startMs).coerceIn(500L, 12_000L)
            } else {
                4500L
            }
            // 防御性校验：若外部传入的 duration 异常（<=0 或超过 20 秒），回退到相邻行间距
            val dur = if (item.durationMs in 300L..20_000L) {
                item.durationMs
            } else {
                spanMs
            }
            item.copy(durationMs = dur)
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

    // ==================== 自定义绘制视图：双行卡拉OK扫色歌词 ====================

    private class KaraokeLyricLineView(context: Context) : View(context) {
        private val density = context.resources.displayMetrics.density
        private val scaledDensity = context.resources.displayMetrics.scaledDensity

        private var text: String = ""
        private var isActive: Boolean = false
        private var progress: Float = 0f
        private var baseTextSizeSp: Float = 19f
        private var highlightColorInt: Int = 0xFF56A8E8.toInt()

        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
            color = 0xAA000000.toInt()
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            setShadowLayer(4f * density, 0f, 1.5f * density, 0xCC000000.toInt())
        }

        private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.WHITE
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }

        private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = highlightColorInt
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }

        init {
            setLayerType(LAYER_TYPE_SOFTWARE, null)
            applyPaintSizes(baseTextSizeSp * scaledDensity)
        }

        private fun applyPaintSizes(px: Float) {
            strokePaint.textSize = px
            strokePaint.strokeWidth = (px * 0.14f).coerceIn(2.2f * density, 4.2f * density)
            basePaint.textSize = px
            highlightPaint.textSize = px
        }

        fun setHighlightColor(color: Int) {
            highlightColorInt = color
            highlightPaint.color = color
            invalidate()
        }

        fun setTextSizeSp(sp: Float) {
            baseTextSizeSp = sp
            applyPaintSizes(sp * scaledDensity)
            requestLayout()
            invalidate()
        }

        fun setLineData(newText: String, active: Boolean, progress: Float) {
            val clamped = progress.coerceIn(0f, 1f)
            if (text == newText && isActive == active && abs(this.progress - clamped) < 0.005f) {
                return
            }
            val textChanged = text != newText
            text = newText
            isActive = active
            this.progress = clamped
            basePaint.color = if (active) Color.WHITE else 0xF2FFFFFF.toInt()
            if (textChanged) requestLayout()
            invalidate()
        }

        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val w = MeasureSpec.getSize(widthMeasureSpec)
            applyPaintSizes(baseTextSizeSp * scaledDensity)
            val fm = basePaint.fontMetrics
            val lineHeight = (fm.bottom - fm.top + 8f * density).toInt().coerceAtLeast((26 * density).toInt())
            setMeasuredDimension(w, lineHeight)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (text.isBlank()) return

            val availWidth = (width - paddingLeft - paddingRight - 8f * density).coerceAtLeast(40f)
            var px = baseTextSizeSp * scaledDensity
            applyPaintSizes(px)
            var tw = basePaint.measureText(text)
            if (tw > availWidth && tw > 0f) {
                // 超长歌词自适应微缩，保证完整显示不截断
                px = (px * (availWidth / tw)).coerceAtLeast(12f * scaledDensity)
                applyPaintSizes(px)
                tw = basePaint.measureText(text)
            }

            val fm = basePaint.fontMetrics
            val baseline = height / 2f - (fm.ascent + fm.descent) / 2f
            val startX = (width - tw) / 2f

            // 1. 描边 + 阴影（保证任意壁纸清晰可读）
            canvas.drawText(text, startX, baseline, strokePaint)
            // 2. 白色底字
            canvas.drawText(text, startX, baseline, basePaint)
            // 3. 当前行逐字高亮扫色
            if (isActive && progress > 0f) {
                canvas.save()
                canvas.clipRect(startX, 0f, startX + tw * progress, height.toFloat())
                canvas.drawText(text, startX, baseline, highlightPaint)
                canvas.restore()
            }
        }
    }

    // ==================== 自定义绘制视图：网易云极简线框矢量按钮 ====================

    private enum class IconType {
        CLOSE, LOCK, PREV, PLAY_CIRCLE, PAUSE_CIRCLE, NEXT, SETTINGS
    }

    private class VectorIconButton(
        context: Context,
        type: IconType
    ) : View(context) {
        private val dp = context.resources.displayMetrics.density
        var iconType: IconType = type
            set(value) {
                if (field != value) {
                    field = value
                    invalidate()
                }
            }

        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xE6FFFFFF.toInt()
            style = Paint.Style.STROKE
            strokeWidth = 1.7f * dp
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xE6FFFFFF.toInt()
            style = Paint.Style.FILL
        }

        init {
            isClickable = true
            isFocusable = true
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f

            when (iconType) {
                IconType.CLOSE -> {
                    val s = 7.5f * dp
                    canvas.drawLine(cx - s, cy - s, cx + s, cy + s, strokePaint)
                    canvas.drawLine(cx + s, cy - s, cx - s, cy + s, strokePaint)
                }
                IconType.LOCK -> {
                    // 线框挂锁
                    val bw = 15f * dp
                    val bh = 11.5f * dp
                    val body = RectF(cx - bw / 2f, cy - 1.5f * dp, cx + bw / 2f, cy - 1.5f * dp + bh)
                    canvas.drawRoundRect(body, 2.5f * dp, 2.5f * dp, strokePaint)
                    val shackle = RectF(cx - 4.8f * dp, cy - 9.5f * dp, cx + 4.8f * dp, cy + 1f * dp)
                    canvas.drawArc(shackle, 180f, 180f, false, strokePaint)
                    canvas.drawLine(cx - 4.8f * dp, cy - 4.2f * dp, cx - 4.8f * dp, cy - 1.5f * dp, strokePaint)
                    canvas.drawLine(cx + 4.8f * dp, cy - 4.2f * dp, cx + 4.8f * dp, cy - 1.5f * dp, strokePaint)
                }
                IconType.PREV -> {
                    val h = 8.5f * dp
                    val barX = cx - 8f * dp
                    canvas.drawLine(barX, cy - h, barX, cy + h, strokePaint)
                    val p = Path().apply {
                        moveTo(barX + 1.5f * dp, cy)
                        lineTo(cx + 8.5f * dp, cy - h)
                        lineTo(cx + 8.5f * dp, cy + h)
                        close()
                    }
                    canvas.drawPath(p, strokePaint)
                }
                IconType.NEXT -> {
                    val h = 8.5f * dp
                    val barX = cx + 8f * dp
                    canvas.drawLine(barX, cy - h, barX, cy + h, strokePaint)
                    val p = Path().apply {
                        moveTo(barX - 1.5f * dp, cy)
                        lineTo(cx - 8.5f * dp, cy - h)
                        lineTo(cx - 8.5f * dp, cy + h)
                        close()
                    }
                    canvas.drawPath(p, strokePaint)
                }
                IconType.PAUSE_CIRCLE -> {
                    val r = 18.5f * dp
                    canvas.drawCircle(cx, cy, r, strokePaint)
                    val barH = 7.5f * dp
                    val gap = 4.2f * dp
                    strokePaint.strokeWidth = 2.1f * dp
                    canvas.drawLine(cx - gap, cy - barH, cx - gap, cy + barH, strokePaint)
                    canvas.drawLine(cx + gap, cy - barH, cx + gap, cy + barH, strokePaint)
                    strokePaint.strokeWidth = 1.7f * dp
                }
                IconType.PLAY_CIRCLE -> {
                    val r = 18.5f * dp
                    canvas.drawCircle(cx, cy, r, strokePaint)
                    val p = Path().apply {
                        moveTo(cx - 4.5f * dp, cy - 7.5f * dp)
                        lineTo(cx + 8.5f * dp, cy)
                        lineTo(cx - 4.5f * dp, cy + 7.5f * dp)
                        close()
                    }
                    canvas.drawPath(p, strokePaint)
                }
                IconType.SETTINGS -> {
                    // 极简 8 齿空心齿轮
                    val outerR = 9.5f * dp
                    val innerR = 7.2f * dp
                    val path = Path()
                    val teeth = 8
                    for (i in 0 until teeth * 2) {
                        val angle = Math.toRadians((i * 360.0 / (teeth * 2)) - 90.0)
                        val r = if (i % 2 == 0) outerR else innerR
                        val px = cx + (r * cos(angle)).toFloat()
                        val py = cy + (r * sin(angle)).toFloat()
                        if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                    }
                    path.close()
                    canvas.drawPath(path, strokePaint)
                    canvas.drawCircle(cx, cy, 3.2f * dp, strokePaint)
                }
            }
        }
    }

    // ==================== 自定义绘制视图：圆形配色球（带选中白勾） ====================

    private class ColorDotView(
        context: Context,
        val dotColor: Int
    ) : View(context) {
        private val dp = context.resources.displayMetrics.density
        var isActiveDot: Boolean = false
            set(value) {
                if (field != value) {
                    field = value
                    invalidate()
                }
            }

        private val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = dotColor
        }

        private val checkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = Color.WHITE
            strokeWidth = 2.0f * dp
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        init {
            isClickable = true
            isFocusable = true
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val cx = width / 2f
            val cy = height / 2f
            val r = 12.5f * dp
            canvas.drawCircle(cx, cy, r, circlePaint)

            if (isActiveDot) {
                val p = Path().apply {
                    moveTo(cx - 4.8f * dp, cy + 0.3f * dp)
                    lineTo(cx - 1.2f * dp, cy + 3.8f * dp)
                    lineTo(cx + 5.2f * dp, cy - 3.6f * dp)
                }
                canvas.drawPath(p, checkPaint)
            }
        }
    }
}
