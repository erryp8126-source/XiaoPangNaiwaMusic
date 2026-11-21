package com.alger.musicplayer.lyric

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * 自定义绘制视图：双行卡拉OK逐字扫色歌词（含描边投影与超长文本微缩自适应）
 */
internal class KaraokeLyricLineView(context: Context) : View(context) {
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

internal enum class FloatingIconType {
    CLOSE, LOCK, PREV, PLAY_CIRCLE, PAUSE_CIRCLE, NEXT, SETTINGS
}

/**
 * 自定义绘制视图：网易云极简线框矢量按钮
 */
internal class VectorIconButton(
    context: Context,
    type: FloatingIconType
) : View(context) {
    private val dp = context.resources.displayMetrics.density
    var iconType: FloatingIconType = type
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

    init {
        isClickable = true
        isFocusable = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f

        when (iconType) {
            FloatingIconType.CLOSE -> {
                val s = 7.5f * dp
                canvas.drawLine(cx - s, cy - s, cx + s, cy + s, strokePaint)
                canvas.drawLine(cx + s, cy - s, cx - s, cy + s, strokePaint)
            }
            FloatingIconType.LOCK -> {
                val bw = 15f * dp
                val bh = 11.5f * dp
                val body = RectF(cx - bw / 2f, cy - 1.5f * dp, cx + bw / 2f, cy - 1.5f * dp + bh)
                canvas.drawRoundRect(body, 2.5f * dp, 2.5f * dp, strokePaint)
                val shackle = RectF(cx - 4.8f * dp, cy - 9.5f * dp, cx + 4.8f * dp, cy + 1f * dp)
                canvas.drawArc(shackle, 180f, 180f, false, strokePaint)
                canvas.drawLine(cx - 4.8f * dp, cy - 4.2f * dp, cx - 4.8f * dp, cy - 1.5f * dp, strokePaint)
                canvas.drawLine(cx + 4.8f * dp, cy - 4.2f * dp, cx + 4.8f * dp, cy - 1.5f * dp, strokePaint)
            }
            FloatingIconType.PREV -> {
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
            FloatingIconType.NEXT -> {
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
            FloatingIconType.PAUSE_CIRCLE -> {
                val r = 18.5f * dp
                canvas.drawCircle(cx, cy, r, strokePaint)
                val barH = 7.5f * dp
                val gap = 4.2f * dp
                strokePaint.strokeWidth = 2.1f * dp
                canvas.drawLine(cx - gap, cy - barH, cx - gap, cy + barH, strokePaint)
                canvas.drawLine(cx + gap, cy - barH, cx + gap, cy + barH, strokePaint)
                strokePaint.strokeWidth = 1.7f * dp
            }
            FloatingIconType.PLAY_CIRCLE -> {
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
            FloatingIconType.SETTINGS -> {
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

/**
 * 自定义绘制视图：圆形配色球（带选中白勾）
 */
internal class ColorDotView(
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
