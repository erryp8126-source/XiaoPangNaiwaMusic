package com.xiaopang.naiwamusic.config

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.JsonObject

data class ServerConfig(
    val mode: String = "local",
    val localPort: Int = 30488,
    val localToken: String = "",
    val customApiUrl: String = "",
    val customMusicApiUrl: String = "",
    val floatingLyricEnabled: Boolean = false
)

class AppPrefs(context: Context) {
    companion object {
        const val DEFAULT_AUDIO_CACHE_MAX_MB: Int = 500
        val AUDIO_CACHE_MAX_MB_OPTIONS: List<Int> = listOf(200, 500, 1024, 2048)
        private const val KEY_AUDIO_CACHE_MAX_MB = "audio_cache_max_mb"

        fun normalizeAudioCacheMaxMb(value: Int): Int {
            return if (value in AUDIO_CACHE_MAX_MB_OPTIONS) value else DEFAULT_AUDIO_CACHE_MAX_MB
        }
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences("alger_music_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    fun getServerConfig(activeLocalPort: Int, localAuthToken: String = ""): ServerConfig {
        return ServerConfig(
            mode = prefs.getString("api_mode", "local") ?: "local",
            localPort = activeLocalPort,
            localToken = localAuthToken,
            customApiUrl = prefs.getString("custom_api_url", "") ?: "",
            customMusicApiUrl = prefs.getString("custom_music_api_url", "") ?: "",
            floatingLyricEnabled = prefs.getBoolean("floating_lyric_enabled", false)
        )
    }

    fun saveServerConfigFromJson(json: String, activeLocalPort: Int, localAuthToken: String = ""): ServerConfig {
        val obj = runCatching { gson.fromJson(json, JsonObject::class.java) }.getOrNull()
        val editor = prefs.edit()
        if (obj != null) {
            obj.get("mode")?.asString?.let { editor.putString("api_mode", if (it == "custom") "custom" else "local") }
            obj.get("customApiUrl")?.asString?.let { editor.putString("custom_api_url", it.trim()) }
            obj.get("customMusicApiUrl")?.asString?.let { editor.putString("custom_music_api_url", it.trim()) }
            obj.get("floatingLyricEnabled")?.asBoolean?.let { editor.putBoolean("floating_lyric_enabled", it) }
        }
        editor.apply()
        return getServerConfig(activeLocalPort, localAuthToken)
    }

    var floatingLyricEnabled: Boolean
        get() = prefs.getBoolean("floating_lyric_enabled", false)
        set(value) = prefs.edit().putBoolean("floating_lyric_enabled", value).apply()

    var floatingLyricY: Int
        get() = prefs.getInt("floating_lyric_y", 380)
        set(value) = prefs.edit().putInt("floating_lyric_y", value).apply()

    var floatingLyricColor: Int
        get() = prefs.getInt("floating_lyric_color", 0xFF56A8E8.toInt())
        set(value) = prefs.edit().putInt("floating_lyric_color", value).apply()

    var floatingLyricTextSize: Float
        get() = prefs.getFloat("floating_lyric_text_size", 19f).coerceIn(14f, 26f)
        set(value) = prefs.edit().putFloat("floating_lyric_text_size", value.coerceIn(14f, 26f)).apply()

    var floatingLyricShowTranslation: Boolean
        get() = prefs.getBoolean("floating_lyric_show_translation", true)
        set(value) = prefs.edit().putBoolean("floating_lyric_show_translation", value).apply()

    var anonymousToken: String
        get() = prefs.getString("anonymous_token", "") ?: ""
        set(value) = prefs.edit().putString("anonymous_token", value).apply()

    var deviceId: String
        get() = prefs.getString("ncm_device_id", "") ?: ""
        set(value) = prefs.edit().putString("ncm_device_id", value).apply()

    var audioCacheMaxMb: Int
        get() = normalizeAudioCacheMaxMb(
            prefs.getInt(KEY_AUDIO_CACHE_MAX_MB, DEFAULT_AUDIO_CACHE_MAX_MB)
        )
        set(value) {
            val normalized = normalizeAudioCacheMaxMb(value)
            prefs.edit().putInt(KEY_AUDIO_CACHE_MAX_MB, normalized).apply()
        }
}
