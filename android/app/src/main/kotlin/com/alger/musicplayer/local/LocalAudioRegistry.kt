package com.alger.musicplayer.local

import android.content.Context
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * 内存级合法本地音频路径白名单注册表：
 * 仅在原生本地扫描器（MediaStore / 应用专属目录扫描）发现合法音频文件时登记其 canonicalPath，
 * 避免 EmbeddedHttpServer 放行整个外部共享存储根目录。
 */
object LocalAudioRegistry {
    private val allowedAudioExts = setOf(
        ".mp3", ".flac", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".wma"
    )

    private val registeredCanonicalPaths: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun registerFile(context: Context, file: File): Boolean {
        if (!file.exists() || !file.isFile) return false
        val lowerName = file.name.lowercase()
        if (allowedAudioExts.none { lowerName.endsWith(it) }) return false

        val canonical = runCatching { file.canonicalPath }.getOrNull() ?: return false
        val forbiddenRoots = listOfNotNull(
            runCatching { context.filesDir.canonicalPath }.getOrNull(),
            runCatching { context.cacheDir.canonicalPath }.getOrNull(),
            runCatching { context.dataDir.canonicalPath }.getOrNull()
        )
        if (forbiddenRoots.any { root -> canonical == root || canonical.startsWith("$root${File.separator}") }) {
            return false
        }
        registeredCanonicalPaths.add(canonical)
        return true
    }

    fun registerPath(context: Context, path: String): Boolean {
        if (path.isBlank() || path.startsWith("content://")) return false
        return registerFile(context, File(path))
    }

    fun isRegistered(canonicalPath: String): Boolean {
        return canonicalPath.isNotEmpty() && registeredCanonicalPaths.contains(canonicalPath)
    }

    fun clear() {
        registeredCanonicalPaths.clear()
    }
}
