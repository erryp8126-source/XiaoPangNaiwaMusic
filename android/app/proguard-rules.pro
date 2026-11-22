# ProGuard / R8 rules for 小庞奶娃音乐 (Android - com.xiaopang.naiwamusic)
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*

# Preserve WebView @JavascriptInterface bridge classes & methods
-keep class com.xiaopang.naiwamusic.bridge.** { *; }
-keepclassmembers class com.xiaopang.naiwamusic.bridge.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Application, Widgets, Services, and Activities referenced via reflection / manifest
-keep class com.xiaopang.naiwamusic.NaiwaApp { *; }
-keep class com.xiaopang.naiwamusic.MainActivity { *; }
-keep class com.xiaopang.naiwamusic.widget.** { *; }

# Preserve Gson serialized models & listening stats payload
-keep class com.xiaopang.naiwamusic.config.** { *; }
-keep class com.xiaopang.naiwamusic.player.ListeningStatsTracker { *; }
-keep class com.xiaopang.naiwamusic.player.ListeningStatsTracker$* { *; }
-keep class com.xiaopang.naiwamusic.server.** { *; }
-keep class com.xiaopang.naiwamusic.local.** { *; }
-keep class com.xiaopang.naiwamusic.download.** { *; }
-keep class com.google.gson.** { *; }
-keep class * extends com.google.gson.TypeAdapter
-keep class * extends com.google.gson.TypeAdapterFactory
-keep class * extends com.google.gson.JsonSerializer
-keep class * extends com.google.gson.JsonDeserializer

# Keep Media3 & NanoHTTPD runtime classes
-keep class androidx.media3.** { *; }
-keep class fi.iki.elonen.** { *; }

# Optional JVM/TLS provider classes referenced by OkHttp / Okio / Gson / NanoHTTPD
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**
-dontwarn javax.servlet.**
-dontwarn java.lang.invoke.**
