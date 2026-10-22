package io.github.liotto1337.claudevm.ssh

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import java.util.Collections

/** Против sshd на этой ВМ: тестовый ключ ~/.ssh/cvg_test_ed25519 пускает root только с localhost. */
class SshSessionTest {
    private class Recorder(private val trust: Boolean = true) : SshListener {
        val prompts = Collections.synchronizedList(mutableListOf<HostKeyPrompt>())
        val events = Collections.synchronizedList(mutableListOf<String>())
        val out = Collections.synchronizedMap(mutableMapOf<Int, java.io.ByteArrayOutputStream>())
        val err = Collections.synchronizedMap(mutableMapOf<Int, java.io.ByteArrayOutputStream>())
        val seqs = Collections.synchronizedMap(mutableMapOf<Int, MutableList<Int>>())
        val closed = Collections.synchronizedSet(mutableSetOf<Int>())
        override suspend fun onHostKey(p: HostKeyPrompt): Boolean = trust.also { prompts.add(p) }
        override fun onState(state: String, attempt: Int?) { events.add("state:$state") }
        override fun onLost() { events.add("lost") }
        override fun onReconnected() { events.add("reconnected") }
        // stdout и stderr приходят из разных нитей: getOrPut у synchronizedMap не атомарен
        override fun onData(ch: Int, seq: Int, bytes: ByteArray) = synchronized(this) {
            out.getOrPut(ch) { java.io.ByteArrayOutputStream() }.write(bytes); seqs.getOrPut(ch) { mutableListOf() }.add(seq); Unit
        }
        override fun onStderr(ch: Int, seq: Int, bytes: ByteArray) = synchronized(this) {
            err.getOrPut(ch) { java.io.ByteArrayOutputStream() }.write(bytes); seqs.getOrPut(ch) { mutableListOf() }.add(seq); Unit
        }
        override fun onClose(ch: Int) { closed.add(ch) }
        fun text(ch: Int) = out[ch]?.toString(Charsets.UTF_8) ?: ""
    }

    private class Secrets(private val map: Map<String, String?>) : SecretSource {
        override fun read(name: String): String? = map[name]
    }

    private val open = mutableListOf<SshSession>()
    private fun kh(): File = Files.createTempDirectory("kh").resolve("known_hosts").toFile()
    private fun keySecrets() = Secrets(mapOf("key" to Fixtures.testKey.readText()))
    private fun session(rec: Recorder, secrets: SecretSource = keySecrets(), known: File = kh(), user: String = "root") =
        SshSession(SshConfig("127.0.0.1", 22, user), secrets, HostKeys(known), rec).also { open.add(it) }
    private fun waitFor(ms: Long = 5000, cond: () -> Boolean): Boolean {
        val t = System.currentTimeMillis()
        while (System.currentTimeMillis() - t < ms) { if (cond()) return true; Thread.sleep(50) }
        return cond()
    }

    @Before fun needKey() = assumeTrue("нет тестового ключа", Fixtures.testKey.exists())
    @After fun closeAll() = open.forEach { it.close() }

    @Test fun `неизвестный ключ хоста — вопрос, запись в known_hosts, команды выполняются`() = runBlocking {
        val rec = Recorder()
        val known = kh()
        val s = session(rec, known = known)
        assertEquals(SshResult.Ok, s.connect(interactive = true))
        assertEquals(1, rec.prompts.size)
        assertEquals("unknown", rec.prompts[0].kind)
        assertTrue(rec.prompts[0].fingerprint.startsWith("SHA256:"))
        assertTrue(known.readText().startsWith("127.0.0.1 ssh-"))
        assertEquals(ExecResult(0, "hi\n", ""), s.exec("echo hi"))
        // Второй раз ключ уже известен — без вопроса
        val rec2 = Recorder()
        assertEquals(SshResult.Ok, session(rec2, known = known).connect(interactive = true))
        assertEquals(0, rec2.prompts.size)
    }

