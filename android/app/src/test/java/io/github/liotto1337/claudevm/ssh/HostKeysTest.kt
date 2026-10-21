package io.github.liotto1337.claudevm.ssh

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64

class HostKeysTest {
    private val plain = Fixtures.text("kh_plain").trim()
    private val type = plain.split(" ")[1]
    private val key = Base64.getDecoder().decode(plain.split(" ")[2])
    private val otherKey = Base64.getDecoder().decode(Fixtures.text("kh_rsa").trim().split(" ")[2])

    private fun file(text: String): File = Files.createTempFile("kh", "").toFile().apply { writeText(text) }

    @Test fun `отпечаток как у ssh-keygen`() = assertEquals(Fixtures.text("kh_fingerprint").trim(), HostKeys.fingerprint(key))
    @Test fun `тип ключа из blob`() {
        assertEquals("ssh-ed25519", HostKeys.typeOf(key))
        assertEquals("ssh-rsa", HostKeys.typeOf(otherKey))
    }
    @Test fun `простая запись`() = assertEquals(HostKeys.Check.MATCH, HostKeys(file(plain)).check("127.0.0.1", 22, type, key))
    @Test fun `хешированная запись`() = assertEquals(HostKeys.Check.MATCH, HostKeys(file(Fixtures.text("kh_hashed"))).check("127.0.0.1", 22, type, key))
    @Test fun `запись с портом`() {
        val f = file("[h]:2222 $type ${plain.split(" ")[2]}")
        assertEquals(HostKeys.Check.MATCH, HostKeys(f).check("h", 2222, type, key))
        assertEquals(HostKeys.Check.UNKNOWN, HostKeys(f).check("h", 22, type, key))
    }
    @Test fun `список хостов через запятую`() =
        assertEquals(HostKeys.Check.MATCH, HostKeys(file("a,127.0.0.1 $type ${plain.split(" ")[2]}")).check("127.0.0.1", 22, type, key))
    @Test fun `другой хост — неизвестен`() = assertEquals(HostKeys.Check.UNKNOWN, HostKeys(file(plain)).check("10.9.9.9", 22, type, key))
    @Test fun `подменённый ключ — mismatch, и для хешированной записи`() {
        val fake = key.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        assertEquals(HostKeys.Check.MISMATCH, HostKeys(file(plain)).check("127.0.0.1", 22, type, fake))
        assertEquals(HostKeys.Check.MISMATCH, HostKeys(file(Fixtures.text("kh_hashed"))).check("127.0.0.1", 22, type, fake))
    }
    @Test fun `комментарии, пустые строки и нет файла`() {
        assertEquals(HostKeys.Check.MATCH, HostKeys(file("# c\n\n$plain\n")).check("127.0.0.1", 22, type, key))
        assertEquals(HostKeys.Check.UNKNOWN, HostKeys(File("/nonexistent/kh")).check("127.0.0.1", 22, type, key))
    }
    @Test fun `известные типы хоста и алгоритмы — rsa включает rsa-sha2`() {
        val kh = HostKeys(file("$plain\n127.0.0.1 ssh-rsa ${Base64.getEncoder().encodeToString(otherKey)}"))
        assertEquals(setOf("ssh-ed25519", "ssh-rsa"), kh.knownTypes("127.0.0.1", 22).toSet())
        assertEquals(listOf("rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"), HostKeys.algorithms(listOf("ssh-rsa")))
    }
    @Test fun `новый ключ дописывается и потом совпадает`() {
        val f = Files.createTempDirectory("kh").resolve("sub/known_hosts").toFile()
        val kh = HostKeys(f)
        kh.add("h", 2222, type, key)
        assertEquals("[h]:2222 $type ${plain.split(" ")[2]}", f.readText().trim())
        assertEquals(HostKeys.Check.MATCH, kh.check("h", 2222, type, key))
    }
    @Test fun `отпечаток записанного ключа того же типа`() =
        assertEquals(HostKeys.fingerprint(key), HostKeys(file(plain)).knownFingerprint("127.0.0.1", 22, type))
}
