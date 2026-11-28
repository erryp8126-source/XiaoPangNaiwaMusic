package com.xiaopang.naiwamusic.server

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 外部歌单分享链接安全解析代理（汽水音乐 / QQ 音乐 / 酷狗 / 酷我 / 网易云）
 * 安全边界：
 * - 强制域名白名单 `SafeHttpGuard.EXTERNAL_PLAYLIST_ALLOWED_DOMAINS` + 公网 DNS + 最多 4 跳重定向校验
 * - 单次响应体强制上限 2MB，仅提取公开歌单名称与 {title, artist} 并执行纯文本转义防 XSS
 */
class ExternalPlaylistParser(
    private val ncmClient: NeteaseApiClient? = null
) {
    data class ParsedTrack(
        val title: String,
        val artist: String,
        val album: String = "",
        val durationMs: Long = 0L,
        val neteaseId: Long = 0L
    )

    data class ExtractedResult(
        val playlistName: String,
        val tracks: List<ParsedTrack>
    )

    companion object {
        private const val BROWSER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        private const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
        private const val MAX_TRACKS = 300
        private const val MAX_REDIRECTS = 4
        private const val FALLBACK_TO_TEXT_MESSAGE =
            "该链接暂无法自动读取，可复制歌单文字使用「文本导入」"

        private val SHARE_URL_REGEX = Regex("""https?://[^\s"'<>]+""", RegexOption.IGNORE_CASE)
        private val TRAILING_PUNCT_REGEX = Regex("""[】》）」』”’，。！？、；：.,!?;:'")\]]+$""")
        private val SCRIPT_BLOCK_REGEX = Regex("""<script\b[^>]*>[\s\S]*?</script>""", RegexOption.IGNORE_CASE)
        private val STYLE_BLOCK_REGEX = Regex("""<style\b[^>]*>[\s\S]*?</style>""", RegexOption.IGNORE_CASE)
        private val HTML_TAG_REGEX = Regex("""<[^>]*>""")
        private val NUMERIC_ENTITY_REGEX = Regex("""&#(\d{1,6});""")
        private val HEX_ENTITY_REGEX = Regex("""&#x([0-9a-fA-F]{1,6});""")
        private val CONTROL_CHARS_REGEX = Regex("""[\u0000-\u001f\u007f\u200b-\u200f\ufeff]""")
        private val MULTISPACE_REGEX = Regex("""\s+""")

        private val OG_TITLE_1 = Regex(
            """<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,160})["']""",
            RegexOption.IGNORE_CASE
        )
        private val OG_TITLE_2 = Regex(
            """<meta[^>]+content=["']([^"']{1,160})["'][^>]+property=["']og:title["']""",
            RegexOption.IGNORE_CASE
        )
        private val HTML_TITLE_REGEX = Regex("""<title[^>]*>([^<]{1,160})</title>""", RegexOption.IGNORE_CASE)
        private val FILENAME_JSON_REGEX = Regex(""""filename"\s*:\s*"([^"]{2,160})"""")
        private val STATE_ASSIGN_REGEX = Regex(
            """(?:window\.__INITIAL_STATE__|window\._ROUTER_DATA|window\.__DATA__|dataFromSmarty)\s*="""
        )

        private fun extractAssignedJsonObjects(html: String): List<String> {
            val results = ArrayList<String>()
            for (match in STATE_ASSIGN_REGEX.findAll(html)) {
                var i = match.range.last + 1
                while (i < html.length && html[i].isWhitespace()) i++
                if (i >= html.length || html[i] != '{') continue
                val start = i
                var depth = 0
                var inStr = false
                var escaped = false
                val maxEnd = minOf(html.length, start + 250_000)
                while (i < maxEnd) {
                    val ch = html[i]
                    if (inStr) {
                        if (escaped) {
                            escaped = false
                        } else if (ch == '\\') {
                            escaped = true
                        } else if (ch == '"') {
                            inStr = false
                        }
                    } else {
                        if (ch == '"') {
                            inStr = true
                        } else if (ch == '{') {
                            depth++
                        } else if (ch == '}') {
                            depth--
                            if (depth == 0) {
                                results.add(html.substring(start, i + 1))
                                break
                            }
                        }
                    }
                    i++
                }
            }
            return results
        }

        internal fun extractCandidateUrl(rawInput: String): String {
            val trimmed = rawInput.trim()
            if (trimmed.isEmpty()) return ""
            val m = SHARE_URL_REGEX.find(trimmed)
            val raw = m?.value ?: trimmed
            return raw.replace(TRAILING_PUNCT_REGEX, "")
        }

        internal fun isAllowedUrl(rawUrl: String): URI? {
            return SafeHttpGuard.validateUrlSyntax(rawUrl, SafeHttpGuard.EXTERNAL_PLAYLIST_ALLOWED_DOMAINS)
        }

        internal fun detectPlatform(host: String): String {
            val h = host.lowercase()
            return when {
                h.contains("douyin.com") -> "qishui"
                h == "y.qq.com" || h.endsWith(".y.qq.com") -> "qq"
                h == "kugou.com" || h.endsWith(".kugou.com") -> "kugou"
                h == "kuwo.cn" || h.endsWith(".kuwo.cn") -> "kuwo"
                h == "163cn.tv" || h == "music.163.com" || h.endsWith(".music.163.com") -> "netease"
                else -> "unknown"
            }
        }

        internal fun sanitizePlainText(raw: String?, maxLen: Int = 160): String {
            if (raw.isNullOrBlank()) return ""
            var s = SCRIPT_BLOCK_REGEX.replace(raw, " ")
            s = STYLE_BLOCK_REGEX.replace(s, " ")
            s = HTML_TAG_REGEX.replace(s, " ")
            s = decodeEntities(s)
            s = HTML_TAG_REGEX.replace(s, " ")
            s = CONTROL_CHARS_REGEX.replace(s, " ")
            s = MULTISPACE_REGEX.replace(s, " ").trim()
            if (maxLen > 0 && s.length > maxLen) {
                s = s.substring(0, maxLen).trim()
            }
            return s
        }

        private fun decodeEntities(input: String): String {
            var s = input
                .replace("&amp;", "&", ignoreCase = true)
                .replace("&lt;", "<", ignoreCase = true)
                .replace("&gt;", ">", ignoreCase = true)
                .replace("&quot;", "\"", ignoreCase = true)
                .replace("&apos;", "'", ignoreCase = true)
                .replace("&#39;", "'")
                .replace("&nbsp;", " ", ignoreCase = true)
            s = NUMERIC_ENTITY_REGEX.replace(s) { m ->
                val code = m.groupValues[1].toIntOrNull() ?: -1
                if (code in 1..0xFFFF) code.toChar().toString() else ""
            }
            s = HEX_ENTITY_REGEX.replace(s) { m ->
                val code = m.groupValues[1].toIntOrNull(16) ?: -1
                if (code in 1..0xFFFF) code.toChar().toString() else ""
            }
            return s
        }

        internal fun dedupeTracks(tracks: List<ParsedTrack>): List<ParsedTrack> {
            val seen = HashSet<String>()
            val out = ArrayList<ParsedTrack>()
            for (t in tracks) {
                val cleanTitle = sanitizePlainText(t.title, 120)
                val cleanArtist = sanitizePlainText(t.artist, 80)
                if (cleanTitle.isEmpty()) continue
                val key = "${cleanTitle.lowercase()}::${cleanArtist.lowercase()}"
                if (!seen.add(key)) continue
                out.add(
                    ParsedTrack(
                        title = cleanTitle,
                        artist = cleanArtist,
                        album = sanitizePlainText(t.album, 100),
                        durationMs = t.durationMs.coerceAtLeast(0L),
                        neteaseId = t.neteaseId.coerceAtLeast(0L)
                    )
                )
                if (out.size >= MAX_TRACKS) break
            }
            return out
        }

        internal fun extractTitleFromHtml(html: String): String {
            val raw = OG_TITLE_1.find(html)?.groupValues?.getOrNull(1)
                ?: OG_TITLE_2.find(html)?.groupValues?.getOrNull(1)
                ?: HTML_TITLE_REGEX.find(html)?.groupValues?.getOrNull(1)
                ?: return ""
            val stripped = raw.replace(
                Regex("""[-_|\s]*(?:QQ音乐|酷狗音乐|酷我音乐|网易云音乐|汽水音乐).*$""", RegexOption.IGNORE_CASE),
                ""
            )
            return sanitizePlainText(stripped, 80)
        }

        internal fun extractTracksFromHtmlJson(html: String): ExtractedResult {
            var playlistName = extractTitleFromHtml(html)
            val tracks = ArrayList<ParsedTrack>()

            for (m in FILENAME_JSON_REGEX.findAll(html)) {
                if (tracks.size >= MAX_TRACKS) break
                val raw = sanitizePlainText(m.groupValues[1], 140)
                val dashIdx = raw.indexOf(" - ")
                if (dashIdx > 0) {
                    tracks.add(
                        ParsedTrack(
                            title = raw.substring(dashIdx + 3).trim(),
                            artist = raw.substring(0, dashIdx).trim()
                        )
                    )
                } else if (raw.isNotEmpty()) {
                    tracks.add(ParsedTrack(title = raw, artist = ""))
                }
            }

            for (jsonBlock in extractAssignedJsonObjects(html)) {
                runCatching {
                    val root = JsonParser.parseString(jsonBlock)
                    val stack = ArrayDeque<JsonElement>()
                    stack.addLast(root)
                    var visited = 0
                    while (stack.isNotEmpty() && visited < 4000) {
                        visited++
                        val node = stack.removeLast()
                        if (node.isJsonArray) {
                            val arr = node.asJsonArray
                            for (idx in arr.size() - 1 downTo 0) {
                                val el = arr[idx]
                                if (el.isJsonObject || el.isJsonArray) stack.addLast(el)
                            }
                            continue
                        }
                        if (!node.isJsonObject) continue
                        val obj = node.asJsonObject
                        val candTitle = strOrNull(obj, "songname")
                            ?: strOrNull(obj, "songName")
                            ?: strOrNull(obj, "track_name")
                            ?: run {
                                val hasArtist = obj.has("singer") || obj.has("artists") || obj.has("artist") || obj.has("author")
                                if (hasArtist) strOrNull(obj, "name") ?: strOrNull(obj, "title") else null
                            }
                        if (!candTitle.isNullOrBlank()) {
                            val artist = extractArtistField(obj)
                            tracks.add(ParsedTrack(title = candTitle, artist = artist))
                        }
                        if (playlistName.isEmpty()) {
                            val candPl = strOrNull(obj, "dissname")
                                ?: strOrNull(obj, "specialname")
                                ?: strOrNull(obj, "playlist_name")
                            if (!candPl.isNullOrBlank()) {
                                playlistName = sanitizePlainText(candPl, 80)
                            }
                        }
                        val childValues = obj.entrySet().map { it.value }.filter { it.isJsonObject || it.isJsonArray }
                        for (idx in childValues.size - 1 downTo 0) {
                            stack.addLast(childValues[idx])
                        }
                    }
                }
            }

            return ExtractedResult(playlistName = playlistName, tracks = dedupeTracks(tracks))
        }

        private fun strOrNull(obj: JsonObject, key: String): String? {
            val el = obj.get(key) ?: return null
            if (!el.isJsonPrimitive) return null
            val p = el.asJsonPrimitive
            return if (p.isString) p.asString else null
        }

        private fun extractArtistField(obj: JsonObject): String {
            for (key in listOf("singer", "artists", "artist_list", "artist", "author")) {
                val el = obj.get(key) ?: continue
                if (el.isJsonPrimitive && el.asJsonPrimitive.isString) {
                    return el.asString
                }
                if (el.isJsonArray) {
                    val names = el.asJsonArray.mapNotNull { item ->
                        when {
                            item.isJsonPrimitive && item.asJsonPrimitive.isString -> item.asString
                            item.isJsonObject -> strOrNull(item.asJsonObject, "name")
                                ?: strOrNull(item.asJsonObject, "singer_name")
                            else -> null
                        }
                    }.filter { it.isNotBlank() }
                    if (names.isNotEmpty()) return names.joinToString(" / ")
                }
                if (el.isJsonObject) {
                    val n = strOrNull(el.asJsonObject, "name") ?: strOrNull(el.asJsonObject, "singer_name")
                    if (!n.isNullOrBlank()) return n
                }
            }
            return ""
        }
    }

    private val gson = Gson()
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(12, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.EXTERNAL_PLAYLIST_ALLOWED_DOMAINS))
            .build()
    }

    fun handle(params: Map<String, String>): Pair<Int, String> {
        val rawInput = params["url"]?.trim().orEmpty()
        if (rawInput.isEmpty()) {
            return 400 to gson.toJson(mapOf("code" to 400, "ok" to false, "message" to "请输入外部歌单分享链接"))
        }

        val candidateUrl = extractCandidateUrl(rawInput)
        val syntaxUri = isAllowedUrl(candidateUrl)
            ?: return 403 to gson.toJson(
                mapOf(
                    "code" to 403,
                    "ok" to false,
                    "blocked" to true,
                    "message" to "暂不支持该链接域名，请使用汽水 / QQ / 酷狗 / 酷我 / 网易云分享链接或切换至「文本导入」"
                )
            )

        var platform = detectPlatform(syntaxUri.host ?: "")

        return try {
            val (finalUrl, initialHtml) = fetchBoundedText(candidateUrl, emptyMap())
            val finalHost = runCatching { URI(finalUrl).host.orEmpty() }.getOrDefault(syntaxUri.host.orEmpty())
            platform = detectPlatform(finalHost)

            var playlistName = ""
            val rawTracks = ArrayList<ParsedTrack>()

            when (platform) {
                "netease" -> {
                    val id = Regex("""[?&]id=(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex("""/playlist/(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex("""/playlist\?[^"'\s]*id=(\d{4,16})""").find(initialHtml)?.groupValues?.getOrNull(1)
                    val ncm = ncmClient
                    if (!id.isNullOrEmpty() && ncm != null) {
                        val detailRes = ncm.dispatch("/playlist/detail", mapOf("id" to id))
                        runCatching {
                            val root = JsonParser.parseString(detailRes.body).asJsonObject
                            val pl = root.getAsJsonObject("playlist")
                            if (pl != null) {
                                playlistName = sanitizePlainText(strOrNull(pl, "name"), 80)
                                val seenIds = HashSet<Long>()
                                pl.getAsJsonArray("tracks")?.forEach { el ->
                                    if (rawTracks.size < MAX_TRACKS && el.isJsonObject) {
                                        val t = el.asJsonObject
                                        val tid = t.get("id")?.asLong ?: 0L
                                        val name = strOrNull(t, "name").orEmpty()
                                        val artist = t.getAsJsonArray("ar")?.mapNotNull { a ->
                                            if (a.isJsonObject) strOrNull(a.asJsonObject, "name") else null
                                        }?.joinToString(" / ").orEmpty()
                                        val album = t.getAsJsonObject("al")?.let { strOrNull(it, "name") }.orEmpty()
                                        val dt = t.get("dt")?.asLong ?: 0L
                                        if (tid > 0L) seenIds.add(tid)
                                        rawTracks.add(ParsedTrack(name, artist, album, dt, tid))
                                    }
                                }
                                val missingIds = pl.getAsJsonArray("trackIds")?.mapNotNull { el ->
                                    if (el.isJsonObject) el.asJsonObject.get("id")?.asLong else null
                                }?.filter { it > 0L && it !in seenIds }
                                    ?.take((MAX_TRACKS - rawTracks.size).coerceAtLeast(0))
                                    .orEmpty()
                                if (missingIds.isNotEmpty()) {
                                    val songsRes = ncm.dispatch(
                                        "/song/detail",
                                        mapOf("ids" to missingIds.joinToString(","))
                                    )
                                    val songsArr = JsonParser.parseString(songsRes.body).asJsonObject
                                        .getAsJsonArray("songs")
                                    songsArr?.forEach { el ->
                                        if (el.isJsonObject) {
                                            val s = el.asJsonObject
                                            val tid = s.get("id")?.asLong ?: 0L
                                            val name = strOrNull(s, "name").orEmpty()
                                            val artist = s.getAsJsonArray("ar")?.mapNotNull { a ->
                                                if (a.isJsonObject) strOrNull(a.asJsonObject, "name") else null
                                            }?.joinToString(" / ").orEmpty()
                                            val album = s.getAsJsonObject("al")?.let { strOrNull(it, "name") }.orEmpty()
                                            val dt = s.get("dt")?.asLong ?: 0L
                                            rawTracks.add(ParsedTrack(name, artist, album, dt, tid))
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (playlistName.isEmpty()) playlistName = extractTitleFromHtml(initialHtml)
                }

                "qq" -> {
                    val disstid = Regex("""[?&](?:id|disstid)=(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex("""/playlist/(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex(""""disstid"\s*:\s*"?(\d{4,16})"?""").find(initialHtml)?.groupValues?.getOrNull(1)
                    if (!disstid.isNullOrEmpty()) {
                        runCatching {
                            val apiUrl =
                                "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${
                                    enc(disstid)
                                }&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0"
                            val (_, apiText) = fetchBoundedText(apiUrl, mapOf("Referer" to "https://y.qq.com/"))
                            val jsonStart = apiText.indexOf('{')
                            val jsonEnd = apiText.lastIndexOf('}')
                            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                                val root = JsonParser.parseString(apiText.substring(jsonStart, jsonEnd + 1)).asJsonObject
                                val cd = root.getAsJsonArray("cdlist")?.firstOrNull()?.asJsonObject
                                if (cd != null) {
                                    playlistName = sanitizePlainText(strOrNull(cd, "dissname"), 80)
                                    cd.getAsJsonArray("songlist")?.forEach { el ->
                                        if (rawTracks.size < MAX_TRACKS && el.isJsonObject) {
                                            val s = el.asJsonObject
                                            val name = strOrNull(s, "name") ?: strOrNull(s, "songname") ?: ""
                                            val artist = s.getAsJsonArray("singer")?.mapNotNull { a ->
                                                if (a.isJsonObject) strOrNull(a.asJsonObject, "name") else null
                                            }?.joinToString(" / ").orEmpty()
                                            val album = s.getAsJsonObject("album")?.let { strOrNull(it, "name") }
                                                ?: strOrNull(s, "albumname")
                                                ?: ""
                                            val dt = (s.get("interval")?.asLong ?: 0L) * 1000L
                                            rawTracks.add(ParsedTrack(name, artist, album, dt))
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (rawTracks.isEmpty()) {
                        val embedded = extractTracksFromHtmlJson(initialHtml)
                        if (playlistName.isEmpty()) playlistName = embedded.playlistName
                        rawTracks.addAll(embedded.tracks)
                    }
                }

                "kuwo" -> {
                    val pid = Regex("""playlist_detail/(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex("""[?&](?:pid|id)=(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex(""""id"\s*:\s*"?(\d{4,16})"?""").find(initialHtml)?.groupValues?.getOrNull(1)
                    if (!pid.isNullOrEmpty()) {
                        runCatching {
                            val apiUrl =
                                "https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${enc(pid)}&pn=0&rn=300&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.1.1.2_BCS2"
                            val (_, apiText) = fetchBoundedText(apiUrl, mapOf("Referer" to "https://kuwo.cn/"))
                            val root = JsonParser.parseString(apiText).asJsonObject
                            playlistName = sanitizePlainText(strOrNull(root, "title"), 80)
                            root.getAsJsonArray("musiclist")?.forEach { el ->
                                if (rawTracks.size < MAX_TRACKS && el.isJsonObject) {
                                    val m = el.asJsonObject
                                    rawTracks.add(
                                        ParsedTrack(
                                            title = strOrNull(m, "name").orEmpty(),
                                            artist = strOrNull(m, "artist").orEmpty(),
                                            album = strOrNull(m, "album").orEmpty(),
                                            durationMs = (m.get("duration")?.asLong ?: 0L) * 1000L
                                        )
                                    )
                                }
                            }
                        }
                    }
                    if (rawTracks.isEmpty()) {
                        val embedded = extractTracksFromHtmlJson(initialHtml)
                        if (playlistName.isEmpty()) playlistName = embedded.playlistName
                        rawTracks.addAll(embedded.tracks)
                    }
                }

                else -> {
                    val specialId = Regex("""[?&]specialid=(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                        ?: Regex("""special/single/(\d{4,16})""").find(finalUrl)?.groupValues?.getOrNull(1)
                    if (platform == "kugou" && !specialId.isNullOrEmpty()) {
                        runCatching {
                            val apiUrl = "https://m.kugou.com/plist/list/${enc(specialId)}?json=true"
                            val (_, apiText) = fetchBoundedText(apiUrl, mapOf("Referer" to "https://m.kugou.com/"))
                            val root = JsonParser.parseString(apiText).asJsonObject
                            val listMeta = root.getAsJsonObject("info")?.getAsJsonObject("list")
                            if (listMeta != null) {
                                playlistName = sanitizePlainText(strOrNull(listMeta, "specialname"), 80)
                            }
                            val items = root.getAsJsonObject("list")
                                ?.getAsJsonObject("list")
                                ?.getAsJsonArray("info")
                            items?.forEach { el ->
                                if (rawTracks.size < MAX_TRACKS && el.isJsonObject) {
                                    val item = el.asJsonObject
                                    val filename = strOrNull(item, "filename").orEmpty()
                                    val dt = (item.get("duration")?.asLong ?: 0L) * 1000L
                                    val dashIdx = filename.indexOf(" - ")
                                    if (dashIdx > 0) {
                                        rawTracks.add(
                                            ParsedTrack(
                                                title = filename.substring(dashIdx + 3).trim(),
                                                artist = filename.substring(0, dashIdx).trim(),
                                                durationMs = dt
                                            )
                                        )
                                    } else if (filename.isNotEmpty()) {
                                        rawTracks.add(ParsedTrack(title = filename, artist = "", durationMs = dt))
                                    }
                                }
                            }
                        }
                    }
                    if (rawTracks.isEmpty()) {
                        val embedded = extractTracksFromHtmlJson(initialHtml)
                        if (playlistName.isEmpty()) playlistName = embedded.playlistName
                        rawTracks.addAll(embedded.tracks)
                    }
                }
            }

            val cleanTracks = dedupeTracks(rawTracks)
            if (cleanTracks.isEmpty()) {
                return 200 to gson.toJson(
                    mapOf(
                        "code" to 200,
                        "ok" to false,
                        "fallbackToText" to true,
                        "platform" to platform,
                        "playlistName" to playlistName,
                        "message" to FALLBACK_TO_TEXT_MESSAGE
                    )
                )
            }

            val trackMaps = cleanTracks.map { t ->
                val m = LinkedHashMap<String, Any>()
                m["title"] = t.title
                m["artist"] = t.artist
                if (t.album.isNotEmpty()) m["album"] = t.album
                if (t.durationMs > 0L) m["durationMs"] = t.durationMs
                if (t.neteaseId > 0L) m["neteaseId"] = t.neteaseId
                m
            }
            200 to gson.toJson(
                mapOf(
                    "code" to 200,
                    "ok" to true,
                    "platform" to platform,
                    "playlistName" to (playlistName.ifEmpty { "导入外部歌单" }),
                    "tracks" to trackMaps
                )
            )
        } catch (e: SecurityException) {
            403 to gson.toJson(
                mapOf(
                    "code" to 403,
                    "ok" to false,
                    "blocked" to true,
                    "message" to "暂不支持重定向到该域名或内网地址，请切换至「文本导入」"
                )
            )
        } catch (e: Exception) {
            200 to gson.toJson(
                mapOf(
                    "code" to 200,
                    "ok" to false,
                    "fallbackToText" to true,
                    "platform" to platform,
                    "message" to FALLBACK_TO_TEXT_MESSAGE
                )
            )
        }
    }

    private fun fetchBoundedText(url: String, extraHeaders: Map<String, String>): Pair<String, String> {
        val req = Request.Builder().url(url).get().apply {
            header("User-Agent", BROWSER_UA)
            header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            extraHeaders.forEach { (k, v) -> header(k, v) }
        }.build()

        SafeHttpGuard.executeWithSafeRedirects(
            client,
            req,
            SafeHttpGuard.EXTERNAL_PLAYLIST_ALLOWED_DOMAINS,
            MAX_REDIRECTS
        ).use { resp ->
            val finalUrl = resp.request.url.toString()
            val text = readBoundedBody(resp)
            return finalUrl to text
        }
    }

    private fun readBoundedBody(resp: Response): String {
        val stream = resp.body?.byteStream() ?: return ""
        return stream.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var remaining = MAX_RESPONSE_BYTES
            while (remaining > 0) {
                val read = input.read(buf, 0, minOf(buf.size, remaining))
                if (read <= 0) break
                out.write(buf, 0, read)
                remaining -= read
            }
            out.toString(Charsets.UTF_8.name())
        }
    }

    private fun enc(raw: String): String = URLEncoder.encode(raw, "UTF-8")
}
