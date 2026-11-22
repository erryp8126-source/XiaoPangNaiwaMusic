package com.xiaopang.naiwamusic

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.xiaopang.naiwamusic.bridge.AndroidJsBridge
import com.xiaopang.naiwamusic.download.NativeDownloadManager
import com.xiaopang.naiwamusic.local.LocalMusicScanner
import com.xiaopang.naiwamusic.lyric.FloatingLyricManager
import com.xiaopang.naiwamusic.player.MusicPlaybackService
import com.google.gson.JsonObject
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var localScanner: LocalMusicScanner
    private lateinit var downloadManager: NativeDownloadManager
    private lateinit var floatingLyricManager: FloatingLyricManager
    private lateinit var jsBridge: AndroidJsBridge

    private var topInsetDp: Int = 0
    private var bottomInsetDp: Int = 0
    @Volatile
    private var isWebViewReady: Boolean = false
    @Volatile
    private var pendingWidgetRoute: String? = null
    @Volatile
    private var pendingWidgetAutoplay: Boolean = false

    private var pendingAudioPermissionCallback: ((Boolean) -> Unit)? = null
    private var pendingFilePickCallback: ((JsonObject?) -> Unit)? = null

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val audioPerm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        val granted = results[audioPerm] == true || hasAudioPermission()
        pendingAudioPermissionCallback?.invoke(granted)
        pendingAudioPermissionCallback = null
    }

    private val openDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        val cb = pendingFilePickCallback
        pendingFilePickCallback = null
        if (cb == null) return@registerForActivityResult
        if (uri == null) {
            cb(null)
            return@registerForActivityResult
        }
        runCatching {
            val content = contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use {
                it.readText()
            } ?: ""
            var displayName = "plugin"
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) displayName = c.getString(0) ?: displayName
            }
            cb(JsonObject().apply {
                addProperty("name", displayName)
                addProperty("content", content)
            })
        }.onFailure {
            cb(null)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-Edge 沉浸式状态栏与手势导航栏
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        val app = NaiwaApp.instance
        localScanner = LocalMusicScanner(this, { app.localServerPort }, { app.localAuthToken })
        downloadManager = NativeDownloadManager(this) { channel, payloadJson ->
            pushEventToJs(channel, payloadJson)
        }
        val lyricCmdHandler: (String) -> Unit = { cmd ->
            when (cmd) {
                "close" -> pushEventToJs("floating-lyric-closed", "{}")
                "next" -> {
                    val svc = MusicPlaybackService.instance
                    if (svc != null) svc.handleExternalTrackCommand("nexttrack", 1)
                    else pushEventToJs("lyric-control-back", JSONObject.quote(cmd))
                }
                "prev" -> {
                    val svc = MusicPlaybackService.instance
                    if (svc != null) svc.handleExternalTrackCommand("previoustrack", -1)
                    else pushEventToJs("lyric-control-back", JSONObject.quote(cmd))
                }
                "playpause" -> {
                    val svc = MusicPlaybackService.instance
                    if (svc != null) svc.togglePlayPauseFromOverlay()
                    else pushEventToJs("lyric-control-back", JSONObject.quote(cmd))
                }
                else -> pushEventToJs("lyric-control-back", JSONObject.quote(cmd))
            }
        }
        val existingLyricMgr = FloatingLyricManager.activeInstance
        floatingLyricManager = if (existingLyricMgr != null) {
            existingLyricMgr.onControlCommand = lyricCmdHandler
            existingLyricMgr
        } else {
            FloatingLyricManager(applicationContext, app.prefs, lyricCmdHandler)
        }

        // 将原生播放器事件回传绑定到当前 WebView
        MusicPlaybackService.eventEmitter = { channel, payloadJson ->
            pushEventToJs(channel, payloadJson)
        }

        webView = WebView(this)
        setContentView(webView)

        handleWidgetIntent(intent)
        setupInsetsInjection()
        setupWebView(app)
        setupBackNavigation()
        requestInitialNotificationPermission()

        // 如果用户之前开启了悬浮歌词，且权限仍然有效，则自动恢复
        if (app.prefs.floatingLyricEnabled) {
            floatingLyricManager.show()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // 从通知栏 / 悬浮窗 / 桌面小组件拉回已存在的 Activity 时，同步原生播放状态并处理小组件直达动作
        if (isWebViewReady) {
            MusicPlaybackService.onAppForegroundChanged(true)
        }
        handleWidgetIntent(intent)
    }

    private fun handleWidgetIntent(intent: Intent?) {
        if (intent == null) return
        val route = intent.getStringExtra("widget_route")
        val autoplay = intent.getBooleanExtra("widget_autoplay", false)
        if (!route.isNullOrBlank()) {
            intent.removeExtra("widget_route")
            if (isWebViewReady) {
                pushEventToJs("widget-navigate", JSONObject.quote(route))
            } else {
                pendingWidgetRoute = route
            }
        }
        if (autoplay) {
            intent.removeExtra("widget_autoplay")
            if (isWebViewReady) {
                pushEventToJs("widget-autoplay", "{}")
            } else {
                pendingWidgetAutoplay = true
            }
        }
    }

    fun consumePendingWidgetActionJson(): String {
        val route = pendingWidgetRoute
        val autoplay = pendingWidgetAutoplay
        pendingWidgetRoute = null
        pendingWidgetAutoplay = false
        val obj = JSONObject()
        if (!route.isNullOrBlank()) obj.put("route", route)
        obj.put("autoplay", autoplay)
        return obj.toString()
    }

    override fun onResume() {
        super.onResume()
        // 若 Activity 是从通知栏冷重建而来且 WebView 尚未加载完毕，不要提前清空 pendingTrackSyncJson；
        // 前端加载完成后会通过 audioGetActiveTrack() 无缝接管正在播放的原生音轨
        if (isWebViewReady) {
            MusicPlaybackService.onAppForegroundChanged(true)
        } else {
            MusicPlaybackService.isAppInForeground = true
        }
    }

    override fun onPause() {
        MusicPlaybackService.onAppForegroundChanged(false)
        super.onPause()
    }

    override fun onDestroy() {
        if (MusicPlaybackService.instance == null) {
            floatingLyricManager.hide()
        }
        if (isFinishing) {
            MusicPlaybackService.eventEmitter = null
        }
        webView.destroy()
        super.onDestroy()
    }

    private fun setupInsetsInjection() {
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            val sysBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val density = resources.displayMetrics.density
            topInsetDp = (sysBars.top / density).toInt()
            bottomInsetDp = (sysBars.bottom / density).toInt()
            injectSafeAreaCssVars()
            insets
        }
    }

    private fun injectSafeAreaCssVars() {
        val js = """
            (function() {
              document.documentElement.style.setProperty('--safe-area-inset-top', '${topInsetDp}px');
              document.documentElement.style.setProperty('--safe-area-inset-bottom', '${bottomInsetDp}px');
            })();
        """.trimIndent()
        webView.post { webView.evaluateJavascript(js, null) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(app: NaiwaApp) {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // 确保前端 isMobile 始终精准识别为 Android 手机端
            if (!userAgentString.contains("AlgerAndroid")) {
                userAgentString = "$userAgentString AlgerAndroid/${BuildConfig.VERSION_NAME} Mobile"
            }
        }

        webView.setBackgroundColor(Color.parseColor("#F6FAFD"))
        applySystemBarAppearance(false)

        jsBridge = AndroidJsBridge(
            activity = this,
            app = app,
            localScanner = localScanner,
            downloadManager = downloadManager,
            floatingLyricManager = floatingLyricManager,
            onStatusBarStyle = { isDark -> applySystemBarAppearance(isDark) },
            onRequestAudioPermission = { cb -> ensureAudioPermission(cb) },
            onPickTextFile = { _, cb ->
                pendingFilePickCallback = cb
                openDocumentLauncher.launch(arrayOf("text/*", "application/javascript", "application/json", "*/*"))
            },
            callbackDispatcher = { callbackId, success, resultJson ->
                dispatchAsyncCallbackToJs(callbackId, success, resultJson)
            }
        )

        webView.addJavascriptInterface(jsBridge, "AlgerAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val res = assetLoader.shouldInterceptRequest(request.url)
                if (res != null && request.url.path?.endsWith("index.html") == true) {
                    res.responseHeaders = (res.responseHeaders?.toMutableMap() ?: mutableMapOf()).apply {
                        put("Cache-Control", "no-store, no-cache, must-revalidate")
                    }
                }
                return res
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()
                if (url.startsWith("https://appassets.androidplatform.net/") ||
                    url.startsWith("http://127.0.0.1:")
                ) {
                    return false
                }
                // 外链（如 GitHub、会员页、文档）交给系统浏览器打开
                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                }
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isWebViewReady = true
                injectSafeAreaCssVars()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                return super.onConsoleMessage(consoleMessage)
            }
        }

        val curVersionCode = runCatching {
            androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(
                packageManager.getPackageInfo(packageName, 0)
            )
        }.getOrDefault(0L)
        val webMetaPrefs = getSharedPreferences("alger_webview_meta", MODE_PRIVATE)
        val lastVersionCode = webMetaPrefs.getLong("last_version_code", -1L)
        if (curVersionCode > 0L && curVersionCode != lastVersionCode) {
            // 覆盖升级新版 APK 时自动清掉 WebView 旧版 JS/HTML 缓存（绝不影响 localStorage 里的历史与收藏）
            webView.clearCache(true)
            webMetaPrefs.edit().putLong("last_version_code", curVersionCode).apply()
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html?v=$curVersionCode")
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){ return window.__algerHandleBack ? window.__algerHandleBack() : false; })()"
                ) { result ->
                    if (result != "true") {
                        // 在首页按返回键时退至后台，保持音乐不中断
                        moveTaskToBack(true)
                    }
                }
            }
        })
    }

    private fun applySystemBarAppearance(isDarkBackground: Boolean) {
        val controller = WindowCompat.getInsetsController(window, webView)
        controller.isAppearanceLightStatusBars = !isDarkBackground
        controller.isAppearanceLightNavigationBars = !isDarkBackground
        webView.setBackgroundColor(Color.parseColor(if (isDarkBackground) "#0F141C" else "#F6FAFD"))
    }

    private fun hasAudioPermission(): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
    }

    private fun ensureAudioPermission(callback: (Boolean) -> Unit) {
        if (hasAudioPermission()) {
            callback(true)
            return
        }
        pendingAudioPermissionCallback = callback
        val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        requestPermissionLauncher.launch(arrayOf(perm))
    }

    private fun requestInitialNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }
        }
    }

    private fun dispatchAsyncCallbackToJs(callbackId: String, success: Boolean, resultJson: String) {
        val quotedId = JSONObject.quote(callbackId)
        val quotedRes = JSONObject.quote(resultJson)
        val js = "window.__algerNativeCallback && window.__algerNativeCallback($quotedId, $success, $quotedRes);"
        runOnUiThread {
            if (!isDestroyed) {
                webView.evaluateJavascript(js, null)
            }
        }
    }

    private fun pushEventToJs(channel: String, payloadJson: String) {
        val quotedChannel = JSONObject.quote(channel)
        val quotedPayload = JSONObject.quote(payloadJson)
        val js = "window.__algerNativeEvent && window.__algerNativeEvent($quotedChannel, $quotedPayload);"
        runOnUiThread {
            if (!isDestroyed) {
                webView.evaluateJavascript(js, null)
            }
        }
    }
}
