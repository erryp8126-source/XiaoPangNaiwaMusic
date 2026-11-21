package com.alger.musicplayer.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import java.lang.ref.WeakReference
import kotlin.math.max
import kotlin.math.min

/**
 * 桌面小组件视觉渲染引擎
 * - 从专辑封面提取氛围主色，同时渲染：
 *   1. 深色流光渐变玻璃底（4×1 流光播控 / 4×2 极光全能卡）
 *   2. 浅色柔光珍珠水彩玻璃底（4×2 柔光珍珠卡，告别单调纯白，随封面变幻淡彩流光）
 *   3. 抗锯齿圆角封面与 2×2 满屏唱片卡片（带上下通透暗角遮罩）
 * - 按封面位图身份缓存渲染结果，兼顾丝滑进度刷新与零重复内存分配
 */
object WidgetArtRenderer {

    private data class PaletteColors(
        val deepStart: Int,
        val midTone: Int,
        val warmGlow: Int,
        val accentHue: Float,
        val accentSat: Float
    )

    data class RenderedAssets(
        val roundedCover: Bitmap,
        val ambient4x1: Bitmap,
        val ambient4x2: Bitmap,
        val ambientLight4x2: Bitmap,
        val fullCover2x2: Bitmap
    )

    private val cacheLock = Any()
    private var cachedSourceRef: WeakReference<Bitmap>? = null
    private var cachedSourceIdentity: Int = 0
    private var cachedAssets: RenderedAssets? = null

    fun getOrRender(source: Bitmap?): RenderedAssets? {
        if (source == null || source.isRecycled || source.width <= 0 || source.height <= 0) {
            return null
        }
        val identity = System.identityHashCode(source)
        synchronized(cacheLock) {
            val prevSrc = cachedSourceRef?.get()
            val existing = cachedAssets
            if (prevSrc === source && cachedSourceIdentity == identity && existing != null) {
                return existing
            }
        }

        val palette = extractPalette(source)
        val assets = RenderedAssets(
            roundedCover = renderRoundedCover(source, targetPx = 128, radiusPx = 24f),
            ambient4x1 = renderAmbientBackground(palette, widthPx = 360, heightPx = 96, radiusPx = 30f),
            ambient4x2 = renderAmbientBackground(palette, widthPx = 360, heightPx = 180, radiusPx = 30f),
            ambientLight4x2 = renderLightPearlBackground(palette, widthPx = 360, heightPx = 180, radiusPx = 34f),
            fullCover2x2 = renderFullBleedCover(source, sizePx = 288, radiusPx = 38f)
        )

        synchronized(cacheLock) {
            cachedSourceRef = WeakReference(source)
            cachedSourceIdentity = identity
            cachedAssets = assets
        }
        return assets
    }

    private fun extractPalette(source: Bitmap): PaletteColors {
        val sample = Bitmap.createScaledBitmap(source, 24, 24, true)
        val pixels = IntArray(24 * 24)
        sample.getPixels(pixels, 0, 24, 0, 0, 24, 24)
        if (sample !== source) {
            sample.recycle()
        }

        val hsv = FloatArray(3)
        var bestScore = -1f
        var bestHue = 30f
        var bestSat = 0.55f
        var bestVal = 0.50f

        for (pixel in pixels) {
            val a = Color.alpha(pixel)
            if (a < 180) continue
            val r = Color.red(pixel)
            val g = Color.green(pixel)
            val b = Color.blue(pixel)

            Color.RGBToHSV(r, g, b, hsv)
            val sat = hsv[1]
            val value = hsv[2]
            if (value in 0.18f..0.94f) {
                val brightnessWeight = 1f - kotlin.math.abs(value - 0.58f)
                val score = sat * 1.45f + brightnessWeight * 0.55f
                if (score > bestScore) {
                    bestScore = score
                    bestHue = hsv[0]
                    bestSat = sat
                    bestVal = value
                }
            }
        }

        if (bestSat < 0.14f) {
            val deepStart = Color.argb(242, 24, 32, 48)
            val midTone = Color.argb(242, 34, 41, 56)
            val warmGlow = Color.argb(244, 72, 54, 40)
            return PaletteColors(deepStart, midTone, warmGlow, accentHue = 32f, accentSat = 0.36f)
        }

        val clampedSat = bestSat.coerceIn(0.32f, 0.82f)
        val deepStart = Color.HSVToColor(
            244,
            floatArrayOf(bestHue, (clampedSat * 0.55f).coerceIn(0.18f, 0.48f), 0.16f)
        )
        val midTone = Color.HSVToColor(
            242,
            floatArrayOf((bestHue + 10f) % 360f, (clampedSat * 0.72f).coerceIn(0.24f, 0.62f), 0.25f)
        )
        val warmGlow = Color.HSVToColor(
            244,
            floatArrayOf(
                bestHue,
                (clampedSat * 0.92f).coerceIn(0.35f, 0.85f),
                bestVal.coerceIn(0.36f, 0.54f)
            )
        )
        return PaletteColors(deepStart, midTone, warmGlow, accentHue = bestHue, accentSat = clampedSat)
    }

