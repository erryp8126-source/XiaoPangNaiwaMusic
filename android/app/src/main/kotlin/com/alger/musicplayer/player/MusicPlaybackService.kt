package com.alger.musicplayer.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.audiofx.Equalizer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaStyleNotificationHelper
import com.alger.musicplayer.MainActivity
import com.alger.musicplayer.R
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URLDecoder
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * 原生后台音乐播放前台服务
 * 基于 AndroidX Media3 ExoPlayer + MediaSession + 通知栏/锁屏/蓝牙控制 + 硬件均衡器 (Equalizer)
 */
@OptIn(UnstableApi::class)
class MusicPlaybackService : Service() {

    companion object {
        private const val TAG = "MusicPlaybackService"
        const val CHANNEL_ID = "alger_music_playback"
        const val NOTIFICATION_ID = 1001

        const val ACTION_PREV = "com.alger.musicplayer.ACTION_PREV"
        const val ACTION_PLAY_PAUSE = "com.alger.musicplayer.ACTION_PLAY_PAUSE"
        const val ACTION_NEXT = "com.alger.musicplayer.ACTION_NEXT"

        @Volatile
        var instance: MusicPlaybackService? = null
            private set

        @Volatile
        var eventEmitter: ((String, String) -> Unit)? = null

        private val pendingActions = mutableListOf<(MusicPlaybackService) -> Unit>()
        private val mainHandler = Handler(Looper.getMainLooper())

        fun ensureStarted(context: Context, onReady: (MusicPlaybackService) -> Unit) {
            mainHandler.post {
                val svc = instance
                if (svc != null) {
                    onReady(svc)
                } else {
                    pendingActions.add(onReady)
                    val intent = Intent(context.applicationContext, MusicPlaybackService::class.java)
                    try {
                        ContextCompat.startForegroundService(context.applicationContext, intent)
                    } catch (e: Exception) {
                        Log.w(TAG, "startForegroundService fallback: ${e.message}")
                        context.applicationContext.startService(intent)
                    }
                }
            }
        }
    }

    private val gson = Gson()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val uiHandler = Handler(Looper.getMainLooper())

    private lateinit var exoPlayer: ExoPlayer
    private lateinit var wrappedPlayer: ForwardingPlayer
    private lateinit var mediaSession: MediaSession

    private var equalizer: Equalizer? = null
    private var eqEnabled: Boolean = false
    private val eqGainsDb = LinkedHashMap<Int, Float>()

