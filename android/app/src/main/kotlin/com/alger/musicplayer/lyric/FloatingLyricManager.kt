package com.alger.musicplayer.lyric

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.alger.musicplayer.config.AppPrefs

/**
 * Android 系统桌面悬浮歌词窗口（类似桌面版 AlgerMusicPlayer 独立歌词窗）
 * 支持上下拖拽、点击展开迷你播控（上一首 / 播放暂停 / 下一首 / 关闭）、主词 + 翻译双行显示
 */
class FloatingLyricManager(
    private val context: Context,
    private val prefs: AppPrefs,
    private val onControlCommand: (String) -> Unit
) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var rootView: LinearLayout? = null
    private var mainLyricTv: TextView? = null
    private var transLyricTv: TextView? = null
    private var controlBar: LinearLayout? = null
    private var playPauseBtn: TextView? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    private var isShowing = false
    private var isPlayingState = false

    fun isEnabled(): Boolean = isShowing

    fun setEnabled(enabled: Boolean): Boolean {
        if (!enabled) {
            hide()
            prefs.floatingLyricEnabled = false
            return false
        }
        if (!Settings.canDrawOverlays(context)) {
            mainHandler.post {
                Toast.makeText(context, "请授予「显示在其他应用上层」权限以开启悬浮歌词", Toast.LENGTH_LONG).show()
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                runCatching { context.startActivity(intent) }
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
            if (!Settings.canDrawOverlays(context)) return@post

            val dp = context.resources.displayMetrics.density
            val container = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                val padH = (16 * dp).toInt()
                val padV = (8 * dp).toInt()
                setPadding(padH, padV, padH, padV)
                background = GradientDrawable().apply {
                    setColor(Color.argb(208, 19, 27, 41))
                    cornerRadius = 22 * dp
                    setStroke((1.2f * dp).toInt(), Color.argb(105, 255, 200, 61))
                }
            }

            val mainTv = TextView(context).apply {
                text = "小庞奶娃音乐"
                setTextColor(Color.parseColor("#FFCA28"))
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                setShadowLayer(4f, 0f, 1f, Color.BLACK)
            }

            val transTv = TextView(context).apply {
                text = ""
                setTextColor(Color.argb(215, 255, 255, 255))
                textSize = 12f
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                visibility = View.GONE
            }

            val bar = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                visibility = View.GONE
                setPadding(0, (6 * dp).toInt(), 0, 0)
            }

            fun makeBtn(label: String, onClick: () -> Unit): TextView {
                return TextView(context).apply {
                    text = label
                    setTextColor(Color.WHITE)
                    textSize = 13f
                    val p = (10 * dp).toInt()
                    setPadding(p, (4 * dp).toInt(), p, (4 * dp).toInt())
                    setOnClickListener { onClick() }
                }
            }

            val prevBtn = makeBtn("⏮") { onControlCommand("prev") }
            val ppBtn = makeBtn(if (isPlayingState) "⏸" else "▶") { onControlCommand("playpause") }
            val nextBtn = makeBtn("⏭") { onControlCommand("next") }
            val closeBtn = makeBtn("✕") {
                setEnabled(false)
                onControlCommand("close")
            }

            bar.addView(prevBtn)
            bar.addView(ppBtn)
            bar.addView(nextBtn)
            bar.addView(closeBtn)

            container.addView(mainTv)
            container.addView(transTv)
            container.addView(bar)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = prefs.floatingLyricY
                width = (context.resources.displayMetrics.widthPixels * 0.88f).toInt()
            }

            var initialY = 0
            var initialTouchY = 0f
            var moved = false

            container.setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialY = params.y
                        initialTouchY = event.rawY
                        moved = false
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (kotlin.math.abs(dy) > 8) moved = true
                        params.y = (initialY + dy).coerceAtLeast(40)
                        runCatching { wm.updateViewLayout(container, params) }
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (moved) {
                            prefs.floatingLyricY = params.y
                        } else {
                            bar.visibility = if (bar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                        }
                        true
                    }
                    else -> false
                }
            }

            runCatching {
                wm.addView(container, params)
                rootView = container
                mainLyricTv = mainTv
                transLyricTv = transTv
                controlBar = bar
                playPauseBtn = ppBtn
                layoutParams = params
                isShowing = true
            }
        }
    }

    fun updateLyric(text: String, translation: String, songTitle: String, isPlaying: Boolean) {
        isPlayingState = isPlaying
        if (!isShowing) return
        mainHandler.post {
            mainLyricTv?.text = text.ifBlank { songTitle.ifBlank { "小庞奶娃音乐" } }
            if (translation.isNotBlank()) {
                transLyricTv?.text = translation
                transLyricTv?.visibility = View.VISIBLE
            } else {
                transLyricTv?.visibility = View.GONE
            }
            playPauseBtn?.text = if (isPlaying) "⏸" else "▶"
        }
    }

    fun hide() {
        mainHandler.post {
            val view = rootView ?: return@post
            runCatching { wm.removeView(view) }
            rootView = null
            mainLyricTv = null
            transLyricTv = null
            controlBar = null
            playPauseBtn = null
            isShowing = false
        }
    }
}
