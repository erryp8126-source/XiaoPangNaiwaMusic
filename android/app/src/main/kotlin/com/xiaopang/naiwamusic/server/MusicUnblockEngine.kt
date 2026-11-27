package com.xiaopang.naiwamusic.server

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
import okhttp3.Response
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 手机内置多音源解锁与 CORS-Free HTTP 引擎
 * 支持酷我 / 酷狗 / 咪咕 / GD音乐台以及 LX Music 脚本与云同步无跨域请求代理
 */
class MusicUnblockEngine internal constructor(
    private val customProbeExecutor: ((Request) -> Response)? = null
) {
    constructor() : this(null)

    companion object {
        private const val TAG = "MusicUnblockEngine"
        private const val DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
        internal val DEFAULT_ENABLED_SOURCES = listOf("pyncmd", "gdmusic", "migu", "kugou", "kuwo")
        internal const val MIN_VALID_AUDIO_BYTES = 400L * 1024L // 400 KB：拦截酷我短提示音等占位小文件
        internal const val MIN_SHORT_TRACK_AUDIO_BYTES = 80L * 1024L // 80 KB：原曲 < 30 秒时适度放宽
        internal const val SHORT_TRACK_DURATION_THRESHOLD_MS = 30_000L
        private val HEAD_FALLBACK_CODES = setOf(400, 403, 405, 501)
        private val CONTENT_RANGE_TOTAL_REGEX = Regex("""bytes\s+\d+-\d+/(\d+)""", RegexOption.IGNORE_CASE)
        private val KUWO_SUSPICIOUS_URL_REGEX = Regex(
            """(^|[/?&_=-])(audition|shiting|tishi|viptip|vip[_-]?tip|free[_-]?tip|notice|prompt|trylisten|try[_-]?listen|preview)([/?&_=.-]|$)""",
            RegexOption.IGNORE_CASE
        )
        private val DISALLOWED_AUDIO_CONTENT_TYPES = setOf(
            "text/html",
            "application/json",
            "application/xml",
            "text/plain",
            "text/xml"
        )
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

    // 音频流 CDN 探测客户端：仅约束公网 IP + 手动重定向校验，允许第三方公网音频 CDN
    private val mediaProbeClient: OkHttpClient = client.newBuilder()
        .dns(SafeHttpGuard.createPublicIpOnlyDns())
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
        enabledSources: List<String> = DEFAULT_ENABLED_SOURCES,
        expectedDurationMs: Long = 0L
    ): UnblockResult? {
        val keyword = "$songName $artists".trim()
        if (keyword.isBlank() && songId.isBlank()) return null

        val ordered = if (enabledSources.isEmpty()) {
            DEFAULT_ENABLED_SOURCES
        } else {
            enabledSources
        }

        for (src in ordered) {
            val result = when (src.lowercase()) {
                "pyncmd" -> if (songId.isNotBlank()) runCatching { searchPyncmd(songId, expectedDurationMs) }.getOrNull() else null
                "kuwo" -> if (keyword.isNotBlank()) runCatching { searchKuwo(keyword, songName, expectedDurationMs) }.getOrNull() else null
                "kugou" -> if (keyword.isNotBlank()) runCatching { searchKugou(keyword, songName, expectedDurationMs) }.getOrNull() else null
                "migu" -> if (keyword.isNotBlank()) runCatching { searchMigu(keyword, songName, expectedDurationMs) }.getOrNull() else null
                "gdmusic", "qq", "joox" -> if (keyword.isNotBlank()) runCatching { searchGdMusic(keyword, songId, expectedDurationMs) }.getOrNull() else null
                else -> null
            }
            if (result != null && result.url.startsWith("http")) {
                safeLogD("Unblocked [$keyword/$songId] via ${result.platform}: ${result.url.take(80)}")
                return result
            }
        }

        // 兜底尝试 pyncmd 与 GD 音乐台
        if (!ordered.any { it.equals("pyncmd", ignoreCase = true) } && songId.isNotBlank()) {
            val pyncmdFallback = runCatching { searchPyncmd(songId, expectedDurationMs) }.getOrNull()
            if (pyncmdFallback != null && pyncmdFallback.url.startsWith("http")) return pyncmdFallback
        }
        if (!ordered.any { it.equals("gdmusic", ignoreCase = true) } && keyword.isNotBlank()) {
            val fallback = runCatching { searchGdMusic(keyword, songId, expectedDurationMs) }.getOrNull()
            if (fallback != null && fallback.url.startsWith("http")) return fallback
        }
        return null
    }

    /**
     * 精准网易云 ID 无损解析（对齐 @unblockneteasemusic/server pyncmd 通道）
     */
    private fun searchPyncmd(songId: String, expectedDurationMs: Long = 0L): UnblockResult? {
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
                if (!checkAudioUrlReachable(playUrl, expectedDurationMs)) continue
                val bitrate = (urlObj.get("br")?.takeIf { !it.isJsonNull }?.asInt ?: 320) * 1000
                val size = urlObj.get("size")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                return UnblockResult(url = playUrl, br = bitrate, size = size, platform = "pyncmd")
            }
        }
        return null
    }

    private fun searchKuwo(keyword: String, songName: String, expectedDurationMs: Long = 0L): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://search.kuwo.cn/r.s?all=$q&ft=music&rformat=json&encoding=utf8&pcjson=1&vipver=1&pn=0&rn=5"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = runCatching { JsonParser.parseString(body.replace("'", "\"")).asJsonObject }.getOrNull()
            ?: return null
        val list = root.getAsJsonArray("abslist") ?: return null
        if (list.size() == 0) return null

        val maxItems = minOf(3, list.size())
        for (index in 0 until maxItems) {
            val obj = list[index].asJsonObject
            val rid = obj.get("MUSICRID")?.takeIf { !it.isJsonNull }?.asString?.removePrefix("MUSIC_") ?: continue
            val urlApi =
                "https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=$rid&format=mp3"
            val urlBody = httpGetText(urlApi, mapOf("User-Agent" to DEFAULT_UA))
            val urlJson = urlBody?.let { runCatching { JsonParser.parseString(it).asJsonObject }.getOrNull() }
            val playUrl = urlJson?.get("url")?.takeIf { !it.isJsonNull }?.asString?.trim()
            if (!playUrl.isNullOrBlank() && playUrl.startsWith("http") && checkAudioUrlReachable(playUrl, expectedDurationMs)) {
                return UnblockResult(url = playUrl, br = 320000, platform = "kuwo")
            }
            // convert_url3 返回酷我短提示音或失效时，继续尝试备选 playUrl 接口
            val altApi =
                "http://www.kuwo.cn/api/v1/www/music/playUrl?mid=$rid&type=music&httpsStatus=1&br=320kmp3"
            val altBody = httpGetText(
                altApi,
                mapOf("User-Agent" to DEFAULT_UA, "Referer" to "http://www.kuwo.cn/")
            ) ?: continue
            val altJson = runCatching { JsonParser.parseString(altBody).asJsonObject }.getOrNull()
            val altUrl = altJson?.getAsJsonObject("data")?.get("url")?.takeIf { !it.isJsonNull }?.asString?.trim()
            if (!altUrl.isNullOrBlank() && altUrl.startsWith("http") && checkAudioUrlReachable(altUrl, expectedDurationMs)) {
                return UnblockResult(url = altUrl, br = 320000, platform = "kuwo")
            }
        }
        return null
    }

    private fun searchKugou(keyword: String, songName: String, expectedDurationMs: Long = 0L): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=$q&page=1&pagesize=5&showtype=1"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return null
        val info = root.getAsJsonObject("data")?.getAsJsonArray("info") ?: return null
        for (el in info) {
            val obj = el.asJsonObject
            val hash = obj.get("320hash")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("hash")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: continue
            val albumId = obj.get("album_id")?.takeIf { !it.isJsonNull }?.asString ?: ""
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
            val playUrl = data?.get("play_url")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.startsWith("http") }
                ?: data?.get("play_backup_url")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.startsWith("http") }
            if (!playUrl.isNullOrBlank() && checkAudioUrlReachable(playUrl, expectedDurationMs)) {
                return UnblockResult(url = playUrl, br = 320000, platform = "kugou")
            }
        }
        return null
    }

    private fun searchMigu(keyword: String, songName: String, expectedDurationMs: Long = 0L): UnblockResult? {
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
            val contentId = obj.get("contentId")?.takeIf { !it.isJsonNull }?.asString ?: continue
            val copyrightId = obj.get("copyrightId")?.takeIf { !it.isJsonNull }?.asString ?: continue
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
                    val rawPath = f.get("androidUrl")?.takeIf { !it.isJsonNull }?.asString
                        ?: f.get("url")?.takeIf { !it.isJsonNull }?.asString
                        ?: continue
                    val finalUrl = rawPath.replace(Regex("ftp://[^/]+"), "https://freetyst.nf.migu.cn")
                    if (finalUrl.startsWith("http") && checkAudioUrlReachable(finalUrl, expectedDurationMs)) {
                        return UnblockResult(url = finalUrl, br = 320000, platform = "migu")
                    }
                }
            }
            // 备选直接拼接
            val direct =
                "https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=$copyrightId&contentId=$contentId&toneFlag=HQ&resourceType=2&userId=15548614588710179085069&netType=00"
            if (checkAudioUrlReachable(direct, expectedDurationMs)) {
                return UnblockResult(url = direct, br = 320000, platform = "migu")
            }
        }
        return null
    }

    private fun searchGdMusic(keyword: String, songId: String, expectedDurationMs: Long = 0L): UnblockResult? {
        val sources = listOf("joox", "netease", "kugou", "tidal", "kuwo")
        val baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for (source in sources) {
            val searchUrl = "$baseUrl?types=search&source=$source&name=${enc(keyword)}&count=3&pages=1"
            val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val arr = runCatching { JsonParser.parseString(body).asJsonArray }.getOrNull() ?: continue
            if (arr.size() == 0) continue
            val maxItems = minOf(2, arr.size())
            for (idx in 0 until maxItems) {
                val item = arr[idx].asJsonObject
                val trackId = item.get("id")?.takeIf { !it.isJsonNull }?.asString ?: continue
                val trackSource = item.get("source")?.takeIf { !it.isJsonNull }?.asString ?: source
                val urlEndpoint = "$baseUrl?types=url&source=$trackSource&id=$trackId&br=999"
                val urlBody = httpGetText(urlEndpoint, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
                val urlObj = runCatching { JsonParser.parseString(urlBody).asJsonObject }.getOrNull() ?: continue
                val playUrl = urlObj.get("url")?.takeIf { !it.isJsonNull }?.asString?.replace("\\", "")?.trim()
                if (!playUrl.isNullOrBlank() && playUrl.startsWith("http") && checkAudioUrlReachable(playUrl, expectedDurationMs)) {
                    val br = (urlObj.get("br")?.takeIf { !it.isJsonNull }?.asInt ?: 320) * 1000
                    val size = urlObj.get("size")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
                    return UnblockResult(url = playUrl, br = br, size = size, platform = "gdmusic:$trackSource")
                }
            }
        }
        return null
    }

    internal fun resolveMinValidAudioBytes(expectedDurationMs: Long): Long {
        return if (expectedDurationMs in 1L until SHORT_TRACK_DURATION_THRESHOLD_MS) {
            MIN_SHORT_TRACK_AUDIO_BYTES
        } else {
            MIN_VALID_AUDIO_BYTES
        }
    }

    internal fun isSuspiciousKuwoPlaceholderUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return false
        val lowerUrl = trimmed.lowercase()
        val parsed = runCatching { URI(trimmed) }.getOrNull()
        val host = parsed?.host?.lowercase().orEmpty()
        val isKuwoUrl = host.contains("kuwo") || host.contains("kwcdn") ||
            lowerUrl.contains("kuwo") || lowerUrl.contains("kwcdn")
        if (!isKuwoUrl) return false
        val target = buildString {
            append(parsed?.path.orEmpty())
            val q = parsed?.rawQuery.orEmpty()
            if (q.isNotEmpty()) {
                append('?').append(q)
            }
        }.ifBlank { lowerUrl }
        return KUWO_SUSPICIOUS_URL_REGEX.containsMatchIn(target)
    }

    internal fun parseTotalBytesFromHeaders(
        code: Int,
        contentLengthHeader: String?,
        contentRangeHeader: String?
    ): Long? {
        if (code == 206) {
            val range = contentRangeHeader?.trim().orEmpty()
            val match = CONTENT_RANGE_TOTAL_REGEX.find(range)
            return match?.groupValues?.getOrNull(1)?.toLongOrNull()
        }
        return contentLengthHeader?.trim()?.toLongOrNull()
    }

    private fun isDisallowedAudioContentType(contentType: String?): Boolean {
        val normalized = contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
        if (normalized.isEmpty()) return false
        return normalized in DISALLOWED_AUDIO_CONTENT_TYPES
    }

    private fun safeLogD(message: String) {
        runCatching { Log.d(TAG, message) }
    }

    private fun safeLogW(message: String) {
        runCatching { Log.w(TAG, message) }
    }

    internal fun checkAudioUrlReachable(url: String, expectedDurationMs: Long = 0L): Boolean {
        if (isSuspiciousKuwoPlaceholderUrl(url)) {
            safeLogW("Rejected suspicious Kuwo notice/audition URL: ${url.take(100)}")
            return false
        }
        val minValidBytes = resolveMinValidAudioBytes(expectedDurationMs)
        val runProbe: (Request) -> Response = { req ->
            customProbeExecutor?.invoke(req)
                ?: SafeHttpGuard.executePublicMediaWithSafeRedirects(mediaProbeClient, req)
        }
        return try {
            val headReq = Request.Builder().url(url).head().header("User-Agent", DEFAULT_UA).build()
            var shouldFallbackToRangeGet = false
            runProbe(headReq).use { resp ->
                if (isDisallowedAudioContentType(resp.header("Content-Type"))) {
                    return false
                }
                if (resp.isSuccessful) {
                    val totalBytes = parseTotalBytesFromHeaders(
                        resp.code,
                        resp.header("Content-Length"),
                        resp.header("Content-Range")
                    )
                    if (totalBytes != null && totalBytes > 0L) {
                        if (totalBytes < minValidBytes) {
                            safeLogW("Rejected undersized audio (${totalBytes}B < ${minValidBytes}B) via HEAD: ${url.take(100)}")
                            return false
                        }
                        return true
                    }
                    shouldFallbackToRangeGet = true
                } else if (resp.code in HEAD_FALLBACK_CODES) {
                    shouldFallbackToRangeGet = true
                } else {
                    return false
                }
            }

            if (!shouldFallbackToRangeGet) return false

            val rangeReq = Request.Builder()
                .url(url)
                .get()
                .header("User-Agent", DEFAULT_UA)
                .header("Range", "bytes=0-1")
                .build()
            runProbe(rangeReq).use { resp ->
                if (resp.code != 200 && resp.code != 206) {
                    return false
                }
                if (isDisallowedAudioContentType(resp.header("Content-Type"))) {
                    return false
                }
                val totalBytes = parseTotalBytesFromHeaders(
                    resp.code,
                    resp.header("Content-Length"),
                    resp.header("Content-Range")
                )
                if (totalBytes != null) {
                    if (totalBytes == 0L || totalBytes < minValidBytes) {
                        safeLogW("Rejected undersized audio (${totalBytes}B < ${minValidBytes}B) via Range GET: ${url.take(100)}")
                        return false
                    }
                    return true
                }
                true
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
     * 默认执行核心域名白名单 + 全量公网 IP 校验 + 手动 3 跳重定向；
     * 当 isCustomLx = true 时，放开用户自主启用的自定义 LX 音源第三方公网域名，同时严格保留 SSRF / 内网 / Supabase 阻断。
     */
    fun proxyHttpRequest(
        url: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        form: Map<String, String>? = null,
        timeoutMs: Long = 15000,
        isCustomLx: Boolean = false
    ): JsonObject {
        val allowed = if (isCustomLx) {
            SafeHttpGuard.validateCustomLxUrlAndResolve(url)
        } else {
            SafeHttpGuard.validateUrlAndResolve(url, SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS)
        }
        if (!allowed) {
            throw SecurityException(
                if (isCustomLx) "Blocked unsafe or restricted LX proxy URL"
                else "Blocked non-allowlisted or unsafe proxy URL"
            )
        }
        val customClient = client.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .dns(
                if (isCustomLx) SafeHttpGuard.createCustomLxSafeDns()
                else SafeHttpGuard.createSafeDns(SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS)
            )
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

        val respBlock = if (isCustomLx) {
            SafeHttpGuard.executeCustomLxWithSafeRedirects(customClient, reqBuilder.build())
        } else {
            SafeHttpGuard.executeWithSafeRedirects(
                customClient,
                reqBuilder.build(),
                SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
            )
        }
        respBlock.use { resp ->
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
