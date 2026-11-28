package com.xiaopang.naiwamusic.server

import android.util.Log
import com.xiaopang.naiwamusic.config.AppPrefs
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * 手机本地直连网易云音乐核心协议引擎
 * 完整对齐 netease-cloud-music-api-alger 的加密、Cookie、匿名 Token 及 80+ 核心接口
 */
class NeteaseApiClient(private val prefs: AppPrefs) {
    companion object {
        private const val TAG = "NeteaseApiClient"
        private const val DOMAIN = "https://music.163.com"
        private const val API_DOMAIN = "https://interface.music.163.com"
        private const val CHECK_TOKEN =
            "9ca17ae2e6ffcda170e2e6ee8af14fbabdb988f225b3868eb2c15a879b9a83d274a790ac8ff54a97b889d5d42af0feaec3b92af58cff99c470a7eafd88f75e839a9ea7c14e909da883e83fb692a3abdb6b92adee9e"

        private const val UA_WEAPI =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
        private const val UA_API_IPHONE = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)"
        private const val UA_API_PC =
            "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152"
        private const val UA_LINUX =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36"

        private val SPECIAL_CODES = setOf(201, 302, 400, 502, 800, 801, 802, 803)
    }

    private val gson = Gson()
    private val wnmcid: String = run {
        val letters = "abcdefghijklmnopqrstuvwxyz"
        val prefix = buildString(6) {
            repeat(6) { append(letters[(Math.random() * letters.length).toInt()]) }
        }
        "$prefix.${System.currentTimeMillis()}.01.0"
    }

    @Volatile
    private var anonymousToken: String = prefs.anonymousToken

    @Volatile
    private var deviceId: String = prefs.deviceId.ifBlank {
        NeteaseCrypto.generateDeviceId().also { prefs.deviceId = it }
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.NETEASE_ALLOWED_DOMAINS))
        .build()

    data class ApiResponse(
        val status: Int,
        val body: String,
        val cookies: List<String> = emptyList()
    )

    fun hasAnonymousToken(): Boolean = anonymousToken.isNotBlank()

    /**
     * 在后台初始化匿名 MUSIC_A Cookie（确保未登录时搜索、榜单、歌词、推荐接口稳定可用）
     */
    fun ensureAnonymousToken() {
        if (anonymousToken.isNotBlank()) return
        synchronized(this) {
            if (anonymousToken.isNotBlank()) return
            runCatching {
                val res = registerAnonymous(emptyMap())
                val rawCookies = res.cookies.joinToString("; ")
                val map = parseCookieString(rawCookies)
                val token = map["MUSIC_A"]
                if (!token.isNullOrBlank()) {
                    anonymousToken = token
                    prefs.anonymousToken = token
                    Log.i(TAG, "Anonymous MUSIC_A token initialized (${token.take(12)}...)")
                }
            }.onFailure {
                Log.w(TAG, "Failed to init anonymous token: ${it.message}")
            }
        }
    }

    /**
     * 统一路由分发：支持 AlgerMusicPlayer v5.1.0 全部 80+ 网易云接口
     */
    fun dispatch(path: String, params: Map<String, String>): ApiResponse {
        val normalized = path.trimEnd('/').ifEmpty { "/" }
        return when (normalized) {
            // ==================== 匿名与认证 ====================
            "/register/anonimous" -> registerAnonymous(params)
            "/login/qr/key" -> loginQrKey(params)
            "/login/qr/create" -> loginQrCreate(params)
            "/login/qr/check" -> loginQrCheck(params)
            "/login/status" -> loginStatus(params)
            "/captcha/sent" -> ncmRequest(
                "/api/sms/captcha/sent",
                mapOf(
                    "ctcode" to (params["ctcode"]?.takeIf { it.isNotBlank() } ?: "86"),
                    "cellphone" to (params["phone"] ?: ""),
                    "secrete" to "music_middleuser_pclogin"
                ),
                params,
                "weapi"
            )
            "/login/cellphone" -> loginCellphone(params)
            "/logout" -> ncmRequest("/api/logout", emptyMap(), params, "eapi")

            // ==================== 首页与推荐 ====================
            "/banner" -> {
                val typeMap = mapOf("0" to "pc", "1" to "android", "2" to "iphone", "3" to "ipad")
                val clientType = typeMap[params["type"] ?: "0"] ?: "pc"
                ncmRequest("/api/v2/banner/get", mapOf("clientType" to clientType), params, "eapi")
            }
            "/personalized" -> ncmRequest(
                "/api/personalized/playlist",
                mapOf("limit" to intParam(params, "limit", 30), "total" to true, "n" to 1000),
                params,
                "weapi"
            )
            "/personalized/newsong" -> ncmRequest(
                "/api/personalized/newsong",
                mapOf(
                    "type" to "recommend",
                    "limit" to intParam(params, "limit", 10),
                    "areaId" to intParam(params, "areaId", 0)
                ),
                params,
                "weapi"
            )
            "/personalized/mv" -> ncmRequest("/api/personalized/mv", emptyMap(), params, "weapi")
            "/personalized/privatecontent" ->
                ncmRequest("/api/personalized/privatecontent", emptyMap(), params, "weapi")
            "/personalized/djprogram" ->
                ncmRequest("/api/personalized/djprogram", emptyMap(), params, "weapi")
            "/recommend/songs" ->
                ncmRequest("/api/v3/discovery/recommend/songs", emptyMap(), params, "weapi")
            "/recommend/songs/dislike" -> ncmRequest(
                "/api/v2/discovery/recommend/dislike",
                mapOf("resId" to (params["id"] ?: ""), "resType" to 4, "sceneType" to 1),
                params,
                "weapi"
            )
            "/history/recommend/songs" ->
                ncmRequest("/api/discovery/recommend/songs/history/recent", emptyMap(), params, "weapi")
            "/history/recommend/songs/detail" -> ncmRequest(
                "/api/discovery/recommend/songs/history/detail",
                mapOf("date" to (params["date"] ?: "")),
                params,
                "weapi"
            )
            "/personal_fm" -> ncmRequest("/api/v1/radio/get", emptyMap(), params, "weapi")
            "/fm_trash" -> ncmRequest(
                "/api/radio/trash/add",
                mapOf(
                    "songId" to (params["id"] ?: ""),
                    "alg" to "RT",
                    "time" to intParam(params, "time", 25)
                ),
                params,
                "weapi"
            )

            // ==================== 搜索 ====================
            "/cloudsearch", "/search" -> ncmRequest(
                "/api/cloudsearch/pc",
                mapOf(
                    "s" to (params["keywords"] ?: ""),
                    "type" to intParam(params, "type", 1),
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true
                ),
                params,
                "eapi"
            )
            "/search/default" ->
                ncmRequest("/api/search/defaultkeyword/get", emptyMap(), params, "eapi")
            "/search/hot/detail" ->
                ncmRequest("/api/hotsearchlist/get", emptyMap(), params, "weapi")
            "/search/suggest" -> {
                val type = if (params["type"] == "mobile") "keyword" else "web"
                ncmRequest(
                    "/api/search/suggest/$type",
                    mapOf("s" to (params["keywords"] ?: "")),
                    params,
                    "weapi"
                )
            }

            // ==================== 歌单 / 榜单 / 专辑 / 歌手 ====================
            "/playlist/catlist" -> ncmRequest("/api/playlist/catalogue", emptyMap(), params, "eapi")
            "/top/playlist" -> {
                val res = ncmRequest(
                    "/api/playlist/list",
                    mapOf(
                        "cat" to (params["cat"] ?: "全部"),
                        "order" to (params["order"] ?: "hot"),
                        "limit" to intParam(params, "limit", 50),
                        "offset" to intParam(params, "offset", 0),
                        "total" to true
                    ),
                    params,
                    "weapi"
                )
                res.copy(body = res.body.replace("avatarImgId_str", "avatarImgIdStr"))
            }
            "/top/playlist/highquality" -> ncmRequest(
                "/api/playlist/highquality/list",
                mapOf(
                    "cat" to (params["cat"] ?: "全部"),
                    "limit" to intParam(params, "limit", 50),
                    "lasttime" to longParam(params, "before", 0L),
                    "total" to true
                ),
                params,
                "weapi"
            )
            "/playlist/detail" -> ncmRequest(
                "/api/v6/playlist/detail",
                mapOf(
                    "id" to (params["id"] ?: ""),
                    "n" to 100000,
                    "s" to intParam(params, "s", 8)
                ),
                params,
                "eapi"
            )
            "/playlist/track/all" -> playlistTrackAll(params)
            "/playlist/create" -> ncmRequest(
                "/api/playlist/create",
                mapOf(
                    "name" to (params["name"] ?: ""),
                    "privacy" to (params["privacy"] ?: "0"),
                    "type" to (params["type"] ?: "NORMAL")
                ),
                params,
                "weapi"
            )
            "/playlist/tracks" -> playlistTracks(params)
            "/playlist/subscribe" -> {
                val t = params["t"]
                val action = if (t == "1") "subscribe" else "unsubscribe"
                val data = mutableMapOf<String, Any>("id" to (params["id"] ?: ""))
                if (t == "1") data["checkToken"] = params["checkToken"] ?: CHECK_TOKEN
                ncmRequest("/api/playlist/$action", data, params, "eapi", checkToken = true)
            }
            "/playlist/import/name/task/create" -> playlistImportCreate(params)
            "/playlist/import/task/status" -> ncmRequest(
                "/api/playlist/import/task/status/v2",
                mapOf("taskIds" to gson.toJson(listOf(params["id"] ?: ""))),
                params,
                "eapi"
            )
            "/toplist", "/toplist/detail" -> {
                val uri = if (normalized == "/toplist/detail") "/api/toplist/detail" else "/api/toplist"
                ncmRequest(uri, emptyMap(), params, "eapi")
            }
            "/album" -> ncmRequest("/api/v1/album/${params["id"] ?: ""}", emptyMap(), params, "weapi")
            "/album/newest" -> ncmRequest("/api/discovery/newAlbum", emptyMap(), params, "weapi")
            "/album/new" -> ncmRequest(
                "/api/album/new",
                mapOf(
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true,
                    "area" to (params["area"] ?: "ALL")
                ),
                params,
                "weapi"
            )
            "/top/album" -> {
                val cal = Calendar.getInstance()
                ncmRequest(
                    "/api/discovery/new/albums/area",
                    mapOf(
                        "area" to (params["area"] ?: "ALL"),
                        "limit" to intParam(params, "limit", 50),
                        "offset" to intParam(params, "offset", 0),
                        "type" to (params["type"] ?: "new"),
                        "year" to intParam(params, "year", cal.get(Calendar.YEAR)),
                        "month" to intParam(params, "month", cal.get(Calendar.MONTH) + 1),
                        "total" to false,
                        "rcmd" to true
                    ),
                    params,
                    "weapi"
                )
            }
            "/album/sub" -> {
                val action = if (params["t"] == "1") "sub" else "unsub"
                ncmRequest("/api/album/$action", mapOf("id" to (params["id"] ?: "")), params, "weapi")
            }
            "/album/sublist" -> ncmRequest(
                "/api/album/sublist",
                mapOf(
                    "limit" to intParam(params, "limit", 25),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true
                ),
                params,
                "weapi"
            )
            "/top/artists" -> ncmRequest(
                "/api/artist/top",
                mapOf(
                    "limit" to intParam(params, "limit", 50),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true
                ),
                params,
                "weapi"
            )
            "/artist/detail" -> ncmRequest(
                "/api/artist/head/info/get",
                mapOf("id" to (params["id"] ?: "")),
                params,
                "eapi"
            )
            "/artist/songs" -> ncmRequest(
                "/api/v1/artist/songs",
                mapOf(
                    "id" to (params["id"] ?: ""),
                    "private_cloud" to "true",
                    "work_type" to 1,
                    "order" to (params["order"] ?: "hot"),
                    "offset" to intParam(params, "offset", 0),
                    "limit" to intParam(params, "limit", 100)
                ),
                params,
                "eapi"
            )
            "/artist/album" -> ncmRequest(
                "/api/artist/albums/${params["id"] ?: ""}",
                mapOf(
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true
                ),
                params,
                "weapi"
            )
            "/artist/new/song" -> ncmRequest(
                "/api/sub/artist/new/works/song/list",
                mapOf(
                    "limit" to intParam(params, "limit", 20),
                    "startTimestamp" to longParam(params, "before", System.currentTimeMillis())
                ),
                params,
                "weapi"
            )

            // ==================== 歌曲 / 歌词 / 喜欢 / 心动模式 ====================
            "/song/url/v1" -> {
                val level = params["level"] ?: "higher"
                val data = mutableMapOf<String, Any>(
                    "ids" to "[${params["id"] ?: ""}]",
                    "level" to level,
                    "encodeType" to (params["encodeType"] ?: "flac")
                )
                if (level == "sky") data["immerseType"] = "c51"
                ncmRequest("/api/song/enhance/player/url/v1", data, params, "eapi")
            }
            "/song/download/url/v1" -> ncmRequest(
                "/api/song/enhance/download/url/v1",
                mapOf(
                    "id" to (params["id"] ?: ""),
                    "immerseType" to "c51",
                    "level" to (params["level"] ?: "higher")
                ),
                params,
                "eapi"
            )
            "/song/detail" -> {
                val ids = (params["ids"] ?: "")
                    .split(",")
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                val c = "[" + ids.joinToString(",") { "{\"id\":$it}" } + "]"
                ncmRequest("/api/v3/song/detail", mapOf("c" to c), params, "weapi")
            }
            "/song/music/detail" -> ncmRequest(
                "/api/song/music/detail/get",
                mapOf("songId" to (params["id"] ?: "")),
                params,
                "eapi"
            )
            "/lyric/new" -> ncmRequest(
                "/api/song/lyric/v1",
                mapOf(
                    "id" to (params["id"] ?: ""),
                    "cp" to false,
                    "tv" to 0, "lv" to 0, "rv" to 0, "kv" to 0,
                    "yv" to 0, "ytv" to 0, "yrv" to 0
                ),
                params,
                "eapi"
            )
            "/lyric" -> ncmRequest(
                "/api/song/lyric",
                mapOf(
                    "id" to (params["id"] ?: ""),
                    "tv" to -1, "lv" to -1, "rv" to -1, "kv" to -1, "_nmclfl" to 1
                ),
                params,
                "eapi"
            )
            "/like" -> ncmRequest(
                "/api/radio/like",
                mapOf(
                    "alg" to "itembased",
                    "trackId" to (params["id"] ?: ""),
                    "like" to (params["like"] != "false"),
                    "time" to "3"
                ),
                params,
                "weapi"
            )
            "/likelist" -> ncmRequest(
                "/api/song/like/get",
                mapOf("uid" to (params["uid"] ?: "")),
                params,
                "eapi"
            )
            "/playmode/intelligence/list" -> ncmRequest(
                "/api/playmode/intelligence/list",
                mapOf(
                    "songId" to (params["id"] ?: ""),
                    "type" to "fromPlayOne",
                    "playlistId" to (params["pid"] ?: ""),
                    "startMusicId" to (params["sid"] ?: params["id"] ?: ""),
                    "count" to intParam(params, "count", 1)
                ),
                params,
                "eapi"
            )

            // ==================== MV ====================
            "/mv/all" -> {
                val tagsJson = gson.toJson(
                    mapOf(
                        "地区" to (params["area"] ?: "全部"),
                        "类型" to (params["type"] ?: "全部"),
                        "排序" to (params["order"] ?: "上升最快")
                    )
                )
                ncmRequest(
                    "/api/mv/all",
                    mapOf(
                        "tags" to tagsJson,
                        "offset" to intParam(params, "offset", 0),
                        "total" to "true",
                        "limit" to intParam(params, "limit", 30)
                    ),
                    params,
                    "eapi"
                )
            }
            "/mv/detail" -> ncmRequest(
                "/api/v1/mv/detail",
                mapOf("id" to (params["mvid"] ?: params["id"] ?: "")),
                params,
                "weapi"
            )
            "/mv/url" -> ncmRequest(
                "/api/song/enhance/play/mv/url",
                mapOf("id" to (params["id"] ?: ""), "r" to intParam(params, "r", 1080)),
                params,
                "weapi"
            )

            // ==================== 播客 / 电台 (DJ) ====================
            "/dj/sub" -> {
                val action = if (params["t"] == "1") "sub" else "unsub"
                ncmRequest("/api/djradio/$action", mapOf("id" to (params["rid"] ?: "")), params, "weapi")
            }
            "/dj/sublist" -> ncmRequest(
                "/api/djradio/get/subed",
                mapOf(
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "total" to true
                ),
                params,
                "weapi"
            )
            "/dj/detail" -> ncmRequest(
                "/api/djradio/v2/get",
                mapOf("id" to (params["rid"] ?: "")),
                params,
                "weapi"
            )
            "/dj/program" -> ncmRequest(
                "/api/dj/program/byradio",
                mapOf(
                    "radioId" to (params["rid"] ?: ""),
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "asc" to (params["asc"] == "true" || params["asc"] == "1")
                ),
                params,
                "weapi"
            )
            "/dj/program/detail" -> ncmRequest(
                "/api/dj/program/detail",
                mapOf("id" to (params["id"] ?: "")),
                params,
                "weapi"
            )
            "/dj/recommend" -> ncmRequest("/api/djradio/recommend/v1", emptyMap(), params, "weapi")
            "/dj/catelist" -> ncmRequest("/api/djradio/category/get", emptyMap(), params, "weapi")
            "/dj/recommend/type" -> ncmRequest(
                "/api/djradio/recommend",
                mapOf("cateId" to (params["type"] ?: "")),
                params,
                "weapi"
            )
            "/dj/category/recommend" ->
                ncmRequest("/api/djradio/home/category/recommend", emptyMap(), params, "weapi")
            "/dj/today/perfered" -> ncmRequest(
                "/api/djradio/home/today/perfered",
                mapOf("page" to intParam(params, "page", 0)),
                params,
                "weapi"
            )
            "/dj/personalize/recommend" -> ncmRequest(
                "/api/djradio/personalize/rcmd",
                mapOf("limit" to intParam(params, "limit", 6)),
                params,
                "weapi"
            )
            "/dj/banner" -> ncmRequest("/api/djradio/banner/get", emptyMap(), params, "weapi")
            "/dj/toplist" -> {
                val typeNum = if (params["type"] == "hot") 1 else 0
                ncmRequest(
                    "/api/djradio/toplist",
                    mapOf(
                        "limit" to intParam(params, "limit", 100),
                        "offset" to intParam(params, "offset", 0),
                        "type" to typeNum
                    ),
                    params,
                    "weapi"
                )
            }
            "/dj/radio/hot" -> ncmRequest(
                "/api/djradio/hot",
                mapOf(
                    "cateId" to (params["cateId"] ?: ""),
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0)
                ),
                params,
                "weapi"
            )
            "/comment/dj" -> {
                val id = params["id"] ?: ""
                ncmRequest(
                    "/api/v1/resource/comments/A_DJ_1_$id",
                    mapOf(
                        "rid" to id,
                        "limit" to intParam(params, "limit", 20),
                        "offset" to intParam(params, "offset", 0),
                        "beforeTime" to longParam(params, "before", 0L)
                    ),
                    params,
                    "weapi"
                )
            }

            // ==================== 用户与播放记录 ====================
            "/user/account" -> ncmRequest("/api/nuser/account/get", emptyMap(), params, "weapi")
            "/user/detail" -> {
                val res = ncmRequest("/api/v1/user/detail/${params["uid"] ?: ""}", emptyMap(), params, "weapi")
                res.copy(body = res.body.replace("avatarImgId_str", "avatarImgIdStr"))
            }
            "/user/playlist" -> ncmRequest(
                "/api/user/playlist",
                mapOf(
                    "uid" to (params["uid"] ?: ""),
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "includeVideo" to true
                ),
                params,
                "weapi"
            )
            "/user/record" -> ncmRequest(
                "/api/v1/play/record",
                mapOf("uid" to (params["uid"] ?: ""), "type" to intParam(params, "type", 0)),
                params,
                "weapi"
            )
            "/record/recent/song" -> ncmRequest(
                "/api/play-record/song/list",
                mapOf("limit" to intParam(params, "limit", 100)),
                params,
                "weapi"
            )
            "/record/recent/playlist" -> ncmRequest(
                "/api/play-record/playlist/list",
                mapOf("limit" to intParam(params, "limit", 100)),
                params,
                "weapi"
            )
            "/record/recent/album" -> ncmRequest(
                "/api/play-record/album/list",
                mapOf("limit" to intParam(params, "limit", 100)),
                params,
                "weapi"
            )
            "/record/recent/dj" -> ncmRequest(
                "/api/play-record/djradio/list",
                mapOf("limit" to intParam(params, "limit", 100)),
                params,
                "weapi"
            )
            "/scrobble" -> {
                val songId = params["id"] ?: ""
                val sourceId = params["sourceid"] ?: params["sourceId"] ?: ""
                val playSec = intParam(params, "time", 120)
                val logEntry = mapOf(
                    "action" to "play",
                    "json" to mapOf(
                        "download" to 0,
                        "end" to "playend",
                        "id" to (songId.toLongOrNull() ?: songId),
                        "sourceId" to sourceId,
                        "time" to playSec,
                        "type" to "song",
                        "wifi" to 0,
                        "source" to "list",
                        "mainsite" to 1,
                        "content" to ""
                    )
                )
                ncmRequest(
                    "/api/feedback/weblog",
                    mapOf("logs" to gson.toJson(listOf(logEntry))),
                    params,
                    "weapi"
                )
            }
            "/user/follows" -> ncmRequest(
                "/api/user/getfollows/${params["uid"] ?: ""}",
                mapOf(
                    "offset" to intParam(params, "offset", 0),
                    "limit" to intParam(params, "limit", 30),
                    "order" to true
                ),
                params,
                "weapi"
            )
            "/user/followeds" -> ncmRequest(
                "/api/user/getfolloweds/${params["uid"] ?: ""}",
                mapOf(
                    "userId" to (params["uid"] ?: ""),
                    "time" to "0",
                    "limit" to intParam(params, "limit", 30),
                    "offset" to intParam(params, "offset", 0),
                    "getcounts" to "true"
                ),
                params,
                "eapi"
            )

            else -> ApiResponse(404, """{"code":404,"msg":"Unknown endpoint: $normalized"}""")
        }
    }

    // ==================== 特殊复合接口 ====================

    private fun registerAnonymous(params: Map<String, String>): ApiResponse {
        val devId = deviceId
        val encoded = NeteaseCrypto.encodeAnonymousUsername(devId)
        val res = ncmRequest("/api/register/anonimous", mapOf("username" to encoded), params, "weapi")
        val obj = runCatching { JsonParser.parseString(res.body).asJsonObject }.getOrNull()
        if (obj != null && obj.get("code")?.asInt == 200) {
            obj.addProperty("cookie", res.cookies.joinToString(";"))
            return res.copy(status = 200, body = gson.toJson(obj))
        }
        return res
    }

    private fun loginQrKey(params: Map<String, String>): ApiResponse {
        val res = ncmRequest("/api/login/qrcode/unikey", mapOf("type" to 3), params, "eapi")
        val parsed = runCatching { JsonParser.parseString(res.body) }.getOrNull()
        val wrapped = JsonObject().apply {
            addProperty("code", 200)
            if (parsed != null) add("data", parsed)
        }
        return ApiResponse(200, gson.toJson(wrapped), res.cookies)
    }

    private fun loginQrCreate(params: Map<String, String>): ApiResponse {
        val key = params["key"] ?: ""
        val qrUrl = "https://music.163.com/login?codekey=$key"
        val needImg = params["qrimg"] != null && params["qrimg"] != "false" && params["qrimg"] != "0"
        val qrImg = if (needImg) NeteaseCrypto.generateQrPngDataUrl(qrUrl) else ""
        val body = JsonObject().apply {
            addProperty("code", 200)
            add("data", JsonObject().apply {
                addProperty("qrurl", qrUrl)
                addProperty("qrimg", qrImg)
            })
        }
        return ApiResponse(200, gson.toJson(body))
    }

    private fun loginQrCheck(params: Map<String, String>): ApiResponse {
        val res = ncmRequest(
            "/api/login/qrcode/client/login",
            mapOf("key" to (params["key"] ?: ""), "type" to 3),
            params,
            "eapi"
        )
        val obj = runCatching { JsonParser.parseString(res.body).asJsonObject }.getOrNull() ?: JsonObject()
        obj.addProperty("cookie", res.cookies.joinToString(";"))
        return ApiResponse(200, gson.toJson(obj), res.cookies)
    }

    private fun loginStatus(params: Map<String, String>): ApiResponse {
        val res = ncmRequest("/api/w/nuser/account/get", emptyMap(), params, "weapi")
        val obj = runCatching { JsonParser.parseString(res.body).asJsonObject }.getOrNull()
        if (obj != null && obj.get("code")?.asInt == 200) {
            val wrapped = JsonObject().apply { add("data", obj) }
            return ApiResponse(200, gson.toJson(wrapped), res.cookies)
        }
        return res
    }

    private fun loginCellphone(params: Map<String, String>): ApiResponse {
        val data = mutableMapOf<String, Any>(
            "type" to "1",
            "https" to "true",
            "phone" to (params["phone"] ?: ""),
            "countrycode" to (params["countrycode"] ?: "86"),
            "remember" to "true"
        )
        val captcha = params["captcha"]
        if (!captcha.isNullOrBlank()) {
            data["captcha"] = captcha
        } else {
            data["password"] = params["md5_password"] ?: NeteaseCrypto.md5Hex(params["password"] ?: "")
        }
        val res = ncmRequest("/api/w/login/cellphone", data, params, "weapi")
        val cleanBody = res.body.replace("avatarImgId_str", "avatarImgIdStr")
        val obj = runCatching { JsonParser.parseString(cleanBody).asJsonObject }.getOrNull()
        if (obj != null && obj.get("code")?.asInt == 200) {
            obj.addProperty("cookie", res.cookies.joinToString(";"))
            return ApiResponse(200, gson.toJson(obj), res.cookies)
        }
        return res.copy(body = cleanBody)
    }

    private fun playlistTrackAll(params: Map<String, String>): ApiResponse {
        val detail = ncmRequest(
            "/api/v6/playlist/detail",
            mapOf("id" to (params["id"] ?: ""), "n" to 100000, "s" to intParam(params, "s", 8)),
            params,
            "eapi"
        )
        val root = runCatching { JsonParser.parseString(detail.body).asJsonObject }.getOrNull()
            ?: return detail
        val trackIds = root.getAsJsonObject("playlist")?.getAsJsonArray("trackIds") ?: return detail
        val limit = intParam(params, "limit", 1000)
        val offset = intParam(params, "offset", 0)
        val slice = mutableListOf<String>()
        val end = minOf(trackIds.size(), offset + limit)
        for (i in offset until end) {
            val tid = trackIds[i].asJsonObject.get("id")?.asString ?: continue
            slice.add("{\"id\":$tid}")
        }
        val c = "[" + slice.joinToString(",") + "]"
        return ncmRequest("/api/v3/song/detail", mapOf("c" to c), params, "eapi")
    }

    private fun playlistTracks(params: Map<String, String>): ApiResponse {
        val tracks = (params["tracks"] ?: "").split(",").filter { it.isNotBlank() }
        val data = mapOf(
            "op" to (params["op"] ?: "add"),
            "pid" to (params["pid"] ?: ""),
            "trackIds" to gson.toJson(tracks),
            "imme" to "true"
        )
        val res = ncmRequest("/api/playlist/manipulate/tracks", data, params, "eapi")
        val parsed = runCatching { JsonParser.parseString(res.body).asJsonObject }.getOrNull()
        val code = parsed?.get("code")?.asInt ?: res.status
        if (code == 512) {
            val retryData = data + ("trackIds" to gson.toJson(tracks + tracks))
            return ncmRequest("/api/playlist/manipulate/tracks", retryData, params, "eapi")
        }
        val wrapped = JsonObject().apply {
            addProperty("status", res.status)
            if (parsed != null) add("body", parsed)
        }
        return ApiResponse(200, gson.toJson(wrapped), res.cookies)
    }

    private fun playlistImportCreate(params: Map<String, String>): ApiResponse {
        val data = mutableMapOf<String, Any>(
            "importStarPlaylist" to (params["importStarPlaylist"] == "true")
        )
        if (!params["local"].isNullOrBlank()) {
            val arr = runCatching { JsonParser.parseString(params["local"]).asJsonArray }.getOrNull()
            val mapped = JsonArray()
            arr?.forEach { el ->
                val o = el.asJsonObject
                mapped.add(JsonObject().apply {
                    addProperty("songName", o.get("name")?.asString ?: "")
                    addProperty("artistName", o.get("artist")?.asString ?: "")
                    addProperty("albumName", o.get("album")?.asString ?: "")
                })
            }
            data["multiSongs"] = gson.toJson(mapped)
        } else {
            val playlistName = params["playlistName"] ?: "导入音乐"
            data["playlistName"] = playlistName
            data["taskIdForLog"] = ""
            if (!params["text"].isNullOrBlank()) {
                val encodedText = URLEncoder.encode(params["text"], "UTF-8").replace("+", "%20")
                data["songs"] = gson.toJson(
                    listOf(mapOf("name" to playlistName, "type" to "", "url" to "rpc://playlist/import?text=$encodedText"))
                )
            } else if (!params["link"].isNullOrBlank()) {
                val links = runCatching { JsonParser.parseString(params["link"]).asJsonArray }.getOrNull()
                val songs = mutableListOf<Map<String, String>>()
                links?.forEach { l ->
                    songs.add(mapOf("name" to playlistName, "type" to "", "url" to l.asString))
                }
                data["songs"] = gson.toJson(songs)
            }
        }
        return ncmRequest("/api/playlist/import/name/task/create", data, params, "eapi")
    }

    // ==================== 底层网易云加密请求执行器 ====================

    private fun ncmRequest(
        uri: String,
        rawData: Map<String, Any>,
        queryParams: Map<String, String>,
        defaultCrypto: String,
        checkToken: Boolean = false
    ): ApiResponse {
        // 确保有匿名 Token（非登录/匿名注册接口）
        if (anonymousToken.isBlank() && !uri.contains("anonimous") && !uri.contains("login")) {
            ensureAnonymousToken()
        }

        val noCookie = queryParams["noCookie"] == "true"
        val incomingCookie = if (noCookie) "" else (queryParams["cookie"] ?: "")
        val cookieMap = buildCookieMap(incomingCookie, uri)
        val csrfToken = cookieMap["__csrf"] ?: ""
        val crypto = queryParams["crypto"]?.takeIf { it.isNotBlank() } ?: defaultCrypto

        val dataMap = LinkedHashMap<String, Any>(rawData)
        dataMap["e_r"] = false

        val headers = LinkedHashMap<String, String>()
        val realIP = queryParams["realIP"]
        if (!realIP.isNullOrBlank()) {
            headers["X-Real-IP"] = realIP
            headers["X-Forwarded-For"] = realIP
        }

        val targetUrl: String
        val formParams: Map<String, String>

        when (crypto) {
            "weapi" -> {
                headers["Referer"] = DOMAIN
                headers["User-Agent"] = UA_WEAPI
                headers["Cookie"] = cookieMapToString(cookieMap)
                dataMap["csrf_token"] = csrfToken
                val jsonText = gson.toJson(dataMap)
                formParams = NeteaseCrypto.weapi(jsonText)
                targetUrl = "$DOMAIN/weapi/${uri.removePrefix("/api/")}"
            }
            "linuxapi" -> {
                headers["User-Agent"] = UA_LINUX
                headers["Cookie"] = cookieMapToString(cookieMap)
                val wrapper = mapOf("method" to "POST", "url" to "$DOMAIN$uri", "params" to dataMap)
                formParams = NeteaseCrypto.linuxapi(gson.toJson(wrapper))
                targetUrl = "$DOMAIN/api/linux/forward"
            }
            "api" -> {
                val eapiHeader = buildEapiHeader(cookieMap, csrfToken, checkToken)
                headers["Cookie"] = cookieMapToString(eapiHeader)
                headers["User-Agent"] = UA_API_IPHONE
                targetUrl = "$API_DOMAIN$uri"
                formParams = dataMap.mapValues { (_, v) ->
                    if (v is String) v else gson.toJson(v)
                }
            }
            else -> {
                // 默认 eapi
                val eapiHeader = buildEapiHeader(cookieMap, csrfToken, checkToken)
                headers["Cookie"] = cookieMapToString(eapiHeader)
                headers["User-Agent"] = if (cookieMap["os"] == "pc") UA_API_PC else UA_API_IPHONE
                dataMap["header"] = eapiHeader
                val jsonText = gson.toJson(dataMap)
                formParams = NeteaseCrypto.eapi(uri, jsonText)
                targetUrl = "$API_DOMAIN/eapi/${uri.removePrefix("/api/")}"
            }
        }

        val formBuilder = FormBody.Builder()
        formParams.forEach { (k, v) -> formBuilder.add(k, v) }

        val reqBuilder = Request.Builder()
            .url(targetUrl)
            .post(formBuilder.build())
        headers.forEach { (k, v) -> reqBuilder.header(k, v) }

        return try {
            SafeHttpGuard.executeWithSafeRedirects(
                client,
                reqBuilder.build(),
                SafeHttpGuard.NETEASE_ALLOWED_DOMAINS
            ).use { resp ->
                val rawBody = resp.body?.string() ?: "{}"
                val setCookies = resp.headers("Set-Cookie").map { c ->
                    c.replace(Regex("\\s*Domain=[^(;|$)]+;*"), "")
                }

                val parsedCode = runCatching {
                    val el = JsonParser.parseString(rawBody)
                    if (el.isJsonObject && el.asJsonObject.has("code")) {
                        el.asJsonObject.get("code").asInt
                    } else resp.code
                }.getOrDefault(resp.code)

                var httpStatus = if (SPECIAL_CODES.contains(parsedCode)) 200 else parsedCode
                if (httpStatus !in 101..599) httpStatus = 200

                ApiResponse(httpStatus, rawBody, setCookies)
            }
        } catch (e: Exception) {
            Log.e(TAG, "ncmRequest failed for $uri: ${e.message}")
            ApiResponse(502, gson.toJson(mapOf("code" to 502, "msg" to (e.message ?: "Network error"))))
        }
    }

    private fun buildCookieMap(rawCookie: String, uri: String): MutableMap<String, String> {
        val parsed = parseCookieString(rawCookie).toMutableMap()
        val osKey = parsed["os"] ?: "pc"
        val (osName, appver, osver, channel) = when (osKey) {
            "android" -> Quad("android", "8.20.20.231215173437", "14", "xiaomi")
            "iphone" -> Quad("iPhone OS", "9.0.90", "16.2", "distribution")
            "linux" -> Quad("linux", "1.2.1.0428", "Deepin 20.9", "netease")
            else -> Quad("pc", "3.1.17.204416", "Microsoft-Windows-10-Professional-build-19045-64bit", "netease")
        }
        val nuid = parsed["_ntes_nuid"] ?: NeteaseCrypto.randomHex(32)
        parsed.putIfAbsent("__remember_me", "true")
        parsed.putIfAbsent("ntes_kaola_ad", "1")
        parsed.putIfAbsent("_ntes_nuid", nuid)
        parsed.putIfAbsent("_ntes_nnid", "$nuid,${System.currentTimeMillis()}")
        parsed.putIfAbsent("WNMCID", wnmcid)
        parsed.putIfAbsent("WEVNSM", "1.0.0")
        parsed.putIfAbsent("osver", osver)
        parsed.putIfAbsent("deviceId", deviceId)
        parsed.putIfAbsent("os", osName)
        parsed.putIfAbsent("channel", channel)
        parsed.putIfAbsent("appver", appver)

        if (!uri.contains("login")) {
            parsed["NMTID"] = NeteaseCrypto.randomHex(16)
        }
        if (parsed["MUSIC_U"].isNullOrBlank() && parsed["MUSIC_A"].isNullOrBlank() && anonymousToken.isNotBlank()) {
            parsed["MUSIC_A"] = anonymousToken
        }
        return parsed
    }

    private fun buildEapiHeader(
        cookieMap: Map<String, String>,
        csrfToken: String,
        checkToken: Boolean
    ): Map<String, String> {
        val now = System.currentTimeMillis()
        val randSuffix = ((Math.random() * 1000).toInt()).toString().padStart(4, '0')
        val map = LinkedHashMap<String, String>()
        map["osver"] = cookieMap["osver"] ?: "14"
        map["deviceId"] = cookieMap["deviceId"] ?: deviceId
        map["os"] = cookieMap["os"] ?: "pc"
        map["appver"] = cookieMap["appver"] ?: "3.1.17.204416"
        map["versioncode"] = cookieMap["versioncode"] ?: "140"
        map["mobilename"] = cookieMap["mobilename"] ?: ""
        map["buildver"] = cookieMap["buildver"] ?: (now / 1000).toString()
        map["resolution"] = cookieMap["resolution"] ?: "1920x1080"
        map["__csrf"] = csrfToken
        map["channel"] = cookieMap["channel"] ?: "netease"
        map["requestId"] = "${now}_$randSuffix"
        if (checkToken) map["X-antiCheatToken"] = CHECK_TOKEN
        cookieMap["MUSIC_U"]?.takeIf { it.isNotBlank() }?.let { map["MUSIC_U"] = it }
        cookieMap["MUSIC_A"]?.takeIf { it.isNotBlank() }?.let { map["MUSIC_A"] = it }
        return map
    }

    private fun parseCookieString(cookie: String): Map<String, String> {
        if (cookie.isBlank()) return emptyMap()
        val result = LinkedHashMap<String, String>()
        cookie.split(";").forEach { part ->
            val idx = part.indexOf('=')
            if (idx > 0) {
                val k = part.substring(0, idx).trim()
                val v = part.substring(idx + 1).trim()
                if (k.isNotEmpty() && !k.equals("Path", true) && !k.equals("Expires", true) &&
                    !k.equals("Max-Age", true) && !k.equals("HttpOnly", true) &&
                    !k.equals("SameSite", true) && !k.equals("Secure", true)
                ) {
                    result[k] = v
                }
            }
        }
        return result
    }

    private fun cookieMapToString(map: Map<String, String>): String {
        return map.entries.joinToString("; ") { (k, v) ->
            "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
        }
    }

    private fun intParam(params: Map<String, String>, key: String, default: Int): Int {
        return params[key]?.toDoubleOrNull()?.toInt() ?: default
    }

    private fun longParam(params: Map<String, String>, key: String, default: Long): Long {
        return params[key]?.toDoubleOrNull()?.toLong() ?: default
    }

    private data class Quad(val a: String, val b: String, val c: String, val d: String)
}
