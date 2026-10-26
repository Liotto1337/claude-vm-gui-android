package io.github.liotto1337.claudevm.files

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.OutputStream
import java.util.UUID

/**
 * Файлы outbox на телефоне. save — в «Загрузки» (Android 10+ — MediaStore без разрешений, Android 8–9 — публичная
 * папка Download), без перезаписи: занятое имя — «имя (1).ext». cacheForView — в кэш приложения (своя папка на каждое
 * открытие) для просмотра другим приложением. Ошибка в write — недокачанного файла не остаётся.
 */
object Downloads {
    fun save(ctx: Context, name: String, write: (OutputStream) -> Unit): Uri =
        if (Build.VERSION.SDK_INT >= 29) saveMediaStore(ctx, name, write) else saveLegacy(ctx, name, write)

    fun cacheForView(ctx: Context, name: String, write: (OutputStream) -> Unit): Uri {
        val dir = File(ctx.cacheDir, "outbox/${UUID.randomUUID()}").apply { mkdirs() }
        return providerUri(ctx, writeFile(File(dir, safe(name)), write))
    }

    fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: when (ext) {
            "html", "htm" -> "text/html"
            "apk" -> "application/vnd.android.package-archive"
            else -> "application/octet-stream"
        }
    }

    private fun saveMediaStore(ctx: Context, name: String, write: (OutputStream) -> Unit): Uri {
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safe(name))
            put(MediaStore.Downloads.MIME_TYPE, mimeOf(name))
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Не удалось создать файл в «Загрузках»")
        try {
            (resolver.openOutputStream(uri) ?: error("Не удалось открыть файл в «Загрузках»")).use(write)
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(ctx: Context, name: String, write: (OutputStream) -> Unit): Uri {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).apply { mkdirs() }
        return providerUri(ctx, writeFile(free(dir, safe(name)), write))
    }

    private fun writeFile(file: File, write: (OutputStream) -> Unit): File {
        try {
            file.outputStream().use(write)
            return file
        } catch (e: Throwable) {
            file.delete()
            throw e
        }
    }

    /** Свободное имя: «a.txt», «a (1).txt», «a (2).txt»… */
    private fun free(dir: File, name: String): File {
        val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
        var file = File(dir, name)
        var n = 1
        while (file.exists()) file = File(dir, "${name.substring(0, dot)} (${n++})${name.substring(dot)}")
        return file
    }

    private fun safe(name: String) = name.replace('/', '_').ifBlank { "file" }

    private fun providerUri(ctx: Context, file: File): Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
}