    private var currentInstanceId: Int = 0
    private var currentTitle: String = "小庞奶娃音乐"
    private var currentArtist: String = ""
    private var currentAlbum: String = ""
    private var currentCoverUrl: String = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var hasNotifiedLoaded: Boolean = false
    private var isForegroundStarted: Boolean = false

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .addInterceptor { chain ->
                val req = chain.request()
                val host = req.url.host.lowercase()
                val builder = req.newBuilder()
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
                    )
                if (host.contains("bilivideo") || host.contains("bilibili") || host.contains("akamaized")) {
                    builder.header("Referer", "https://www.bilibili.com/")
                } else if (host.contains("music.126.net")) {
                    builder.header("Referer", "https://music.163.com/")
                }
                chain.proceed(builder.build())
            }
            .build()
    }

    private val progressTicker = object : Runnable {
        override fun run() {
            if (::exoPlayer.isInitialized && exoPlayer.isPlaying) {
                emitAudioEvent("timeupdate")
                uiHandler.postDelayed(this, 200)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initPlayerAndSession()
        instance = this

        val queued = ArrayList(pendingActions)
        pendingActions.clear()
        queued.forEach { action ->
            runCatching { action(this) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREV -> emitMediaControl("previoustrack")
            ACTION_NEXT -> emitMediaControl("nexttrack")
            ACTION_PLAY_PAUSE -> {
                if (::exoPlayer.isInitialized) {
                    if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
                }
            }
        }
        // 确保前台通知已启动（避免 Android 8+ ForegroundServiceDidNotStartInTimeException）
        ensureForegroundNotification()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        uiHandler.removeCallbacks(progressTicker)
        releaseEqualizer()
        if (::mediaSession.isInitialized) {
            mediaSession.release()
        }
        if (::exoPlayer.isInitialized) {
            exoPlayer.release()
        }
        serviceScope.cancel()
        instance = null
        super.onDestroy()
    }

    private fun initPlayerAndSession() {
        val okHttpDataSourceFactory = OkHttpDataSource.Factory(httpClient)
        val dataSourceFactory = DefaultDataSource.Factory(this, okHttpDataSourceFactory)
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_READY -> {
                        if (!hasNotifiedLoaded) {
                            hasNotifiedLoaded = true
                            initHardwareEqualizer(exoPlayer.audioSessionId)
                            emitAudioEvent("loaded")
                        }
                        updateNotification()
                    }
                    Player.STATE_ENDED -> {
                        uiHandler.removeCallbacks(progressTicker)
                        emitAudioEvent("end")
                        updateNotification()
                    }
                    else -> {}
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    uiHandler.removeCallbacks(progressTicker)
                    uiHandler.post(progressTicker)
                    emitAudioEvent("play")
                } else {
                    uiHandler.removeCallbacks(progressTicker)
                    if (exoPlayer.playbackState != Player.STATE_ENDED &&
                        exoPlayer.playbackState != Player.STATE_IDLE
                    ) {
                        emitAudioEvent("pause")
                    }
                }
                updateNotification()
            }

            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                if (audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
                    initHardwareEqualizer(audioSessionId)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "ExoPlayer error: ${error.errorCodeName} - ${error.message}")
                uiHandler.removeCallbacks(progressTicker)
                emitAudioEvent(if (hasNotifiedLoaded) "playerror" else "loaderror", error.message)
                updateNotification()
            }
        })

        // 包装 ForwardingPlayer，确保系统通知栏/锁屏/蓝牙始终显示并响应「上一首 / 下一首」
        wrappedPlayer = object : ForwardingPlayer(exoPlayer) {
            override fun getAvailableCommands(): Player.Commands {
                return super.getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build()
            }

            override fun isCommandAvailable(command: Int): Boolean {
                if (command == Player.COMMAND_SEEK_TO_NEXT ||
                    command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS ||
                    command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
                ) {
                    return true
                }
                return super.isCommandAvailable(command)
            }

            override fun hasNextMediaItem(): Boolean = true
            override fun hasPreviousMediaItem(): Boolean = true

            override fun seekToNext() {
                emitMediaControl("nexttrack")
            }

            override fun seekToNextMediaItem() {
                emitMediaControl("nexttrack")
            }

            override fun seekToPrevious() {
                emitMediaControl("previoustrack")
            }

            override fun seekToPreviousMediaItem() {
                emitMediaControl("previoustrack")
            }
        }

        val sessionActivityIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val sessionActivityPendingIntent = PendingIntent.getActivity(
            this,
            0,
            sessionActivityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        mediaSession = MediaSession.Builder(this, wrappedPlayer)
            .setId("alger_music_session")
            .setSessionActivity(sessionActivityPendingIntent)
            .build()
    }

    // ==================== 播放控制接口 ====================

    fun loadAndPrepare(payload: JsonObject) {
        uiHandler.post {
            val url = payload.get("url")?.asString ?: ""
            if (url.isBlank()) {
                emitAudioEvent("loaderror", "Empty URL")
                return@post
            }

            currentInstanceId = payload.get("instanceId")?.asInt ?: (currentInstanceId + 1)
            currentTitle = payload.get("title")?.asString?.ifBlank { "未知歌曲" } ?: "未知歌曲"
            currentArtist = payload.get("artist")?.asString ?: ""
            currentAlbum = payload.get("album")?.asString ?: ""
            currentCoverUrl = payload.get("cover")?.asString ?: ""
            val autoplay = payload.get("autoplay")?.asBoolean ?: false
            val volume = payload.get("volume")?.asFloat ?: 1.0f
            val rate = payload.get("rate")?.asFloat ?: 1.0f

            hasNotifiedLoaded = false

            val resolvedUri = resolvePlayableUri(url)
            val metadata = MediaMetadata.Builder()
                .setTitle(currentTitle)
                .setArtist(currentArtist)
                .setAlbumTitle(currentAlbum)
                .build()

            val mediaItem = MediaItem.Builder()
                .setUri(resolvedUri)
                .setMediaMetadata(metadata)
                .build()

            exoPlayer.stop()
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.volume = volume.coerceIn(0f, 1f)
            exoPlayer.playbackParameters = PlaybackParameters(rate.coerceIn(0.25f, 4f))
            exoPlayer.playWhenReady = autoplay
            exoPlayer.prepare()

            ensureForegroundNotification()
            updateNotification()
            fetchCoverArtworkAsync(currentCoverUrl, currentInstanceId)
        }
    }

    fun play() {
        uiHandler.post {
            if (::exoPlayer.isInitialized) {
                exoPlayer.play()
                ensureForegroundNotification()
                updateNotification()
            }
        }
    }

    fun pause() {
        uiHandler.post {
            if (::exoPlayer.isInitialized) {
                exoPlayer.pause()
                updateNotification()
            }
        }
    }

    fun stopPlayback() {
        uiHandler.post {
            uiHandler.removeCallbacks(progressTicker)
            if (::exoPlayer.isInitialized) {
                exoPlayer.stop()
            }
            updateNotification()
        }
    }

    fun seekTo(seconds: Double) {
        uiHandler.post {
            if (::exoPlayer.isInitialized) {
                val targetMs = (seconds * 1000.0).toLong().coerceAtLeast(0L)
                exoPlayer.seekTo(targetMs)
                emitAudioEvent("seek")
            }
        }
    }

    fun setVolume(volume: Float) {
        uiHandler.post {
            if (::exoPlayer.isInitialized) {
                exoPlayer.volume = volume.coerceIn(0f, 1f)
            }
        }
    }

    fun setPlaybackRate(rate: Float) {
        uiHandler.post {
            if (::exoPlayer.isInitialized) {
                exoPlayer.playbackParameters = PlaybackParameters(rate.coerceIn(0.25f, 4f))
            }
        }
    }

    fun getStateJson(): String {
        val posSec = if (::exoPlayer.isInitialized) exoPlayer.currentPosition / 1000.0 else 0.0
        val durMs = if (::exoPlayer.isInitialized) exoPlayer.duration else C.TIME_UNSET
        val durSec = if (durMs > 0) durMs / 1000.0 else 0.0
        val playing = if (::exoPlayer.isInitialized) exoPlayer.isPlaying else false
        return gson.toJson(
            mapOf(
                "instanceId" to currentInstanceId,
                "position" to posSec,
                "duration" to durSec,
                "playing" to playing
            )
        )
    }

    // ==================== 硬件均衡器 (Equalizer) ====================

    fun setEqEnabled(enabled: Boolean) {
        uiHandler.post {
            eqEnabled = enabled
            if (::exoPlayer.isInitialized && equalizer == null && exoPlayer.audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
                initHardwareEqualizer(exoPlayer.audioSessionId)
            }
            runCatching {
                equalizer?.enabled = enabled
                if (enabled) applyAllEqBands()
            }
        }
    }

    fun setEqBandGain(freqHz: Int, gainDb: Float) {
        uiHandler.post {
            eqGainsDb[freqHz] = gainDb.coerceIn(-12f, 12f)
            if (eqEnabled) applyAllEqBands()
        }
    }

    fun resetEq() {
        uiHandler.post {
            eqGainsDb.clear()
            runCatching {
                val eq = equalizer ?: return@post
                for (band in 0 until eq.numberOfBands) {
                    eq.setBandLevel(band.toShort(), 0)
                }
            }
        }
    }

    private fun initHardwareEqualizer(audioSessionId: Int) {
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET || audioSessionId == 0) return
        releaseEqualizer()
        runCatching {
            val eq = Equalizer(0, audioSessionId)
            eq.enabled = eqEnabled
            equalizer = eq
            if (eqEnabled) applyAllEqBands()
        }.onFailure {
            Log.w(TAG, "Hardware Equalizer init failed: ${it.message}")
        }
    }

    private fun applyAllEqBands() {
        val eq = equalizer ?: return
        runCatching {
            val minLevel = eq.bandLevelRange[0].toInt()
            val maxLevel = eq.bandLevelRange[1].toInt()
            for (band in 0 until eq.numberOfBands) {
                val centerHz = eq.getCenterFreq(band.toShort()) / 1000 // milliHz -> Hz
                // 匹配 Alger 10 段 EQ 中距离当前硬件频段中心频率最近的频点
                val closest = eqGainsDb.entries.minByOrNull { abs(it.key - centerHz) }
                val gainDb = closest?.value ?: 0f
                val targetMilliBel = (gainDb * 100f).toInt().coerceIn(minLevel, maxLevel)
                eq.setBandLevel(band.toShort(), targetMilliBel.toShort())
            }
        }
    }

    private fun releaseEqualizer() {
        runCatching { equalizer?.release() }
        equalizer = null
    }

    // ==================== URI 解析、封面加载与前台通知 ====================

    private fun resolvePlayableUri(rawUrl: String): Uri {
        if (rawUrl.startsWith("local:///")) {
            val rawPath = rawUrl.removePrefix("local:///")
            val decoded = runCatching { URLDecoder.decode(rawPath, "UTF-8") }.getOrDefault(rawPath)
            return if (decoded.startsWith("content://")) {
                Uri.parse(decoded)
            } else {
                val file = File(decoded)
                if (file.exists()) Uri.fromFile(file) else Uri.parse(decoded)
            }
        }
        return Uri.parse(rawUrl)
    }

    private fun fetchCoverArtworkAsync(coverUrl: String, instanceId: Int) {
        if (coverUrl.isBlank() || coverUrl.startsWith("/images/")) {
            currentArtworkBitmap = null
            return
        }
        serviceScope.launch {
            val bmp = runCatching {
                val reqUrl = if (coverUrl.startsWith("http") && !coverUrl.contains("127.0.0.1") && !coverUrl.contains("param=")) {
                    "$coverUrl?param=300y300"
                } else coverUrl
                val req = Request.Builder().url(reqUrl).get().build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val bytes = resp.body?.bytes() ?: return@use null
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }
            }.getOrNull()

            if (bmp != null && instanceId == currentInstanceId) {
                val artBytes = ByteArrayOutputStream().use { baos ->
                    bmp.compress(Bitmap.CompressFormat.JPEG, 85, baos)
                    baos.toByteArray()
                }
                uiHandler.post {
                    if (instanceId != currentInstanceId) return@post
                    currentArtworkBitmap = bmp
                    // 更新 MediaItem 的 artworkData，Android 13+ 系统媒体控件会自动展示封面
                    if (::exoPlayer.isInitialized && exoPlayer.currentMediaItem != null) {
                        val currentItem = exoPlayer.currentMediaItem!!
                        val updatedMeta = currentItem.mediaMetadata.buildUpon()
                            .setTitle(currentTitle)
                            .setArtist(currentArtist)
                            .setAlbumTitle(currentAlbum)
                            .setArtworkData(artBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                            .build()
                        exoPlayer.replaceMediaItem(
                            exoPlayer.currentMediaItemIndex,
                            currentItem.buildUpon().setMediaMetadata(updatedMeta).build()
                        )
                    }
                    updateNotification()
                }
            }
        }
    }

    private fun createNotificationChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "音乐播放控制",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "用于后台持续播放音乐和通知栏控制"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            this,
            10,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevPending = PendingIntent.getService(
            this,
            11,
            Intent(this, MusicPlaybackService::class.java).setAction(ACTION_PREV),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPausePending = PendingIntent.getService(
            this,
            12,
            Intent(this, MusicPlaybackService::class.java).setAction(ACTION_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nextPending = PendingIntent.getService(
            this,
            13,
            Intent(this, MusicPlaybackService::class.java).setAction(ACTION_NEXT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val isPlaying = ::exoPlayer.isInitialized && exoPlayer.isPlaying
        val playPauseIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val playPauseLabel = if (isPlaying) "暂停" else "播放"

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_music_note)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist.ifBlank { "小庞奶娃音乐" })
            .setSubText(currentAlbum.takeIf { it.isNotBlank() })
            .setContentIntent(contentPending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_previous, "上一首", prevPending)
            .addAction(playPauseIcon, playPauseLabel, playPausePending)
            .addAction(android.R.drawable.ic_media_next, "下一首", nextPending)

        currentArtworkBitmap?.let { builder.setLargeIcon(it) }

        if (::mediaSession.isInitialized) {
            builder.setStyle(
                MediaStyleNotificationHelper.MediaStyle(mediaSession)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        }
        return builder.build()
    }

    private fun ensureForegroundNotification() {
        val notification = buildNotification()
        if (!isForegroundStarted) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                isForegroundStarted = true
            } catch (e: Exception) {
                Log.e(TAG, "startForeground failed: ${e.message}")
            }
        }
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification())
    }

    // ==================== 事件回传至 WebView ====================

    private fun emitAudioEvent(type: String, errorMsg: String? = null) {
        val posSec = if (::exoPlayer.isInitialized) exoPlayer.currentPosition / 1000.0 else 0.0
        val durMs = if (::exoPlayer.isInitialized) exoPlayer.duration else C.TIME_UNSET
        val durSec = if (durMs > 0) durMs / 1000.0 else 0.0
        val playing = if (::exoPlayer.isInitialized) exoPlayer.isPlaying else false

        val map = LinkedHashMap<String, Any>()
        map["type"] = type
        map["instanceId"] = currentInstanceId
        map["position"] = posSec
        map["duration"] = durSec
        map["playing"] = playing
        if (errorMsg != null) map["error"] = errorMsg

        eventEmitter?.invoke("audio-event", gson.toJson(map))
    }

    private fun emitMediaControl(command: String) {
        val json = gson.toJson(mapOf("type" to command))
        eventEmitter?.invoke("audio-event", json)
    }
}
