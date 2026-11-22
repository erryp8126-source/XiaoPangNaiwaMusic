package com.xiaopang.naiwamusic.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * Android 桌面 2×2「唱片封面」小组件（满屏圆角封面 + 播放状态灵动胶囊 + 控键）
 */
class CoverCardWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        MusicAppWidgetProvider.updateFromService(
            context,
            MusicAppWidgetProvider.WidgetStyle.COVER_2X2,
            appWidgetManager,
            appWidgetIds
        )
    }
}
