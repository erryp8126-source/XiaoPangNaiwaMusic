package com.alger.musicplayer.bridge

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.alger.musicplayer.AlgerApp
import com.alger.musicplayer.MainActivity
import com.alger.musicplayer.download.NativeDownloadManager
import com.alger.musicplayer.local.LocalMusicScanner
import com.alger.musicplayer.lyric.FloatingLyricManager
import com.alger.musicplayer.player.AudioCacheManager
import com.alger.musicplayer.player.ListeningStatsTracker
import com.alger.musicplayer.player.MusicPlaybackService
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
    private val app: AlgerApp,
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
    }

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mainHandler = Handler(Looper.getMainLooper())

    // ==================== 服务器配置 ====================

    @JavascriptInterface
    fun getServerConfig(): String {
        val cfg = app.prefs.getServerConfig(app.localServerPort)
        return gson.toJson(cfg)
    }

    @JavascriptInterface
    fun setServerConfig(json: String): String {
        val saved = app.prefs.saveServerConfigFromJson(json, app.localServerPort)
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
        val songId = payload.get("id")?.asString ?: ""
        val songData = payload.getAsJsonObject("songData")
        val songName = songData?.get("name")?.asString ?: ""
        val artists = buildString {
            val ar = songData?.getAsJsonArray("ar") ?: songData?.getAsJsonArray("artists")
            ar?.forEach { el ->
                val name = el.asJsonObject.get("name")?.asString
                if (!name.isNullOrBlank()) {
                    if (isNotEmpty()) append(" ")
                    append(name)
                }
            }
        }
        val sources = mutableListOf<String>()
        payload.getAsJsonArray("enabledSources")?.forEach { el ->
            el.asString?.let { sources.add(it) }
        }

        val res = app.unblockEngine.unblock(songId, songName, artists, sources)
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
        val url = payload.get("url")?.asString ?: throw IllegalArgumentException("Missing URL")
        val method = payload.get("method")?.asString ?: "GET"
        val timeout = payload.get("timeout")?.asLong ?: 15000L
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

        val resp = app.unblockEngine.proxyHttpRequest(url, method, headers, body, form, timeout)
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
        mainHandler.post {
            runCatching {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
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
    fun getAudioCacheSize(): Long {
        return AudioCacheManager.getCacheSizeBytes(activity)
    }

    @JavascriptInterface
    fun clearAudioCache(): Boolean {
        return AudioCacheManager.clearCache(activity)
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

    @JavascriptInterface
    fun exitApp() {
        mainHandler.post {
            runCatching {
                floatingLyricManager.hide()
                MusicPlaybackService.instance?.stopPlayback()
                activity.finishAndRemoveTask()
            }.onFailure {
                activity.finish()
            }
        }
    }
}