    @Test fun `ключ с парольной фразой — фраза из секретов`() = runBlocking {
        val copy = Files.createTempDirectory("key").resolve("k").toFile()
        Fixtures.testKey.copyTo(copy)
        copy.setReadable(false, false); copy.setReadable(true, true)
        assertEquals(0, ProcessBuilder("ssh-keygen", "-q", "-p", "-N", "test", "-f", copy.path).start().waitFor())
        val s = session(Recorder(), Secrets(mapOf("key" to copy.readText(), "passphrase" to "test")))
        assertEquals(SshResult.Ok, s.connect(true))
        assertEquals("hi\n", s.exec("echo hi").stdout)
    }

    @Test fun `сессию закрыли во время рукопожатия — после входа соединение не остаётся`() = runBlocking {
        var self: SshSession? = null
        val events = Collections.synchronizedList(mutableListOf<String>())
        val listener = object : SshListener {
            override fun onState(state: String, attempt: Int?) { events.add(state) }
            // Пока человек сверяет отпечаток, интерфейс перезагрузился и новый connect закрыл эту сессию
            override suspend fun onHostKey(p: HostKeyPrompt): Boolean = true.also { self!!.close() }
        }
        val s = SshSession(SshConfig("127.0.0.1", 22, "root"), keySecrets(), HostKeys(kh()), listener).also { open.add(it); self = it }
        val r = s.connect(true)
        assertTrue(r.toString(), r is SshResult.Err)
        assertEquals(false, s.connected)
        assertTrue(events.toString(), "connected" !in events)
    }

    @Test fun `отказ доверять ключу — HOSTKEY_REJECTED`() = runBlocking {
        val r = session(Recorder(trust = false)).connect(interactive = true)
        assertEquals("HOSTKEY_REJECTED", (r as SshResult.Err).code)
    }

    @Test fun `переподключение не спрашивает — неизвестный ключ отклоняется`() = runBlocking {
        val rec = Recorder()
        val r = session(rec).connect(interactive = false)
        assertEquals("HOSTKEY_REJECTED", (r as SshResult.Err).code)
        assertEquals(0, rec.prompts.size)
    }

    @Test fun `изменившийся ключ хоста — HOSTKEY_MISMATCH с отпечатками`() = runBlocking {
        val known = kh()
        assertEquals(SshResult.Ok, session(Recorder(), known = known).connect(true))
        val line = known.readText().trim().split(" ")
        val blob = Base64.getDecoder().decode(line[2]).also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        known.writeText("${line[0]} ${line[1]} ${Base64.getEncoder().encodeToString(blob)}\n")
        val r = session(Recorder(), known = known).connect(true) as SshResult.Err
        assertEquals("HOSTKEY_MISMATCH", r.code)
        assertTrue(r.message, r.message.startsWith("Ключ сервера изменился. Сохранённый: SHA256:"))
    }

    @Test fun `ни ключа, ни пароля — AUTH_FAILED`() = runBlocking {
        val r = session(Recorder(), Secrets(emptyMap())).connect(true) as SshResult.Err
        assertEquals("AUTH_FAILED", r.code)
        assertEquals("Нет ни ключа, ни пароля: импортируйте SSH-ключ или задайте пароль в настройках", r.message)
    }

    @Test fun `exec — stdin и таймаут`() = runBlocking {
        val s = session(Recorder())
        assertEquals(SshResult.Ok, s.connect(true))
        assertEquals("ok", s.exec("cat", stdin = "ok").stdout)
        assertEquals(ExecResult(3, "", "e\n"), s.exec("echo e >&2; exit 3"))
        val t = System.currentTimeMillis()
        s.exec("sleep 5", timeoutMs = 300)
        assertTrue(System.currentTimeMillis() - t < 2000)
    }

    @Test fun `PTY с изменением размера`() = runBlocking {
        val rec = Recorder()
        val s = session(rec)
        assertEquals(SshResult.Ok, s.connect(true))
        val ch = s.openPty("sleep 0.7; stty size", 80, 24)
        s.resize(ch, 100, 30)
        assertTrue(waitFor { ch in rec.closed })
        assertEquals("30 100", rec.text(ch).trim())
    }

