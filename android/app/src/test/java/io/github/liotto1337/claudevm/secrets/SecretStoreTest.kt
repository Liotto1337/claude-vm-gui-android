package io.github.liotto1337.claudevm.secrets

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class SecretStoreTest {
    /** Keystore в Robolectric нет — ключ AES в памяти. */
    private class InMemoryKey : KeyProvider {
        private val k: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        override fun key(): SecretKey = k
    }

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Test fun `сохранить, прочитать, удалить`() {
        val s = SecretStore(ctx, InMemoryKey())
        assertEquals("no", s.has("password"))
        s.save("password", "секрет")
        assertEquals("yes", s.has("password"))
        assertEquals("секрет", s.read("password"))
        s.save("password", null)
        assertEquals("no", s.has("password"))
        assertNull(s.read("password"))
    }

    @Test fun `в SharedPreferences нет открытого текста`() {
        SecretStore(ctx, InMemoryKey()).save("password", "секрет-123")
        val all = ctx.getSharedPreferences("cvg-secrets", Context.MODE_PRIVATE).all.values.joinToString()
        assertFalse(all.contains("секрет-123"))
    }

    @Test fun `ключ Keystore потерян — не расшифровывается`() {
        SecretStore(ctx, InMemoryKey()).save("password", "x")
        val other = SecretStore(ctx, InMemoryKey())
        assertEquals("unreadable", other.has("password"))
        assertNull(other.read("password"))
    }

    @Test fun `повреждённый шифротекст — не расшифровывается`() {
        val s = SecretStore(ctx, InMemoryKey())
        s.save("key", "KEY")
        ctx.getSharedPreferences("cvg-secrets", Context.MODE_PRIVATE).edit().putString("key", "AAAA").commit()
        assertEquals("unreadable", s.has("key"))
    }

    @Test fun `пустая строка — удалить`() {
        val s = SecretStore(ctx, InMemoryKey())
        s.save("key", "KEY")
        s.save("key", "")
        assertEquals("no", s.has("key"))
    }
}
