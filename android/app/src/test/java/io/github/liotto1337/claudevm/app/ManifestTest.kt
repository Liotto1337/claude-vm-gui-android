package io.github.liotto1337.claudevm.app

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ManifestTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Test fun `резервная копия выключена — настройки без ключей Keystore всё равно не расшифровать`() {
        assertEquals(0, ctx.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    }

    @Test fun `FileProvider на месте — через него Capacitor отдаёт снимок камеры в выбор картинки`() {
        val providers = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PROVIDERS).providers.orEmpty()
        assertTrue(providers.any { it.authority == "${ctx.packageName}.fileprovider" })
    }

    @Test fun `запись в «Загрузки» запрашивается только для Android 8–9`() {
        // PackageManager Robolectric (новый SDK) такое разрешение не показывает — проверяем сам манифест
        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        assertTrue(Regex("""WRITE_EXTERNAL_STORAGE"\s+android:maxSdkVersion="28"""").containsMatchIn(manifest))
    }
}