    @Test fun `поток — stdout и stderr по порядку, запись в stdin, закрытие`() = runBlocking {
        val rec = Recorder()
        val s = session(rec)
        assertEquals(SshResult.Ok, s.connect(true))
        val ch = s.openStream("read x; echo got:\$x; echo e >&2")
        s.write(ch, "привет\n".toByteArray())
        assertTrue(waitFor { ch in rec.closed })
        assertEquals("got:привет\n", rec.text(ch))
        assertEquals("e\n", rec.err[ch]?.toString(Charsets.UTF_8))
        // Порядок вызовов из двух нитей может отличаться — номера без пропусков, интерфейс собирает по ним
        val seqs = rec.seqs[ch]!!.sorted()
        assertEquals((0 until seqs.size).toList(), seqs)
    }

    @Test fun `end закрывает stdin — cat завершается`() = runBlocking {
        val rec = Recorder()
        val s = session(rec)
        assertEquals(SshResult.Ok, s.connect(true))
        val ch = s.openStream("cat")
        s.write(ch, "x".toByteArray())
        s.end(ch)
        assertTrue(waitFor { ch in rec.closed })
        assertEquals("x", rec.text(ch))
    }

    @Test fun `SFTP — 200 КБ с прогрессом и правами 600`() = runBlocking {
        val s = session(Recorder())
        assertEquals(SshResult.Ok, s.connect(true))
        val data = ByteArray(204_800) { (it % 253).toByte() }
        val progress = Collections.synchronizedList(mutableListOf<Long>())
        val path = "/tmp/cvg-sftp-${System.nanoTime()}.bin"
        s.writeFile(path, data.copyOfRange(0, 100_000)) { progress.add(it) }
        s.writeFile(path, data.copyOfRange(100_000, data.size), offset = 100_000) { progress.add(100_000 + it) }
        val sha = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
        assertEquals("$sha 600", s.exec("sha256sum $path | cut -d' ' -f1 | tr -d '\\n'; echo -n ' '; stat -c %a $path; rm -f $path").stdout.trim())
        assertEquals(204_800L, progress.last())
        assertEquals(progress.sorted(), progress)
    }

    @Test fun `обрыв — lost, затем reconnected, команды снова работают`() = runBlocking {
        val rec = Recorder()
        val s = session(rec)
        assertEquals(SshResult.Ok, s.connect(true))
        s.simulateDrop()
        assertTrue(rec.events.toString(), waitFor(15_000) { "reconnected" in rec.events })
        assertTrue(rec.events.indexOf("lost") < rec.events.indexOf("reconnected"))
        assertEquals("hi\n", s.exec("echo hi").stdout)
    }

    @Test fun `close — без переподключения`() = runBlocking {
        val rec = Recorder()
        val s = session(rec)
        assertEquals(SshResult.Ok, s.connect(true))
        s.close()
        Thread.sleep(1500)
        assertTrue(rec.events.toString(), "lost" !in rec.events)
        assertEquals(false, s.connected)
    }

    @Test fun `пароль (CVG_TEST_SSH_USER и CVG_TEST_SSH_PASSWORD)`() = runBlocking {
        val user = System.getenv("CVG_TEST_SSH_USER")
        val password = System.getenv("CVG_TEST_SSH_PASSWORD")
        assumeTrue("нет тестового пароля", !user.isNullOrEmpty() && !password.isNullOrEmpty())
        val ok = session(Recorder(), Secrets(mapOf("password" to password)), user = user!!)
        assertEquals(SshResult.Ok, withTimeout(30_000) { ok.connect(true) })
        assertEquals("$user\n", ok.exec("whoami").stdout)
        val bad = session(Recorder(), Secrets(mapOf("password" to "wrong-$password")), user = user).connect(true) as SshResult.Err
        assertEquals("AUTH_FAILED", bad.code)
    }
}
