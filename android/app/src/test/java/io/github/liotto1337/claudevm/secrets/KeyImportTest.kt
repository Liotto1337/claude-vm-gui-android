package io.github.liotto1337.claudevm.secrets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyImportTest {
    private fun key(name: String) = javaClass.getResource("/keys/$name")!!.readText()

    @Test fun `ed25519 без фразы`() {
        val r = KeyImport.parse(key("ed25519"), null)
        assertTrue(r is KeyImport.Result.Ok)
        assertEquals("ed25519", (r as KeyImport.Result.Ok).type)
    }

    @Test fun `rsa в PEM`() = assertEquals("rsa", (KeyImport.parse(key("rsa"), null) as KeyImport.Result.Ok).type)

    @Test fun `ключ с фразой без неё — нужна фраза`() =
        assertEquals(KeyImport.Result.NeedsPassphrase, KeyImport.parse(key("ed25519-pass"), null))

    @Test fun `ключ с верной фразой`() = assertEquals("ed25519", (KeyImport.parse(key("ed25519-pass"), "test") as KeyImport.Result.Ok).type)

    @Test fun `неверная фраза`() =
        assertEquals(KeyImport.Result.Invalid("Неверная парольная фраза"), KeyImport.parse(key("ed25519-pass"), "wrong"))

    @Test fun `мусор`() =
        assertEquals(KeyImport.Result.Invalid("Это не закрытый ключ OpenSSH или PEM"), KeyImport.parse("не ключ", null))

    @Test fun `открытый ключ вместо закрытого`() =
        assertEquals(
            KeyImport.Result.Invalid("Это не закрытый ключ OpenSSH или PEM"),
            KeyImport.parse("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA test", null),
        )
}
