package com.alger.musicplayer.player

import android.annotation.SuppressLint
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
import android.os.PowerManager
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
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaStyleNotificationHelper
import com.alger.musicplayer.AlgerApp
import com.alger.musicplayer.MainActivity
import com.alger.musicplayer.R
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
 * 支持：
 * 1. CBR/VBR MP3 & ADTS 全流精准拖拽 Seek
 * 2. 熄屏/后台原生队列自动切歌 + 切歌过渡 WakeLock 保活（即使 WebView 被系统冻结也能连续播放下一首）
 * 3. 返回前台自动状态与曲目同步
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

        private const val MAX_NATIVE_SKIP_FAILS = 8

        @Volatile
        var instance: MusicPlaybackService? = null
            private set

        @Volatile
        var eventEmitter: ((String, String) -> Unit)? = null

        @Volatile
        var isAppInForeground: Boolean = true

        @Volatile
        var latestSyncedQueue: JsonObject? = null

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

        fun onAppForegroundChanged(inForeground: Boolean) {
            isAppInForeground = inForeground
            mainHandler.post {
                if (inForeground) {
                    instance?.syncStateToWebView()
                } else {
                    instance?.onEnteredBackground()
                }
            }
        }
    }

    private data class NativeQueueItem(
        val id: String,
        val name: String,
        val artist: String,
        val album: String,
        val cover: String,
        val url: String,
        val source: String,
        val dt: Long
    )

    private val gson = Gson()
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val uiHandler = Handler(Looper.getMainLooper())

    private lateinit var exoPlayer: ExoPlayer
    private lateinit var wrappedPlayer: ForwardingPlayer
    private lateinit var mediaSession: MediaSession
    private var transitionWakeLock: PowerManager.WakeLock? = null

    private var equalizer: Equalizer? = null
    private var eqEnabled: Boolean = false
    private val eqGainsDb = LinkedHashMap<Int, Float>()

    @Volatile
    private var currentInstanceId: Int = 0
    private var nativeInstanceSeq: Int = 0
    @Volatile
    private var cachedPositionSec: Double = 0.0
    @Volatile
    private var cachedDurationSec: Double = 0.0
    @Volatile
    private var cachedIsPlaying: Boolean = false

    private var currentSongId: String = ""
    private var currentTitle: String = "小庞奶娃音乐"
    private var currentArtist: String = ""
    private var currentAlbum: String = ""
    private var currentCoverUrl: String = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var hasNotifiedLoaded: Boolean = false
    private var isForegroundStarted: Boolean = false
    private var isNativeManagedTrack: Boolean = false
    private var isTransitioningTrack: Boolean = false
    private var userPaused: Boolean = false
    private var nativeConsecutiveFails: Int = 0

    // 原生后台播放队列缓存（由前端实时同步，供息屏/后台自动切歌使用）
    private var nativeQueue: List<NativeQueueItem> = emptyList()
    private var nativeQueueIndex: Int = 0
    private var nativePlayMode: Int = 0 // 0=顺序, 1=单曲循环, 2=随机(已洗牌), 3=心动
    private var nativeMusicQuality: String = "higher"
    private var nativeUnblockSources: List<String> = listOf("kuwo", "kugou", "migu", "gdmusic")
    private var nativeUserCookie: String = ""
    private var nativeIsFm: Boolean = false

    private var pendingAutoNextRunnable: Runnable? = null
    private var nativeAdvanceJob: Job? = null
    private var pendingTrackSyncJson: String? = null
    private var seekConfirmRunnable: Runnable? = null

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
                    // 禁用 gzip 透明压缩，确保 CDN 返回真实 Content-Length 以支持 HTTP Range 拖拽 Seek
                    .header("Accept-Encoding", "identity")
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
                snapshotPlayerState()
                emitAudioEvent("timeupdate")
                uiHandler.postDelayed(this, 200)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        initWakeLock()
        createNotificationChannel()
        initPlayerAndSession()
        instance = this

        latestSyncedQueue?.let { syncQueue(it) }

        val queued = ArrayList(pendingActions)
        pendingActions.clear()
        queued.forEach { action ->
            runCatching { action(this) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREV -> handleExternalTrackCommand("previoustrack", -1)
            ACTION_NEXT -> handleExternalTrackCommand("nexttrack", 1)
            ACTION_PLAY_PAUSE -> {
                if (::exoPlayer.isInitialized) {
                    if (exoPlayer.isPlaying) pause() else play()
                }
            }
        }
        // 确保前台通知已启动（避免 Android 8+ ForegroundServiceDidNotStartInTimeException）
        ensureForegroundNotification()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        cancelNativeAutoAdvance()
        seekConfirmRunnable?.let { uiHandler.removeCallbacks(it) }
        uiHandler.removeCallbacks(progressTicker)
        releaseTransitionWakeLock()
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

    private fun initWakeLock() {
        runCatching {
            val pm = getSystemService(PowerManager::class.java)
            transitionWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "XiaoPangNaiwaMusic:TrackTransition"
            ).apply {
                setReferenceCounted(false)
            }
        }
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireTransitionWakeLock(timeoutMs: Long = 30_000L) {
        runCatching {
            transitionWakeLock?.let { wl ->
                if (!wl.isHeld) {
                    wl.acquire(timeoutMs)
                }
            }
        }
    }

    private fun releaseTransitionWakeLock() {
        runCatching {
            transitionWakeLock?.let { wl ->
                if (wl.isHeld) wl.release()
            }
        }
    }

    private fun snapshotPlayerState() {
        if (!::exoPlayer.isInitialized) return
        val posMs = exoPlayer.currentPosition.coerceAtLeast(0L)
        val durMs = exoPlayer.duration
        cachedPositionSec = posMs / 1000.0
        cachedDurationSec = if (durMs > 0 && durMs != C.TIME_UNSET) durMs / 1000.0 else 0.0
        cachedIsPlaying = exoPlayer.isPlaying
    }

    private fun initPlayerAndSession() {
        val okHttpDataSourceFactory = OkHttpDataSource.Factory(httpClient)
        val dataSourceFactory = DefaultDataSource.Factory(this, okHttpDataSourceFactory)
        // 强制启用 CBR/MP3/ADTS 拖拽索引估算，解决部分在线音源进度条无法拖动/拖后无声跳回的问题
        val extractorsFactory = DefaultExtractorsFactory()
            .setConstantBitrateSeekingEnabled(true)
            .setConstantBitrateSeekingAlwaysEnabled(true)
        val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory)

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
                snapshotPlayerState()
                when (playbackState) {
                    Player.STATE_READY -> {
                        nativeConsecutiveFails = 0
                        isTransitioningTrack = false
                        releaseTransitionWakeLock()
                        if (!hasNotifiedLoaded) {
                            hasNotifiedLoaded = true
                            initHardwareEqualizer(exoPlayer.audioSessionId)
                            emitAudioEvent("loaded")
                        } else {
                            // Seek 后缓冲完成，立即同步真实位置给前端歌词和进度条
                            emitAudioEvent("timeupdate")
                        }
                        updateNotification()
                    }
                    Player.STATE_ENDED -> {
                        uiHandler.removeCallbacks(progressTicker)
                        handleTrackEnded()
                        updateNotification()
                    }
                    else -> {}
                }
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                if (reason == Player.DISCONTINUITY_REASON_SEEK) {
                    snapshotPlayerState()
                    emitAudioEvent("seek")
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                snapshotPlayerState()
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
                snapshotPlayerState()
                uiHandler.removeCallbacks(progressTicker)
                emitAudioEvent(if (hasNotifiedLoaded) "playerror" else "loaderror", error.message)
                updateNotification()

                // 只要用户没有主动暂停，后台/原生接管期间单曲播放报错时自动跳过并播放下一首，绝不静音断播
                if (!userPaused && (!isAppInForeground || isNativeManagedTrack) &&
                    nativeConsecutiveFails < MAX_NATIVE_SKIP_FAILS
                ) {
                    nativeConsecutiveFails++
                    acquireTransitionWakeLock(45_000L)
                    isTransitioningTrack = true
                    Log.w(TAG, "Track playback failed ($nativeConsecutiveFails/$MAX_NATIVE_SKIP_FAILS), auto skipping to next...")
                    advanceNativeQueue(delta = 1, fromEnded = false)
                } else {
                    isTransitioningTrack = false
                    releaseTransitionWakeLock()
                }
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

            override fun play() {
                userPaused = false
                if (exoPlayer.playbackState == Player.STATE_ENDED) {
                    exoPlayer.seekTo(0L)
                }
                super.play()
            }

            override fun pause() {
                userPaused = true
                isTransitioningTrack = false
                cancelNativeAutoAdvance()
                releaseTransitionWakeLock()
                super.pause()
            }

            override fun setPlayWhenReady(playWhenReady: Boolean) {
                if (playWhenReady) {
                    userPaused = false
                } else {
                    userPaused = true
                    isTransitioningTrack = false
                    cancelNativeAutoAdvance()
                    releaseTransitionWakeLock()
                }
                super.setPlayWhenReady(playWhenReady)
            }

            override fun seekToNext() {
                handleExternalTrackCommand("nexttrack", 1)
            }

            override fun seekToNextMediaItem() {
                handleExternalTrackCommand("nexttrack", 1)
            }

            override fun seekToPrevious() {
                handleExternalTrackCommand("previoustrack", -1)
            }

            override fun seekToPreviousMediaItem() {
                handleExternalTrackCommand("previoustrack", -1)
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

    // ==================== 后台原生自动切歌引擎 ====================

    private fun cancelNativeAutoAdvance() {
        pendingAutoNextRunnable?.let { uiHandler.removeCallbacks(it) }
        pendingAutoNextRunnable = null
        nativeAdvanceJob?.cancel()
        nativeAdvanceJob = null
    }

    private fun onEnteredBackground() {
        // 若用户在歌曲刚结束切歌的瞬间切入后台/熄屏，立即加速原生接管，避免 WebView 休眠导致切歌卡死
        if (!userPaused && isTransitioningTrack && pendingAutoNextRunnable != null &&
            ::exoPlayer.isInitialized && !exoPlayer.isPlaying
        ) {
            pendingAutoNextRunnable?.let { uiHandler.removeCallbacks(it) }
            val tokenId = currentInstanceId
            val fastTakeover = Runnable {
                if (!userPaused && currentInstanceId == tokenId &&
                    ::exoPlayer.isInitialized && !exoPlayer.isPlaying
                ) {
                    Log.i(TAG, "Entered background during track transition: taking over natively")
                    advanceNativeQueue(delta = 1, fromEnded = true)
                }
            }
            pendingAutoNextRunnable = fastTakeover
            uiHandler.postDelayed(fastTakeover, 300L)
        }
    }

    private fun handleTrackEnded() {
        if (userPaused) {
            isTransitioningTrack = false
            releaseTransitionWakeLock()
            return
        }

        // 立刻申请过渡期 WakeLock，防止 ExoPlayer 在 STATE_ENDED 释放锁后 CPU 立刻休眠
        acquireTransitionWakeLock(45_000L)
        isTransitioningTrack = true
        val endedInstanceId = currentInstanceId

        // 1. 单曲循环：直接在原生层瞬时重播，无需经过 WebView（前后台/锁屏 100% 稳定）
        if (nativePlayMode == 1 && ::exoPlayer.isInitialized && exoPlayer.currentMediaItem != null) {
            Log.i(TAG, "Single-track loop active: replaying natively")
            exoPlayer.seekTo(0L)
            exoPlayer.playWhenReady = true
            exoPlayer.play()
            isTransitioningTrack = false
            snapshotPlayerState()
            emitAudioEvent("replayed")
            return
        }

        // 2. 后台/熄屏状态：直接由 Kotlin 原生引擎立即接管切下一首（不再发 end 给 WebView 抢跑，彻底杜绝 WebView 休眠或 audioStop 竞争）
        if (!isAppInForeground) {
            Log.i(TAG, "Track ended in background: advancing natively immediately (fm=$nativeIsFm, queue=${nativeQueue.size})")
            cancelNativeAutoAdvance()
            advanceNativeQueue(delta = 1, fromEnded = true)
            return
        }

        // 3. 前台状态：通知前端 end 事件（完整支持定时关闭、歌单动态更新、自定义脚本音源与歌词加载），
        //    同时设置 3800ms 原生兜底保险丝，防止前端偶发卡顿或用户刚切到后台时断播
        emitAudioEvent("end")
        cancelNativeAutoAdvance()
        val watchdog = Runnable {
            if (!userPaused &&
                currentInstanceId == endedInstanceId &&
                ::exoPlayer.isInitialized &&
                !exoPlayer.isPlaying
            ) {
                Log.i(TAG, "Foreground WebView did not start next track within 3800ms, advancing natively!")
                advanceNativeQueue(delta = 1, fromEnded = true)
            }
        }
        pendingAutoNextRunnable = watchdog
        uiHandler.postDelayed(watchdog, 3800L)
    }

    private fun handleExternalTrackCommand(command: String, delta: Int) {
        userPaused = false
        acquireTransitionWakeLock(35_000L)
        isTransitioningTrack = true
        if (!isAppInForeground) {
            Log.i(TAG, "External [$command] in background: advancing natively immediately")
            cancelNativeAutoAdvance()
            advanceNativeQueue(delta = delta, fromEnded = false)
            return
        }

        val prevInstanceId = currentInstanceId
        emitMediaControl(command)
        cancelNativeAutoAdvance()
        val r = Runnable {
            if (!userPaused && currentInstanceId == prevInstanceId) {
                Log.i(TAG, "External [$command] did not advance via WebView, advancing natively")
                advanceNativeQueue(delta = delta, fromEnded = false)
            }
        }
        pendingAutoNextRunnable = r
        uiHandler.postDelayed(r, 1500L)
    }

    private fun fetchNativeRecommendedSongs(excludeId: String): List<NativeQueueItem> {
        val params = mutableMapOf("limit" to "20")
        if (nativeUserCookie.isNotBlank()) {
            params["cookie"] = nativeUserCookie
        }
        return runCatching {
            val res = AlgerApp.instance.ncmClient.dispatch("/personalized/newsong", params)
            val root = JsonParser.parseString(res.body).asJsonObject
            val arr = root.getAsJsonArray("result") ?: return@runCatching emptyList()
            val list = ArrayList<NativeQueueItem>(arr.size())
            arr.forEach { el ->
                if (!el.isJsonObject) return@forEach
                val o = el.asJsonObject
                val id = o.get("id")?.takeIf { !it.isJsonNull }?.asString ?: return@forEach
                if (id.isBlank() || id == excludeId) return@forEach
                val name = o.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val songObj = o.getAsJsonObject("song")
                val albumObj = songObj?.getAsJsonObject("album")
                val artistsArr = songObj?.getAsJsonArray("artists")
                val artistStr = artistsArr?.mapNotNull { a ->
                    a.takeIf { it.isJsonObject }?.asJsonObject?.get("name")?.takeIf { !it.isJsonNull }?.asString
                }?.joinToString(" / ") ?: ""
                val cover = o.get("picUrl")?.takeIf { !it.isJsonNull }?.asString
                    ?: albumObj?.get("picUrl")?.takeIf { !it.isJsonNull }?.asString
                    ?: ""
                val albumName = albumObj?.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val dt = songObj?.get("duration")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                list.add(
                    NativeQueueItem(
                        id = id,
                        name = name,
                        artist = artistStr,
                        album = albumName,
                        cover = cover,
                        url = "",
                        source = "netease",
                        dt = dt
                    )
                )
            }
            list
        }.getOrElse { emptyList() }
    }

    private fun fetchNativeFmSongs(excludeId: String): List<NativeQueueItem> {
        val params = mutableMapOf<String, String>()
        if (nativeUserCookie.isNotBlank()) {
            params["cookie"] = nativeUserCookie
        }
        return runCatching {
            val res = AlgerApp.instance.ncmClient.dispatch("/personal_fm", params)
            val root = JsonParser.parseString(res.body).asJsonObject
            val arr = root.getAsJsonArray("data") ?: return@runCatching emptyList()
            val list = ArrayList<NativeQueueItem>(arr.size())
            arr.forEach { el ->
                if (!el.isJsonObject) return@forEach
                val o = el.asJsonObject
                val id = o.get("id")?.takeIf { !it.isJsonNull }?.asString ?: return@forEach
                if (id.isBlank() || id == excludeId) return@forEach
                val name = o.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val albumObj = o.getAsJsonObject("album") ?: o.getAsJsonObject("al")
                val artistsArr = o.getAsJsonArray("artists") ?: o.getAsJsonArray("ar")
                val artistStr = artistsArr?.mapNotNull { a ->
                    a.takeIf { it.isJsonObject }?.asJsonObject?.get("name")?.takeIf { !it.isJsonNull }?.asString
                }?.joinToString(" / ") ?: ""
                val cover = albumObj?.get("picUrl")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val albumName = albumObj?.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val dt = o.get("duration")?.takeIf { !it.isJsonNull }?.asLong
                    ?: o.get("dt")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                list.add(
                    NativeQueueItem(
                        id = id,
                        name = name,
                        artist = artistStr,
                        album = albumName,
                        cover = cover,
                        url = "",
                        source = "netease",
                        dt = dt
                    )
                )
            }
            list
        }.getOrElse { emptyList() }
    }

    private fun advanceNativeQueue(delta: Int, fromEnded: Boolean) {
        val requestToken = currentInstanceId
        val snapshotIsFm = nativeIsFm
        val snapshotQueue = nativeQueue
        val snapshotIndex = nativeQueueIndex
        val snapshotSongId = currentSongId

        nativeAdvanceJob?.cancel()
        nativeAdvanceJob = serviceScope.launch {
            // 1. 私人漫游 FM 后台原生续播
            if (snapshotIsFm) {
                val fmItems = fetchNativeFmSongs(snapshotSongId).ifEmpty {
                    fetchNativeRecommendedSongs(snapshotSongId)
                }
                for (item in fmItems.take(MAX_NATIVE_SKIP_FAILS)) {
                    val resolvedUrl = resolveItemUrlNatively(item)
                    if (!resolvedUrl.isNullOrBlank()) {
                        uiHandler.post {
                            if (userPaused || currentInstanceId != requestToken) return@post
                            nativeQueue = listOf(item)
                            playNativeQueueItem(0, item, resolvedUrl)
                        }
                        return@launch
                    }
                }
            }

            // 2. 普通队列：只要用户未点暂停，永不在队列末尾停止（顺序/列表循环/随机均无缝循环；
            //    若队列为空或仅有 1 首歌，自动拉取推荐新歌追加到队列继续播放！）
            var workingQueue = snapshotQueue
            var workingIndex = snapshotIndex
            if (workingQueue.size <= 1) {
                val existingIds = workingQueue.map { it.id }.toSet()
                val recommended = fetchNativeRecommendedSongs(snapshotSongId)
                    .filter { it.id !in existingIds }
                if (recommended.isNotEmpty()) {
                    workingQueue = workingQueue + recommended
                    if (workingQueue.size == recommended.size) {
                        workingIndex = -1
                    }
                    val updatedQueue = workingQueue
                    uiHandler.post {
                        if (!userPaused && currentInstanceId == requestToken) {
                            nativeQueue = updatedQueue
                        }
                    }
                }
            }

            if (workingQueue.isEmpty()) {
                uiHandler.post {
                    // 彻底无网且队列为空：尝试原地重播当前曲目而不静默卡死
                    if (!userPaused && currentInstanceId == requestToken &&
                        ::exoPlayer.isInitialized && exoPlayer.currentMediaItem != null
                    ) {
                        exoPlayer.seekTo(0L)
                        exoPlayer.playWhenReady = true
                        exoPlayer.play()
                        isTransitioningTrack = false
                        emitAudioEvent("replayed")
                    } else {
                        isTransitioningTrack = false
                        releaseTransitionWakeLock()
                    }
                }
                return@launch
            }

            val size = workingQueue.size
            val safeIdx = if (workingIndex < 0) -1 else workingIndex.coerceIn(0, size - 1)
            val startIdx = if (safeIdx < 0) 0 else ((safeIdx + delta) % size + size) % size
            val step = if (delta >= 0) 1 else -1
            val maxAttempts = minOf(MAX_NATIVE_SKIP_FAILS, size)

            for (attempt in 0 until maxAttempts) {
                val idx = ((startIdx + attempt * step) % size + size) % size
                val item = workingQueue[idx]
                val resolvedUrl = resolveItemUrlNatively(item)
                if (!resolvedUrl.isNullOrBlank()) {
                    uiHandler.post {
                        if (userPaused || currentInstanceId != requestToken) {
                            return@post
                        }
                        playNativeQueueItem(idx, item, resolvedUrl)
                    }
                    return@launch
                } else {
                    Log.w(TAG, "Native resolve failed for [${item.name}], trying next ($attempt/$maxAttempts)")
                }
            }

            // 全部候选解析失败（如断网且仅 1 首已缓存）：尝试原地重播当前已加载媒体，避免断播
            uiHandler.post {
                if (!userPaused && currentInstanceId == requestToken &&
                    size == 1 && ::exoPlayer.isInitialized && exoPlayer.currentMediaItem != null
                ) {
                    exoPlayer.seekTo(0L)
                    exoPlayer.playWhenReady = true
                    exoPlayer.play()
                    isTransitioningTrack = false
                    emitAudioEvent("replayed")
                } else {
                    isTransitioningTrack = false
                    releaseTransitionWakeLock()
                }
            }
        }
    }

    private fun resolveItemUrlNatively(item: NativeQueueItem): String? {
        // 1. 本地音乐直接使用
        if (item.url.startsWith("local:///")) {
            return item.url
        }

        // 2. 网易云音源：优先官方直连接口 /song/url/v1，试听/无链接时回退多平台解锁引擎
        if (item.source.isBlank() || item.source == "netease") {
            if (item.id.isNotBlank()) {
                val params = mutableMapOf(
                    "id" to item.id,
                    "level" to nativeMusicQuality
                )
                if (nativeUserCookie.isNotBlank()) {
                    params["cookie"] = nativeUserCookie
                }
                val ncmUrl = runCatching {
                    val res = AlgerApp.instance.ncmClient.dispatch("/song/url/v1", params)
                    val root = JsonParser.parseString(res.body).asJsonObject
                    val arr = root.getAsJsonArray("data")
                    if (arr != null && arr.size() > 0) {
                        val first = arr[0].asJsonObject
                        val url = first.get("url")?.takeIf { !it.isJsonNull }?.asString ?: ""
                        val hasTrial = first.has("freeTrialInfo") && !first.get("freeTrialInfo").isJsonNull
                        if (url.startsWith("http") && !hasTrial) url else null
                    } else null
                }.getOrNull()

                if (!ncmUrl.isNullOrBlank()) {
                    return ncmUrl
                }
            }

            // 回退内置多平台解锁引擎
            val unblocked = runCatching {
                AlgerApp.instance.unblockEngine.unblock(
                    item.id,
                    item.name,
                    item.artist,
                    nativeUnblockSources
                )
            }.getOrNull()
            if (unblocked != null && unblocked.url.startsWith("http")) {
                return unblocked.url
            }
        }

        // 3. 若队列中已有缓存 http URL（如 Bilibili 等）作为兜底
        if (item.url.startsWith("http")) {
            return item.url
        }
        return null
    }

    private fun playNativeQueueItem(index: Int, item: NativeQueueItem, url: String) {
        nativeInstanceSeq -= 1
        currentInstanceId = nativeInstanceSeq
        nativeQueueIndex = index
        currentSongId = item.id
        isNativeManagedTrack = true
        isTransitioningTrack = true
        userPaused = false
        hasNotifiedLoaded = false
        currentTitle = item.name.ifBlank { "未知歌曲" }
        currentArtist = item.artist
        currentAlbum = item.album
        currentCoverUrl = item.cover

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
        exoPlayer.playWhenReady = true
        exoPlayer.prepare()

        snapshotPlayerState()
        ensureForegroundNotification()
        updateNotification()
        fetchCoverArtworkAsync(currentCoverUrl, currentInstanceId)

        val syncPayload = gson.toJson(
            mapOf(
                "type" to "native-track-changed",
                "instanceId" to currentInstanceId,
                "index" to index,
                "songId" to item.id,
                "url" to url,
                "title" to currentTitle,
                "artist" to currentArtist,
                "album" to currentAlbum,
                "cover" to currentCoverUrl,
                "duration" to (item.dt / 1000.0),
                "position" to 0.0,
                "playing" to true,
                "isFm" to nativeIsFm
            )
        )
        pendingTrackSyncJson = syncPayload
        eventEmitter?.invoke("audio-event", syncPayload)
    }

    fun syncQueue(payload: JsonObject) {
        uiHandler.post {
            runCatching {
                nativePlayMode = payload.get("playMode")?.asInt ?: nativePlayMode
                val incomingIndex = payload.get("currentIndex")?.asInt ?: nativeQueueIndex
                nativeMusicQuality = payload.get("musicQuality")?.asString?.ifBlank { "higher" } ?: "higher"
                nativeIsFm = payload.get("isFm")?.asBoolean ?: false
                payload.get("cookie")?.takeIf { !it.isJsonNull }?.asString?.let {
                    nativeUserCookie = it
                }
                payload.getAsJsonArray("unblockSources")?.let { arr ->
                    val srcs = arr.mapNotNull { el -> el.takeIf { !it.isJsonNull }?.asString?.trim() }
                        .filter { it.isNotEmpty() }
                    if (srcs.isNotEmpty()) nativeUnblockSources = srcs
                }
                payload.getAsJsonArray("items")?.let { arr ->
                    val parsed = ArrayList<NativeQueueItem>(arr.size())
                    arr.forEach { el ->
                        if (el.isJsonObject) {
                            val o = el.asJsonObject
                            parsed.add(
                                NativeQueueItem(
                                    id = o.get("id")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    name = o.get("name")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    artist = o.get("artist")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    album = o.get("album")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    cover = o.get("cover")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    url = o.get("url")?.takeIf { !it.isJsonNull }?.asString ?: "",
                                    source = o.get("source")?.takeIf { !it.isJsonNull }?.asString ?: "netease",
                                    dt = o.get("dt")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                                )
                            )
                        }
                    }
                    // 若后台原生刚切完歌且尚未回传 WebView，切勿被延迟的旧队列覆盖导致索引倒退
                    if (pendingTrackSyncJson != null && isNativeManagedTrack && currentSongId.isNotBlank()) {
                        val idxInIncoming = parsed.indexOfFirst { it.id == currentSongId }
                        if (idxInIncoming != -1) {
                            nativeQueue = parsed
                            nativeQueueIndex = idxInIncoming
                        }
                        return@let
                    }
                    nativeQueue = parsed
                    if (currentSongId.isNotBlank() && parsed.isNotEmpty()) {
                        val safeIdx = incomingIndex.coerceIn(0, parsed.size - 1)
                        if (parsed[safeIdx].id == currentSongId) {
                            nativeQueueIndex = safeIdx
                        } else {
                            val matchedIdx = parsed.indexOfFirst { it.id == currentSongId }
                            nativeQueueIndex = if (matchedIdx != -1) matchedIdx else safeIdx
                        }
                    } else {
                        nativeQueueIndex = incomingIndex.coerceAtLeast(0)
                    }
                }
            }.onFailure {
                Log.w(TAG, "syncQueue parse error: ${it.message}")
            }
        }
    }

    /**
     * 当 App 从后台回到前台时调用：将后台期间原生自动切换的曲目和最新进度同步给 WebView
     */
    fun syncStateToWebView() {
        if (!::exoPlayer.isInitialized) return
        snapshotPlayerState()
        pendingTrackSyncJson?.let { json ->
            pendingTrackSyncJson = null
            // 用当前真实的播放位置与播放状态刷新 payload
            runCatching {
                val obj = JsonParser.parseString(json).asJsonObject
                obj.addProperty("position", cachedPositionSec)
                if (cachedDurationSec > 0) obj.addProperty("duration", cachedDurationSec)
                obj.addProperty("playing", cachedIsPlaying)
                eventEmitter?.invoke("audio-event", gson.toJson(obj))
            }.onFailure {
                eventEmitter?.invoke("audio-event", json)
            }
        }
        emitAudioEvent("sync-state")
    }

    // ==================== 播放控制接口 ====================

    fun loadAndPrepare(payload: JsonObject) {
        uiHandler.post {
            cancelNativeAutoAdvance()
            pendingTrackSyncJson = null
            isNativeManagedTrack = false
            nativeConsecutiveFails = 0

            val url = payload.get("url")?.asString ?: ""
            if (url.isBlank()) {
                emitAudioEvent("loaderror", "Empty URL")
                return@post
            }

            currentInstanceId = payload.get("instanceId")?.asInt ?: (currentInstanceId + 1)
            currentSongId = payload.get("songId")?.takeIf { !it.isJsonNull }?.asString ?: ""
            currentTitle = payload.get("title")?.asString?.ifBlank { "未知歌曲" } ?: "未知歌曲"
            currentArtist = payload.get("artist")?.asString ?: ""
            currentAlbum = payload.get("album")?.asString ?: ""
            currentCoverUrl = payload.get("cover")?.asString ?: ""
            val autoplay = payload.get("autoplay")?.asBoolean ?: false
            userPaused = !autoplay
            isTransitioningTrack = autoplay
            if (autoplay) {
                acquireTransitionWakeLock(30_000L)
            }
            if (currentSongId.isNotBlank() && nativeQueue.isNotEmpty()) {
                val matchedIdx = nativeQueue.indexOfFirst { it.id == currentSongId }
                if (matchedIdx != -1) {
                    nativeQueueIndex = matchedIdx
                }
            }
            val volume = payload.get("volume")?.asFloat ?: 1.0f
            val rate = payload.get("rate")?.asFloat ?: 1.0f
            val initialSeekSec = payload.get("seekTime")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0

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
            if (initialSeekSec > 0.0) {
                exoPlayer.setMediaItem(mediaItem, (initialSeekSec * 1000.0).toLong())
            } else {
                exoPlayer.setMediaItem(mediaItem)
            }
            exoPlayer.volume = volume.coerceIn(0f, 1f)
            exoPlayer.playbackParameters = PlaybackParameters(rate.coerceIn(0.25f, 4f))
            exoPlayer.playWhenReady = autoplay
            exoPlayer.prepare()

            snapshotPlayerState()
            ensureForegroundNotification()
            updateNotification()
            fetchCoverArtworkAsync(currentCoverUrl, currentInstanceId)
        }
    }

    fun play() {
        uiHandler.post {
            userPaused = false
            if (::exoPlayer.isInitialized) {
                if (exoPlayer.playbackState == Player.STATE_ENDED) {
                    exoPlayer.seekTo(0L)
                }
                exoPlayer.play()
                snapshotPlayerState()
                ensureForegroundNotification()
                updateNotification()
            }
        }
    }

    fun pause() {
        uiHandler.post {
            userPaused = true
            isTransitioningTrack = false
            cancelNativeAutoAdvance()
            releaseTransitionWakeLock()
            if (::exoPlayer.isInitialized) {
                exoPlayer.pause()
                snapshotPlayerState()
                updateNotification()
            }
        }
    }

    fun stopPlayback() {
        uiHandler.post {
            userPaused = true
            isTransitioningTrack = false
            cancelNativeAutoAdvance()
            uiHandler.removeCallbacks(progressTicker)
            releaseTransitionWakeLock()
            if (::exoPlayer.isInitialized) {
                exoPlayer.stop()
                snapshotPlayerState()
            }
            updateNotification()
        }
    }

    fun seekTo(seconds: Double) {
        uiHandler.post {
            if (!::exoPlayer.isInitialized) return@post
            val durMs = exoPlayer.duration
            val rawTargetMs = (seconds * 1000.0).toLong().coerceAtLeast(0L)
            val targetMs = if (durMs > 0 && durMs != C.TIME_UNSET) {
                rawTargetMs.coerceAtMost(maxOf(0L, durMs - 250L))
            } else {
                rawTargetMs
            }

            if (exoPlayer.playbackState == Player.STATE_IDLE && exoPlayer.currentMediaItem != null) {
                exoPlayer.prepare()
            }

            val wasEnded = exoPlayer.playbackState == Player.STATE_ENDED
            exoPlayer.seekTo(targetMs)
            if (wasEnded) {
                exoPlayer.playWhenReady = true
            }

            snapshotPlayerState()
            emitAudioEvent("seek")

            // 180ms 后再回传一次 ExoPlayer 真实位置，确保歌词和进度条与实际解码位置严丝合缝
            seekConfirmRunnable?.let { uiHandler.removeCallbacks(it) }
            val confirm = Runnable {
                if (::exoPlayer.isInitialized) {
                    snapshotPlayerState()
                    emitAudioEvent("seek")
                }
            }
            seekConfirmRunnable = confirm
            uiHandler.postDelayed(confirm, 180L)
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
        return gson.toJson(
            mapOf(
                "instanceId" to currentInstanceId,
                "position" to cachedPositionSec,
                "duration" to cachedDurationSec,
                "playing" to cachedIsPlaying
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
            .setOngoing(isPlaying || isTransitioningTrack)
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
        snapshotPlayerState()
        val map = LinkedHashMap<String, Any>()
        map["type"] = type
        map["instanceId"] = currentInstanceId
        map["position"] = cachedPositionSec
        map["duration"] = cachedDurationSec
        map["playing"] = cachedIsPlaying
        if (errorMsg != null) map["error"] = errorMsg

        eventEmitter?.invoke("audio-event", gson.toJson(map))
    }

    private fun emitMediaControl(command: String) {
        val json = gson.toJson(mapOf("type" to command))
        eventEmitter?.invoke("audio-event", json)
    }
}
