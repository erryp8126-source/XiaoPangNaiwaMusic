package com.xiaopang.naiwamusic.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * Android 桌面 4×2「奶油白捷径卡」小组件（对标 QQ 音乐纯白质感 + 2×2 多彩直达方格）
 */
class CreamCardWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        MusicAppWidgetProvider.updateFromService(
            context,
            MusicAppWidgetProvider.WidgetStyle.CREAM_4X2,
            appWidgetManager,
            appWidgetIds
        )
    }
}
