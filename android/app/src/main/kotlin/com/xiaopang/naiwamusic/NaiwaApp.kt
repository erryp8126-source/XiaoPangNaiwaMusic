package com.xiaopang.naiwamusic

import android.app.Application
import android.util.Log
import com.xiaopang.naiwamusic.config.AppPrefs
import com.xiaopang.naiwamusic.server.EmbeddedHttpServer
import com.xiaopang.naiwamusic.server.MusicUnblockEngine
import com.xiaopang.naiwamusic.server.NeteaseApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.SecureRandom

class NaiwaApp : Application() {
    companion object {
        private const val TAG = "NaiwaApp"
        @Volatile
        lateinit var instance: NaiwaApp
            private set

        private fun generateSessionToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }

    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val localAuthToken: String = generateSessionToken()

    lateinit var prefs: AppPrefs
        private set
    lateinit var ncmClient: NeteaseApiClient
        private set
    lateinit var unblockEngine: MusicUnblockEngine
        private set

    @Volatile
    var httpServer: EmbeddedHttpServer? = null
        private set

    @Volatile
    var localServerPort: Int = 30488
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = AppPrefs(this)
        ncmClient = NeteaseApiClient(prefs)
        unblockEngine = MusicUnblockEngine()

        startEmbeddedServer()

        // 后台预热匿名 MUSIC_A Cookie，加快首屏推荐/搜索速度
        appScope.launch {
            ncmClient.ensureAnonymousToken()
        }
    }

    private fun startEmbeddedServer() {
        for (port in 30488..30498) {
            try {
                val server = EmbeddedHttpServer(this, port, localAuthToken, ncmClient, unblockEngine)
                server.start(10_000, false)
                httpServer = server
                localServerPort = port
                Log.i(TAG, "Embedded Netease API server started at http://127.0.0.1:$port")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Port $port busy, trying next: ${e.message}")
            }
        }
        Log.e(TAG, "Failed to start embedded HTTP server on any port in 30488..30498")
    }
}
