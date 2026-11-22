package com.xiaopang.naiwamusic.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * Android 桌面 4×2「极光全能卡」小组件（随专辑封面流光渐变 + 实时进度与时间 + 4 枚快捷入口）
 */
class AuraConsoleWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        MusicAppWidgetProvider.updateFromService(
            context,
            MusicAppWidgetProvider.WidgetStyle.AURA_4X2,
            appWidgetManager,
            appWidgetIds
        )
    }
}
