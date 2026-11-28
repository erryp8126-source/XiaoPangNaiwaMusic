import Foundation

struct NcmApiResponse {
    let status: Int
    let body: String
    let cookies: [String]
}

/// iOS 内置直连网易云音乐核心协议引擎（完整 1:1 移植 Android NeteaseApiClient.kt 全部 80+ 路由）
final class NeteaseApiClient {
    private static let domain = "https://music.163.com"
    private static let apiDomain = "https://interface.music.163.com"
    private static let checkToken =
        "9ca17ae2e6ffcda170e2e6ee8af14fbabdb988f225b3868eb2c15a879b9a83d274a790ac8ff54a97b889d5d42af0feaec3b92af58cff99c470a7eafd88f75e839a9ea7c14e909da883e83fb692a3abdb6b92adee9e"
    private static let uaWeapi =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
    private static let uaApiIphone = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)"
    private static let uaApiPc =
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152"
    private static let uaLinux =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36"
    private static let specialCodes: Set<Int> = [201, 302, 400, 502, 800, 801, 802, 803]

    private let prefs: AppPrefs
    private let redirectDelegate: SafeRedirectSessionDelegate
    private let session: URLSession
    private let tokenLock = NSLock()
    private let wnmcid: String

    private var anonymousToken: String
    private var deviceId: String

    init(prefs: AppPrefs) {
        self.prefs = prefs
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 14
        cfg.timeoutIntervalForResource = 20
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        let del = SafeRedirectSessionDelegate(allowedSuffixes: SafeHttpGuard.neteaseAllowedDomains)
        self.redirectDelegate = del
        self.session = URLSession(configuration: cfg, delegate: del, delegateQueue: nil)

        let letters = Array("abcdefghijklmnopqrstuvwxyz")
        let prefix = String((0..<6).map { _ in letters[Int.random(in: 0..<letters.count)] })
        self.wnmcid = "\(prefix).\(Int64(Date().timeIntervalSince1970 * 1000)).01.0"

        self.anonymousToken = prefs.anonymousToken
        let savedDev = prefs.deviceId
        if savedDev.isEmpty {
            let gen = NeteaseCrypto.generateDeviceId()
            prefs.deviceId = gen
            self.deviceId = gen
        } else {
            self.deviceId = savedDev
        }
    }

    func hasAnonymousToken() -> Bool {
        tokenLock.lock()
        defer { tokenLock.unlock() }
        return !anonymousToken.isEmpty
    }

    func ensureAnonymousToken() {
        tokenLock.lock()
        if !anonymousToken.isEmpty {
            tokenLock.unlock()
            return
        }
        tokenLock.unlock()

        let res = registerAnonymous([:])
        let rawCookies = res.cookies.joined(separator: "; ")
        let map = parseCookieString(rawCookies)
        if let token = map["MUSIC_A"], !token.isEmpty {
            tokenLock.lock()
            self.anonymousToken = token
            self.prefs.anonymousToken = token
            tokenLock.unlock()
        }
    }

    func dispatch(path: String, params: [String: String]) -> NcmApiResponse {
        var normalized = path
        while normalized.count > 1 && normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        if normalized.isEmpty { normalized = "/" }

        switch normalized {
        // MARK: - 匿名与认证
        case "/register/anonimous": return registerAnonymous(params)
        case "/login/qr/key": return loginQrKey(params)
        case "/login/qr/create": return loginQrCreate(params)
        case "/login/qr/check": return loginQrCheck(params)
        case "/login/status": return loginStatus(params)
        case "/captcha/sent":
            let ctcode = (params["ctcode"]?.isEmpty == false ? params["ctcode"]! : "86")
            return ncmRequest("/api/sms/captcha/sent", rawData: [
                "ctcode": ctcode,
                "cellphone": params["phone"] ?? "",
                "secrete": "music_middleuser_pclogin"
            ], queryParams: params, defaultCrypto: "weapi")
        case "/login/cellphone": return loginCellphone(params)
        case "/logout": return ncmRequest("/api/logout", rawData: [:], queryParams: params, defaultCrypto: "eapi")

        // MARK: - 首页与推荐
        case "/banner":
            let typeMap = ["0": "pc", "1": "android", "2": "iphone", "3": "ipad"]
            let clientType = typeMap[params["type"] ?? "0"] ?? "pc"
            return ncmRequest("/api/v2/banner/get", rawData: ["clientType": clientType], queryParams: params, defaultCrypto: "eapi")
        case "/personalized":
            return ncmRequest("/api/personalized/playlist", rawData: [
                "limit": intParam(params, "limit", 30),
                "total": true,
                "n": 1000
            ], queryParams: params, defaultCrypto: "weapi")
        case "/personalized/newsong":
            return ncmRequest("/api/personalized/newsong", rawData: [
                "type": "recommend",
                "limit": intParam(params, "limit", 10),
                "areaId": intParam(params, "areaId", 0)
            ], queryParams: params, defaultCrypto: "weapi")
        case "/personalized/mv":
            return ncmRequest("/api/personalized/mv", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/personalized/privatecontent":
            return ncmRequest("/api/personalized/privatecontent", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/personalized/djprogram":
            return ncmRequest("/api/personalized/djprogram", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/recommend/songs":
            return ncmRequest("/api/v3/discovery/recommend/songs", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/recommend/songs/dislike":
            return ncmRequest("/api/v2/discovery/recommend/dislike", rawData: [
                "resId": params["id"] ?? "",
                "resType": 4,
                "sceneType": 1
            ], queryParams: params, defaultCrypto: "weapi")
        case "/history/recommend/songs":
            return ncmRequest("/api/discovery/recommend/songs/history/recent", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/history/recommend/songs/detail":
            return ncmRequest("/api/discovery/recommend/songs/history/detail", rawData: [
                "date": params["date"] ?? ""
            ], queryParams: params, defaultCrypto: "weapi")
        case "/personal_fm":
            return ncmRequest("/api/v1/radio/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/fm_trash":
            return ncmRequest("/api/radio/trash/add", rawData: [
                "songId": params["id"] ?? "",
                "alg": "RT",
                "time": intParam(params, "time", 25)
            ], queryParams: params, defaultCrypto: "weapi")

        // MARK: - 搜索
        case "/cloudsearch", "/search":
            return ncmRequest("/api/cloudsearch/pc", rawData: [
                "s": params["keywords"] ?? "",
                "type": intParam(params, "type", 1),
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "eapi")
        case "/search/default":
            return ncmRequest("/api/search/defaultkeyword/get", rawData: [:], queryParams: params, defaultCrypto: "eapi")
        case "/search/hot/detail":
            return ncmRequest("/api/hotsearchlist/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/search/suggest":
            let t = params["type"] == "mobile" ? "keyword" : "web"
            return ncmRequest("/api/search/suggest/\(t)", rawData: [
                "s": params["keywords"] ?? ""
            ], queryParams: params, defaultCrypto: "weapi")

        // MARK: - 歌单 / 榜单 / 专辑 / 歌手
        case "/playlist/catlist":
            return ncmRequest("/api/playlist/catalogue", rawData: [:], queryParams: params, defaultCrypto: "eapi")
        case "/top/playlist":
            let res = ncmRequest("/api/playlist/list", rawData: [
                "cat": params["cat"] ?? "全部",
                "order": params["order"] ?? "hot",
                "limit": intParam(params, "limit", 50),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
            return NcmApiResponse(status: res.status, body: res.body.replacingOccurrences(of: "avatarImgId_str", with: "avatarImgIdStr"), cookies: res.cookies)
        case "/top/playlist/highquality":
            return ncmRequest("/api/playlist/highquality/list", rawData: [
                "cat": params["cat"] ?? "全部",
                "limit": intParam(params, "limit", 50),
                "lasttime": int64Param(params, "before", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/playlist/detail":
            return ncmRequest("/api/v6/playlist/detail", rawData: [
                "id": params["id"] ?? "",
                "n": 100000,
                "s": intParam(params, "s", 8)
            ], queryParams: params, defaultCrypto: "eapi")
        case "/playlist/track/all":
            return playlistTrackAll(params)
        case "/playlist/create":
            return ncmRequest("/api/playlist/create", rawData: [
                "name": params["name"] ?? "",
                "privacy": params["privacy"] ?? "0",
                "type": params["type"] ?? "NORMAL"
            ], queryParams: params, defaultCrypto: "weapi")
        case "/playlist/tracks":
            return playlistTracks(params)
        case "/playlist/subscribe":
            let t = params["t"]
            let action = t == "1" ? "subscribe" : "unsubscribe"
            var data: [String: Any] = ["id": params["id"] ?? ""]
            if t == "1" { data["checkToken"] = params["checkToken"] ?? Self.checkToken }
            return ncmRequest("/api/playlist/\(action)", rawData: data, queryParams: params, defaultCrypto: "eapi", checkToken: true)
        case "/playlist/import/name/task/create":
            return playlistImportCreate(params)
        case "/playlist/import/task/status":
            let taskIdsJson = jsonString([params["id"] ?? ""])
            return ncmRequest("/api/playlist/import/task/status/v2", rawData: ["taskIds": taskIdsJson], queryParams: params, defaultCrypto: "eapi")
        case "/toplist", "/toplist/detail":
            let uri = normalized == "/toplist/detail" ? "/api/toplist/detail" : "/api/toplist"
            return ncmRequest(uri, rawData: [:], queryParams: params, defaultCrypto: "eapi")
        case "/album":
            return ncmRequest("/api/v1/album/\(params["id"] ?? "")", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/album/newest":
            return ncmRequest("/api/discovery/newAlbum", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/album/new":
            return ncmRequest("/api/album/new", rawData: [
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "total": true,
                "area": params["area"] ?? "ALL"
            ], queryParams: params, defaultCrypto: "weapi")
        case "/top/album":
            let comps = Calendar.current.dateComponents([.year, .month], from: Date())
            return ncmRequest("/api/discovery/new/albums/area", rawData: [
                "area": params["area"] ?? "ALL",
                "limit": intParam(params, "limit", 50),
                "offset": intParam(params, "offset", 0),
                "type": params["type"] ?? "new",
                "year": intParam(params, "year", comps.year ?? 2026),
                "month": intParam(params, "month", comps.month ?? 1),
                "total": false,
                "rcmd": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/album/sub":
            let action = params["t"] == "1" ? "sub" : "unsub"
            return ncmRequest("/api/album/\(action)", rawData: ["id": params["id"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/album/sublist":
            return ncmRequest("/api/album/sublist", rawData: [
                "limit": intParam(params, "limit", 25),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/top/artists":
            return ncmRequest("/api/artist/top", rawData: [
                "limit": intParam(params, "limit", 50),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/artist/detail":
            return ncmRequest("/api/artist/head/info/get", rawData: ["id": params["id"] ?? ""], queryParams: params, defaultCrypto: "eapi")
        case "/artist/songs":
            return ncmRequest("/api/v1/artist/songs", rawData: [
                "id": params["id"] ?? "",
                "private_cloud": "true",
                "work_type": 1,
                "order": params["order"] ?? "hot",
                "offset": intParam(params, "offset", 0),
                "limit": intParam(params, "limit", 100)
            ], queryParams: params, defaultCrypto: "eapi")
        case "/artist/album":
            return ncmRequest("/api/artist/albums/\(params["id"] ?? "")", rawData: [
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/artist/new/song":
            return ncmRequest("/api/sub/artist/new/works/song/list", rawData: [
                "limit": intParam(params, "limit", 20),
                "startTimestamp": int64Param(params, "before", Int64(Date().timeIntervalSince1970 * 1000))
            ], queryParams: params, defaultCrypto: "weapi")

        // MARK: - 歌曲 / 歌词 / 喜欢 / 心动模式
        case "/song/url/v1":
            let level = params["level"] ?? "higher"
            var data: [String: Any] = [
                "ids": "[\(params["id"] ?? "")]",
                "level": level,
                "encodeType": params["encodeType"] ?? "flac"
            ]
            if level == "sky" { data["immerseType"] = "c51" }
            return ncmRequest("/api/song/enhance/player/url/v1", rawData: data, queryParams: params, defaultCrypto: "eapi")
        case "/song/download/url/v1":
            return ncmRequest("/api/song/enhance/download/url/v1", rawData: [
                "id": params["id"] ?? "",
                "immerseType": "c51",
                "level": params["level"] ?? "higher"
            ], queryParams: params, defaultCrypto: "eapi")
        case "/song/detail":
            let ids = (params["ids"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let c = "[" + ids.map { "{\"id\":\($0)}" }.joined(separator: ",") + "]"
            return ncmRequest("/api/v3/song/detail", rawData: ["c": c], queryParams: params, defaultCrypto: "weapi")
        case "/song/music/detail":
            return ncmRequest("/api/song/music/detail/get", rawData: ["songId": params["id"] ?? ""], queryParams: params, defaultCrypto: "eapi")
        case "/lyric/new":
            return ncmRequest("/api/song/lyric/v1", rawData: [
                "id": params["id"] ?? "",
                "cp": false,
                "tv": 0, "lv": 0, "rv": 0, "kv": 0,
                "yv": 0, "ytv": 0, "yrv": 0
            ], queryParams: params, defaultCrypto: "eapi")
        case "/lyric":
            return ncmRequest("/api/song/lyric", rawData: [
                "id": params["id"] ?? "",
                "tv": -1, "lv": -1, "rv": -1, "kv": -1, "_nmclfl": 1
            ], queryParams: params, defaultCrypto: "eapi")
        case "/like":
            return ncmRequest("/api/radio/like", rawData: [
                "alg": "itembased",
                "trackId": params["id"] ?? "",
                "like": params["like"] != "false",
                "time": "3"
            ], queryParams: params, defaultCrypto: "weapi")
        case "/likelist":
            return ncmRequest("/api/song/like/get", rawData: ["uid": params["uid"] ?? ""], queryParams: params, defaultCrypto: "eapi")
        case "/playmode/intelligence/list":
            return ncmRequest("/api/playmode/intelligence/list", rawData: [
                "songId": params["id"] ?? "",
                "type": "fromPlayOne",
                "playlistId": params["pid"] ?? "",
                "startMusicId": params["sid"] ?? params["id"] ?? "",
                "count": intParam(params, "count", 1)
            ], queryParams: params, defaultCrypto: "eapi")

        // MARK: - MV
        case "/mv/all":
            let tagsJson = jsonString([
                "地区": params["area"] ?? "全部",
                "类型": params["type"] ?? "全部",
                "排序": params["order"] ?? "上升最快"
            ])
            return ncmRequest("/api/mv/all", rawData: [
                "tags": tagsJson,
                "offset": intParam(params, "offset", 0),
                "total": "true",
                "limit": intParam(params, "limit", 30)
            ], queryParams: params, defaultCrypto: "eapi")
        case "/mv/detail":
            return ncmRequest("/api/v1/mv/detail", rawData: ["id": params["mvid"] ?? params["id"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/mv/url":
            return ncmRequest("/api/song/enhance/play/mv/url", rawData: [
                "id": params["id"] ?? "",
                "r": intParam(params, "r", 1080)
            ], queryParams: params, defaultCrypto: "weapi")

        // MARK: - 播客 / 电台
        case "/dj/sub":
            let action = params["t"] == "1" ? "sub" : "unsub"
            return ncmRequest("/api/djradio/\(action)", rawData: ["id": params["rid"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/dj/sublist":
            return ncmRequest("/api/djradio/get/subed", rawData: [
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "total": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/dj/detail":
            return ncmRequest("/api/djradio/v2/get", rawData: ["id": params["rid"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/dj/program":
            return ncmRequest("/api/dj/program/byradio", rawData: [
                "radioId": params["rid"] ?? "",
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "asc": params["asc"] == "true" || params["asc"] == "1"
            ], queryParams: params, defaultCrypto: "weapi")
        case "/dj/program/detail":
            return ncmRequest("/api/dj/program/detail", rawData: ["id": params["id"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/dj/recommend":
            return ncmRequest("/api/djradio/recommend/v1", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/dj/catelist":
            return ncmRequest("/api/djradio/category/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/dj/recommend/type":
            return ncmRequest("/api/djradio/recommend", rawData: ["cateId": params["type"] ?? ""], queryParams: params, defaultCrypto: "weapi")
        case "/dj/category/recommend":
            return ncmRequest("/api/djradio/home/category/recommend", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/dj/today/perfered":
            return ncmRequest("/api/djradio/home/today/perfered", rawData: ["page": intParam(params, "page", 0)], queryParams: params, defaultCrypto: "weapi")
        case "/dj/personalize/recommend":
            return ncmRequest("/api/djradio/personalize/rcmd", rawData: ["limit": intParam(params, "limit", 6)], queryParams: params, defaultCrypto: "weapi")
        case "/dj/banner":
            return ncmRequest("/api/djradio/banner/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/dj/toplist":
            return ncmRequest("/api/djradio/toplist", rawData: [
                "limit": intParam(params, "limit", 100),
                "offset": intParam(params, "offset", 0),
                "type": params["type"] == "hot" ? 1 : 0
            ], queryParams: params, defaultCrypto: "weapi")
        case "/dj/radio/hot":
            return ncmRequest("/api/djradio/hot", rawData: [
                "cateId": params["cateId"] ?? "",
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0)
            ], queryParams: params, defaultCrypto: "weapi")
        case "/comment/dj":
            let id = params["id"] ?? ""
            return ncmRequest("/api/v1/resource/comments/A_DJ_1_\(id)", rawData: [
                "rid": id,
                "limit": intParam(params, "limit", 20),
                "offset": intParam(params, "offset", 0),
                "beforeTime": int64Param(params, "before", 0)
            ], queryParams: params, defaultCrypto: "weapi")

        // MARK: - 用户与播放记录
        case "/user/account":
            return ncmRequest("/api/nuser/account/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        case "/user/detail":
            let res = ncmRequest("/api/v1/user/detail/\(params["uid"] ?? "")", rawData: [:], queryParams: params, defaultCrypto: "weapi")
            return NcmApiResponse(status: res.status, body: res.body.replacingOccurrences(of: "avatarImgId_str", with: "avatarImgIdStr"), cookies: res.cookies)
        case "/user/playlist":
            return ncmRequest("/api/user/playlist", rawData: [
                "uid": params["uid"] ?? "",
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "includeVideo": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/user/record":
            return ncmRequest("/api/v1/play/record", rawData: [
                "uid": params["uid"] ?? "",
                "type": intParam(params, "type", 0)
            ], queryParams: params, defaultCrypto: "weapi")
        case "/record/recent/song":
            return ncmRequest("/api/play-record/song/list", rawData: ["limit": intParam(params, "limit", 100)], queryParams: params, defaultCrypto: "weapi")
        case "/record/recent/playlist":
            return ncmRequest("/api/play-record/playlist/list", rawData: ["limit": intParam(params, "limit", 100)], queryParams: params, defaultCrypto: "weapi")
        case "/record/recent/album":
            return ncmRequest("/api/play-record/album/list", rawData: ["limit": intParam(params, "limit", 100)], queryParams: params, defaultCrypto: "weapi")
        case "/record/recent/dj":
            return ncmRequest("/api/play-record/djradio/list", rawData: ["limit": intParam(params, "limit", 100)], queryParams: params, defaultCrypto: "weapi")
        case "/scrobble":
            let songIdStr = params["id"] ?? ""
            let songIdVal: Any = Int64(songIdStr) ?? songIdStr
            let sourceId = params["sourceid"] ?? params["sourceId"] ?? ""
            let playSec = intParam(params, "time", 120)
            let innerJson: [String: Any] = [
                "download": 0,
                "end": "playend",
                "id": songIdVal,
                "sourceId": sourceId,
                "time": playSec,
                "type": "song",
                "wifi": 0,
                "source": "list",
                "mainsite": 1,
                "content": ""
            ]
            let logEntry: [[String: Any]] = [[
                "action": "play",
                "json": innerJson
            ]]
            return ncmRequest("/api/feedback/weblog", rawData: ["logs": jsonString(logEntry)], queryParams: params, defaultCrypto: "weapi")
        case "/user/follows":
            return ncmRequest("/api/user/getfollows/\(params["uid"] ?? "")", rawData: [
                "offset": intParam(params, "offset", 0),
                "limit": intParam(params, "limit", 30),
                "order": true
            ], queryParams: params, defaultCrypto: "weapi")
        case "/user/followeds":
            return ncmRequest("/api/user/getfolloweds/\(params["uid"] ?? "")", rawData: [
                "userId": params["uid"] ?? "",
                "time": "0",
                "limit": intParam(params, "limit", 30),
                "offset": intParam(params, "offset", 0),
                "getcounts": "true"
            ], queryParams: params, defaultCrypto: "eapi")

        default:
            return NcmApiResponse(status: 404, body: "{\"code\":404,\"msg\":\"Unknown endpoint: \(normalized)\"}", cookies: [])
        }
    }

    // MARK: - 复合接口

    private func registerAnonymous(_ params: [String: String]) -> NcmApiResponse {
        let encoded = NeteaseCrypto.encodeAnonymousUsername(deviceId)
        let res = ncmRequest("/api/register/anonimous", rawData: ["username": encoded], queryParams: params, defaultCrypto: "weapi")
        if var obj = parseJsonDict(res.body), (obj["code"] as? Int) == 200 {
            obj["cookie"] = res.cookies.joined(separator: ";")
            return NcmApiResponse(status: 200, body: jsonString(obj), cookies: res.cookies)
        }
        return res
    }

    private func loginQrKey(_ params: [String: String]) -> NcmApiResponse {
        let res = ncmRequest("/api/login/qrcode/unikey", rawData: ["type": 3], queryParams: params, defaultCrypto: "eapi")
        var wrapped: [String: Any] = ["code": 200]
        if let d = res.body.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: d) {
            wrapped["data"] = parsed
        }
        return NcmApiResponse(status: 200, body: jsonString(wrapped), cookies: res.cookies)
    }

    private func loginQrCreate(_ params: [String: String]) -> NcmApiResponse {
        let key = params["key"] ?? ""
        let qrUrl = "https://music.163.com/login?codekey=\(key)"
        let qrimgFlag = params["qrimg"]
        let needImg = qrimgFlag != nil && qrimgFlag != "false" && qrimgFlag != "0"
        let qrImg = needImg ? NeteaseCrypto.generateQrPngDataUrl(qrUrl) : ""
        let body: [String: Any] = [
            "code": 200,
            "data": [
                "qrurl": qrUrl,
                "qrimg": qrImg
            ]
        ]
        return NcmApiResponse(status: 200, body: jsonString(body), cookies: [])
    }

    private func loginQrCheck(_ params: [String: String]) -> NcmApiResponse {
        let res = ncmRequest("/api/login/qrcode/client/login", rawData: [
            "key": params["key"] ?? "",
            "type": 3
        ], queryParams: params, defaultCrypto: "eapi")
        var obj = parseJsonDict(res.body) ?? [:]
        obj["cookie"] = res.cookies.joined(separator: ";")
        return NcmApiResponse(status: 200, body: jsonString(obj), cookies: res.cookies)
    }

    private func loginStatus(_ params: [String: String]) -> NcmApiResponse {
        let res = ncmRequest("/api/w/nuser/account/get", rawData: [:], queryParams: params, defaultCrypto: "weapi")
        if let obj = parseJsonDict(res.body), (obj["code"] as? Int) == 200 {
            return NcmApiResponse(status: 200, body: jsonString(["data": obj]), cookies: res.cookies)
        }
        return res
    }

    private func loginCellphone(_ params: [String: String]) -> NcmApiResponse {
        var data: [String: Any] = [
            "type": "1",
            "https": "true",
            "phone": params["phone"] ?? "",
            "countrycode": params["countrycode"] ?? "86",
            "remember": "true"
        ]
        if let captcha = params["captcha"], !captcha.isEmpty {
            data["captcha"] = captcha
        } else {
            data["password"] = params["md5_password"] ?? NeteaseCrypto.md5Hex(params["password"] ?? "")
        }
        let res = ncmRequest("/api/w/login/cellphone", rawData: data, queryParams: params, defaultCrypto: "weapi")
        let cleanBody = res.body.replacingOccurrences(of: "avatarImgId_str", with: "avatarImgIdStr")
        if var obj = parseJsonDict(cleanBody), (obj["code"] as? Int) == 200 {
            obj["cookie"] = res.cookies.joined(separator: ";")
            return NcmApiResponse(status: 200, body: jsonString(obj), cookies: res.cookies)
        }
        return NcmApiResponse(status: res.status, body: cleanBody, cookies: res.cookies)
    }

    private func playlistTrackAll(_ params: [String: String]) -> NcmApiResponse {
        let detail = ncmRequest("/api/v6/playlist/detail", rawData: [
            "id": params["id"] ?? "",
            "n": 100000,
            "s": intParam(params, "s", 8)
        ], queryParams: params, defaultCrypto: "eapi")
        guard let root = parseJsonDict(detail.body),
              let playlist = root["playlist"] as? [String: Any],
              let trackIds = playlist["trackIds"] as? [[String: Any]] else {
            return detail
        }
        let limit = intParam(params, "limit", 1000)
        let offset = intParam(params, "offset", 0)
        let end = min(trackIds.count, offset + limit)
        var slice = [String]()
        if offset < end {
            for i in offset..<end {
                if let tid = trackIds[i]["id"] {
                    slice.append("{\"id\":\(tid)}")
                }
            }
        }
        let c = "[" + slice.joined(separator: ",") + "]"
        return ncmRequest("/api/v3/song/detail", rawData: ["c": c], queryParams: params, defaultCrypto: "eapi")
    }

    private func playlistTracks(_ params: [String: String]) -> NcmApiResponse {
        let tracks = (params["tracks"] ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
        var data: [String: Any] = [
            "op": params["op"] ?? "add",
            "pid": params["pid"] ?? "",
            "trackIds": jsonString(tracks),
            "imme": "true"
        ]
        let res = ncmRequest("/api/playlist/manipulate/tracks", rawData: data, queryParams: params, defaultCrypto: "eapi")
        let parsed = parseJsonDict(res.body)
        let code = (parsed?["code"] as? Int) ?? res.status
        if code == 512 {
            data["trackIds"] = jsonString(tracks + tracks)
            return ncmRequest("/api/playlist/manipulate/tracks", rawData: data, queryParams: params, defaultCrypto: "eapi")
        }
        var wrapped: [String: Any] = ["status": res.status]
        if let p = parsed { wrapped["body"] = p }
        return NcmApiResponse(status: 200, body: jsonString(wrapped), cookies: res.cookies)
    }

    private func playlistImportCreate(_ params: [String: String]) -> NcmApiResponse {
        var data: [String: Any] = ["importStarPlaylist": params["importStarPlaylist"] == "true"]
        if let local = params["local"], !local.isEmpty,
           let d = local.data(using: .utf8),
           let arr = (try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]] {
            let mapped = arr.map { o -> [String: String] in
                [
                    "songName": (o["name"] as? String) ?? "",
                    "artistName": (o["artist"] as? String) ?? "",
                    "albumName": (o["album"] as? String) ?? ""
                ]
            }
            data["multiSongs"] = jsonString(mapped)
        } else {
            let playlistName = params["playlistName"] ?? "导入音乐"
            data["playlistName"] = playlistName
            data["taskIdForLog"] = ""
            if let text = params["text"], !text.isEmpty {
                let encodedText = urlEncode(text)
                data["songs"] = jsonString([["name": playlistName, "type": "", "url": "rpc://playlist/import?text=\(encodedText)"]])
            } else if let link = params["link"], !link.isEmpty,
                      let d = link.data(using: .utf8),
                      let links = (try? JSONSerialization.jsonObject(with: d)) as? [String] {
                let songs = links.map { ["name": playlistName, "type": "", "url": $0] }
                data["songs"] = jsonString(songs)
            }
        }
        return ncmRequest("/api/playlist/import/name/task/create", rawData: data, queryParams: params, defaultCrypto: "eapi")
    }

    // MARK: - 底层加密请求执行器

    private func ncmRequest(
        _ uri: String,
        rawData: [String: Any],
        queryParams: [String: String],
        defaultCrypto: String,
        checkToken: Bool = false
    ) -> NcmApiResponse {
        if !hasAnonymousToken() && !uri.contains("anonimous") && !uri.contains("login") {
            ensureAnonymousToken()
        }

        let noCookie = queryParams["noCookie"] == "true"
        let incomingCookie = noCookie ? "" : (queryParams["cookie"] ?? "")
        let cookieMap = buildCookieMap(rawCookie: incomingCookie, uri: uri)
        let csrfToken = cookieMap["__csrf"] ?? ""
        let crypto = (queryParams["crypto"]?.isEmpty == false) ? queryParams["crypto"]! : defaultCrypto

        var dataMap = rawData
        dataMap["e_r"] = false

        var headers = [String: String]()
        if let realIP = queryParams["realIP"], !realIP.isEmpty {
            headers["X-Real-IP"] = realIP
            headers["X-Forwarded-For"] = realIP
        }

        let targetUrl: String
        let formParams: [String: String]
        let strippedUri = uri.hasPrefix("/api/") ? String(uri.dropFirst(5)) : uri

        switch crypto {
        case "weapi":
            headers["Referer"] = Self.domain
            headers["User-Agent"] = Self.uaWeapi
            headers["Cookie"] = cookieMapToString(cookieMap)
            dataMap["csrf_token"] = csrfToken
            formParams = NeteaseCrypto.weapi(jsonString(dataMap))
            targetUrl = "\(Self.domain)/weapi/\(strippedUri)"
        case "linuxapi":
            headers["User-Agent"] = Self.uaLinux
            headers["Cookie"] = cookieMapToString(cookieMap)
            let wrapper: [String: Any] = ["method": "POST", "url": "\(Self.domain)\(uri)", "params": dataMap]
            formParams = NeteaseCrypto.linuxapi(jsonString(wrapper))
            targetUrl = "\(Self.domain)/api/linux/forward"
        case "api":
            let eapiHeader = buildEapiHeader(cookieMap: cookieMap, csrfToken: csrfToken, checkToken: checkToken)
            headers["Cookie"] = cookieMapToString(eapiHeader)
            headers["User-Agent"] = Self.uaApiIphone
            targetUrl = "\(Self.apiDomain)\(uri)"
            var mapped = [String: String]()
            for (k, v) in dataMap {
                mapped[k] = (v as? String) ?? jsonString(v)
            }
            formParams = mapped
        default:
            let eapiHeader = buildEapiHeader(cookieMap: cookieMap, csrfToken: csrfToken, checkToken: checkToken)
            headers["Cookie"] = cookieMapToString(eapiHeader)
            headers["User-Agent"] = cookieMap["os"] == "pc" ? Self.uaApiPc : Self.uaApiIphone
            dataMap["header"] = eapiHeader
            formParams = NeteaseCrypto.eapi(url: uri, jsonText: jsonString(dataMap))
            targetUrl = "\(Self.apiDomain)/eapi/\(strippedUri)"
        }

        guard let url = URL(string: targetUrl),
              SafeHttpGuard.validateUrlAndResolve(url, allowedSuffixes: SafeHttpGuard.neteaseAllowedDomains) else {
            return NcmApiResponse(status: 403, body: "{\"code\":403,\"msg\":\"Blocked non-allowlisted target URL\"}", cookies: [])
        }

        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }

        let formBody = formParams.map { "\(urlEncode($0.key))=\(urlEncode($0.value))" }.joined(separator: "&")
        req.httpBody = formBody.data(using: .utf8)

        let sem = DispatchSemaphore(value: 0)
        var respData: Data?
        var httpResp: HTTPURLResponse?
        var reqError: Error?

        session.dataTask(with: req) { data, response, err in
            respData = data
            httpResp = response as? HTTPURLResponse
            reqError = err
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 18)

        if let err = reqError {
            return NcmApiResponse(status: 502, body: jsonString(["code": 502, "msg": err.localizedDescription]), cookies: [])
        }

        let rawBody = respData.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        var setCookies = [String]()
        if let http = httpResp, let urlObj = http.url {
            var headerDict = [String: String]()
            for (k, v) in http.allHeaderFields {
                headerDict["\(k)"] = "\(v)"
            }
            let parsedCookies = HTTPCookie.cookies(withResponseHeaderFields: headerDict, for: urlObj)
            for c in parsedCookies {
                setCookies.append("\(c.name)=\(c.value); Path=/")
            }
        }

        let respCode = httpResp?.statusCode ?? 200
        let parsedCode = (parseJsonDict(rawBody)?["code"] as? Int) ?? respCode
        var httpStatus = Self.specialCodes.contains(parsedCode) ? 200 : parsedCode
        if !(101...599).contains(httpStatus) { httpStatus = 200 }

        return NcmApiResponse(status: httpStatus, body: rawBody, cookies: setCookies)
    }

    private func buildCookieMap(rawCookie: String, uri: String) -> [String: String] {
        var parsed = parseCookieString(rawCookie)
        let osKey = parsed["os"] ?? "pc"
        let osMeta: (String, String, String, String)
        switch osKey {
        case "android": osMeta = ("android", "8.20.20.231215173437", "14", "xiaomi")
        case "iphone": osMeta = ("iPhone OS", "9.0.90", "16.2", "distribution")
        case "linux": osMeta = ("linux", "1.2.1.0428", "Deepin 20.9", "netease")
        default: osMeta = ("pc", "3.1.17.204416", "Microsoft-Windows-10-Professional-build-19045-64bit", "netease")
        }

        let nuid = parsed["_ntes_nuid"] ?? NeteaseCrypto.randomHex(byteCount: 32)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if parsed["__remember_me"] == nil { parsed["__remember_me"] = "true" }
        if parsed["ntes_kaola_ad"] == nil { parsed["ntes_kaola_ad"] = "1" }
        if parsed["_ntes_nuid"] == nil { parsed["_ntes_nuid"] = nuid }
        if parsed["_ntes_nnid"] == nil { parsed["_ntes_nnid"] = "\(nuid),\(nowMs)" }
        if parsed["WNMCID"] == nil { parsed["WNMCID"] = wnmcid }
        if parsed["WEVNSM"] == nil { parsed["WEVNSM"] = "1.0.0" }
        if parsed["osver"] == nil { parsed["osver"] = osMeta.2 }
        if parsed["deviceId"] == nil { parsed["deviceId"] = deviceId }
        if parsed["os"] == nil { parsed["os"] = osMeta.0 }
        if parsed["channel"] == nil { parsed["channel"] = osMeta.3 }
        if parsed["appver"] == nil { parsed["appver"] = osMeta.1 }

        if !uri.contains("login") {
            parsed["NMTID"] = NeteaseCrypto.randomHex(byteCount: 16)
        }
        tokenLock.lock()
        let anon = anonymousToken
        tokenLock.unlock()
        if (parsed["MUSIC_U"] ?? "").isEmpty && (parsed["MUSIC_A"] ?? "").isEmpty && !anon.isEmpty {
            parsed["MUSIC_A"] = anon
        }
        return parsed
    }

    private func buildEapiHeader(cookieMap: [String: String], csrfToken: String, checkToken: Bool) -> [String: String] {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let randSuffix = String(format: "%04d", Int.random(in: 0..<1000))
        var map: [String: String] = [
            "osver": cookieMap["osver"] ?? "16.2",
            "deviceId": cookieMap["deviceId"] ?? deviceId,
            "os": cookieMap["os"] ?? "pc",
            "appver": cookieMap["appver"] ?? "3.1.17.204416",
            "versioncode": cookieMap["versioncode"] ?? "140",
            "mobilename": cookieMap["mobilename"] ?? "",
            "buildver": cookieMap["buildver"] ?? "\(nowMs / 1000)",
            "resolution": cookieMap["resolution"] ?? "1920x1080",
            "__csrf": csrfToken,
            "channel": cookieMap["channel"] ?? "netease",
            "requestId": "\(nowMs)_\(randSuffix)"
        ]
        if checkToken { map["X-antiCheatToken"] = Self.checkToken }
        if let u = cookieMap["MUSIC_U"], !u.isEmpty { map["MUSIC_U"] = u }
        if let a = cookieMap["MUSIC_A"], !a.isEmpty { map["MUSIC_A"] = a }
        return map
    }

    private func parseCookieString(_ cookie: String) -> [String: String] {
        guard !cookie.isEmpty else { return [:] }
        var result = [String: String]()
        let skipKeys: Set<String> = ["path", "expires", "max-age", "httponly", "samesite", "secure", "domain"]
        for part in cookie.split(separator: ";") {
            guard let eqIdx = part.firstIndex(of: "=") else { continue }
            let k = part[..<eqIdx].trimmingCharacters(in: .whitespaces)
            let v = part[part.index(after: eqIdx)...].trimmingCharacters(in: .whitespaces)
            if !k.isEmpty && !skipKeys.contains(k.lowercased()) {
                result[k] = v
            }
        }
        return result
    }

    private func cookieMapToString(_ map: [String: String]) -> String {
        return map.map { "\(urlEncode($0.key))=\(urlEncode($0.value))" }.joined(separator: "; ")
    }

    private func parseJsonDict(_ text: String) -> [String: Any]? {
        guard let d = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    private func jsonString(_ obj: Any) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let s = String(data: d, encoding: .utf8) else {
            return "{}"
        }
        return s
    }

    private func urlEncode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    private func intParam(_ params: [String: String], _ key: String, _ defaultVal: Int) -> Int {
        guard let s = params[key], let d = Double(s) else { return defaultVal }
        return Int(d)
    }

    private func int64Param(_ params: [String: String], _ key: String, _ defaultVal: Int64) -> Int64 {
        guard let s = params[key], let d = Double(s) else { return defaultVal }
        return Int64(d)
    }
}
