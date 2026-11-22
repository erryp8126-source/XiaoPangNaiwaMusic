package com.xiaopang.naiwamusic.local

import android.content.ContentUris
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import java.io.File
import java.net.URLEncoder

/**
 * Android 原生本地音乐扫描器（基于 MediaStore + 下载目录补充 + 同名 .lrc 歌词读取）
 */
class LocalMusicScanner(
    private val context: Context,
    private val localServerPortProvider: () -> Int,
    private val localAuthTokenProvider: () -> String = { "" }
) {
    private val supportedExts = setOf(".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".wma")

    private val scannedCache = LinkedHashMap<String, ScannedTrack>()

    data class ScannedTrack(
        val filePath: String,
        val title: String,
        val artist: String,
        val album: String,
        val duration: Long,
        val albumId: Long,
        val fileSize: Long,
        val modifiedTime: Long
    )

    fun scanWithStats(folderPath: String): JsonObject {
        val filesArr = JsonArray()
        val seenPaths = HashSet<String>()

        // 1. 查询 Android 系统 MediaStore 音频库
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_MODIFIED
        )

        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.DURATION} >= 10000"
        val sortOrder = "${MediaStore.Audio.Media.DATE_ADDED} DESC"

        runCatching {
            context.contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                null,
                sortOrder
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA)
                val titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                val albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)
                val durCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION)
                val albumIdCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID)
                val sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE)
                val modCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val rawPath = if (dataCol >= 0) cursor.getString(dataCol) else null
                    val contentUri = ContentUris.withAppendedId(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        id
                    ).toString()

                    val effectivePath = if (!rawPath.isNullOrBlank() && File(rawPath).canRead()) {
                        rawPath
                    } else {
                        contentUri
                    }

                    // 如果用户指定了某个具体目录，按路径过滤
                    if (folderPath.isNotBlank() &&
                        folderPath != "__ANDROID_MEDIASTORE__" &&
                        rawPath != null &&
                        !rawPath.startsWith(folderPath, ignoreCase = true)
                    ) {
                        continue
                    }

                    val duration = if (durCol >= 0) cursor.getLong(durCol) else 0L
                    if (duration in 1..4999) continue // 过滤系统提示音/短铃声

                    val title = if (titleCol >= 0) cursor.getString(titleCol) ?: "" else ""
                    val artist = if (artistCol >= 0) cursor.getString(artistCol) ?: "未知艺术家" else "未知艺术家"
                    val album = if (albumCol >= 0) cursor.getString(albumCol) ?: "未知专辑" else "未知专辑"
                    val albumId = if (albumIdCol >= 0) cursor.getLong(albumIdCol) else 0L
                    val size = if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L
                    val modSec = if (modCol >= 0) cursor.getLong(modCol) else 0L
                    val modMs = modSec * 1000L

                    if (seenPaths.add(effectivePath)) {
                        if (!effectivePath.startsWith("content://")) {
                            LocalAudioRegistry.registerPath(context, effectivePath)
                        }
                        scannedCache[effectivePath] = ScannedTrack(
                            filePath = effectivePath,
                            title = title.ifBlank { extractFilename(effectivePath) },
                            artist = if (artist == "<unknown>") "未知艺术家" else artist,
                            album = if (album == "<unknown>") "未知专辑" else album,
                            duration = duration,
                            albumId = albumId,
                            fileSize = size,
                            modifiedTime = modMs
                        )
                        filesArr.add(JsonObject().apply {
                            addProperty("path", effectivePath)
                            addProperty("modifiedTime", modMs)
                        })
                    }
                }
            }
        }

        // 2. 额外扫描 App 自有下载目录（即使尚未被系统媒体库索引也能立即看到）
        val appMusicDir = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), "AlgerMusicPlayer")
        scanDirRecursive(appMusicDir, seenPaths, filesArr)

        return JsonObject().apply {
            add("files", filesArr)
        }
    }

    private fun scanDirRecursive(dir: File, seen: MutableSet<String>, out: JsonArray) {
        if (!dir.exists() || !dir.isDirectory) return
        dir.listFiles()?.forEach { f ->
            if (f.isDirectory) {
                scanDirRecursive(f, seen, out)
            } else if (f.isFile && supportedExts.any { f.name.lowercase().endsWith(it) }) {
                val p = f.absolutePath
                if (seen.add(p)) {
                    LocalAudioRegistry.registerFile(context, f)
                    out.add(JsonObject().apply {
                        addProperty("path", p)
                        addProperty("modifiedTime", f.lastModified())
                    })
                }
            }
        }
    }

    fun parseMetadata(filePaths: List<String>): JsonArray {
        val port = localServerPortProvider()
        val tokenParam = localAuthTokenProvider().takeIf { it.isNotBlank() }?.let { "&token=${enc(it)}" } ?: ""
        val result = JsonArray()

        for (filePath in filePaths) {
            val cached = scannedCache[filePath]
            if (cached != null) {
                val coverUrl = if (cached.albumId > 0) {
                    "http://127.0.0.1:$port/local-cover?albumId=${cached.albumId}&path=${enc(filePath)}$tokenParam"
                } else {
                    "http://127.0.0.1:$port/local-cover?path=${enc(filePath)}$tokenParam"
                }
                result.add(JsonObject().apply {
                    addProperty("filePath", cached.filePath)
                    addProperty("title", cached.title)
                    addProperty("artist", cached.artist)
                    addProperty("album", cached.album)
                    addProperty("duration", cached.duration)
                    addProperty("cover", coverUrl)
                    val lrc = readSidecarLrc(cached.filePath)
                    if (lrc != null) addProperty("lyrics", lrc) else add("lyrics", null)
                    addProperty("fileSize", cached.fileSize)
                    addProperty("modifiedTime", cached.modifiedTime)
                })
                continue
            }

            // 未在 MediaStore 缓存中的文件使用 MediaMetadataRetriever 解析
            val meta = extractViaRetriever(filePath, port, tokenParam)
            result.add(meta)
        }
        return result
    }

    private fun extractViaRetriever(filePath: String, port: Int, tokenParam: String): JsonObject {
        val file = File(filePath)
        var title = extractFilename(filePath)
        var artist = "未知艺术家"
        var album = "未知专辑"
        var duration = 0L
        var hasCover = false

        val retriever = MediaMetadataRetriever()
        try {
            if (filePath.startsWith("content://")) {
                retriever.setDataSource(context, Uri.parse(filePath))
            } else if (file.exists()) {
                retriever.setDataSource(file.absolutePath)
            }
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
                ?.takeIf { it.isNotBlank() }?.let { title = it }
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
                ?.takeIf { it.isNotBlank() }?.let { artist = it }
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
                ?.takeIf { it.isNotBlank() }?.let { album = it }
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()?.let { duration = it }
            hasCover = retriever.embeddedPicture != null
        } catch (_: Exception) {
            // fallback to filename
        } finally {
            runCatching { retriever.release() }
        }

        return JsonObject().apply {
            addProperty("filePath", filePath)
            addProperty("title", title)
            addProperty("artist", artist)
            addProperty("album", album)
            addProperty("duration", duration)
            if (hasCover) {
                addProperty("cover", "http://127.0.0.1:$port/local-cover?path=${enc(filePath)}$tokenParam")
            } else {
                add("cover", null)
            }
            val lrc = readSidecarLrc(filePath)
            if (lrc != null) addProperty("lyrics", lrc) else add("lyrics", null)
            addProperty("fileSize", if (file.exists()) file.length() else 0L)
            addProperty("modifiedTime", if (file.exists()) file.lastModified() else 0L)
        }
    }

    private fun readSidecarLrc(filePath: String): String? {
        if (filePath.startsWith("content://")) return null
        val dotIdx = filePath.lastIndexOf('.')
        if (dotIdx <= 0) return null
        val lrcFile = File(filePath.substring(0, dotIdx) + ".lrc")
        return if (lrcFile.exists() && lrcFile.canRead()) {
            runCatching { lrcFile.readText(Charsets.UTF_8) }.getOrNull()
        } else null
    }

    fun getScannedPaths(): Set<String> {
        return LinkedHashSet(scannedCache.keys)
    }

    fun checkFileExists(path: String): Boolean {
        if (path.isBlank()) return false
        if (path.startsWith("content://")) {
            return runCatching {
                context.contentResolver.openAssetFileDescriptor(Uri.parse(path), "r")?.use { true } ?: false
            }.getOrDefault(false)
        }
        return File(path).exists()
    }

    private fun extractFilename(path: String): String {
        val name = path.substringAfterLast('/').substringAfterLast('\\')
        val dot = name.lastIndexOf('.')
        return if (dot > 0) name.substring(0, dot) else name
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
}
