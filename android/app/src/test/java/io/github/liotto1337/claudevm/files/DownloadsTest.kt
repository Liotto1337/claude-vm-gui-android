package io.github.liotto1337.claudevm.files

import android.content.Context
import android.os.Environment
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowEnvironment
import java.io.File
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
class DownloadsTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    @Suppress("DEPRECATION")
    private val dl: File get() = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)

    // Как на телефоне: Download лежит внутри корня внешней памяти (у Robolectric по умолчанию это разные папки),
    // иначе FileProvider (external-path ".") не найдёт файл
    @Before fun externalRoot() {
        ShadowEnvironment.setExternalStorageDirectory(dl.parentFile!!.toPath())
        // FileProvider запоминает корни на весь процесс, а у каждого теста Robolectric своя временная папка
        FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }.let { (it.get(null) as MutableMap<*, *>).clear() }
    }

    @Config(sdk = [28])
    @Test fun `Android 8–9 — файл в публичной папке Download, ссылка через FileProvider`() {
        val uri = Downloads.save(ctx, "отчёт.zip") { it.write(byteArrayOf(1, 2, 3)) }
        assertArrayEquals(byteArrayOf(1, 2, 3), File(dl, "отчёт.zip").readBytes())
        assertEquals("content", uri.scheme)
        assertEquals("${ctx.packageName}.fileprovider", uri.authority)
    }

    @Config(sdk = [28])
    @Test fun `имя занято — «имя (1)» с тем же расширением, старый файл не перезаписан`() {
        Downloads.save(ctx, "a.txt") { it.write("старый".toByteArray()) }
        Downloads.save(ctx, "a.txt") { it.write("новый".toByteArray()) }
        assertEquals("старый", File(dl, "a.txt").readText())
        assertEquals("новый", File(dl, "a (1).txt").readText())
    }

    @Config(sdk = [28])
    @Test fun `ошибка во время записи — недокачанного файла нет`() {
        try {
            Downloads.save(ctx, "cut.bin") {
                it.write(ByteArray(10))
                throw IOException("Связь с ВМ прервалась")
            }
            fail("ошибка должна дойти до вызывающего")
        } catch (e: IOException) {
            assertEquals("Связь с ВМ прервалась", e.message)
        }
        assertFalse(File(dl, "cut.bin").exists())
    }

    @Test fun `страница для просмотра — в кэше, своя папка на каждое открытие`() {
        val a = Downloads.cacheForView(ctx, "r.html") { it.write("<h1>1</h1>".toByteArray()) }
        val b = Downloads.cacheForView(ctx, "r.html") { it.write("<h1>2</h1>".toByteArray()) }
        assertTrue(a != b)
        assertEquals("${ctx.packageName}.fileprovider", a.authority)
        val files = File(ctx.cacheDir, "outbox").walk().filter { it.isFile }.toList()
        assertEquals(2, files.size)
    }

    @Test fun `тип файла по расширению`() {
        assertEquals("text/html", Downloads.mimeOf("a.HTML"))
        assertEquals("application/vnd.android.package-archive", Downloads.mimeOf("app.apk"))
        assertEquals("application/octet-stream", Downloads.mimeOf("без-расширения"))
    }
}
