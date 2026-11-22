package com.xiaopang.naiwamusic.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews
import com.xiaopang.naiwamusic.MainActivity
import com.xiaopang.naiwamusic.R
import com.xiaopang.naiwamusic.player.MusicPlaybackService
import java.util.Locale

/**
 * Android 桌面 4×1「流光播控」小组件（小庞奶娃音乐）
 * 同时作为 4 种桌面小组件样式的统一状态分发中心：
 * 1. MusicAppWidgetProvider       — 4×1 流光播控条（随专辑封面动态流光渐变 + 实时进度条）
 * 2. CoverCardWidgetProvider      — 2×2 唱片封面卡（满屏圆角封面 + 播放状态胶囊 + 播控）
 * 3. AuraConsoleWidgetProvider    — 4×2 极光全能卡（流光氛围 + 进度时间 + 每日推荐/私人FM/我喜欢/搜索）
 * 4. CreamCardWidgetProvider      — 4×2 柔光珍珠卡（随封面淡彩流光珍珠底 + 2×2 釉光方砖）
 */
class MusicAppWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        updateFromService(context, WidgetStyle.BAR_4X1, appWidgetManager, appWidgetIds)
    }

    enum class WidgetStyle {
        BAR_4X1,
        COVER_2X2,
        AURA_4X2,
        CREAM_4X2
    }

    companion object {
        private const val REQ_OPEN_APP = 301
        private const val REQ_PREV = 302
        private const val REQ_PLAY_PAUSE = 303
        private const val REQ_NEXT = 304
        private const val REQ_COLD_AUTOPLAY = 305
        private const val REQ_SHORTCUT_DAILY = 310
        private const val REQ_SHORTCUT_FM = 311
        private const val REQ_SHORTCUT_FAVORITE = 312
        private const val REQ_SHORTCUT_SEARCH = 313

        private const val ROUTE_DAILY = "action:daily-recommend"
        private const val ROUTE_FM = "action:personal-fm"
        private const val ROUTE_FAVORITE = "/favorite"
        private const val ROUTE_SEARCH = "/mobile-search"

        fun updateFromService(
            context: Context,
            style: WidgetStyle,
            appWidgetManager: AppWidgetManager,
            appWidgetIds: IntArray
        ) {
            if (appWidgetIds.isEmpty()) return
            val svc = MusicPlaybackService.instance
            val hasActiveTrack = svc?.hasActiveTrack() ?: false
            val title = svc?.getCurrentSongTitle()?.ifBlank { "小庞奶娃音乐" } ?: "小庞奶娃音乐"
            val artist = svc?.getCurrentSongArtist()?.ifBlank {
                if (hasActiveTrack) "小庞奶娃音乐" else "轻点封面打开播放器"
            } ?: "轻点封面打开播放器"
            val playing = svc?.isCurrentlyPlaying() ?: false
            val artwork = svc?.getCurrentArtworkBitmap()
            val posMs = svc?.getCurrentPositionMs() ?: 0L
            val durMs = svc?.getCurrentDurationMs() ?: 0L

            val assets = WidgetArtRenderer.getOrRender(artwork)
            val views = buildViewsForStyle(
                context = context.applicationContext,
                style = style,
                title = title,
                artist = artist,
                isPlaying = playing,
                hasActiveTrack = hasActiveTrack,
                assets = assets,
                positionMs = posMs,
                durationMs = durMs
            )
            for (id in appWidgetIds) {
                appWidgetManager.updateAppWidget(id, views)
            }
        }

        fun updateAllWidgets(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?,
            positionMs: Long = 0L,
            durationMs: Long = 0L,
            hasActiveTrack: Boolean = title.isNotBlank() && title != "小庞奶娃音乐"
        ) {
            runCatching {
                val appCtx = context.applicationContext
                val manager = AppWidgetManager.getInstance(appCtx)

                val providers = listOf(
                    WidgetStyle.BAR_4X1 to MusicAppWidgetProvider::class.java,
                    WidgetStyle.COVER_2X2 to CoverCardWidgetProvider::class.java,
                    WidgetStyle.AURA_4X2 to AuraConsoleWidgetProvider::class.java,
                    WidgetStyle.CREAM_4X2 to CreamCardWidgetProvider::class.java
                )

                val activeTargets = providers.mapNotNull { (style, cls) ->
                    val ids = manager.getAppWidgetIds(ComponentName(appCtx, cls))
                    if (ids != null && ids.isNotEmpty()) style to ids else null
                }
                if (activeTargets.isEmpty()) return

                val safeTitle = title.ifBlank { "小庞奶娃音乐" }
                val safeArtist = artist.ifBlank {
                    if (hasActiveTrack) "小庞奶娃音乐" else "轻点封面打开播放器"
                }
                val assets = WidgetArtRenderer.getOrRender(artwork)

                for ((style, ids) in activeTargets) {
                    val views = buildViewsForStyle(
                        context = appCtx,
                        style = style,
                        title = safeTitle,
                        artist = safeArtist,
                        isPlaying = isPlaying,
                        hasActiveTrack = hasActiveTrack,
                        assets = assets,
                        positionMs = positionMs,
                        durationMs = durationMs
                    )
                    for (id in ids) {
                        manager.updateAppWidget(id, views)
                    }
                }
            }
        }

        private fun buildViewsForStyle(
            context: Context,
            style: WidgetStyle,
            title: String,
            artist: String,
            isPlaying: Boolean,
            hasActiveTrack: Boolean,
            assets: WidgetArtRenderer.RenderedAssets?,
            positionMs: Long,
            durationMs: Long
        ): RemoteViews {
            val layoutId = when (style) {
                WidgetStyle.BAR_4X1 -> R.layout.widget_aura_bar
                WidgetStyle.COVER_2X2 -> R.layout.widget_cover_card
                WidgetStyle.AURA_4X2 -> R.layout.widget_aura_console
                WidgetStyle.CREAM_4X2 -> R.layout.widget_cream_card
            }
            val views = RemoteViews(context.packageName, layoutId)
            val progressPermille = if (durationMs > 0L) {
                ((positionMs * 1000L) / durationMs).toInt().coerceIn(0, 1000)
            } else {
                0
            }

            // 显式重设全部三枚播控图标，防止系统桌面覆盖升级后因旧资源 ID 缓存导致上一首图标错乱
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_artist, artist)
            views.setImageViewResource(R.id.widget_btn_prev, R.drawable.ic_widget_prev)
            views.setImageViewResource(
                R.id.widget_btn_play_pause,
                if (isPlaying) R.drawable.ic_widget_pause else R.drawable.ic_widget_play
            )
            views.setImageViewResource(R.id.widget_btn_next, R.drawable.ic_widget_next)

            when (style) {
                WidgetStyle.BAR_4X1 -> {
                    if (assets != null) {
                        views.setImageViewBitmap(R.id.widget_ambient_bg, assets.ambient4x1)
                        views.setImageViewBitmap(R.id.widget_cover, assets.roundedCover)
                    } else {
                        views.setImageViewResource(R.id.widget_ambient_bg, R.drawable.widget_music_bg)
                        views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_round)
                    }
                    views.setProgressBar(R.id.widget_progress, 1000, progressPermille, false)
                }

                WidgetStyle.COVER_2X2 -> {
                    if (assets != null) {
                        views.setImageViewBitmap(R.id.widget_full_cover, assets.fullCover2x2)
                    } else {
                        views.setImageViewResource(R.id.widget_full_cover, R.drawable.widget_music_bg)
                    }
                    val badgeText = when {
                        isPlaying -> "● 正在播放"
                        hasActiveTrack -> "已暂停"
                        else -> "小庞奶娃"
                    }
                    views.setTextViewText(R.id.widget_status_badge, badgeText)
                }

                WidgetStyle.AURA_4X2 -> {
                    if (assets != null) {
                        views.setImageViewBitmap(R.id.widget_ambient_bg, assets.ambient4x2)
                        views.setImageViewBitmap(R.id.widget_cover, assets.roundedCover)
                    } else {
                        views.setImageViewResource(R.id.widget_ambient_bg, R.drawable.widget_music_bg)
                        views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_round)
                    }
                    views.setProgressBar(R.id.widget_progress, 1000, progressPermille, false)
                    views.setTextViewText(R.id.widget_time_cur, formatTimeMs(positionMs))
                    views.setTextViewText(R.id.widget_time_total, formatTimeMs(durationMs))
                }

                WidgetStyle.CREAM_4X2 -> {
                    if (assets != null) {
                        views.setImageViewBitmap(R.id.widget_ambient_bg, assets.ambientLight4x2)
                        views.setImageViewBitmap(R.id.widget_cover, assets.roundedCover)
                    } else {
                        views.setImageViewResource(R.id.widget_ambient_bg, R.drawable.widget_cream_bg)
                        views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_round)
                    }
                    views.setProgressBar(R.id.widget_progress, 1000, progressPermille, false)
                    views.setTextViewText(R.id.widget_time_cur, formatTimeMs(positionMs))
                    views.setTextViewText(R.id.widget_time_total, formatTimeMs(durationMs))
                }
            }

            // 点击封面/歌名区域打开播放器
            val openPending = openAppPendingIntent(context)
            views.setOnClickPendingIntent(R.id.widget_info_container, openPending)
            when (style) {
                WidgetStyle.COVER_2X2 -> {
                    views.setOnClickPendingIntent(R.id.widget_full_cover, openPending)
                    views.setOnClickPendingIntent(R.id.widget_status_badge, openPending)
                }
                else -> {
                    views.setOnClickPendingIntent(R.id.widget_cover, openPending)
                }
            }

            // 播控三键
            val playPausePending = if (hasActiveTrack) {
                servicePendingIntent(context, REQ_PLAY_PAUSE, MusicPlaybackService.ACTION_PLAY_PAUSE)
            } else {
                coldAutoplayPendingIntent(context)
            }
            views.setOnClickPendingIntent(
                R.id.widget_btn_prev,
                servicePendingIntent(context, REQ_PREV, MusicPlaybackService.ACTION_PREV)
            )
            views.setOnClickPendingIntent(R.id.widget_btn_play_pause, playPausePending)
            views.setOnClickPendingIntent(
                R.id.widget_btn_next,
                servicePendingIntent(context, REQ_NEXT, MusicPlaybackService.ACTION_NEXT)
            )

            // 4×2 两种大卡片绑定 4 枚一键直达入口（每日推荐 / 私人FM / 我喜欢 / 搜索）
            if (style == WidgetStyle.AURA_4X2 || style == WidgetStyle.CREAM_4X2) {
                views.setOnClickPendingIntent(
                    R.id.widget_shortcut_daily,
                    shortcutPendingIntent(context, REQ_SHORTCUT_DAILY, ROUTE_DAILY)
                )
                views.setOnClickPendingIntent(
                    R.id.widget_shortcut_fm,
                    shortcutPendingIntent(context, REQ_SHORTCUT_FM, ROUTE_FM)
                )
                views.setOnClickPendingIntent(
                    R.id.widget_shortcut_favorite,
                    shortcutPendingIntent(context, REQ_SHORTCUT_FAVORITE, ROUTE_FAVORITE)
                )
                views.setOnClickPendingIntent(
                    R.id.widget_shortcut_search,
                    shortcutPendingIntent(context, REQ_SHORTCUT_SEARCH, ROUTE_SEARCH)
                )
            }

            return views
        }

        private fun openAppPendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            return PendingIntent.getActivity(
                context,
                REQ_OPEN_APP,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun coldAutoplayPendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = "com.xiaopang.naiwamusic.WIDGET_AUTOPLAY"
                putExtra("widget_autoplay", true)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            return PendingIntent.getActivity(
                context,
                REQ_COLD_AUTOPLAY,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun shortcutPendingIntent(
            context: Context,
            requestCode: Int,
            route: String
        ): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = "com.xiaopang.naiwamusic.WIDGET_NAV_$requestCode"
                putExtra("widget_route", route)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun servicePendingIntent(
            context: Context,
            requestCode: Int,
            action: String
        ): PendingIntent {
            val intent = Intent(context, MusicPlaybackService::class.java).setAction(action)
            return PendingIntent.getForegroundService(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun formatTimeMs(ms: Long): String {
            val totalSec = (ms.coerceAtLeast(0L) / 1000L).toInt()
            val min = totalSec / 60
            val sec = totalSec % 60
            return String.format(Locale.US, "%02d:%02d", min, sec)
        }
    }
}
