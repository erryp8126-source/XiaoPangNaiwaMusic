package com.alger.musicplayer.server

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 手机内置多音源解锁与 CORS-Free HTTP 引擎
 * 支持酷我 / 酷狗 / 咪咕 / GD音乐台以及 LX Music 脚本与云同步无跨域请求代理
 */
class MusicUnblockEngine {
    companion object {
        private const val TAG = "MusicUnblockEngine"
        private const val DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
    }

    private val gson = Gson()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS))
        .build()

    data class UnblockResult(
        val url: String,
        val br: Int = 320000,
        val size: Long = 0,
        val platform: String
    )

    fun unblock(
        songId: String,
        songName: String,
        artists: String,
        enabledSources: List<String> = listOf("pyncmd", "kuwo", "kugou", "migu", "gdmusic")
    ): UnblockResult? {
        val keyword = "$songName $artists".trim()
        if (keyword.isBlank() && songId.isBlank()) return null

        val ordered = if (enabledSources.isEmpty()) {
            listOf("pyncmd", "kuwo", "kugou", "migu", "gdmusic")
        } else {
            enabledSources
        }

        for (src in ordered) {
            val result = when (src.lowercase()) {
                "pyncmd" -> if (songId.isNotBlank()) runCatching { searchPyncmd(songId) }.getOrNull() else null
                "kuwo" -> if (keyword.isNotBlank()) runCatching { searchKuwo(keyword, songName) }.getOrNull() else null
                "kugou" -> if (keyword.isNotBlank()) runCatching { searchKugou(keyword, songName) }.getOrNull() else null
                "migu" -> if (keyword.isNotBlank()) runCatching { searchMigu(keyword, songName) }.getOrNull() else null
                "gdmusic", "qq", "joox" -> if (keyword.isNotBlank()) runCatching { searchGdMusic(keyword, songId) }.getOrNull() else null
                else -> null
            }
            if (result != null && result.url.startsWith("http")) {
                Log.d(TAG, "Unblocked [$keyword/$songId] via ${result.platform}: ${result.url.take(80)}")
                return result
            }
        }

        // 兜底尝试 pyncmd 与 GD 音乐台
        if (!ordered.any { it.equals("pyncmd", ignoreCase = true) } && songId.isNotBlank()) {
            val pyncmdFallback = runCatching { searchPyncmd(songId) }.getOrNull()
            if (pyncmdFallback != null && pyncmdFallback.url.startsWith("http")) return pyncmdFallback
        }
        if (!ordered.any { it.equals("gdmusic", ignoreCase = true) } && keyword.isNotBlank()) {
            val fallback = runCatching { searchGdMusic(keyword, songId) }.getOrNull()
            if (fallback != null && fallback.url.startsWith("http")) return fallback
        }
        return null
    }

    /**
     * 精准网易云 ID 无损解析（对齐 @unblockneteasemusic/server pyncmd 通道）
     */
    private fun searchPyncmd(songId: String): UnblockResult? {
        val cleanId = songId.trim()
        if (cleanId.isEmpty() || !cleanId.all { it.isDigit() }) return null
        val baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for (br in listOf("999", "320")) {
            val urlEndpoint = "$baseUrl?types=url&source=netease&id=$cleanId&br=$br"
            val urlBody = httpGetText(urlEndpoint, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val urlObj = runCatching { JsonParser.parseString(urlBody).asJsonObject }.getOrNull() ?: continue
            val rawUrl = urlObj.get("url")?.takeIf { !it.isJsonNull }?.asString?.replace("\\", "")?.trim()
            if (!rawUrl.isNullOrBlank() && rawUrl.startsWith("http")) {
                val playUrl = rawUrl.replace(Regex("^http://([^/]*\\.126\\.net/)", RegexOption.IGNORE_CASE), "https://$1")
                val bitrate = (urlObj.get("br")?.takeIf { !it.isJsonNull }?.asInt ?: 320) * 1000
                val size = urlObj.get("size")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                return UnblockResult(url = playUrl, br = bitrate, size = size, platform = "pyncmd")
            }
        }
        return null
    }

    private fun searchKuwo(keyword: String, songName: String): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://search.kuwo.cn/r.s?all=$q&ft=music&rformat=json&encoding=utf8&pcjson=1&vipver=1&pn=0&rn=5"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = runCatching { JsonParser.parseString(body.replace("'", "\"")).asJsonObject }.getOrNull()
            ?: return null
        val list = root.getAsJsonArray("abslist") ?: return null
        if (list.size() == 0) return null

        for (item in list) {
            val obj = item.asJsonObject
            val rid = obj.get("MUSICRID")?.asString?.removePrefix("MUSIC_") ?: continue
            val urlApi =
                "https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=$rid&format=mp3"
            val urlBody = httpGetText(urlApi, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val urlJson = runCatching { JsonParser.parseString(urlBody).asJsonObject }.getOrNull()
            val playUrl = urlJson?.get("url")?.asString
            if (!playUrl.isNullOrBlank() && playUrl.startsWith("http")) {
                return UnblockResult(url = playUrl, br = 320000, platform = "kuwo")
            }
            // 备选接口
            val altApi =
                "http://www.kuwo.cn/api/v1/www/music/playUrl?mid=$rid&type=music&httpsStatus=1&br=320kmp3"
            val altBody = httpGetText(
                altApi,
                mapOf("User-Agent" to DEFAULT_UA, "Referer" to "http://www.kuwo.cn/")
            ) ?: continue
            val altJson = runCatching { JsonParser.parseString(altBody).asJsonObject }.getOrNull()
            val altUrl = altJson?.getAsJsonObject("data")?.get("url")?.asString
            if (!altUrl.isNullOrBlank() && altUrl.startsWith("http")) {
                return UnblockResult(url = altUrl, br = 320000, platform = "kuwo")
            }
        }
        return null
    }

    private fun searchKugou(keyword: String, songName: String): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=$q&page=1&pagesize=5&showtype=1"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return null
        val info = root.getAsJsonObject("data")?.getAsJsonArray("info") ?: return null
        for (el in info) {
            val obj = el.asJsonObject
            val hash = obj.get("320hash")?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("hash")?.asString?.takeIf { it.isNotBlank() }
                ?: continue
            val albumId = obj.get("album_id")?.asString ?: ""
            val playApi =
                "https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=$hash&album_id=$albumId&mid=1"
            val playBody = httpGetText(
                playApi,
                mapOf(
                    "User-Agent" to DEFAULT_UA,
                    "Cookie" to "kg_mid=2333; kg_dfid=2333"
                )
            ) ?: continue
            val playJson = runCatching { JsonParser.parseString(playBody).asJsonObject }.getOrNull()
            val data = playJson?.getAsJsonObject("data")
            val playUrl = data?.get("play_url")?.asString?.takeIf { it.startsWith("http") }
                ?: data?.get("play_backup_url")?.asString?.takeIf { it.startsWith("http") }
            if (!playUrl.isNullOrBlank()) {
                return UnblockResult(url = playUrl, br = 320000, platform = "kugou")
            }
        }
        return null
    }

    private fun searchMigu(keyword: String, songName: String): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=$q&pageNo=1&pageSize=5&searchSwitch=%7B%22song%22%3A1%7D"
        val body = httpGetText(
            searchUrl,
            mapOf(
                "User-Agent" to DEFAULT_UA,
                "Referer" to "https://m.music.migu.cn/",
                "channel" to "0140210"
            )
        ) ?: return null
        val root = runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return null
        val resultList = root.getAsJsonObject("songResultData")?.getAsJsonArray("result") ?: return null
        for (el in resultList) {
            val obj = el.asJsonObject
            val contentId = obj.get("contentId")?.asString ?: continue
            val copyrightId = obj.get("copyrightId")?.asString ?: continue
            val urlApi =
                "https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=$copyrightId&resourceType=2"
            val urlBody = httpGetText(urlApi, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val uRoot = runCatching { JsonParser.parseString(urlBody).asJsonObject }.getOrNull()
            val resArr = uRoot?.getAsJsonArray("resource") ?: continue
            if (resArr.size() == 0) continue
            val resObj = resArr[0].asJsonObject
            val formats = resObj.getAsJsonArray("newRateFormats") ?: resObj.getAsJsonArray("rateFormats")
            if (formats != null && formats.size() > 0) {
                for (i in formats.size() - 1 downTo 0) {
                    val f = formats[i].asJsonObject
                    val rawPath = f.get("androidUrl")?.asString ?: f.get("url")?.asString ?: continue
                    val finalUrl = rawPath.replace(Regex("ftp://[^/]+"), "https://freetyst.nf.migu.cn")
                    if (finalUrl.startsWith("http")) {
                        return UnblockResult(url = finalUrl, br = 320000, platform = "migu")
                    }
                }
            }
            // 备选直接拼接
            val direct =
                "https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=$copyrightId&contentId=$contentId&toneFlag=HQ&resourceType=2&userId=15548614588710179085069&netType=00"
            if (checkAudioUrlReachable(direct)) {
                return UnblockResult(url = direct, br = 320000, platform = "migu")
            }
        }
        return null
    }

    private fun searchGdMusic(keyword: String, songId: String): UnblockResult? {
        val sources = listOf("joox", "kuwo", "kugou", "netease", "tidal")
        val baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for (source in sources) {
            val searchUrl = "$baseUrl?types=search&source=$source&name=${enc(keyword)}&count=3&pages=1"
            val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val arr = runCatching { JsonParser.parseString(body).asJsonArray }.getOrNull() ?: continue
            if (arr.size() == 0) continue
            val first = arr[0].asJsonObject
            val trackId = first.get("id")?.asString ?: continue
            val trackSource = first.get("source")?.asString ?: source
            val urlEndpoint = "$baseUrl?types=url&source=$trackSource&id=$trackId&br=999"
            val urlBody = httpGetText(urlEndpoint, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val urlObj = runCatching { JsonParser.parseString(urlBody).asJsonObject }.getOrNull() ?: continue
            val playUrl = urlObj.get("url")?.asString?.replace("\\", "")
            if (!playUrl.isNullOrBlank() && playUrl.startsWith("http")) {
                val br = (urlObj.get("br")?.asInt ?: 320) * 1000
                val size = urlObj.get("size")?.asLong ?: 0L
                return UnblockResult(url = playUrl, br = br, size = size, platform = "gdmusic:$trackSource")
            }
        }
        return null
    }

    private fun checkAudioUrlReachable(url: String): Boolean {
        return try {
            val req = Request.Builder().url(url).head().header("User-Agent", DEFAULT_UA).build()
            SafeHttpGuard.executeWithSafeRedirects(
                client,
                req,
                SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
            ).use { resp ->
                resp.isSuccessful && (resp.header("Content-Type")?.contains("text/html") != true)
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun httpGetText(url: String, headers: Map<String, String>): String? {
        return try {
            val builder = Request.Builder().url(url).get()
            headers.forEach { (k, v) -> builder.header(k, v) }
            SafeHttpGuard.executeWithSafeRedirects(
                client,
                builder.build(),
                SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
            ).use { resp ->
                if (!resp.isSuccessful) return null
                resp.body?.string()
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * 供 LX Music 脚本、GD 音乐台、自定义 API 插件与云同步调用的无跨域 HTTP 请求器
     * 强制执行域名白名单、全量公网 IP 校验与手动 3 跳重定向防 SSRF 绕过
     */
    fun proxyHttpRequest(
        url: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        form: Map<String, String>? = null,
        timeoutMs: Long = 15000
    ): JsonObject {
        if (!SafeHttpGuard.validateUrlAndResolve(url, SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS)) {
            throw SecurityException("Blocked non-allowlisted or unsafe proxy URL")
        }
        val customClient = client.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS))
            .build()

        val reqBuilder = Request.Builder().url(url)
        var hasUa = false
        var contentType: String? = null
        headers.forEach { (k, v) ->
            if (k.equals("user-agent", ignoreCase = true)) hasUa = true
            if (k.equals("content-type", ignoreCase = true)) contentType = v
            reqBuilder.header(k, v)
        }
        if (!hasUa) {
            reqBuilder.header("User-Agent", DEFAULT_UA)
        }

        val upperMethod = method.uppercase()
        if (upperMethod == "GET" || upperMethod == "HEAD") {
            reqBuilder.method(upperMethod, null)
        } else {
            val reqBody = when {
                form != null -> {
                    val fb = FormBody.Builder()
                    form.forEach { (k, v) -> fb.add(k, v) }
                    fb.build()
                }
                body != null -> {
                    val mt = (contentType ?: "application/json; charset=utf-8").toMediaTypeOrNull()
                    body.toRequestBody(mt)
                }
                else -> "".toRequestBody(null)
            }
            reqBuilder.method(upperMethod, reqBody)
        }

        SafeHttpGuard.executeWithSafeRedirects(
            customClient,
            reqBuilder.build(),
            SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
        ).use { resp ->
            val rawText = resp.body?.string() ?: ""
            val respHeaders = JsonObject()
            resp.headers.names().forEach { name ->
                respHeaders.addProperty(name.lowercase(), resp.header(name))
            }

            val parsedBody: JsonElement = runCatching {
                val trimmed = rawText.trim()
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    JsonParser.parseString(trimmed)
                } else {
                    gson.toJsonTree(rawText)
                }
            }.getOrElse { gson.toJsonTree(rawText) }

            return JsonObject().apply {
                addProperty("statusCode", resp.code)
                add("headers", respHeaders)
                add("body", parsedBody)
                addProperty("finalUrl", resp.request.url.toString())
            }
        }
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
