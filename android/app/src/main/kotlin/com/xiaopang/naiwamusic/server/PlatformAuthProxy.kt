package com.xiaopang.naiwamusic.server

import android.util.Base64
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 第三方平台（B 站 / QQ 音乐）安全绑定与资源读取代理
 * - 所有外发请求强制受 SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS 白名单与公网 DNS 约束
 * - 绝不在日志或响应错误中回显敏感 Cookie / qrsig / p_skey
 */
class PlatformAuthProxy {
    companion object {
        private const val BROWSER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        private const val BILIBILI_REFERER = "https://www.bilibili.com/"
        private const val QQ_REFERER = "https://y.qq.com/"
        private const val QQ_PTLOGIN_REFERER = "https://xui.ptlogin2.qq.com/"
        private const val MAX_QQ_SIG_HOPS = 5

        private val BILIBILI_KEYS = listOf("SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5")
        private val QQ_COOKIE_KEYS = listOf(
            "uin",
            "p_uin",
            "qm_keyst",
            "qqmusic_key",
            "p_skey",
            "skey",
            "pt4_token",
            "tmeLoginType",
            "euin"
        )
        private val QQ_AUTH_KEYS = setOf("qm_keyst", "qqmusic_key", "p_skey", "skey", "pt4_token")
        private val PTUICB_REGEX = Regex("""ptuiCB\(([^)]*)\)""")
        private val SINGLE_QUOTED_ARG_REGEX = Regex("""'((?:\\.|[^'\\])*)'""")

        data class QqPtuiResult(
            val status: String,
            val code: String,
            val redirectUrl: String,
            val nickname: String,
            val message: String
        )

        internal fun computeQqPtqrToken(qrsig: String): Int {
            var e = 0
            for (ch in qrsig) {
                e += (e shl 5) + ch.code
            }
            return e and 2147483647
        }

        internal fun parseQqPtuiCB(rawText: String): QqPtuiResult {
            val m = PTUICB_REGEX.find(rawText) ?: return QqPtuiResult(
                status = "risk_control",
                code = "invalid",
                redirectUrl = "",
                nickname = "",
                message = "QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 QQ 音乐 Cookie」完成绑定"
            )
            val args = SINGLE_QUOTED_ARG_REGEX.findAll(m.groupValues[1])
                .map { it.groupValues[1].replace("\\'", "'") }
                .toList()
            val code = args.getOrNull(0)?.trim().orEmpty()
            val redirectUrl = args.getOrNull(2)?.trim().orEmpty()
            val msg = args.getOrNull(4)?.trim().orEmpty()
            val nickname = args.getOrNull(5)?.trim().orEmpty()

            return when (code) {
                "66" -> QqPtuiResult("waiting", code, "", "", "等待使用手机 QQ 扫码")
                "67" -> QqPtuiResult("scanned", code, "", nickname, "已扫码，请在手机 QQ 上确认授权")
                "65" -> QqPtuiResult("expired", code, "", "", "二维码已失效，请点击刷新")
                "68" -> QqPtuiResult("rejected", code, "", "", "您已在手机 QQ 中取消授权")
                "0" -> QqPtuiResult("confirmed", code, redirectUrl, nickname, "QQ 扫码成功，正在完成凭据授权")
                else -> QqPtuiResult(
                    status = "risk_control",
                    code = code.ifEmpty { "unknown" },
                    redirectUrl = "",
                    nickname = "",
                    message = if (msg.isNotEmpty()) {
                        "QQ 登录暂受风控限制（$msg），建议使用下方「手动粘贴 Cookie」完成绑定"
                    } else {
                        "QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 Cookie」完成绑定"
                    }
                )
            }
        }

        internal fun extractBilibiliCookieMap(
            setCookies: List<String>,
            redirectUrl: String?
        ): Map<String, String> {
            val jar = LinkedHashMap<String, String>()
            parseSetCookiesInto(setCookies, jar)
            if (!redirectUrl.isNullOrBlank()) {
                val qIdx = redirectUrl.indexOf('?')
                if (qIdx >= 0) {
                    val query = redirectUrl.substring(qIdx + 1).substringBefore('#')
                    for (pair in query.split('&')) {
                        val eq = pair.indexOf('=')
                        if (eq <= 0) continue
                        val k = runCatching { URLDecoder.decode(pair.substring(0, eq), "UTF-8") }.getOrDefault("")
                        val v = runCatching { URLDecoder.decode(pair.substring(eq + 1), "UTF-8") }.getOrDefault("")
                        if (k in BILIBILI_KEYS && v.isNotBlank() && !jar.containsKey(k)) {
                            jar[k] = v
                        }
                    }
                }
            }
            val filtered = LinkedHashMap<String, String>()
            for (k in BILIBILI_KEYS) {
                val v = jar[k]
                if (!v.isNullOrBlank()) filtered[k] = v
            }
            return filtered
        }

        internal fun extractQqCookieMap(
            setCookies: List<String>,
            existingCookie: String? = null
        ): Map<String, String> {
            val rawJar = LinkedHashMap<String, String>()
            if (!existingCookie.isNullOrBlank()) {
                for (part in existingCookie.split(';')) {
                    val trimmed = part.trim()
                    val eq = trimmed.indexOf('=')
                    if (eq <= 0) continue
                    val k = trimmed.substring(0, eq).trim()
                    val v = trimmed.substring(eq + 1).trim()
                    if (k.isNotEmpty() && v.isNotEmpty()) {
                        rawJar[k] = v
                    }
                }
            }
            parseSetCookiesInto(setCookies, rawJar)
            val filtered = LinkedHashMap<String, String>()
            for (key in QQ_COOKIE_KEYS) {
                val matchedEntry = rawJar.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }
                val value = matchedEntry?.value?.trim().orEmpty()
                if (value.isNotEmpty()) {
                    filtered[key] = value
                }
            }
            return filtered
        }

