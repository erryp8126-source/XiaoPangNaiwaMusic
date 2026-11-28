package com.xiaopang.naiwamusic.server

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs

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
        internal const val MIN_VALID_AUDIO_BYTES = 800L * 1024L // 800 KB：拦截 11s 320k 酷我提示音（~450 KB）等占位小文件
        internal const val MIN_SHORT_TRACK_AUDIO_BYTES = 80L * 1024L // 80 KB：原曲 < 30 秒时适度放宽
        internal const val SHORT_TRACK_DURATION_THRESHOLD_MS = 30_000L
        internal const val MIN_CANDIDATE_PASS_SCORE = 35
        internal const val REJECT_CANDIDATE_SCORE = Int.MIN_VALUE
        internal const val MAX_PROXY_RESPONSE_BYTES = 6 * 1024 * 1024 // 6 MB 上限，防恶意流触发 OOM
        internal const val MAX_UNBLOCK_TEXT_BYTES = 4 * 1024 * 1024 // 4 MB 文本读取上限
        internal const val MIN_PROXY_TIMEOUT_MS = 1_000L
        internal const val MAX_PROXY_TIMEOUT_MS = 60_000L

        internal fun clampProxyTimeoutMs(timeoutMs: Long): Long =
            timeoutMs.coerceIn(MIN_PROXY_TIMEOUT_MS, MAX_PROXY_TIMEOUT_MS)

        internal fun readBoundedResponseText(
            resp: Response,
            maxBytes: Int,
            throwOnOverflow: Boolean = true
        ): String {
            val body = resp.body ?: return ""
            val contentLength = body.contentLength()
            if (throwOnOverflow && contentLength > maxBytes.toLong()) {
                throw IllegalStateException("Response body exceeds $maxBytes byte limit")
            }
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var totalRead = 0
            body.byteStream().use { input ->
                while (true) {
                    val read = input.read(buf)
                    if (read == -1) break
                    if (totalRead + read > maxBytes) {
                        if (throwOnOverflow) {
                            throw IllegalStateException("Response body exceeds $maxBytes byte limit")
                        }
                        val remaining = maxBytes - totalRead
                        if (remaining > 0) {
                            out.write(buf, 0, remaining)
                        }
                        break
                    }
                    out.write(buf, 0, read)
                    totalRead += read
                }
            }
            val charset = runCatching { body.contentType()?.charset(Charsets.UTF_8) }.getOrNull() ?: Charsets.UTF_8
            return out.toString(charset.name())
        }

        internal fun serializeResponseHeaders(headers: Headers): JsonObject {
            val respHeaders = JsonObject()
            for (name in headers.names()) {
                val values = headers.values(name)
                val lowerName = name.lowercase(Locale.ROOT)
                if (values.size > 1) {
                    val arr = JsonArray()
                    values.forEach { arr.add(it) }
                    respHeaders.add(lowerName, arr)
                } else if (values.size == 1) {
                    respHeaders.addProperty(lowerName, values[0])
                }
            }
            return respHeaders
        }

        private fun nextNonWhitespaceChar(text: String, startIdx: Int): Char? {
            var idx = startIdx
            while (idx < text.length) {
                val ch = text[idx]
                if (!ch.isWhitespace()) return ch
                idx++
            }
            return null
        }

        private fun convertSingleQuotedJsonToStandard(raw: String): String {
            val sb = StringBuilder(raw.length)
            var inDoubleQuote = false
            var inSingleQuote = false
            var escaped = false
            var i = 0
            while (i < raw.length) {
                val ch = raw[i]
                if (inDoubleQuote) {
                    sb.append(ch)
                    if (escaped) {
                        escaped = false
                    } else if (ch == '\\') {
                        escaped = true
                    } else if (ch == '"') {
                        inDoubleQuote = false
                    }
                } else if (inSingleQuote) {
                    if (escaped) {
                        if (ch == '\'') {
                            sb.append('\'')
                        } else {
                            sb.append('\\').append(ch)
                        }
                        escaped = false
                    } else if (ch == '\\') {
                        escaped = true
                    } else if (ch == '"') {
                        sb.append("\\\"")
                    } else if (ch == '\'') {
                        val nextNonWs = nextNonWhitespaceChar(raw, i + 1)
                        val isClosingDelimiter =
                            nextNonWs == null ||
                                nextNonWs == ',' ||
                                nextNonWs == ':' ||
                                nextNonWs == '}' ||
                                nextNonWs == ']'
                        if (isClosingDelimiter) {
                            inSingleQuote = false
                            sb.append('"')
                        } else {
                            sb.append('\'')
                        }
                    } else {
                        sb.append(ch)
                    }
                } else {
                    when (ch) {
                        '"' -> {
                            inDoubleQuote = true
                            sb.append(ch)
                        }
                        '\'' -> {
                            inSingleQuote = true
                            sb.append('"')
                        }
                        else -> sb.append(ch)
                    }
                }
                i++
            }
            return sb.toString()
        }

        internal fun parseKuwoSearchJson(rawBody: String): JsonObject? {
            val trimmed = rawBody.trim()
            if (trimmed.isEmpty()) return null
            val direct = runCatching {
                val el = JsonParser.parseString(trimmed)
                if (el.isJsonObject) el.asJsonObject else null
            }.getOrNull()
            if (direct != null) return direct

            val normalized = convertSingleQuotedJsonToStandard(trimmed)
            return runCatching {
                val el = JsonParser.parseString(normalized)
                if (el.isJsonObject) el.asJsonObject else null
            }.getOrNull()
        }
        private const val MAX_SEARCH_CANDIDATES = 8
        private const val MAX_PROBING_CANDIDATES = 3
        private val HEAD_FALLBACK_CODES = setOf(400, 403, 405, 501)
        private val CONTENT_RANGE_TOTAL_REGEX = Regex("""bytes\s+\d+-\d+/(\d+)""", RegexOption.IGNORE_CASE)
        private val DURATION_CLOCK_REGEX = Regex("""^(\d+):(\d{1,2})(?::(\d{1,2}))?$""")
        private val ARTIST_SPLIT_REGEX = Regex("""[\s/,&、+·;；|]+""")
        private val TRAILING_VERSION_DASH_REGEX = Regex(
            """\s+-\s+(?:live|现场|dj|remix|伴奏|翻唱|cover|片段|铃声|纯音乐|instrumental|karaoke|ktv|试听|串烧|高潮版|slowed|sped\s+up|speed\s+up|ver\.?|version|edit|mix|acoustic).*$""",
            RegexOption.IGNORE_CASE
        )
        private val SEVERE_ASCII_VERSION_MARKERS = listOf(
            "dj",
            "remix",
            "cover",
            "instrumental",
            "karaoke",
            "ktv",
            "slowed",
            "sped up",
            "speed up"
        )
        private val SEVERE_CN_VERSION_MARKERS = listOf(
            "伴奏",
            "翻唱",
            "片段",
            "铃声",
            "纯音乐",
            "试听",
            "串烧",
            "高潮版"
        )
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

        private fun isAsciiLetter(ch: Char): Boolean = ch in 'a'..'z' || ch in 'A'..'Z'

        internal fun containsAsciiWord(normalizedLower: String, wordLower: String): Boolean {
            if (normalizedLower.isEmpty() || wordLower.isEmpty()) return false
            var fromIndex = 0
            while (fromIndex <= normalizedLower.length - wordLower.length) {
                val idx = normalizedLower.indexOf(wordLower, startIndex = fromIndex)
                if (idx < 0) return false
                val beforeOk = idx == 0 || !isAsciiLetter(normalizedLower[idx - 1])
                val afterIdx = idx + wordLower.length
                val afterOk = afterIdx >= normalizedLower.length || !isAsciiLetter(normalizedLower[afterIdx])
                if (beforeOk && afterOk) return true
                fromIndex = idx + 1
            }
            return false
        }

        internal fun hasLiveMarker(normalizedLower: String): Boolean {
            return containsAsciiWord(normalizedLower, "live") || normalizedLower.contains("现场")
        }

        private fun hasSevereVersionMismatch(candNorm: String, targetNorm: String): Boolean {
            for (marker in SEVERE_ASCII_VERSION_MARKERS) {
                if (containsAsciiWord(candNorm, marker) && !containsAsciiWord(targetNorm, marker)) {
                    return true
                }
            }
            for (marker in SEVERE_CN_VERSION_MARKERS) {
                if (candNorm.contains(marker) && !targetNorm.contains(marker)) {
                    return true
                }
            }
            return false
        }

        private fun stripBracketGroups(text: String): String {
            if (text.isBlank()) return ""
            val sb = StringBuilder(text.length)
            var parenDepth = 0
            var squareDepth = 0
            var curlyDepth = 0
            for (ch in text) {
                when (ch) {
                    '(' -> parenDepth++
                    ')' -> if (parenDepth > 0) {
                        parenDepth--
                        if (parenDepth == 0 && squareDepth == 0 && curlyDepth == 0) sb.append(' ')
                    }
                    '[' -> squareDepth++
                    ']' -> if (squareDepth > 0) {
                        squareDepth--
                        if (parenDepth == 0 && squareDepth == 0 && curlyDepth == 0) sb.append(' ')
                    }
                    '{' -> curlyDepth++
                    '}' -> if (curlyDepth > 0) {
                        curlyDepth--
                        if (parenDepth == 0 && squareDepth == 0 && curlyDepth == 0) sb.append(' ')
                    }
                    else -> if (parenDepth == 0 && squareDepth == 0 && curlyDepth == 0) {
                        sb.append(ch)
                    }
                }
            }
            return sb.toString()
        }

        private fun extractWordTokens(text: String): List<String> {
            val tokens = ArrayList<String>()
            val current = StringBuilder()
            for (ch in text) {
                if (ch.isLetterOrDigit()) {
                    current.append(ch.lowercaseChar())
                } else {
                    if (current.length >= 2) {
                        tokens.add(current.toString())
                    }
                    current.setLength(0)
                }
            }
            if (current.length >= 2) {
                tokens.add(current.toString())
            }
            return tokens
        }

        internal fun normalizeTrackText(raw: String?): String {
            if (raw.isNullOrBlank()) return ""
            val decoded = raw
                .replace("&amp;", "&", ignoreCase = true)
                .replace("&apos;", "'", ignoreCase = true)
                .replace("&#39;", "'")
                .replace("&quot;", "\"", ignoreCase = true)
                .replace("&nbsp;", " ", ignoreCase = true)
            val sb = StringBuilder(decoded.length)
            for (ch in decoded) {
                val mapped = when {
                    ch in '\uFF01'..'\uFF5E' -> (ch.code - 0xFEE0).toChar()
                    ch == '\u3000' -> ' '
                    ch == '【' || ch == '「' -> '['
                    ch == '】' || ch == '」' -> ']'
                    ch == '《' || ch == '》' -> ' '
                    else -> ch
                }
                sb.append(mapped)
            }
            return sb.toString()
                .lowercase(Locale.ROOT)
                .replace(Regex("""\s+"""), " ")
                .trim()
        }

        internal fun stripBracketSuffixes(normalized: String): String {
            if (normalized.isBlank()) return ""
            val stripped = stripBracketGroups(normalized)
                .replace(TRAILING_VERSION_DASH_REGEX, "")
                .replace(Regex("""\s+"""), " ")
                .trim()
            return stripped.ifBlank { normalized }
        }

        internal fun compactTrackText(text: String): String {
            if (text.isBlank()) return ""
            val sb = StringBuilder(text.length)
            for (ch in text) {
                if (ch.isLetterOrDigit()) {
                    sb.append(ch.lowercaseChar())
                }
            }
            return sb.toString()
        }

        private fun splitArtistTokens(artists: String?): List<String> {
            val norm = normalizeTrackText(artists)
            if (norm.isBlank()) return emptyList()
            return norm.split(ARTIST_SPLIT_REGEX)
                .map { compactTrackText(stripBracketSuffixes(it)) }
                .filter { it.isNotEmpty() }
                .distinct()
        }

        internal fun parseDurationToMs(raw: String?): Long {
            val trimmed = raw?.trim().orEmpty()
            if (trimmed.isEmpty()) return 0L
            DURATION_CLOCK_REGEX.find(trimmed)?.let { m ->
                val p1 = m.groupValues[1].toLongOrNull() ?: 0L
                val p2 = m.groupValues[2].toLongOrNull() ?: 0L
                val p3Str = m.groupValues.getOrNull(3).orEmpty()
                return if (p3Str.isNotEmpty()) {
                    val p3 = p3Str.toLongOrNull() ?: 0L
                    (p1 * 3600L + p2 * 60L + p3) * 1000L
                } else {
                    (p1 * 60L + p2) * 1000L
                }
            }
            val num = trimmed.toDoubleOrNull() ?: return 0L
            return parseDurationNumberToMs(num)
        }

        internal fun parseDurationNumberToMs(value: Double): Long {
            if (!value.isFinite() || value <= 0.0) return 0L
            return if (value < 10_000.0) {
                (value * 1000.0).toLong()
            } else {
                value.toLong()
            }
        }

        internal fun scoreCandidateMatch(
            targetTitle: String,
            targetArtists: String,
            expectedDurationMs: Long,
            candidateTitle: String,
            candidateArtists: String,
            candidateDurationMs: Long = 0L
        ): Int {
            val targetRawNorm = normalizeTrackText(targetTitle)
            val candRawNorm = normalizeTrackText(candidateTitle)
            val targetCoreStr = stripBracketSuffixes(targetRawNorm)
            val candCoreStr = stripBracketSuffixes(candRawNorm)

            val targetRawCompact = compactTrackText(targetRawNorm)
            val candRawCompact = compactTrackText(candRawNorm)
            val targetCore = compactTrackText(targetCoreStr).ifEmpty { targetRawCompact }
            val candCore = compactTrackText(candCoreStr).ifEmpty { candRawCompact }

            var score = 0

            // 1. 歌名匹配（硬性防串歌闸门）
            if (targetCore.isNotEmpty()) {
                if (candCore.isEmpty()) return REJECT_CANDIDATE_SCORE
                when {
                    candCore == targetCore || (candRawCompact.isNotEmpty() && candRawCompact == targetRawCompact) -> {
                        score += 60
                        if (candRawCompact == targetRawCompact) {
                            score += 10
                        }
                    }
                    targetCore.length >= 2 && candCore.contains(targetCore) -> {
                        score += 42
                    }
                    candCore.length >= 2 && targetCore.contains(candCore) &&
                        candCore.length.toDouble() / targetCore.length.toDouble() >= 0.5 -> {
                        score += 32
                    }
                    else -> {
                        val targetTokens = extractWordTokens(targetCoreStr)
                        if (targetTokens.size >= 2 && targetTokens.all { candCore.contains(it) }) {
                            score += 30
                        } else {
                            return REJECT_CANDIDATE_SCORE
                        }
                    }
                }
            }

            // 2. 歌手匹配
            val targetArtistTokens = splitArtistTokens(targetArtists)
            val candArtistTokens = splitArtistTokens(candidateArtists)
            if (targetArtistTokens.isNotEmpty() && candArtistTokens.isNotEmpty()) {
                val matchedCount = targetArtistTokens.count { t ->
                    candArtistTokens.any { c ->
                        c == t || (minOf(c.length, t.length) >= 2 && (c.contains(t) || t.contains(c)))
                    }
                }
                score += when {
                    matchedCount == targetArtistTokens.size -> 40
                    matchedCount > 0 -> 30
                    else -> -65
                }
            }

            // 3. 版本黑名单降权/过滤（原曲本身未带对应标识时才惩罚；英文单词边界匹配，避免误伤 Alive/Discover 等词）
            if (hasLiveMarker(candRawNorm) && !hasLiveMarker(targetRawNorm)) {
                score -= 45
            }
            if (hasSevereVersionMismatch(candRawNorm, targetRawNorm)) {
                score -= 105
            }

            // 4. 时长一致性校验
            if (expectedDurationMs > SHORT_TRACK_DURATION_THRESHOLD_MS && candidateDurationMs > 0L) {
                val diffMs = abs(candidateDurationMs - expectedDurationMs)
                val ratio = diffMs.toDouble() / expectedDurationMs.toDouble()
                score += when {
                    diffMs <= 15_000L -> 25
                    ratio <= 0.20 -> 10
                    ratio <= 0.35 -> -15
                    else -> -85
                }
            }

            return score
        }

        internal fun <T> rankCandidates(
            items: List<T>,
            targetTitle: String,
            targetArtists: String,
            expectedDurationMs: Long,
            extractor: (T) -> TrackCandidate
        ): List<ScoredCandidate<T>> {
            return items.mapIndexedNotNull { idx, item ->
                val info = extractor(item)
                val score = scoreCandidateMatch(
                    targetTitle = targetTitle,
                    targetArtists = targetArtists,
                    expectedDurationMs = expectedDurationMs,
                    candidateTitle = info.title,
                    candidateArtists = info.artists,
                    candidateDurationMs = info.durationMs
                )
                if (score >= MIN_CANDIDATE_PASS_SCORE) ScoredCandidate(item, score, idx) else null
            }.sortedWith(compareByDescending<ScoredCandidate<T>> { it.score }.thenBy { it.index })
        }
    }

    internal data class TrackCandidate(
        val title: String,
        val artists: String,
        val durationMs: Long = 0L
    )

    internal data class ScoredCandidate<T>(
        val item: T,
        val score: Int,
        val index: Int
    )

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
                "kuwo" -> if (keyword.isNotBlank()) runCatching { searchKuwo(keyword, songName, artists, expectedDurationMs) }.getOrNull() else null
                "kugou" -> if (keyword.isNotBlank()) runCatching { searchKugou(keyword, songName, artists, expectedDurationMs) }.getOrNull() else null
                "migu" -> if (keyword.isNotBlank()) runCatching { searchMigu(keyword, songName, artists, expectedDurationMs) }.getOrNull() else null
                "gdmusic", "qq", "joox" -> if (keyword.isNotBlank()) runCatching { searchGdMusic(keyword, songId, songName, artists, expectedDurationMs) }.getOrNull() else null
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
            val fallback = runCatching { searchGdMusic(keyword, songId, songName, artists, expectedDurationMs) }.getOrNull()
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

    private fun parseDurationFromJson(obj: JsonObject, vararg keys: String): Long {
        for (k in keys) {
            val el = obj.get(k)?.takeIf { !it.isJsonNull } ?: continue
            if (el.isJsonPrimitive) {
                val prim = el.asJsonPrimitive
                val ms = when {
                    prim.isNumber -> parseDurationNumberToMs(prim.asDouble)
                    prim.isString -> parseDurationToMs(prim.asString)
                    else -> 0L
                }
                if (ms > 0L) return ms
            }
        }
        return 0L
    }

    private fun extractGdArtistNames(item: JsonObject): String {
        val raw = item.get("artist")?.takeIf { !it.isJsonNull } ?: return ""
        return when {
            raw.isJsonArray -> raw.asJsonArray.mapNotNull { el ->
                el.takeIf { !it.isJsonNull }?.let {
                    if (it.isJsonObject) it.asJsonObject.get("name")?.takeIf { n -> !n.isJsonNull }?.asString
                    else it.asString
                }
            }.joinToString(" ")
            raw.isJsonPrimitive -> raw.asString
            else -> ""
        }
    }

    private fun searchKuwo(
        keyword: String,
        songName: String,
        artists: String,
        expectedDurationMs: Long = 0L
    ): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://search.kuwo.cn/r.s?all=$q&ft=music&rformat=json&encoding=utf8&pcjson=1&vipver=1&pn=0&rn=$MAX_SEARCH_CANDIDATES"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = parseKuwoSearchJson(body) ?: return null
        val list = root.getAsJsonArray("abslist") ?: return null
        if (list.size() == 0) return null

        val rawItems = (0 until minOf(MAX_SEARCH_CANDIDATES, list.size())).mapNotNull { idx ->
            runCatching { list[idx].asJsonObject }.getOrNull()
        }
        val ranked = rankCandidates(rawItems, songName, artists, expectedDurationMs) { obj ->
            val title = obj.get("SONGNAME")?.takeIf { !it.isJsonNull }?.asString
                ?: obj.get("NAME")?.takeIf { !it.isJsonNull }?.asString
                ?: ""
            val artistStr = obj.get("ARTIST")?.takeIf { !it.isJsonNull }?.asString ?: ""
            val durMs = parseDurationFromJson(obj, "DURATION", "duration")
            TrackCandidate(title = title, artists = artistStr, durationMs = durMs)
        }

        for (candidate in ranked.take(MAX_PROBING_CANDIDATES)) {
            val obj = candidate.item
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

    private fun searchKugou(
        keyword: String,
        songName: String,
        artists: String,
        expectedDurationMs: Long = 0L
    ): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=$q&page=1&pagesize=$MAX_SEARCH_CANDIDATES&showtype=1"
        val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: return null
        val root = runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return null
        val info = root.getAsJsonObject("data")?.getAsJsonArray("info") ?: return null
        val rawItems = (0 until minOf(MAX_SEARCH_CANDIDATES, info.size())).mapNotNull { idx ->
            runCatching { info[idx].asJsonObject }.getOrNull()
        }
        val ranked = rankCandidates(rawItems, songName, artists, expectedDurationMs) { obj ->
            val title = obj.get("songname_original")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("songname")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("filename")?.takeIf { !it.isJsonNull }?.asString
                ?: ""
            val artistStr = obj.get("singername")?.takeIf { !it.isJsonNull }?.asString ?: ""
            val durMs = parseDurationFromJson(obj, "duration", "timelength")
            TrackCandidate(title = title, artists = artistStr, durationMs = durMs)
        }

        for (candidate in ranked.take(MAX_PROBING_CANDIDATES)) {
            val obj = candidate.item
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

    private fun searchMigu(
        keyword: String,
        songName: String,
        artists: String,
        expectedDurationMs: Long = 0L
    ): UnblockResult? {
        val q = enc(keyword)
        val searchUrl =
            "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=$q&pageNo=1&pageSize=$MAX_SEARCH_CANDIDATES&searchSwitch=%7B%22song%22%3A1%7D"
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
        val rawItems = (0 until minOf(MAX_SEARCH_CANDIDATES, resultList.size())).mapNotNull { idx ->
            runCatching { resultList[idx].asJsonObject }.getOrNull()
        }
        val ranked = rankCandidates(rawItems, songName, artists, expectedDurationMs) { obj ->
            val title = obj.get("name")?.takeIf { !it.isJsonNull }?.asString
                ?: obj.get("songName")?.takeIf { !it.isJsonNull }?.asString
                ?: ""
            val singersArr = obj.getAsJsonArray("singers")
            val artistStr = singersArr?.mapNotNull { s ->
                s.takeIf { it.isJsonObject }?.asJsonObject?.get("name")?.takeIf { !it.isJsonNull }?.asString
            }?.joinToString(" ")?.takeIf { it.isNotBlank() }
                ?: obj.get("singer")?.takeIf { !it.isJsonNull }?.asString
                ?: ""
            val durMs = parseDurationFromJson(obj, "duration", "length", "songTime")
            TrackCandidate(title = title, artists = artistStr, durationMs = durMs)
        }

        for (candidate in ranked.take(MAX_PROBING_CANDIDATES)) {
            val obj = candidate.item
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

    private fun searchGdMusic(
        keyword: String,
        songId: String,
        songName: String,
        artists: String,
        expectedDurationMs: Long = 0L
    ): UnblockResult? {
        val sources = listOf("joox", "netease", "kugou", "tidal", "kuwo")
        val baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for (source in sources) {
            val searchUrl = "$baseUrl?types=search&source=$source&name=${enc(keyword)}&count=$MAX_SEARCH_CANDIDATES&pages=1"
            val body = httpGetText(searchUrl, mapOf("User-Agent" to DEFAULT_UA)) ?: continue
            val arr = runCatching { JsonParser.parseString(body).asJsonArray }.getOrNull() ?: continue
            if (arr.size() == 0) continue
            val rawItems = (0 until minOf(MAX_SEARCH_CANDIDATES, arr.size())).mapNotNull { idx ->
                runCatching { arr[idx].asJsonObject }.getOrNull()
            }
            val ranked = rankCandidates(rawItems, songName, artists, expectedDurationMs) { item ->
                val title = item.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""
                val artistStr = extractGdArtistNames(item)
                val durMs = parseDurationFromJson(item, "duration", "dt", "time")
                TrackCandidate(title = title, artists = artistStr, durationMs = durMs)
            }
            for (candidate in ranked.take(MAX_PROBING_CANDIDATES)) {
                val item = candidate.item
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
                readBoundedResponseText(resp, MAX_UNBLOCK_TEXT_BYTES, throwOnOverflow = true)
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
        val safeTimeoutMs = clampProxyTimeoutMs(timeoutMs)
        val customClient = client.newBuilder()
            .connectTimeout(safeTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(safeTimeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(safeTimeoutMs, TimeUnit.MILLISECONDS)
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
            val rawText = readBoundedResponseText(resp, MAX_PROXY_RESPONSE_BYTES, throwOnOverflow = true)
            val respHeaders = serializeResponseHeaders(resp.headers)

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
