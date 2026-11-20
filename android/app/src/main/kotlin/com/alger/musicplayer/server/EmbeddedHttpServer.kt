package com.alger.musicplayer.server

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.URLDecoder

/**
 * 手机内置回环 HTTP 服务器 (127.0.0.1:30488)
 * 职责：
 * 1. 承载全部网易云音乐直连 API (/personalized, /cloudsearch, /song/url/v1, /lyric/new 等 80+ 路由)
 * 2. 承载内置多音源解锁接口 (/music, /unblock)
 * 3. 提供本地音频文件 Range 流式播放 (/local-file) 与内嵌专辑封面提取 (/local-cover)
 * 4. 完整处理 CORS 跨域头与 OPTIONS 预检，完美配合 WebViewAssetLoader
 */
class EmbeddedHttpServer(
    private val context: Context,
    port: Int,
    private val ncmClient: NeteaseApiClient,
    private val unblockEngine: MusicUnblockEngine
) : NanoHTTPD("127.0.0.1", port) {

    companion object {
        private const val TAG = "EmbeddedHttpServer"
    }

    private val gson = Gson()

    override fun serve(session: IHTTPSession): Response {
        val origin = session.headers["origin"] ?: "*"

        // 处理 CORS OPTIONS 预检请求
        if (session.method == Method.OPTIONS) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.OK, "text/plain", ""), origin)
        }

        val uri = session.uri ?: "/"

        return try {
            val response = when {
                uri == "/__alger_health" -> handleHealth()
                uri == "/local-file" -> handleLocalFile(session)
                uri == "/local-cover" -> handleLocalCover(session)
                uri == "/music" || uri == "/unblock" -> handleMusicUnblock(session)
                else -> handleNeteaseApi(session, uri)
            }
            addCorsHeaders(response, origin)
        } catch (e: Exception) {
            Log.e(TAG, "Error handling $uri: ${e.message}", e)
            val errJson = gson.toJson(mapOf("code" to 500, "msg" to (e.message ?: "Internal Server Error")))
            addCorsHeaders(
                newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json; charset=utf-8", errJson),
                origin
            )
        }
    }

    private fun handleHealth(): Response {
        val json = gson.toJson(
            mapOf(
                "status" to "ok",
                "port" to listeningPort,
                "hasAnonToken" to ncmClient.hasAnonymousToken(),
                "version" to "5.1.0-android"
            )
        )
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json)
    }

    private fun handleNeteaseApi(session: IHTTPSession, uri: String): Response {
        val params = collectParams(session)
        // 如果 header 中带有 Cookie 且 params 未传 cookie，则补充
        val headerCookie = session.headers["cookie"]
        if (params["cookie"].isNullOrBlank() && !headerCookie.isNullOrBlank() && params["noCookie"] != "true") {
            params["cookie"] = headerCookie
        }

        val apiRes = ncmClient.dispatch(uri, params)
        val status = Response.Status.lookup(apiRes.status) ?: Response.Status.OK
        val resp = newFixedLengthResponse(status, "application/json; charset=utf-8", apiRes.body)
        if (apiRes.cookies.isNotEmpty()) {
            // 仅透传必要 Cookie
            apiRes.cookies.forEach { c -> resp.addHeader("Set-Cookie", c) }
        }
        return resp
    }

    private fun handleMusicUnblock(session: IHTTPSession): Response {
        val params = collectParams(session)
        val songId = params["id"] ?: ""
        var songName = params["name"] ?: ""
        var artists = params["artist"] ?: ""

        // 如果只传了网易云歌曲 ID，先通过内置网易云 API 查歌曲名与歌手名
        if (songName.isBlank() && songId.isNotBlank()) {
            val detailRes = ncmClient.dispatch("/song/detail", mapOf("ids" to songId))
            runCatching {
                val root = JsonParser.parseString(detailRes.body).asJsonObject
                val songs = root.getAsJsonArray("songs")
                if (songs != null && songs.size() > 0) {
                    val s = songs[0].asJsonObject
                    songName = s.get("name")?.asString ?: ""
                    val arArr = s.getAsJsonArray("ar")
                    if (arArr != null) {
                        artists = arArr.mapNotNull { it.asJsonObject.get("name")?.asString }.joinToString(" ")
                    }
                }
            }
        }

        val sources = params["sources"]?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }
            ?: listOf("kuwo", "kugou", "migu", "gdmusic")

        val result = unblockEngine.unblock(songId, songName, artists, sources)
        return if (result != null) {
            val json = gson.toJson(
                mapOf(
                    "code" to 200,
                    "message" to "success",
                    "data" to mapOf(
                        "url" to result.url,
                        "br" to result.br,
                        "size" to result.size,
                        "platform" to result.platform,
                        "gain" to 0
                    )
                )
            )
            newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json)
        } else {
            val json = gson.toJson(mapOf("code" to 404, "message" to "未能解析到可用音源"))
            newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json)
        }
    }

    private fun handleLocalCover(session: IHTTPSession): Response {
        val params = collectParams(session)
        val albumIdStr = params["albumId"]
        val pathStr = params["path"]

        // 1. 优先从 MediaStore Album Art 加载
        if (!albumIdStr.isNullOrBlank()) {
            val albumId = albumIdStr.toLongOrNull()
            if (albumId != null && albumId > 0) {
                val artUri = ContentUris.withAppendedId(
                    Uri.parse("content://media/external/audio/albumart"),
                    albumId
                )
                runCatching {
                    context.contentResolver.openInputStream(artUri)?.use { input ->
                        val bytes = input.readBytes()
                        if (bytes.isNotEmpty()) {
                            return newFixedLengthResponse(
                                Response.Status.OK,
                                "image/jpeg",
                                ByteArrayInputStream(bytes),
                                bytes.size.toLong()
                            )
                        }
                    }
                }
            }
        }

        // 2. 尝试通过 MediaMetadataRetriever 提取音频内嵌封面
        if (!pathStr.isNullOrBlank()) {
            val decoded = runCatching { URLDecoder.decode(pathStr, "UTF-8") }.getOrDefault(pathStr)
            val retriever = MediaMetadataRetriever()
            try {
                if (decoded.startsWith("content://")) {
                    retriever.setDataSource(context, Uri.parse(decoded))
                } else {
                    val file = File(decoded)
                    if (file.exists()) retriever.setDataSource(file.absolutePath)
                }
                val pic = retriever.embeddedPicture
                if (pic != null && pic.isNotEmpty()) {
                    // 压缩一下超大封面防止 OOM
                    val bmp = BitmapFactory.decodeByteArray(pic, 0, pic.size)
                    val out = ByteArrayOutputStream()
                    if (bmp != null) {
                        bmp.compress(Bitmap.CompressFormat.JPEG, 82, out)
                        bmp.recycle()
                        val compressed = out.toByteArray()
                        return newFixedLengthResponse(
                            Response.Status.OK,
                            "image/jpeg",
                            ByteArrayInputStream(compressed),
                            compressed.size.toLong()
                        )
                    }
                }
            } catch (_: Exception) {
                // ignore
            } finally {
                runCatching { retriever.release() }
            }
        }

        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "No cover")
    }

    private fun handleLocalFile(session: IHTTPSession): Response {
        val params = collectParams(session)
        val rawPath = params["path"] ?: return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Missing path")
        val decoded = runCatching { URLDecoder.decode(rawPath, "UTF-8") }.getOrDefault(rawPath)

        val mime = guessAudioMime(decoded)
        val rangeHeader = session.headers["range"]

        if (decoded.startsWith("content://")) {
            val uri = Uri.parse(decoded)
            val pfd = context.contentResolver.openAssetFileDescriptor(uri, "r")
                ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
            val totalLength = pfd.length
            val stream = pfd.createInputStream()
            return if (totalLength > 0) {
                serveStreamWithRange(stream, totalLength, mime, rangeHeader)
            } else {
                newChunkedResponse(Response.Status.OK, mime, stream)
            }
        }

        val file = File(decoded)
        if (!file.exists() || !file.isFile) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "File not found")
        }
        return serveStreamWithRange(FileInputStream(file), file.length(), mime, rangeHeader)
    }

    private fun serveStreamWithRange(
        input: InputStream,
        totalLen: Long,
        mime: String,
        rangeHeader: String?
    ): Response {
        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            val rangeSpec = rangeHeader.removePrefix("bytes=").split(",")[0].trim()
            val parts = rangeSpec.split("-")
            val start = parts.getOrNull(0)?.toLongOrNull() ?: 0L
            val end = parts.getOrNull(1)?.toLongOrNull()?.coerceAtMost(totalLen - 1) ?: (totalLen - 1)
            if (start in 0..end && end < totalLen) {
                val len = end - start + 1
                var skipped = 0L
                while (skipped < start) {
                    val s = input.skip(start - skipped)
                    if (s <= 0) break
                    skipped += s
                }
                val resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mime, input, len)
                resp.addHeader("Accept-Ranges", "bytes")
                resp.addHeader("Content-Range", "bytes $start-$end/$totalLen")
                return resp
            }
        }
        val resp = newFixedLengthResponse(Response.Status.OK, mime, input, totalLen)
        resp.addHeader("Accept-Ranges", "bytes")
        return resp
    }

    private fun collectParams(session: IHTTPSession): MutableMap<String, String> {
        val result = LinkedHashMap<String, String>()
        session.parameters?.forEach { (k, list) ->
            if (!list.isNullOrEmpty()) result[k] = list[0]
        }

        if (session.method == Method.POST || session.method == Method.PUT) {
            val bodyMap = HashMap<String, String>()
            runCatching { session.parseBody(bodyMap) }
            val postData = bodyMap["postData"]
            if (!postData.isNullOrBlank()) {
                val trimmed = postData.trim()
                if (trimmed.startsWith("{")) {
                    runCatching {
                        val obj = JsonParser.parseString(trimmed).asJsonObject
                        obj.entrySet().forEach { (k, v) ->
                            if (!v.isJsonNull) {
                                result[k] = if (v.isJsonPrimitive) v.asString else gson.toJson(v)
                            }
                        }
                    }
                } else {
                    trimmed.split("&").forEach { pair ->
                        val idx = pair.indexOf('=')
                        if (idx > 0) {
                            val k = runCatching { URLDecoder.decode(pair.substring(0, idx), "UTF-8") }.getOrDefault("")
                            val v = runCatching { URLDecoder.decode(pair.substring(idx + 1), "UTF-8") }.getOrDefault("")
                            if (k.isNotEmpty()) result[k] = v
                        }
                    }
                }
            }
            // NanoHTTPD 解析 form 参数后也会放进 session.parameters
            session.parameters?.forEach { (k, list) ->
                if (!list.isNullOrEmpty() && !result.containsKey(k)) {
                    result[k] = list[0]
                }
            }
        }
        return result
    }

    private fun addCorsHeaders(resp: Response, origin: String): Response {
        resp.addHeader("Access-Control-Allow-Origin", origin)
        resp.addHeader("Access-Control-Allow-Credentials", "true")
        resp.addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        resp.addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Cookie")
        resp.addHeader("Cache-Control", "no-store")
        return resp
    }

    private fun guessAudioMime(path: String): String {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".flac") -> "audio/flac"
            lower.endsWith(".wav") -> "audio/wav"
            lower.endsWith(".ogg") || lower.endsWith(".oga") -> "audio/ogg"
            lower.endsWith(".m4a") || lower.endsWith(".aac") -> "audio/mp4"
            lower.endsWith(".opus") -> "audio/opus"
            else -> "audio/mpeg"
        }
    }
}
