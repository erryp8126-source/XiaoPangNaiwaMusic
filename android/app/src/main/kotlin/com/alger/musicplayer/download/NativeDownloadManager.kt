package com.alger.musicplayer.download

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
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
    }

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val indexLock = Any()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun getDownloadDir(): File {
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), "AlgerMusicPlayer")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun getIndexFile(): File = File(getDownloadDir(), ".alger_downloads_index.json")

    fun enqueueDownload(payload: JsonObject) {
        val url = payload.get("url")?.asString ?: ""
        val rawFilename = payload.get("filename")?.asString ?: "unknown_${System.currentTimeMillis()}"
        val songInfo = payload.getAsJsonObject("songInfo")
        val typeHint = payload.get("type")?.asString

        if (url.isBlank()) {
            emitError(rawFilename, "下载地址为空")
            return
        }

        // 推送入队事件
        eventEmitter(
            "music-download-queued",
            gson.toJson(mapOf("filename" to rawFilename, "songInfo" to songInfo))
        )

        scope.launch {
            try {
                val safeName = sanitizeFilename(rawFilename)
                val ext = resolveExt(url, typeHint)
                val targetFile = File(getDownloadDir(), "$safeName.$ext")

                val reqBuilder = Request.Builder()
                    .url(url)
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
                    )
                if (url.contains("bilivideo") || url.contains("bilibili")) {
                    reqBuilder.header("Referer", "https://www.bilibili.com/")
                }

                client.newCall(reqBuilder.build()).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        throw IllegalStateException("HTTP ${resp.code}")
                    }
                    val body = resp.body ?: throw IllegalStateException("Empty response body")
                    val totalBytes = body.contentLength()
                    var downloaded = 0L
                    var lastReportTime = 0L

                    body.byteStream().use { input ->
                        FileOutputStream(targetFile).use { output ->
                            val buf = ByteArray(16 * 1024)
                            while (true) {
                                val read = input.read(buf)
                                if (read == -1) break
                                output.write(buf, 0, read)
                                downloaded += read

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
                        }
                    }

                    // 同步导出一份到公共 Music/AlgerMusicPlayer 便于其他系统音乐软件识别
                    runCatching { exportCopyToPublicMusic(targetFile, ext) }

                    // 记录到本地下载索引
                    val record = JsonObject().apply {
                        addProperty("filename", safeName)
                        addProperty("path", targetFile.absolutePath)
                        addProperty("size", targetFile.length())
                        addProperty("id", songInfo?.get("id")?.asLong ?: targetFile.absolutePath.hashCode().toLong())
                        addProperty("name", songInfo?.get("name")?.asString ?: safeName)
                        addProperty("picUrl", songInfo?.get("picUrl")?.asString ?: "")
                        if (songInfo?.has("ar") == true) {
                            add("ar", songInfo.get("ar"))
                        }
                        addProperty("downloadTime", System.currentTimeMillis())
                    }
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
            val safe = sanitizeFilename(filename).ifBlank { "xiaopang-music-backup.json" }
            val outFile = File(getDownloadDir(), safe)
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
                runCatching { File(p).delete() }
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
