package com.xiaopang.naiwamusic.bridge

import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.xiaopang.naiwamusic.NaiwaApp
import com.xiaopang.naiwamusic.MainActivity
import com.xiaopang.naiwamusic.config.CrashLogManager
import com.xiaopang.naiwamusic.config.SecureCredentialStore
import com.xiaopang.naiwamusic.download.NativeDownloadManager
import com.xiaopang.naiwamusic.local.LocalMusicScanner
import com.xiaopang.naiwamusic.lyric.FloatingLyricManager
import com.xiaopang.naiwamusic.player.AudioCacheManager
import com.xiaopang.naiwamusic.player.ListeningStatsTracker
import com.xiaopang.naiwamusic.player.MusicPlaybackService
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * WebView JavaScript 桥接对象 (window.AlgerAndroid)
 */
class AndroidJsBridge(
    private val activity: MainActivity,
    private val app: NaiwaApp,
    private val localScanner: LocalMusicScanner,
    private val downloadManager: NativeDownloadManager,
    private val floatingLyricManager: FloatingLyricManager,
    private val onStatusBarStyle: (Boolean) -> Unit,
    private val onRequestAudioPermission: ((Boolean) -> Unit) -> Unit,
    private val onPickTextFile: (String, (JsonObject?) -> Unit) -> Unit,
    private val callbackDispatcher: (String, Boolean, String) -> Unit
) {
    companion object {
        private const val TAG = "AndroidJsBridge"
        internal const val NETEASE_AUTH_COOKIE_SECRET_KEY = "netease_auth_cookie"
        private val MUSIC_U_REGEX = Regex("(?:^|;\\s*)MUSIC_U=([^;\\s]+)")

        internal fun pickNeteaseUserCookie(candidates: List<String?>): String {
            for (raw in candidates) {
                val trimmed = raw?.trim().orEmpty()
                if (trimmed.isNotEmpty() && MUSIC_U_REGEX.containsMatchIn(trimmed)) {
                    return trimmed
                }
            }
            return ""
        }

        internal fun isExternalAudioDeviceType(type: Int): Boolean {
            return when (type) {
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_AUX_LINE,
                AudioDeviceInfo.TYPE_LINE_ANALOG,
                AudioDeviceInfo.TYPE_LINE_DIGITAL -> true
                else -> {
                    val isHearingAid = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                        type == AudioDeviceInfo.TYPE_HEARING_AID
                    val isBleAudio = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER)
                    val isBleBroadcast = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        type == AudioDeviceInfo.TYPE_BLE_BROADCAST
                    isHearingAid || isBleAudio || isBleBroadcast
                }
            }
        }
    }

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val secureStore by lazy { SecureCredentialStore(activity.applicationContext) }

    // ==================== 服务器配置与平台能力 ====================

    @JavascriptInterface
    fun getCapabilities(): String {
        return gson.toJson(
            mapOf(
                "supportsEq" to true,
                "supportsFloatingLyric" to true,
                "supportsBatteryOptimization" to true,
                "supportsAudioCache" to true
            )
        )
    }

    @JavascriptInterface
    fun getServerConfig(): String {
        val cfg = app.prefs.getServerConfig(app.localServerPort, app.localAuthToken)
        return gson.toJson(cfg)
    }

    @JavascriptInterface
    fun setServerConfig(json: String): String {
        val saved = app.prefs.saveServerConfigFromJson(json, app.localServerPort, app.localAuthToken)
        return gson.toJson(saved)
    }

    @JavascriptInterface
    fun getLocalServerStatus(): String {
        val running = app.httpServer?.isAlive == true
        return gson.toJson(
            mapOf(
                "running" to running,
                "port" to app.localServerPort,
                "hasAnonToken" to app.ncmClient.hasAnonymousToken()
            )
        )
    }

    // ==================== 异步原生任务分发 ====================

    @JavascriptInterface
    fun invokeAsync(callbackId: String, action: String, payloadJson: String) {
        scope.launch {
            try {
                val payload = runCatching {
                    if (payloadJson.isBlank()) JsonObject()
                    else JsonParser.parseString(payloadJson).asJsonObject
                }.getOrElse { JsonObject() }

                when (action) {
                    "unblock-music" -> handleUnblockMusic(callbackId, payload)
                    "http-request" -> handleHttpRequest(callbackId, payload)
                    "scan-local-music" -> handleScanLocalMusic(callbackId, payload)
                    "parse-local-music-metadata" -> handleParseLocalMetadata(callbackId, payload)
                    "download-music" -> {
                        downloadManager.enqueueDownload(payload)
                        callbackDispatcher(callbackId, true, """{"queued":true}""")
                    }
                    "get-downloaded-music" -> {
                        val list = downloadManager.getDownloadedList()
                        callbackDispatcher(callbackId, true, gson.toJson(list))
                    }
                    "check-file-exists" -> {
                        val path = payload.get("path")?.asString ?: ""
                        callbackDispatcher(callbackId, true, localScanner.checkFileExists(path).toString())
                    }
                    "delete-downloaded-music" -> {
                        val path = payload.get("path")?.asString ?: ""
                        callbackDispatcher(callbackId, true, downloadManager.deleteDownloaded(path).toString())
                    }
                    "clear-downloaded-music" -> {
                        callbackDispatcher(callbackId, true, downloadManager.clearDownloaded().toString())
                    }
                    "save-lyric-file" -> {
                        val fn = payload.get("filename")?.asString ?: "lyric"
                        val content = payload.get("lrcContent")?.asString ?: ""
                        val res = downloadManager.saveLyricFile(fn, content)
                        callbackDispatcher(callbackId, true, gson.toJson(res))
                    }
                    "save-text-file" -> {
                        val fn = payload.get("filename")?.asString ?: "xiaopang-music-backup.json"
                        val content = payload.get("content")?.asString ?: ""
                        val res = downloadManager.saveTextFile(fn, content)
                        callbackDispatcher(callbackId, true, gson.toJson(res))
                    }
                    "save-image-file" -> {
                        val fn = payload.get("filename")?.asString ?: "xiaopang-listening-report.png"
                        val dataUrl = payload.get("dataUrl")?.asString ?: ""
                        val res = downloadManager.saveImageToGallery(fn, dataUrl)
                        callbackDispatcher(callbackId, true, gson.toJson(res))
                    }
                    "get-offline-playable-ids" -> {
                        callbackDispatcher(callbackId, true, buildOfflinePlayableIdsJson())
                    }
                    "get-downloads-path" -> {
                        callbackDispatcher(
                            callbackId,
                            true,
                            gson.toJson(downloadManager.getDownloadDir().absolutePath)
                        )
                    }
                    "select-local-music-source" -> {
                        val res = JsonObject().apply {
                            addProperty("canceled", false)
                            add("filePaths", gson.toJsonTree(listOf("__ANDROID_MEDIASTORE__")))
                        }
                        callbackDispatcher(callbackId, true, gson.toJson(res))
                    }
                    "pick-text-file" -> {
                        val accept = payload.get("accept")?.asString ?: "*/*"
                        mainHandler.post {
                            onPickTextFile(accept) { result ->
                                if (result != null) {
                                    callbackDispatcher(callbackId, true, gson.toJson(result))
                                } else {
                                    callbackDispatcher(callbackId, true, "null")
                                }
                            }
                        }
                    }
                    "get-listening-stats" -> {
                        callbackDispatcher(callbackId, true, ListeningStatsTracker.getStatsJson(activity))
                    }
                    "reset-listening-stats" -> {
                        callbackDispatcher(callbackId, true, ListeningStatsTracker.resetStats(activity).toString())
                    }
                    "merge-listening-stats" -> {
                        val incoming = payload.get("stats")?.let {
                            if (it.isJsonPrimitive) it.asString else gson.toJson(it)
                        } ?: "{}"
                        callbackDispatcher(callbackId, true, ListeningStatsTracker.mergeStatsJson(activity, incoming))
                    }
                    "clear-netease-cookies" -> {
                        clearNeteaseCookiesInternal {
                            callbackDispatcher(callbackId, true, "true")
                        }
                    }
                    else -> {
                        callbackDispatcher(callbackId, true, "null")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "invokeAsync [$action] failed: ${e.message}", e)
                val err = gson.toJson(mapOf("error" to (e.message ?: "Unknown native error")))
                callbackDispatcher(callbackId, false, err)
            }
        }
    }

    private fun handleUnblockMusic(callbackId: String, payload: JsonObject) {
        val songId = payload.get("id")?.takeIf { !it.isJsonNull }?.asString ?: ""
        val songData = payload.getAsJsonObject("songData")
        val songName = songData?.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
        val expectedDurationMs = songData?.get("dt")?.takeIf { !it.isJsonNull }?.asLong
            ?: songData?.get("duration")?.takeIf { !it.isJsonNull }?.asLong
            ?: 0L
        val artists = buildString {
            val ar = songData?.getAsJsonArray("ar") ?: songData?.getAsJsonArray("artists")
            ar?.forEach { el ->
                val name = el.asJsonObject.get("name")?.takeIf { !it.isJsonNull }?.asString
                if (!name.isNullOrBlank()) {
                    if (isNotEmpty()) append(" ")
                    append(name)
                }
            }
        }
        val sources = mutableListOf<String>()
        payload.getAsJsonArray("enabledSources")?.forEach { el ->
            el.takeIf { !it.isJsonNull }?.asString?.let { sources.add(it) }
        }

        val res = app.unblockEngine.unblock(songId, songName, artists, sources, expectedDurationMs)
        if (res != null) {
            val wrapped = mapOf(
                "data" to mapOf(
                    "data" to mapOf(
                        "url" to res.url,
                        "br" to res.br,
                        "size" to res.size,
                        "platform" to res.platform,
                        "gain" to 0
                    ),
                    "params" to mapOf("id" to (songId.toLongOrNull() ?: 0L), "type" to "song")
                )
            )
            callbackDispatcher(callbackId, true, gson.toJson(wrapped))
        } else {
            callbackDispatcher(callbackId, false, gson.toJson(mapOf("error" to "多音源解析未找到可用链接")))
        }
    }

    private fun handleHttpRequest(callbackId: String, payload: JsonObject) {
        val url = payload.get("url")?.takeIf { !it.isJsonNull }?.asString ?: throw IllegalArgumentException("Missing URL")
        val method = payload.get("method")?.takeIf { !it.isJsonNull }?.asString ?: "GET"
        val timeout = payload.get("timeout")?.takeIf { !it.isJsonNull }?.asLong ?: 15000L
        val requestScope = payload.get("scope")?.takeIf { !it.isJsonNull }?.asString?.trim()?.lowercase()
        val isCustomLx = requestScope == "lx"
        val headers = LinkedHashMap<String, String>()
        payload.getAsJsonObject("headers")?.entrySet()?.forEach { (k, v) ->
            if (!v.isJsonNull) headers[k] = v.asString
        }
        val body = payload.get("body")?.takeIf { !it.isJsonNull }?.let {
            if (it.isJsonPrimitive) it.asString else gson.toJson(it)
        }
        val form = payload.getAsJsonObject("form")?.let { fObj ->
            LinkedHashMap<String, String>().apply {
                fObj.entrySet().forEach { (k, v) ->
                    if (!v.isJsonNull) put(k, v.asString)
                }
            }
        }

        val resp = app.unblockEngine.proxyHttpRequest(url, method, headers, body, form, timeout, isCustomLx)
        callbackDispatcher(callbackId, true, gson.toJson(resp))
    }

    private fun handleScanLocalMusic(callbackId: String, payload: JsonObject) {
        val folderPath = payload.get("folderPath")?.asString ?: "__ANDROID_MEDIASTORE__"
        mainHandler.post {
            onRequestAudioPermission { granted ->
                scope.launch {
                    if (!granted) {
                        val err = gson.toJson(mapOf("error" to "未授予音频读取权限，请在系统设置中允许访问本地音频"))
                        callbackDispatcher(callbackId, true, err)
                    } else {
                        val result = localScanner.scanWithStats(folderPath)
                        callbackDispatcher(callbackId, true, gson.toJson(result))
                    }
                }
            }
        }
    }

    private fun handleParseLocalMetadata(callbackId: String, payload: JsonObject) {
        val paths = mutableListOf<String>()
        payload.getAsJsonArray("filePaths")?.forEach { el ->
            el.asString?.let { paths.add(it) }
        }
        val metas = localScanner.parseMetadata(paths)
        callbackDispatcher(callbackId, true, gson.toJson(metas))
    }

    // ==================== 原生 Media3 ExoPlayer 音频控制 ====================

    @JavascriptInterface
    fun audioLoad(payloadJson: String) {
        val obj = runCatching { JsonParser.parseString(payloadJson).asJsonObject }.getOrNull() ?: return
        MusicPlaybackService.ensureStarted(activity) { svc ->
            svc.loadAndPrepare(obj)
        }
    }

    @JavascriptInterface
    fun audioPlay() {
        MusicPlaybackService.ensureStarted(activity) { svc ->
            svc.play()
        }
    }

    @JavascriptInterface
    fun audioPause() {
        MusicPlaybackService.instance?.pause()
    }

    @JavascriptInterface
    fun audioStop() {
        MusicPlaybackService.instance?.stopPlayback()
    }

    @JavascriptInterface
    fun audioSeek(positionSec: Double) {
        MusicPlaybackService.instance?.seekTo(positionSec)
    }

    @JavascriptInterface
    fun audioSetVolume(volume: Float) {
        MusicPlaybackService.instance?.setVolume(volume)
    }

    @JavascriptInterface
    fun audioSetRate(rate: Float) {
        MusicPlaybackService.instance?.setPlaybackRate(rate)
    }

    @JavascriptInterface
    fun audioGetState(): String {
        return MusicPlaybackService.instance?.getStateJson()
            ?: """{"instanceId":0,"position":0,"duration":0,"playing":false}"""
    }

    @JavascriptInterface
    fun audioGetActiveTrack(): String {
        return MusicPlaybackService.instance?.getActiveTrackJson()
            ?: """{"hasActiveTrack":false}"""
    }

    @JavascriptInterface
    fun audioSyncQueue(queueJson: String) {
        val obj = runCatching { JsonParser.parseString(queueJson).asJsonObject }.getOrNull() ?: return
        MusicPlaybackService.latestSyncedQueue = obj
        MusicPlaybackService.instance?.syncQueue(obj)
    }

    @JavascriptInterface
    fun audioSetAudioEnhancement(configJson: String) {
        val obj = runCatching { JsonParser.parseString(configJson).asJsonObject }.getOrNull() ?: return
        val crossfadeMs = obj.get("crossfadeMs")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
        val volumeNormalization = obj.get("volumeNormalization")?.takeIf { !it.isJsonNull }?.asBoolean ?: false
        MusicPlaybackService.latestCrossfadeMs = crossfadeMs.coerceIn(0L, 3000L)
        MusicPlaybackService.latestVolumeNormalization = volumeNormalization
        MusicPlaybackService.instance?.setAudioEnhancement(crossfadeMs, volumeNormalization)
    }

    // ==================== 硬件均衡器 ====================

    @JavascriptInterface
    fun eqSetEnabled(enabled: Boolean) {
        MusicPlaybackService.latestEqEnabled = enabled
        MusicPlaybackService.instance?.setEqEnabled(enabled)
    }

    @JavascriptInterface
    fun eqSetBandGain(freqHz: Int, gainDb: Float) {
        MusicPlaybackService.latestEqGainsDb[freqHz] = gainDb.coerceIn(-12f, 12f)
        MusicPlaybackService.instance?.setEqBandGain(freqHz, gainDb)
    }

    @JavascriptInterface
    fun eqReset() {
        MusicPlaybackService.latestEqGainsDb.clear()
        MusicPlaybackService.instance?.resetEq()
    }

    // ==================== 桌面悬浮歌词 ====================

    @JavascriptInterface
    fun setFloatingLyricEnabled(enabled: Boolean): Boolean {
        return floatingLyricManager.setEnabled(enabled)
    }

    @JavascriptInterface
    fun isFloatingLyricEnabled(): Boolean {
        return floatingLyricManager.isEnabled()
    }

    @JavascriptInterface
    fun isFloatingLyricHideInLandscape(): Boolean {
        return app.prefs.floatingLyricHideInLandscape
    }

    @JavascriptInterface
    fun setFloatingLyricHideInLandscape(enabled: Boolean): Boolean {
        app.prefs.floatingLyricHideInLandscape = enabled
        floatingLyricManager.onHideInLandscapeSettingChanged(enabled)
        return enabled
    }

    @JavascriptInterface
    fun setMediaFavoriteState(songId: String, isFavorite: Boolean) {
        MusicPlaybackService.latestFavoriteSongId = songId
        MusicPlaybackService.latestFavoriteState = isFavorite
        MusicPlaybackService.instance?.setMediaFavoriteState(songId, isFavorite)
    }

    @JavascriptInterface
    fun isFloatingLyricLocked(): Boolean {
        return floatingLyricManager.isLockedState()
    }

    @JavascriptInterface
    fun setFloatingLyricLocked(locked: Boolean): Boolean {
        floatingLyricManager.setLocked(locked)
        return locked
    }

    @JavascriptInterface
    fun updateFloatingLyric(text: String, translation: String, songTitle: String, isPlaying: Boolean) {
        floatingLyricManager.updateLyric(text, translation, songTitle, isPlaying)
    }

    @JavascriptInterface
    fun syncFloatingLyricLines(songId: String, songTitle: String, linesJson: String) {
        floatingLyricManager.syncLyricLinesFromJs(songId, songTitle, linesJson)
    }

    @JavascriptInterface
    fun getFloatingLyricStyle(): String {
        return floatingLyricManager.getStyleConfigJson()
    }

    @JavascriptInterface
    fun setFloatingLyricStyle(configJson: String): String {
        return runCatching {
            val obj = JsonParser.parseString(configJson).asJsonObject
            val color = obj.get("color")?.takeIf { !it.isJsonNull }?.asString
            val textSizeSp = obj.get("textSizeSp")?.takeIf { !it.isJsonNull }?.asFloat
            val showTranslation = obj.get("showTranslation")?.takeIf { !it.isJsonNull }?.asBoolean
            floatingLyricManager.updateStyleFromJs(color, textSizeSp, showTranslation)
        }.getOrElse {
            Log.w(TAG, "setFloatingLyricStyle invalid json: ${it.message}")
            floatingLyricManager.getStyleConfigJson()
        }
    }

    @JavascriptInterface
    fun isAutoResumeOnBluetoothConnect(): Boolean {
        return app.prefs.autoResumeOnBluetoothConnect
    }

    @JavascriptInterface
    fun setAutoResumeOnBluetoothConnect(enabled: Boolean): Boolean {
        app.prefs.autoResumeOnBluetoothConnect = enabled
        return enabled
    }

    // ==================== 系统 UI、保活与工具 ====================

    @JavascriptInterface
    fun setStatusBarStyle(isDark: Boolean) {
        mainHandler.post { onStatusBarStyle(isDark) }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = activity.getSystemService(PowerManager::class.java)
        return pm.isIgnoringBatteryOptimizations(activity.packageName)
    }

    @JavascriptInterface
    fun requestIgnoreBatteryOptimizations() {
        mainHandler.post {
            val pm = activity.getSystemService(PowerManager::class.java)
            if (pm.isIgnoringBatteryOptimizations(activity.packageName)) {
                Toast.makeText(activity, "已加入后台电池优化白名单", Toast.LENGTH_SHORT).show()
                return@post
            }
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${activity.packageName}")
            )
            runCatching { activity.startActivity(intent) }.onFailure {
                val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                runCatching { activity.startActivity(fallback) }
            }
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        val raw = url.trim()
        if (raw.isEmpty()) return
        val parsed = runCatching { Uri.parse(raw) }.getOrNull() ?: return
        val scheme = parsed.scheme?.lowercase()?.trim() ?: return
        val allowedSchemes = setOf("https", "http", "orpheus", "bilibili", "mqqapi", "qqmusic")
        if (!allowedSchemes.contains(scheme)) return

        mainHandler.post {
            val launched = runCatching {
                activity.startActivity(Intent(Intent.ACTION_VIEW, parsed))
                true
            }.getOrDefault(false)
            if (!launched && scheme != "http" && scheme != "https") {
                val fallbackPackage = when (scheme) {
                    "orpheus" -> "com.netease.cloudmusic"
                    "bilibili" -> "tv.danmaku.bili"
                    "mqqapi" -> "com.tencent.mobileqq"
                    "qqmusic" -> "com.tencent.qqmusic"
                    else -> null
                }
                val pkgLaunched = fallbackPackage?.let { pkg ->
                    runCatching {
                        val launchIntent = activity.packageManager.getLaunchIntentForPackage(pkg)
                        if (launchIntent != null) {
                            activity.startActivity(launchIntent)
                            true
                        } else {
                            false
                        }
                    }.getOrDefault(false)
                } ?: false
                if (!pkgLaunched) {
                    Toast.makeText(activity, "未检测到对应 App，可先保存二维码后打开扫一扫", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    @JavascriptInterface
    fun showToast(msg: String) {
        mainHandler.post {
            Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun triggerHaptic(style: String) {
        val feedbackConstant = when (style.lowercase().trim()) {
            "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
            "selection" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                HapticFeedbackConstants.TEXT_HANDLE_MOVE
            } else {
                HapticFeedbackConstants.CLOCK_TICK
            }
            "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.CONTEXT_CLICK
            }
            "light" -> HapticFeedbackConstants.CLOCK_TICK
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        mainHandler.post {
            runCatching {
                // 不传入 FLAG_IGNORE_GLOBAL_SETTING，严格尊重系统触感/震动开关设置
                activity.window?.decorView?.performHapticFeedback(feedbackConstant)
            }
        }
    }

    @JavascriptInterface
    fun isAudioOutputExternal(): Boolean {
        return runCatching {
            val audioManager = activity.getSystemService(AudioManager::class.java) ?: return false
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
                isExternalAudioDeviceType(device.type)
            }
        }.getOrDefault(false)
    }

    @JavascriptInterface
    fun isAudioCached(songId: String, quality: String): Boolean {
        if (songId.isBlank()) return false
        val normalizedQuality = quality.ifBlank { "higher" }
        return AudioCacheManager.isCached(activity, "song_${songId}_${normalizedQuality}")
    }

    @JavascriptInterface
    fun getOfflinePlayableIds(): String {
        return buildOfflinePlayableIdsJson()
    }

    private fun buildOfflinePlayableIdsJson(): String {
        val cachedIds = AudioCacheManager.getCachedSongIds(activity).toList()
        val downloadedIds = downloadManager.getDownloadedSongIds().toList()
        val localPaths = localScanner.getScannedPaths().toList()
        return gson.toJson(
            mapOf(
                "cachedIds" to cachedIds,
                "downloadedIds" to downloadedIds,
                "localIds" to localPaths
            )
        )
    }

    @JavascriptInterface
    fun getAudioCacheSize(): Long {
        return AudioCacheManager.getCacheSizeBytes(activity)
    }

    @JavascriptInterface
    fun clearAudioCache(): Boolean {
        return AudioCacheManager.clearCache(activity)
    }

    @JavascriptInterface
    fun getAudioCacheMaxMb(): Int {
        return AudioCacheManager.getMaxCacheMb(activity)
    }

    @JavascriptInterface
    fun setAudioCacheMaxMb(mb: Int): String {
        val result = AudioCacheManager.setMaxCacheMb(activity, mb)
        return gson.toJson(
            mapOf(
                "maxMb" to result.maxMb,
                "activeMaxMb" to result.activeMaxMb,
                "requiresRestart" to result.requiresRestart
            )
        )
    }

    @JavascriptInterface
    fun getListeningStats(): String {
        return ListeningStatsTracker.getStatsJson(activity)
    }

    @JavascriptInterface
    fun resetListeningStats(): Boolean {
        return ListeningStatsTracker.resetStats(activity)
    }

    @JavascriptInterface
    fun mergeListeningStats(statsJson: String): String {
        return ListeningStatsTracker.mergeStatsJson(activity, statsJson)
    }

    @JavascriptInterface
    fun consumePendingWidgetAction(): String {
        return activity.consumePendingWidgetActionJson()
    }

    // ==================== 硬件 Keystore 加密凭据存储 ====================

    @JavascriptInterface
    fun secureSetSecret(key: String, value: String): Boolean {
        return secureStore.setSecret(key, value)
    }

    @JavascriptInterface
    fun secureGetSecret(key: String): String {
        return secureStore.getSecret(key)
    }

    @JavascriptInterface
    fun secureRemoveSecret(key: String): Boolean {
        return secureStore.removeSecret(key)
    }

    @JavascriptInterface
    fun getNeteaseCookieFromStore(): String {
        val secureCookie = secureStore.getSecret(NETEASE_AUTH_COOKIE_SECRET_KEY).trim()
        if (secureCookie.isNotEmpty()) {
            return secureCookie
        }
        return runCatching {
            val cookieManager = CookieManager.getInstance()
            val candidates = listOf(
                cookieManager.getCookie("https://music.163.com"),
                cookieManager.getCookie("https://interface.music.163.com"),
                cookieManager.getCookie("http://127.0.0.1:${app.localServerPort}")
            )
            pickNeteaseUserCookie(candidates)
        }.onFailure { err ->
            Log.w(TAG, "getNeteaseCookieFromStore CookieManager read failed: ${err.message}")
        }.getOrDefault("")
    }

    private fun clearNeteaseCookiesInternal(onDone: (() -> Unit)? = null) {
        MusicPlaybackService.instance?.clearNativeUserCookie()
        secureStore.removeSecret(NETEASE_AUTH_COOKIE_SECRET_KEY)
        mainHandler.post {
            runCatching {
                val cookieManager = CookieManager.getInstance()
                cookieManager.removeAllCookies {
                    runCatching { cookieManager.flush() }
                    onDone?.invoke()
                }
            }.onFailure {
                Log.w(TAG, "clearNeteaseCookies failed: ${it.message}")
                onDone?.invoke()
            }
        }
    }

    @JavascriptInterface
    fun clearNeteaseCookies(): Boolean {
        clearNeteaseCookiesInternal()
        return true
    }

    @JavascriptInterface
    fun getLastCrashLog(): String {
        return CrashLogManager.getLastCrashLog(activity.applicationContext)
    }

    @JavascriptInterface
    fun clearLastCrashLog(): Boolean {
        return CrashLogManager.clearLastCrashLog(activity.applicationContext)
    }

    @JavascriptInterface
    fun exitApp() {
        mainHandler.post {
            runCatching {
                floatingLyricManager.release()
                MusicPlaybackService.instance?.stopPlayback()
                activity.finishAndRemoveTask()
            }.onFailure {
                activity.finish()
            }
        }
    }
}