        internal fun normalizeQqUin(rawUin: String?): String {
            val clean = rawUin.orEmpty()
                .trim()
                .trimStart('o', 'O', 'q', 'Q')
                .trimStart('0')
            return if (clean.length in 5..15 && clean.all { it.isDigit() }) clean else ""
        }

        private fun parseSetCookiesInto(setCookies: List<String>, jar: MutableMap<String, String>) {
            for (raw in setCookies) {
                val first = raw.substringBefore(';').trim()
                val eq = first.indexOf('=')
                if (eq <= 0) continue
                val k = first.substring(0, eq).trim()
                val v = first.substring(eq + 1).trim()
                if (k.isNotEmpty() && v.isNotEmpty() && !v.equals("deleted", ignoreCase = true)) {
                    jar[k] = v
                }
            }
        }

        private fun formatCookieMap(map: Map<String, String>): String {
            return map.entries.joinToString("; ") { "${it.key}=${it.value}" }
        }

        private fun upgradeHttps(url: String?): String {
            val raw = url?.trim().orEmpty()
            return when {
                raw.startsWith("http://music.163.com") ||
                    raw.startsWith("http://") -> "https://${raw.removePrefix("http://")}"
                raw.startsWith("//") -> "https:$raw"
                else -> raw
            }
        }
    }

    private val gson = Gson()
    private val bilibiliClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS))
        .build()

    private val qqClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS))
        .build()

    fun handle(path: String, params: Map<String, String>): Pair<Int, String> {
        return try {
            when (path) {
                "/bind/bilibili/qr/generate" -> 200 to generateBilibiliQr()
                "/bind/bilibili/qr/poll" -> 200 to pollBilibiliQr(params)
                "/bind/bilibili/nav" -> handleBilibiliNav(params)
                "/bind/bilibili/fav/folders" -> 200 to fetchBilibiliFavFolders(params)
                "/bind/bilibili/fav/resources" -> 200 to fetchBilibiliFavResources(params)
                "/bind/bilibili/audio/resolve" -> 200 to resolveBilibiliAudio(params)
                "/bind/qq/qr/generate" -> 200 to generateQqQr()
                "/bind/qq/qr/poll" -> 200 to pollQqQr(params)
                "/bind/qq/profile" -> handleQqProfile(params)
                "/bind/qq/playlists" -> 200 to fetchQqPlaylists(params)
                "/bind/qq/playlist/detail" -> 200 to fetchQqPlaylistDetail(params)
                "/bind/qq/unblock" -> 200 to resolveQqBoundUnblock(params)
                else -> 404 to gson.toJson(mapOf("code" to 404, "message" to "Unknown bind endpoint"))
            }
        } catch (e: SecurityException) {
            403 to gson.toJson(mapOf("code" to 403, "message" to (e.message ?: "Blocked unsafe request")))
        } catch (e: Exception) {
            502 to gson.toJson(mapOf("code" to 502, "message" to "平台认证请求失败，请稍后重试"))
        }
    }

    private fun executeGetText(
        url: String,
        headers: Map<String, String>,
        targetClient: OkHttpClient,
        allowedDomains: Set<String>
    ): String {
        val req = Request.Builder().url(url).get().apply {
            header("User-Agent", BROWSER_UA)
            headers.forEach { (k, v) -> header(k, v) }
        }.build()
        SafeHttpGuard.executeWithSafeRedirects(
            targetClient,
            req,
            allowedDomains,
            requireHttps = true
        ).use { resp ->
            return resp.body?.string() ?: "{}"
        }
    }

    private fun executePostJson(
        url: String,
        jsonBody: String,
        headers: Map<String, String>,
        targetClient: OkHttpClient,
        allowedDomains: Set<String>
    ): String {
        val body = jsonBody.toRequestBody("application/json; charset=utf-8".toMediaType())
        val req = Request.Builder().url(url).post(body).apply {
            header("User-Agent", BROWSER_UA)
            headers.forEach { (k, v) -> header(k, v) }
        }.build()
        SafeHttpGuard.executeWithSafeRedirects(
            targetClient,
            req,
            allowedDomains,
            requireHttps = true
        ).use { resp ->
            return resp.body?.string() ?: "{}"
        }
    }

    private fun generateBilibiliQr(): String {
        val raw = executeGetText(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
            mapOf("Referer" to BILIBILI_REFERER),
            bilibiliClient,
            SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
        )
        val root = JsonParser.parseString(raw).asJsonObject
        val dataObj = root.getAsJsonObject("data")
        val qrKey = dataObj?.get("qrcode_key")?.asString ?: ""
        val qrUrl = dataObj?.get("url")?.asString ?: ""
        if (qrKey.isBlank() || qrUrl.isBlank()) {
            return gson.toJson(mapOf("code" to 502, "message" to "获取 B 站登录二维码失败"))
        }
        val qrImg = NeteaseCrypto.generateQrPngDataUrl(qrUrl)
        return gson.toJson(
            mapOf(
                "code" to 200,
                "data" to mapOf(
                    "qrcode_key" to qrKey,
                    "url" to qrUrl,
                    "qrImg" to qrImg
                )
            )
        )
    }

    private fun pollBilibiliQr(params: Map<String, String>): String {
        val qrKey = params["qrcode_key"]?.trim().orEmpty()
        if (qrKey.isEmpty()) {
            return gson.toJson(mapOf("code" to 400, "status" to "error", "message" to "缺少 qrcode_key"))
        }
        val pollUrl =
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${enc(qrKey)}"
        val req = Request.Builder().url(pollUrl).get()
            .header("User-Agent", BROWSER_UA)
            .header("Referer", BILIBILI_REFERER)
            .build()

        var setCookies: List<String> = emptyList()
        val bodyText: String
        SafeHttpGuard.executeWithSafeRedirects(
            bilibiliClient,
            req,
            SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS,
            requireHttps = true
        ).use { resp ->
            setCookies = resp.headers("Set-Cookie")
            bodyText = resp.body?.string() ?: "{}"
        }

        val root = runCatching { JsonParser.parseString(bodyText).asJsonObject }.getOrNull() ?: JsonObject()
        val dataObj = root.getAsJsonObject("data") ?: root
        val pollCode = dataObj.get("code")?.asInt ?: -1
        return when (pollCode) {
            86101 -> gson.toJson(mapOf("code" to 200, "status" to "waiting", "message" to "等待使用哔哩哔哩 App 扫码"))
            86090 -> gson.toJson(mapOf("code" to 200, "status" to "scanned", "message" to "已扫码，请在手机 B 站确认登录"))
            86038 -> gson.toJson(mapOf("code" to 200, "status" to "expired", "message" to "二维码已过期，请点击刷新"))
            0 -> {
                val redirectUrl = dataObj.get("url")?.takeIf { !it.isJsonNull }?.asString
                val cookieMap = extractBilibiliCookieMap(setCookies, redirectUrl)
                if (cookieMap["SESSDATA"].isNullOrBlank()) {
                    return gson.toJson(
                        mapOf("code" to 200, "status" to "error", "message" to "未获取到 B 站登录凭据，请刷新重试")
                    )
                }
                val cookieStr = formatCookieMap(cookieMap)
                val profile = fetchBilibiliProfileInternal(cookieStr, cookieMap["DedeUserID"])
                gson.toJson(
                    mapOf(
                        "code" to 200,
                        "status" to "confirmed",
                        "message" to "B 站绑定成功",
                        "profile" to profile,
                        "cookie" to cookieStr
                    )
                )
            }
            else -> {
                val msg = dataObj.get("message")?.takeIf { !it.isJsonNull }?.asString
                    ?: "获取 B 站扫码状态失败"
                gson.toJson(mapOf("code" to 200, "status" to "error", "message" to msg))
            }
        }
    }

    private fun fetchBilibiliProfileInternal(cookie: String, fallbackUid: String?): Map<String, Any?> {
        val raw = runCatching {
            executeGetText(
                "https://api.bilibili.com/x/web-interface/nav",
                mapOf("Referer" to BILIBILI_REFERER, "Cookie" to cookie),
                bilibiliClient,
                SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
            )
        }.getOrNull()
        val root = raw?.let { runCatching { JsonParser.parseString(it).asJsonObject }.getOrNull() }
        val dataObj = root?.getAsJsonObject("data")
        val isLogin = dataObj?.get("isLogin")?.asBoolean == true
        val mid = dataObj?.get("mid")?.takeIf { !it.isJsonNull }?.asString ?: fallbackUid.orEmpty()
        val uname = dataObj?.get("uname")?.takeIf { !it.isJsonNull }?.asString
            ?: if (mid.isNotBlank()) "B站用户 $mid" else "哔哩哔哩用户"
        val face = upgradeHttps(dataObj?.get("face")?.takeIf { !it.isJsonNull }?.asString)
        val vipStatus = dataObj?.get("vipStatus")?.takeIf { !it.isJsonNull }?.asInt ?: 0
        return mapOf(
            "isLogin" to isLogin,
            "uid" to mid,
            "nickname" to uname,
            "avatar" to face,
            "isVip" to (vipStatus == 1)
        )
    }

    private fun handleBilibiliNav(params: Map<String, String>): Pair<Int, String> {
        val cookie = params["cookie"]?.trim().orEmpty()
        if (cookie.isEmpty()) {
            return 401 to gson.toJson(mapOf("code" to 401, "message" to "B 站尚未绑定"))
        }
        val profile = fetchBilibiliProfileInternal(cookie, null)
        if (profile["isLogin"] != true) {
            return 401 to gson.toJson(mapOf("code" to 401, "message" to "B 站登录状态已过期，请重新扫码绑定"))
        }
        return 200 to gson.toJson(mapOf("code" to 200, "profile" to profile))
    }

    private fun fetchBilibiliFavFolders(params: Map<String, String>): String {
        val cookie = params["cookie"]?.trim().orEmpty()
        var uid = params["uid"]?.trim().orEmpty()
        if (uid.isEmpty() && cookie.isNotEmpty()) {
            uid = extractBilibiliCookieMap(emptyList(), null).ifEmpty {
                extractQqCookieMap(emptyList(), cookie)
            }.let {
                cookie.split(';').firstOrNull { it.trim().startsWith("DedeUserID=") }
                    ?.substringAfter("=")?.trim().orEmpty()
            }
        }
        if (uid.isEmpty()) {
            val profile = fetchBilibiliProfileInternal(cookie, null)
            uid = profile["uid"]?.toString().orEmpty()
        }
        if (uid.isEmpty()) {
            return gson.toJson(mapOf("code" to 400, "folders" to emptyList<Any>(), "message" to "缺少 B 站用户 UID"))
        }
        val raw = executeGetText(
            "https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${enc(uid)}&type=2",
            mapOf("Referer" to BILIBILI_REFERER, "Cookie" to cookie),
            bilibiliClient,
            SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
        )
        val root = JsonParser.parseString(raw).asJsonObject
        val list = root.getAsJsonObject("data")?.getAsJsonArray("list")
        val folders = mutableListOf<Map<String, Any>>()
        list?.forEach { el ->
            val o = el.asJsonObject
            folders.add(
                mapOf(
                    "id" to (o.get("id")?.asLong ?: 0L),
                    "title" to (o.get("title")?.takeIf { !it.isJsonNull }?.asString ?: "默认收藏夹"),
                    "mediaCount" to (o.get("media_count")?.asInt ?: 0)
                )
            )
        }
        return gson.toJson(mapOf("code" to 200, "folders" to folders))
    }

    private fun fetchBilibiliFavResources(params: Map<String, String>): String {
        val mediaId = params["mediaId"]?.trim().orEmpty()
        val pn = params["pn"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1
        val ps = params["ps"]?.toIntOrNull()?.coerceIn(1, 20) ?: 20
        val cookie = params["cookie"]?.trim().orEmpty()
        if (mediaId.isEmpty()) {
            return gson.toJson(mapOf("code" to 400, "items" to emptyList<Any>(), "message" to "缺少收藏夹 ID"))
        }
        val raw = executeGetText(
            "https://api.bilibili.com/x/v3/fav/resource/list?media_id=${enc(mediaId)}&pn=$pn&ps=$ps&platform=web",
            mapOf("Referer" to BILIBILI_REFERER, "Cookie" to cookie),
            bilibiliClient,
            SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
        )
        val root = JsonParser.parseString(raw).asJsonObject
        val dataObj = root.getAsJsonObject("data")
        val hasMore = dataObj?.get("has_more")?.asBoolean == true
        val medias = dataObj?.getAsJsonArray("medias")
        val items = mutableListOf<Map<String, Any>>()
        medias?.forEach { el ->
            val o = el.asJsonObject
            val bvid = o.get("bvid")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
            val firstPage = o.getAsJsonObject("ugc")?.get("first_cid")?.takeIf { !it.isJsonNull }?.asLong ?: 0L
            val upperName = o.getAsJsonObject("upper")?.get("name")?.takeIf { !it.isJsonNull }?.asString ?: "UP主"
            if (bvid.isNotEmpty()) {
                items.add(
                    mapOf(
                        "id" to (o.get("id")?.asLong ?: 0L),
                        "bvid" to bvid,
                        "cid" to firstPage,
                        "title" to (o.get("title")?.takeIf { !it.isJsonNull }?.asString ?: bvid),
                        "cover" to upgradeHttps(o.get("cover")?.takeIf { !it.isJsonNull }?.asString),
                        "durationSec" to (o.get("duration")?.asLong ?: 0L),
                        "authorName" to upperName
                    )
                )
            }
        }
        return gson.toJson(mapOf("code" to 200, "hasMore" to hasMore, "items" to items))
    }

    private fun resolveBilibiliAudio(params: Map<String, String>): String {
        val bvid = params["bvid"]?.trim().orEmpty()
        var cid = params["cid"]?.toLongOrNull() ?: 0L
        val cookie = params["cookie"]?.trim().orEmpty()
        if (bvid.isEmpty()) {
            return gson.toJson(mapOf("code" to 400, "message" to "缺少 bvid"))
        }
        val headers = LinkedHashMap<String, String>().apply {
            put("Referer", BILIBILI_REFERER)
            if (cookie.isNotEmpty()) put("Cookie", cookie)
        }
        if (cid <= 0L) {
            val viewRaw = executeGetText(
                "https://api.bilibili.com/x/web-interface/view?bvid=${enc(bvid)}",
                headers,
                bilibiliClient,
                SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
            )
            val viewObj = runCatching { JsonParser.parseString(viewRaw).asJsonObject }.getOrNull()
            val viewData = viewObj?.getAsJsonObject("data")
            cid = viewData?.get("cid")?.takeIf { !it.isJsonNull }?.asLong
                ?: viewData?.getAsJsonArray("pages")?.firstOrNull()?.asJsonObject?.get("cid")?.asLong
                ?: 0L
        }
        if (cid <= 0L) {
            return gson.toJson(mapOf("code" to 404, "message" to "未找到 B 站音频分 P 信息"))
        }
        val playRaw = executeGetText(
            "https://api.bilibili.com/x/player/playurl?bvid=${enc(bvid)}&cid=$cid&qn=80&fnval=16&fourk=1",
            headers,
            bilibiliClient,
            SafeHttpGuard.BILIBILI_AUTH_ALLOWED_DOMAINS
        )
        val playObj = JsonParser.parseString(playRaw).asJsonObject
        val dataObj = playObj.getAsJsonObject("data")
        val dashAudio = dataObj?.getAsJsonObject("dash")?.getAsJsonArray("audio")
        var bestUrl = ""
        var bestBw = 0L
        dashAudio?.forEach { el ->
            val a = el.asJsonObject
            val bw = a.get("bandwidth")?.asLong ?: 0L
            val base = a.get("baseUrl")?.takeIf { !it.isJsonNull }?.asString
                ?: a.get("base_url")?.takeIf { !it.isJsonNull }?.asString
                ?: ""
            if (base.isNotEmpty() && bw >= bestBw) {
                bestBw = bw
                bestUrl = base
            }
        }
        if (bestUrl.isEmpty()) {
            bestUrl = dataObj?.getAsJsonArray("durl")?.firstOrNull()?.asJsonObject
                ?.get("url")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
        }
        val safeUrl = upgradeHttps(bestUrl)
        if (safeUrl.isEmpty()) {
            return gson.toJson(mapOf("code" to 404, "message" to "未能提取该 B 站音频播放地址"))
        }
        return gson.toJson(
            mapOf(
                "code" to 200,
                "data" to mapOf(
                    "url" to safeUrl,
                    "br" to if (bestBw > 0) bestBw else 192000L,
                    "bvid" to bvid,
                    "cid" to cid
                )
            )
        )
    }

    private fun generateQqQr(): String {
        val url =
            "https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=100497308"
        val req = Request.Builder().url(url).get()
            .header("User-Agent", BROWSER_UA)
            .header("Referer", QQ_PTLOGIN_REFERER)
            .build()
        var qrsig = ""
        val bytes: ByteArray
        SafeHttpGuard.executeWithSafeRedirects(
            qqClient,
            req,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS,
            requireHttps = true
        ).use { resp ->
            val setCookies = resp.headers("Set-Cookie")
            for (c in setCookies) {
                val first = c.substringBefore(';').trim()
                if (first.startsWith("qrsig=")) {
                    qrsig = first.substringAfter("qrsig=").trim()
                }
            }
            bytes = resp.body?.bytes() ?: ByteArray(0)
        }
        if (qrsig.isEmpty() || bytes.isEmpty()) {
            return gson.toJson(mapOf("code" to 502, "message" to "获取 QQ 登录二维码失败，建议尝试手动粘贴 Cookie"))
        }
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return gson.toJson(
            mapOf(
                "code" to 200,
                "data" to mapOf(
                    "qrsig" to qrsig,
                    "qrImg" to "data:image/png;base64,$b64"
                )
            )
        )
    }

    private fun pollQqQr(params: Map<String, String>): String {
        val qrsig = params["qrsig"]?.trim().orEmpty()
        if (qrsig.isEmpty() || qrsig.any { it == ';' || it.isWhitespace() || it.code < 0x20 || it.code == 0x7F }) {
            return gson.toJson(mapOf("code" to 400, "status" to "error", "message" to "缺少或非法的 qrsig"))
        }
        val ptqrtoken = computeQqPtqrToken(qrsig)
        val u1 = enc("https://y.qq.com/n/ryqq/profile")
        val pollUrl =
            "https://ssl.ptlogin2.qq.com/ptqrlogin?u1=$u1&ptqrtoken=$ptqrtoken&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${System.currentTimeMillis()}&js_ver=23090814&js_type=1&login_sig=&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308&"
        val req = Request.Builder().url(pollUrl).get()
            .header("User-Agent", BROWSER_UA)
            .header("Referer", QQ_PTLOGIN_REFERER)
            .header("Cookie", "qrsig=$qrsig")
            .build()

        val collectedCookies = mutableListOf<String>()
        val bodyText: String
        SafeHttpGuard.executeWithSafeRedirects(
            qqClient,
            req,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS,
            requireHttps = true
        ).use { resp ->
            collectedCookies.addAll(resp.headers("Set-Cookie"))
            bodyText = resp.body?.string() ?: ""
        }

        val parsed = parseQqPtuiCB(bodyText)
        if (parsed.status != "confirmed") {
            return gson.toJson(
                mapOf(
                    "code" to 200,
                    "status" to parsed.status,
                    "ptCode" to parsed.code,
                    "message" to parsed.message
                )
            )
        }

        // 手动沿 QQ_AUTH_ALLOWED_DOMAINS 强制 HTTPS 安全跟随 check_sig 跳转，跨 Host 自动剥离 Cookie
        if (parsed.redirectUrl.isNotBlank()) {
            val currentJar = extractQqCookieMap(collectedCookies)
            val initialHost = runCatching { URI(parsed.redirectUrl).host }.getOrNull().orEmpty()
            val hopReq = Request.Builder().url(parsed.redirectUrl).get()
                .header("User-Agent", BROWSER_UA)
                .header("Referer", QQ_REFERER)
                .apply {
                    if (initialHost.equals("ssl.ptlogin2.qq.com", ignoreCase = true) && currentJar.isNotEmpty()) {
                        header("Cookie", formatCookieMap(currentJar))
                    }
                }
                .build()
            SafeHttpGuard.executeWithSafeRedirects(
                qqClient,
                hopReq,
                SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS,
                maxRedirects = MAX_QQ_SIG_HOPS,
                requireHttps = true,
                onHopResponse = { resp ->
                    collectedCookies.addAll(resp.headers("Set-Cookie"))
                }
            ).use { }
        }

        val cookieMap = extractQqCookieMap(collectedCookies)
        val hasAuth = QQ_AUTH_KEYS.any { !cookieMap[it].isNullOrBlank() }
        val uid = normalizeQqUin(cookieMap["uin"] ?: cookieMap["p_uin"])
        if (!hasAuth || uid.isEmpty()) {
            return gson.toJson(
                mapOf(
                    "code" to 200,
                    "status" to "risk_control",
                    "message" to "QQ 授权回调受风控限制未能自动提取音乐凭据，请展开下方「手动粘贴 QQ 音乐 Cookie」完成绑定"
                )
            )
        }

        val cookieStr = formatCookieMap(cookieMap)
        val profile = fetchQqProfileInternal(uid, cookieStr, parsed.nickname)
        return gson.toJson(
            mapOf(
                "code" to 200,
                "status" to "confirmed",
                "message" to "QQ 音乐绑定成功",
                "profile" to profile,
                "cookie" to cookieStr
            )
        )
    }

    private fun fetchQqProfileInternal(
        uid: String,
        cookie: String,
        fallbackNick: String = ""
    ): Map<String, Any> {
        var nickname = fallbackNick.trim().ifEmpty { "QQ 音乐用户 $uid" }
        var avatar = "https://q1.qlogo.cn/g?b=qq&nk=$uid&s=140"
        runCatching {
            val raw = executeGetText(
                "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&ct=20&userid=${enc(uid)}&reqfrom=1&format=json&inCharset=utf8&outCharset=utf-8",
                mapOf("Referer" to QQ_REFERER, "Cookie" to cookie),
                qqClient,
                SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
            )
            val root = JsonParser.parseString(raw).asJsonObject
            val creator = root.getAsJsonObject("data")?.getAsJsonObject("creator")
            val nick = creator?.get("nick")?.takeIf { !it.isJsonNull }?.asString?.trim()
            val head = upgradeHttps(creator?.get("headpic")?.takeIf { !it.isJsonNull }?.asString)
            if (!nick.isNullOrBlank()) nickname = nick
            if (head.isNotBlank()) avatar = head
        }
        return mapOf(
            "uid" to uid,
            "nickname" to nickname,
            "avatar" to avatar
        )
    }

    private fun handleQqProfile(params: Map<String, String>): Pair<Int, String> {
        val rawCookie = params["cookie"]?.trim().orEmpty()
        val cookieMap = extractQqCookieMap(emptyList(), rawCookie)
        val uid = normalizeQqUin(cookieMap["uin"] ?: cookieMap["p_uin"])
        val hasAuth = QQ_AUTH_KEYS.any { !cookieMap[it].isNullOrBlank() }
        if (uid.isEmpty() || !hasAuth) {
            return 400 to gson.toJson(
                mapOf("code" to 400, "message" to "Cookie 缺少 uin 或 qm_keyst / qqmusic_key / p_skey 等鉴权字段")
            )
        }
        val normalizedCookie = formatCookieMap(cookieMap)
        val checkRaw = runCatching {
            executeGetText(
                "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${enc(uid)}&sin=0&size=5&r=${System.currentTimeMillis()}&g_tk=5381&loginUin=${enc(uid)}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
                mapOf("Referer" to QQ_REFERER, "Cookie" to normalizedCookie),
                qqClient,
                SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
            )
        }.getOrNull()
        val checkCode = checkRaw?.let {
            runCatching { JsonParser.parseString(it).asJsonObject.get("code")?.asInt }.getOrNull()
        }
        if (checkCode == 1000 || checkCode == 400001) {
            return 401 to gson.toJson(mapOf("code" to 401, "message" to "QQ 音乐 Cookie 已过期，请重新扫码或粘贴新 Cookie"))
        }
        val profile = fetchQqProfileInternal(uid, normalizedCookie)
        return 200 to gson.toJson(mapOf("code" to 200, "profile" to profile, "cookie" to normalizedCookie))
    }

    private fun fetchQqPlaylists(params: Map<String, String>): String {
        val rawCookie = params["cookie"]?.trim().orEmpty()
        val cookieMap = extractQqCookieMap(emptyList(), rawCookie)
        val uid = params["uid"]?.trim()?.takeIf { it.isNotEmpty() }
            ?: normalizeQqUin(cookieMap["uin"] ?: cookieMap["p_uin"])
        val normalizedCookie = formatCookieMap(cookieMap)
        if (uid.isEmpty() || normalizedCookie.isEmpty()) {
            return gson.toJson(mapOf("code" to 401, "playlists" to emptyList<Any>(), "message" to "QQ 音乐尚未绑定"))
        }
        val raw = executeGetText(
            "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${enc(uid)}&sin=0&size=50&r=${System.currentTimeMillis()}&g_tk=5381&loginUin=${enc(uid)}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
            mapOf("Referer" to QQ_REFERER, "Cookie" to normalizedCookie),
            qqClient,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
        )
        val root = JsonParser.parseString(raw).asJsonObject
        val dissList = root.getAsJsonObject("data")?.getAsJsonArray("disslist")
        val playlists = mutableListOf<Map<String, Any>>()
        dissList?.forEach { el ->
            val o = el.asJsonObject
            val tid = o.get("tid")?.asLong ?: 0L
            val name = o.get("diss_name")?.takeIf { !it.isJsonNull }?.asString ?: ""
            if (tid > 0L && name.isNotBlank()) {
                playlists.add(
                    mapOf(
                        "tid" to tid.toString(),
                        "name" to name,
                        "cover" to upgradeHttps(o.get("diss_cover")?.takeIf { !it.isJsonNull }?.asString),
                        "songCount" to (o.get("song_cnt")?.asInt ?: 0)
                    )
                )
            }
        }
        return gson.toJson(mapOf("code" to 200, "playlists" to playlists))
    }

    private fun fetchQqPlaylistDetail(params: Map<String, String>): String {
        val tid = params["tid"]?.trim().orEmpty()
        val rawCookie = params["cookie"]?.trim().orEmpty()
        val cookieMap = extractQqCookieMap(emptyList(), rawCookie)
        val uid = normalizeQqUin(cookieMap["uin"] ?: cookieMap["p_uin"]).ifEmpty { "0" }
        val normalizedCookie = formatCookieMap(cookieMap)
        if (tid.isEmpty()) {
            return gson.toJson(mapOf("code" to 400, "message" to "缺少歌单 ID"))
        }
        val raw = executeGetText(
            "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${enc(tid)}&g_tk=5381&loginUin=${enc(uid)}&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
            mapOf("Referer" to QQ_REFERER, "Cookie" to normalizedCookie),
            qqClient,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
        )
        val root = JsonParser.parseString(raw).asJsonObject
        val cd = root.getAsJsonArray("cdlist")?.firstOrNull()?.asJsonObject
            ?: return gson.toJson(mapOf("code" to 404, "message" to "未找到 QQ 音乐歌单详情"))
        val tracks = mutableListOf<Map<String, Any>>()
        cd.getAsJsonArray("songlist")?.forEach { el ->
            val s = el.asJsonObject
            val mid = s.get("mid")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
            val albumObj = s.getAsJsonObject("album")
            val albumMid = albumObj?.get("mid")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
            val cover = if (albumMid.isNotEmpty()) {
                "https://y.qq.com/music/photo_new/T002R300x300M000$albumMid.jpg"
            } else {
                ""
            }
            val singers = mutableListOf<Map<String, Any>>()
            s.getAsJsonArray("singer")?.forEach { ar ->
                val ao = ar.asJsonObject
                singers.add(
                    mapOf(
                        "id" to (ao.get("id")?.asLong ?: 0L),
                        "name" to (ao.get("name")?.takeIf { !it.isJsonNull }?.asString ?: "")
                    )
                )
            }
            tracks.add(
                mapOf(
                    "id" to (s.get("id")?.asLong ?: 0L),
                    "mid" to mid,
                    "name" to (s.get("name")?.takeIf { !it.isJsonNull }?.asString ?: "未知歌曲"),
                    "artists" to singers,
                    "albumName" to (albumObj?.get("name")?.takeIf { !it.isJsonNull }?.asString ?: ""),
                    "albumMid" to albumMid,
                    "durationMs" to ((s.get("interval")?.asLong ?: 0L) * 1000L),
                    "picUrl" to cover
                )
            )
        }
        return gson.toJson(
            mapOf(
                "code" to 200,
                "playlist" to mapOf(
                    "tid" to tid,
                    "name" to (cd.get("dissname")?.takeIf { !it.isJsonNull }?.asString ?: "QQ 音乐歌单"),
                    "cover" to upgradeHttps(cd.get("logo")?.takeIf { !it.isJsonNull }?.asString),
                    "tracks" to tracks
                )
            )
        )
    }

    private fun resolveQqBoundUnblock(params: Map<String, String>): String {
        val songName = params["name"]?.trim().orEmpty()
        val artist = params["artist"]?.trim().orEmpty()
        val rawCookie = params["cookie"]?.trim().orEmpty()
        val cookieMap = extractQqCookieMap(emptyList(), rawCookie)
        val uid = normalizeQqUin(cookieMap["uin"] ?: cookieMap["p_uin"])
        val normalizedCookie = formatCookieMap(cookieMap)
        if (songName.isEmpty() || uid.isEmpty() || normalizedCookie.isEmpty()) {
            return gson.toJson(mapOf("code" to 404, "message" to "缺少歌曲名或 QQ 音乐凭据"))
        }

        val keyword = "$songName $artist".trim()
        val searchPayload = gson.toJson(
            mapOf(
                "comm" to mapOf("uin" to (uid.toLongOrNull() ?: 0L), "format" to "json", "ct" to 24, "cv" to 0),
                "req_0" to mapOf(
                    "module" to "music.search.SearchCgiService",
                    "method" to "DoSearchForQQMusicDesktop",
                    "param" to mapOf(
                        "query" to keyword,
                        "page_num" to 1,
                        "num_per_page" to 5,
                        "search_type" to 0
                    )
                )
            )
        )
        val searchRaw = executePostJson(
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            searchPayload,
            mapOf("Referer" to QQ_REFERER, "Origin" to "https://y.qq.com", "Cookie" to normalizedCookie),
            qqClient,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
        )
        val searchRoot = JsonParser.parseString(searchRaw).asJsonObject
        val songList = searchRoot.getAsJsonObject("req_0")
            ?.getAsJsonObject("data")
            ?.getAsJsonObject("body")
            ?.getAsJsonObject("song")
            ?.getAsJsonArray("list")
        val firstMid = songList?.firstOrNull()?.asJsonObject?.get("mid")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
        if (firstMid.isEmpty()) {
            return gson.toJson(mapOf("code" to 404, "message" to "QQ 音乐未匹配到可用曲目"))
        }

        val vkeyPayload = gson.toJson(
            mapOf(
                "comm" to mapOf("uin" to (uid.toLongOrNull() ?: 0L), "format" to "json", "ct" to 24, "cv" to 0),
                "req_vkey" to mapOf(
                    "module" to "music.vkey.GetVkey",
                    "method" to "CgiGetVkey",
                    "param" to mapOf(
                        "guid" to "8912432100",
                        "songmid" to listOf(firstMid),
                        "songtype" to listOf(0),
                        "uin" to uid,
                        "loginflag" to 1,
                        "platform" to "20"
                    )
                )
            )
        )
        val vkeyRaw = executePostJson(
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            vkeyPayload,
            mapOf("Referer" to QQ_REFERER, "Origin" to "https://y.qq.com", "Cookie" to normalizedCookie),
            qqClient,
            SafeHttpGuard.QQ_AUTH_ALLOWED_DOMAINS
        )
        val vkeyRoot = JsonParser.parseString(vkeyRaw).asJsonObject
        val vkeyData = vkeyRoot.getAsJsonObject("req_vkey")?.getAsJsonObject("data")
        val purl = vkeyData?.getAsJsonArray("midurlinfo")?.firstOrNull()?.asJsonObject
            ?.get("purl")?.takeIf { !it.isJsonNull }?.asString.orEmpty()
        if (purl.isEmpty()) {
            return gson.toJson(mapOf("code" to 404, "message" to "当前 QQ 凭据未能取得该曲目播放链接"))
        }
        val sipRaw = vkeyData?.getAsJsonArray("sip")?.firstOrNull()?.takeIf { !it.isJsonNull }?.asString
            ?: "https://ws.stream.qqmusic.qq.com/"
        val baseSip = upgradeHttps(sipRaw).trimEnd('/') + "/"
        val finalUrl = upgradeHttps("$baseSip$purl")
        return gson.toJson(
            mapOf(
                "code" to 200,
                "message" to "success",
                "data" to mapOf(
                    "url" to finalUrl,
                    "br" to 320000,
                    "size" to 0,
                    "platform" to "qq-bound",
                    "gain" to 0
                )
            )
        )
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