    private fun renderAmbientBackground(
        palette: PaletteColors,
        widthPx: Int,
        heightPx: Int,
        radiusPx: Float
    ): Bitmap {
        val output = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val rect = RectF(0f, 0f, widthPx.toFloat(), heightPx.toFloat())

        // 1. 主体斜向深邃流光渐变（保证白色歌名与控键高对比可读）
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                widthPx.toFloat(),
                heightPx.toFloat(),
                intArrayOf(palette.deepStart, palette.midTone, palette.warmGlow),
                floatArrayOf(0f, 0.52f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, bgPaint)

        // 2. 右下角柔焦光晕
        val glowColor = Color.argb(
            115,
            Color.red(palette.warmGlow),
            Color.green(palette.warmGlow),
            Color.blue(palette.warmGlow)
        )
        val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                widthPx * 0.82f,
                heightPx * 0.88f,
                max(widthPx, heightPx) * 0.62f,
                intArrayOf(glowColor, Color.TRANSPARENT),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, glowPaint)

        // 3. 左上角微弱高光玻璃层
        val sheenPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                0f,
                heightPx * 0.55f,
                Color.argb(34, 255, 255, 255),
                Color.TRANSPARENT,
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, sheenPaint)

        // 4. 细玻璃描边
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.6f
            color = Color.argb(56, 255, 255, 255)
        }
        val insetRect = RectF(0.8f, 0.8f, widthPx - 0.8f, heightPx - 0.8f)
        canvas.drawRoundRect(insetRect, radiusPx, radiusPx, borderPaint)

        return output
    }

    /**
     * 浅色柔光珍珠水彩玻璃底（4×2 柔光珍珠卡专用）：
     * 随专辑主色自动渲染淡奶白 → 淡彩霞光渐变 + 双重柔和径向弥散光晕 + 珍珠高光玻璃边，
     * 彻底摆脱纯白卡片生硬死白感，同时保持深色文字极致清晰。
     */
    private fun renderLightPearlBackground(
        palette: PaletteColors,
        widthPx: Int,
        heightPx: Int,
        radiusPx: Float
    ): Bitmap {
        val output = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val rect = RectF(0f, 0f, widthPx.toFloat(), heightPx.toFloat())

        val h1 = palette.accentHue
        val h2 = (palette.accentHue + 36f) % 360f
        val satBase = palette.accentSat.coerceIn(0.25f, 0.72f)

        val pearlTopLeft = Color.HSVToColor(246, floatArrayOf(h1, (satBase * 0.08f).coerceIn(0.03f, 0.08f), 0.995f))
        val pearlMid = Color.HSVToColor(244, floatArrayOf((h1 + 14f) % 360f, (satBase * 0.14f).coerceIn(0.06f, 0.13f), 0.985f))
        val pearlBottomRight = Color.HSVToColor(244, floatArrayOf(h2, (satBase * 0.24f).coerceIn(0.11f, 0.22f), 0.965f))

        // 1. 奶白淡彩斜向主底
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                widthPx.toFloat(),
                heightPx.toFloat(),
                intArrayOf(pearlTopLeft, pearlMid, pearlBottomRight),
                floatArrayOf(0f, 0.50f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, bgPaint)

        // 2. 左下角专辑主题色柔焦水彩光晕（映衬封面与播控区）
        val warmOrbColor = Color.HSVToColor(86, floatArrayOf(h1, (satBase * 0.65f).coerceIn(0.28f, 0.58f), 0.96f))
        val warmOrbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                widthPx * 0.16f,
                heightPx * 0.88f,
                max(widthPx, heightPx) * 0.55f,
                intArrayOf(warmOrbColor, Color.TRANSPARENT),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, warmOrbPaint)

        // 3. 右上角邻近色柔彩霞光（衬托右侧 2×2 釉光方砖）
        val coolOrbColor = Color.HSVToColor(68, floatArrayOf(h2, (satBase * 0.55f).coerceIn(0.22f, 0.50f), 0.97f))
        val coolOrbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                widthPx * 0.86f,
                heightPx * 0.14f,
                max(widthPx, heightPx) * 0.50f,
                intArrayOf(coolOrbColor, Color.TRANSPARENT),
                floatArrayOf(0f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, coolOrbPaint)

        // 4. 顶部丝绸镜面高光层
        val glossPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                0f,
                heightPx * 0.42f,
                Color.argb(128, 255, 255, 255),
                Color.TRANSPARENT,
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radiusPx, radiusPx, glossPaint)

        // 5. 精致珍珠双层描边（外层柔和轮廓 + 内层莹白光泽）
        val innerRimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2.0f
            color = Color.argb(215, 255, 255, 255)
        }
        canvas.drawRoundRect(RectF(1.2f, 1.2f, widthPx - 1.2f, heightPx - 1.2f), radiusPx, radiusPx, innerRimPaint)

        val outerRimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.0f
            color = Color.argb(36, 15, 23, 42)
        }
        canvas.drawRoundRect(RectF(0.5f, 0.5f, widthPx - 0.5f, heightPx - 0.5f), radiusPx, radiusPx, outerRimPaint)

        return output
    }

    private fun renderRoundedCover(source: Bitmap, targetPx: Int, radiusPx: Float): Bitmap {
        val cropped = centerCropSquare(source, targetPx)
        val output = Bitmap.createBitmap(targetPx, targetPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val rect = RectF(0f, 0f, targetPx.toFloat(), targetPx.toFloat())
        canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(cropped, 0f, 0f, paint)
        if (cropped !== source) cropped.recycle()

        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.2f
            color = Color.argb(48, 255, 255, 255)
        }
        canvas.drawRoundRect(RectF(0.6f, 0.6f, targetPx - 0.6f, targetPx - 0.6f), radiusPx, radiusPx, strokePaint)
        return output
    }

    private fun renderFullBleedCover(source: Bitmap, sizePx: Int, radiusPx: Float): Bitmap {
        val cropped = centerCropSquare(source, sizePx)
        val output = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)

        val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        val rect = RectF(0f, 0f, sizePx.toFloat(), sizePx.toFloat())
        canvas.drawRoundRect(rect, radiusPx, radiusPx, maskPaint)
        maskPaint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(cropped, 0f, 0f, maskPaint)
        if (cropped !== source) cropped.recycle()

        val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f,
                0f,
                0f,
                sizePx.toFloat(),
                intArrayOf(
                    Color.argb(82, 8, 12, 20),
                    Color.argb(0, 8, 12, 20),
                    Color.argb(18, 8, 12, 20),
                    Color.argb(170, 8, 12, 20),
                    Color.argb(232, 8, 12, 22)
                ),
                floatArrayOf(0f, 0.24f, 0.48f, 0.76f, 1f),
                Shader.TileMode.CLAMP
            )
            xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
        }
        canvas.drawRect(rect, scrimPaint)

        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.6f
            color = Color.argb(58, 255, 255, 255)
        }
        canvas.drawRoundRect(RectF(0.8f, 0.8f, sizePx - 0.8f, sizePx - 0.8f), radiusPx, radiusPx, borderPaint)
        return output
    }

    private fun centerCropSquare(source: Bitmap, targetPx: Int): Bitmap {
        val sw = source.width
        val sh = source.height
        val side = min(sw, sh)
        val left = (sw - side) / 2
        val top = (sh - side) / 2
        val out = Bitmap.createBitmap(targetPx, targetPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(
            source,
            Rect(left, top, left + side, top + side),
            Rect(0, 0, targetPx, targetPx),
            paint
        )
        return out
    }
}
