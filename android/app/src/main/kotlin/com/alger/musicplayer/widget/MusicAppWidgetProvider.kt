package com.alger.musicplayer.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.widget.RemoteViews
import com.alger.musicplayer.MainActivity
import com.alger.musicplayer.R
import com.alger.musicplayer.player.MusicPlaybackService

/**
 * Android 桌面 4x1 音乐播控小组件（小庞奶娃音乐）
 * 显示当前专辑封面、歌名、歌手与 上一首 / 播放暂停 / 下一首 快捷控键
 */
class MusicAppWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val svc = MusicPlaybackService.instance
        val title = svc?.getCurrentSongTitle()?.ifBlank { "小庞奶娃音乐" } ?: "小庞奶娃音乐"
        val artist = svc?.getCurrentSongArtist()?.ifBlank { "轻点封面打开播放器" } ?: "轻点封面打开播放器"
        val playing = svc?.isCurrentlyPlaying() ?: false
        val artwork = svc?.getCurrentArtworkBitmap()

        val views = buildRemoteViews(context, title, artist, playing, artwork)
        for (appWidgetId in appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    companion object {
        fun updateAllWidgets(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?
        ) {
            runCatching {
                val appCtx = context.applicationContext
                val manager = AppWidgetManager.getInstance(appCtx)
                val component = ComponentName(appCtx, MusicAppWidgetProvider::class.java)
                val ids = manager.getAppWidgetIds(component)
                if (ids == null || ids.isEmpty()) return

                val views = buildRemoteViews(
                    appCtx,
                    title.ifBlank { "小庞奶娃音乐" },
                    artist.ifBlank { "小庞奶娃音乐" },
                    isPlaying,
                    artwork
                )
                for (id in ids) {
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(
            context: Context,
            title: String,
            artist: String,
            isPlaying: Boolean,
            artwork: Bitmap?
        ): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_music_player)
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_artist, artist)
            views.setImageViewResource(
                R.id.widget_btn_play_pause,
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
            )

            if (artwork != null && !artwork.isRecycled) {
                val rounded = makeRoundedBitmap(artwork, 144, 24f)
                views.setImageViewBitmap(R.id.widget_cover, rounded)
            } else {
                views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_round)
            }

            // 点击封面或文字打开主界面
            val openIntent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openPending = PendingIntent.getActivity(
                context,
                301,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_cover, openPending)
            views.setOnClickPendingIntent(R.id.widget_info_container, openPending)

            // 播控按钮使用 getForegroundService 兼容 Android 8+ 后台启动限制
            views.setOnClickPendingIntent(
                R.id.widget_btn_prev,
                servicePendingIntent(context, 302, MusicPlaybackService.ACTION_PREV)
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_play_pause,
                servicePendingIntent(context, 303, MusicPlaybackService.ACTION_PLAY_PAUSE)
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_next,
                servicePendingIntent(context, 304, MusicPlaybackService.ACTION_NEXT)
            )

            return views
        }

        private fun servicePendingIntent(context: Context, requestCode: Int, action: String): PendingIntent {
            val intent = Intent(context, MusicPlaybackService::class.java).setAction(action)
            return PendingIntent.getForegroundService(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun makeRoundedBitmap(source: Bitmap, targetPx: Int, radiusPx: Float): Bitmap {
            val scaled = Bitmap.createScaledBitmap(source, targetPx, targetPx, true)
            val output = Bitmap.createBitmap(targetPx, targetPx, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val rect = RectF(0f, 0f, targetPx.toFloat(), targetPx.toFloat())
            canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
            canvas.drawBitmap(scaled, 0f, 0f, paint)
            if (scaled !== source) scaled.recycle()
            return output
        }
    }
}
