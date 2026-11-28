package com.xiaopang.naiwamusic.download

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import com.xiaopang.naiwamusic.server.SafeHttpGuard
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit

/**
 * 原生音乐与歌词下载管理器
 * 兼容 AlgerMusicPlayer v5.1.0 DownloadPage.vue 与 useDownload.ts 的全部事件和数据结构
 */
class NativeDownloadManager(
    private val context: Context,
    private val eventEmitter: (String, String) -> Unit
) {
    companion object {
        private const val TAG = "NativeDownloadManager"
        private const val MAX_DOWNLOAD_BYTES = 200L * 1024L * 1024L // 单曲上限 200MB

        internal fun buildDownloadRecord(
            safeName: String,
            targetFile: File,
            songInfo: JsonObject?
        ): JsonObject {
            return JsonObject().apply {
                addProperty("filename", safeName)
                addProperty("path", targetFile.absolutePath)
                addProperty("size", targetFile.length())
                val idPrim = songInfo?.get("id")
                    ?.takeIf { !it.isJsonNull && it.isJsonPrimitive }
                    ?.asJsonPrimitive
                if (idPrim != null) {
                    if (idPrim.isNumber) {
                        addProperty("id", idPrim.asLong)
                    } else {
                        val rawId = idPrim.asString.trim()
                        val numericId = rawId.toLongOrNull()
                        when {
                            numericId != null -> addProperty("id", numericId)
                            rawId.isNotEmpty() -> addProperty("id", rawId)
                            else -> addProperty("id", targetFile.absolutePath.hashCode().toLong())
                        }
                    }
                } else {
                    addProperty("id", targetFile.absolutePath.hashCode().toLong())
                }
                val nameVal = songInfo?.get("name")
                    ?.takeIf { !it.isJsonNull && it.isJsonPrimitive }
                    ?.asString
                    ?.takeIf { it.isNotBlank() }
                    ?: safeName
                val picUrlVal = songInfo?.get("picUrl")
                    ?.takeIf { !it.isJsonNull && it.isJsonPrimitive }
                    ?.asString
                    ?: ""
                addProperty("name", nameVal)
                addProperty("picUrl", picUrlVal)
                val arEl = songInfo?.get("ar")
                if (arEl != null && !arEl.isJsonNull) {
                    add("ar", arEl)
                }
                addProperty("downloadTime", System.currentTimeMillis())
            }
        }
    }

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val indexLock = Any()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SafeHttpGuard.createSafeDns(SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS))
        .build()

    fun getDownloadDir(): File {
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), "AlgerMusicPlayer")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun isInsideDownloadDir(file: File): Boolean {
        val rootPath = runCatching { getDownloadDir().canonicalPath }.getOrNull() ?: return false
        val targetPath = runCatching { file.canonicalPath }.getOrNull() ?: return false
        return targetPath.startsWith("$rootPath${File.separator}")
    }

    private fun isSafePublicHttpUrl(rawUrl: String): Boolean {
        return SafeHttpGuard.validateUrlSyntax(rawUrl, SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS) != null
    }

    private fun getIndexFile(): File = File(getDownloadDir(), ".alger_downloads_index.json")

    fun enqueueDownload(payload: JsonObject) {
        val url = payload.get("url")?.takeIf { !it.isJsonNull && it.isJsonPrimitive }?.asString?.trim() ?: ""
        val rawFilename = payload.get("filename")?.takeIf { !it.isJsonNull && it.isJsonPrimitive }?.asString
            ?: "unknown_${System.currentTimeMillis()}"
        val songInfo = payload.get("songInfo")?.takeIf { it.isJsonObject }?.asJsonObject
        val typeHint = payload.get("type")?.takeIf { !it.isJsonNull && it.isJsonPrimitive }?.asString

        if (url.isBlank() || !isSafePublicHttpUrl(url)) {
            emitError(rawFilename, "无效或不安全的下载地址")
            return
        }

        // 推送入队事件
        eventEmitter(
            "music-download-queued",
            gson.toJson(mapOf("filename" to rawFilename, "songInfo" to songInfo))
        )

        scope.launch {
            var partFile: File? = null
            try {
                val safeName = sanitizeFilename(rawFilename)
                val ext = resolveExt(url, typeHint)
                val downloadDir = getDownloadDir()
                val targetFile = File(downloadDir, "$safeName.$ext")
                val tempFile = File(downloadDir, "$safeName.$ext.${System.nanoTime()}.part")
                partFile = tempFile

                val reqBuilder = Request.Builder()
                    .url(url)
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
                    )
                if (url.contains("bilivideo") || url.contains("bilibili")) {
                    reqBuilder.header("Referer", "https://www.bilibili.com/")
                }

                SafeHttpGuard.executeWithSafeRedirects(
                    client,
                    reqBuilder.build(),
                    SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
                ).use { resp ->
                    if (!resp.isSuccessful) {
                        throw IllegalStateException("HTTP ${resp.code}")
                    }
                    val body = resp.body ?: throw IllegalStateException("Empty response body")
                    val totalBytes = body.contentLength()
                    var downloaded = 0L
                    var lastReportTime = 0L

                    body.byteStream().use { input ->
                        FileOutputStream(tempFile).use { output ->
                            val buf = ByteArray(16 * 1024)
                            while (true) {
                                val read = input.read(buf)
                                if (read == -1) break
                                downloaded += read
                                if (downloaded > MAX_DOWNLOAD_BYTES) {
                                    throw IllegalStateException("文件体积超过 200MB 安全上限")
                                }
                                output.write(buf, 0, read)

                                val now = System.currentTimeMillis()
                                if (now - lastReportTime >= 250) {
                                    lastReportTime = now
                                    val progress = if (totalBytes > 0) {
                                        ((downloaded * 100.0) / totalBytes).coerceIn(0.0, 99.5)
                                    } else 50.0
                                    eventEmitter(
                                        "music-download-progress",
                                        gson.toJson(
                                            mapOf(
                                                "filename" to rawFilename,
                                                "progress" to progress,
                                                "loaded" to downloaded,
                                                "total" to if (totalBytes > 0) totalBytes else downloaded,
                                                "path" to targetFile.absolutePath,
                                                "status" to "downloading",
                                                "songInfo" to songInfo
                                            )
                                        )
                                    )
                                }
                            }
                            output.flush()
                        }
                    }

                    if (downloaded <= 0L) {
                        throw IllegalStateException("下载内容为空")
                    }
                    if (totalBytes > 0L && downloaded < totalBytes) {
                        throw IllegalStateException("下载流提前中断 ($downloaded/$totalBytes)")
                    }

                    try {
                        Files.move(
                            tempFile.toPath(),
                            targetFile.toPath(),
                            StandardCopyOption.REPLACE_EXISTING,
                            StandardCopyOption.ATOMIC_MOVE
                        )
                    } catch (_: Exception) {
                        runCatching {
                            Files.move(
                                tempFile.toPath(),
                                targetFile.toPath(),
                                StandardCopyOption.REPLACE_EXISTING
                            )
                        }.getOrElse {
                            if (targetFile.exists()) targetFile.delete()
                            if (!tempFile.renameTo(targetFile)) {
                                throw IllegalStateException("写入目标音频文件失败")
                            }
                        }
                    }

                    // 同步导出一份到公共 Music/AlgerMusicPlayer 便于其他系统音乐软件识别
                    runCatching { exportCopyToPublicMusic(targetFile, ext) }

                    // 记录到本地下载索引
                    val record = buildDownloadRecord(safeName, targetFile, songInfo)
                    saveRecord(record)

                    eventEmitter(
                        "music-download-progress",
                        gson.toJson(
                            mapOf(
                                "filename" to rawFilename,
                                "progress" to 100.0,
                                "loaded" to targetFile.length(),
                                "total" to targetFile.length(),
                                "path" to targetFile.absolutePath,
                                "status" to "completed",
                                "songInfo" to songInfo
                            )
                        )
                    )
                    eventEmitter(
                        "music-download-complete",
                        gson.toJson(
                            mapOf(
                                "success" to true,
                                "filename" to rawFilename,
                                "path" to targetFile.absolutePath,
                                "size" to targetFile.length(),
                                "songInfo" to songInfo
                            )
                        )
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Download failed for $rawFilename: ${e.message}")
                emitError(rawFilename, e.message ?: "下载失败")
            } finally {
                runCatching { partFile?.takeIf { it.exists() }?.delete() }
            }
        }
    }

    private fun exportCopyToPublicMusic(sourceFile: File, ext: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Audio.Media.DISPLAY_NAME, sourceFile.name)
                put(MediaStore.Audio.Media.MIME_TYPE, if (ext == "flac") "audio/flac" else "audio/mpeg")
                put(MediaStore.Audio.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MUSIC}/AlgerMusicPlayer")
                put(MediaStore.Audio.Media.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values) ?: return
            context.contentResolver.openOutputStream(uri)?.use { out ->
                sourceFile.inputStream().use { it.copyTo(out) }
            }
            values.clear()
            values.put(MediaStore.Audio.Media.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
        } else {
            MediaScannerConnection.scanFile(context, arrayOf(sourceFile.absolutePath), null, null)
        }
    }

    fun saveLyricFile(filename: String, lrcContent: String): JsonObject {
        return try {
            val safe = sanitizeFilename(filename)
            val lrcFile = File(getDownloadDir(), "$safe.lrc")
            lrcFile.writeText(lrcContent, Charsets.UTF_8)
            JsonObject().apply {
                addProperty("success", true)
                addProperty("path", lrcFile.absolutePath)
            }
        } catch (e: Exception) {
            JsonObject().apply {
                addProperty("success", false)
                addProperty("error", e.message ?: "保存失败")
            }
        }
    }

    fun saveTextFile(filename: String, content: String): JsonObject {
        return try {
            val rawBase = filename.trim().ifEmpty { "xiaopang-music-backup.json" }
            val sanitized = sanitizeFilename(rawBase).trim('.').ifBlank { "xiaopang-music-backup.json" }
            val lower = sanitized.lowercase()
            val safe = if (lower.endsWith(".json") || lower.endsWith(".txt")) {
                sanitized
            } else {
                "$sanitized.json"
            }
            val backupDir = File(getDownloadDir(), "Backups").apply { mkdirs() }
            val outFile = File(backupDir, safe)
            outFile.writeText(content, Charsets.UTF_8)
            JsonObject().apply {
                addProperty("success", true)
                addProperty("path", outFile.absolutePath)
            }
        } catch (e: Exception) {
            JsonObject().apply {
                addProperty("success", false)
                addProperty("error", e.message ?: "保存失败")
            }
        }
    }

    /**
     * 将前端 Canvas 导出的 Base64 PNG 听歌报告图片保存至系统相册（Pictures/XiaoPangNaiwaMusic）
     */
    fun saveImageToGallery(filename: String, base64Data: String): JsonObject {
        return try {
            val pureBase64 = base64Data.substringAfter("base64,", base64Data).trim()
            if (pureBase64.isEmpty()) {
                return JsonObject().apply {
                    addProperty("success", false)
                    addProperty("error", "图片内容为空")
                }
            }
            val bytes = Base64.decode(pureBase64, Base64.DEFAULT)
            if (bytes.isEmpty() || bytes.size > 12 * 1024 * 1024) {
                return JsonObject().apply {
                    addProperty("success", false)
                    addProperty("error", "图片体积超出限制")
                }
            }
            val safeBase = sanitizeFilename(filename).removeSuffix(".png").ifBlank {
                "xiaopang-listening-report-${System.currentTimeMillis()}"
            }
            val finalName = "$safeBase.png"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, finalName)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/XiaoPangNaiwaMusic")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("无法创建相册图片条目")
                resolver.openOutputStream(uri)?.use { out ->
                    out.write(bytes)
                } ?: throw IllegalStateException("无法写入相册图片流")
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                JsonObject().apply {
                    addProperty("success", true)
                    addProperty("path", "Pictures/XiaoPangNaiwaMusic/$finalName")
                    addProperty("uri", uri.toString())
                }
            } else {
                val picRoot = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: getDownloadDir()
                val targetDir = File(picRoot, "XiaoPangNaiwaMusic").apply { if (!exists()) mkdirs() }
                val outFile = File(targetDir, finalName)
                outFile.writeBytes(bytes)
                MediaScannerConnection.scanFile(context, arrayOf(outFile.absolutePath), arrayOf("image/png"), null)
                JsonObject().apply {
                    addProperty("success", true)
                    addProperty("path", outFile.absolutePath)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "saveImageToGallery failed: ${e.message}", e)
            JsonObject().apply {
                addProperty("success", false)
                addProperty("error", e.message ?: "保存图片失败")
            }
        }
    }

    fun getDownloadedSongIds(): Set<String> {
        val ids = LinkedHashSet<String>()
        val list = getDownloadedList()
        for (el in list) {
            val obj = el.asJsonObject
            val idEl = obj.get("id")
            if (idEl != null && !idEl.isJsonNull) {
                val raw = idEl.asString.trim()
                if (raw.isNotEmpty()) ids.add(raw)
            }
        }
        return ids
    }

    fun getDownloadedList(): JsonArray {
        synchronized(indexLock) {
            val raw = loadIndexArray()
            val valid = JsonArray()
            for (el in raw) {
                val obj = el.asJsonObject
                val p = obj.get("path")?.asString ?: continue
                if (File(p).exists()) {
                    valid.add(obj)
                }
            }
            if (valid.size() != raw.size()) {
                writeIndexArray(valid)
            }
            return valid
        }
    }

    fun deleteDownloaded(path: String): Boolean {
        synchronized(indexLock) {
            val file = File(path)
            if (!isInsideDownloadDir(file)) {
                Log.w(TAG, "Blocked out-of-bounds delete attempt: $path")
                return false
            }
            val deleted = if (file.exists()) file.delete() else true
            val arr = loadIndexArray()
            val next = JsonArray()
            for (el in arr) {
                if (el.asJsonObject.get("path")?.asString != path) {
                    next.add(el)
                }
            }
            writeIndexArray(next)
            return deleted
        }
    }

    fun clearDownloaded(): Boolean {
        synchronized(indexLock) {
            val arr = loadIndexArray()
            for (el in arr) {
                val p = el.asJsonObject.get("path")?.asString ?: continue
                val f = File(p)
                if (isInsideDownloadDir(f)) {
                    runCatching { f.delete() }
                }
            }
            writeIndexArray(JsonArray())
            return true
        }
    }

    private fun saveRecord(record: JsonObject) {
        synchronized(indexLock) {
            val arr = loadIndexArray()
            val path = record.get("path")?.asString
            val next = JsonArray()
            next.add(record)
            for (el in arr) {
                if (el.asJsonObject.get("path")?.asString != path) {
                    next.add(el)
                }
            }
            writeIndexArray(next)
        }
    }

    private fun loadIndexArray(): JsonArray {
        val f = getIndexFile()
        if (!f.exists()) return JsonArray()
        return runCatching { JsonParser.parseString(f.readText(Charsets.UTF_8)).asJsonArray }
            .getOrElse { JsonArray() }
    }

    private fun writeIndexArray(arr: JsonArray) {
        runCatching { getIndexFile().writeText(gson.toJson(arr), Charsets.UTF_8) }
    }

    private fun emitError(filename: String, errorMsg: String) {
        val payload = gson.toJson(mapOf("success" to false, "filename" to filename, "error" to errorMsg))
        eventEmitter("music-download-complete", payload)
        eventEmitter("music-download-error", payload)
    }

    private fun sanitizeFilename(name: String): String {
        return name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().take(120).ifEmpty { "song" }
    }

    private fun resolveExt(url: String, hint: String?): String {
        val cleanHint = hint?.lowercase()?.removePrefix(".")
        if (cleanHint in listOf("mp3", "flac", "m4a", "aac", "ogg", "wav")) return cleanHint!!
        val lower = url.substringBefore("?").lowercase()
        return when {
            lower.endsWith(".flac") -> "flac"
            lower.endsWith(".m4a") -> "m4a"
            lower.endsWith(".aac") -> "aac"
            lower.endsWith(".ogg") -> "ogg"
            lower.endsWith(".wav") -> "wav"
            else -> "mp3"
        }
    }
}
