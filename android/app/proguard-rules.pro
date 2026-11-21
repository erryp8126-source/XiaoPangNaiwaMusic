# ProGuard rules for 小庞奶娃音乐 (Android)
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*

# Preserve WebView @JavascriptInterface bridge methods
-keepclassmembers class com.alger.musicplayer.bridge.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Gson serialized models
-keep class com.alger.musicplayer.config.** { *; }
-keep class com.alger.musicplayer.player.ListeningStatsTracker$* { *; }

# Keep Media3 & NanoHTTPD runtime classes
-keep class androidx.media3.** { *; }
-keep class fi.iki.elonen.** { *; }
