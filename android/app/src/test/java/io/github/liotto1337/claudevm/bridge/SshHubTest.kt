package io.github.liotto1337.claudevm.bridge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.github.liotto1337.claudevm.secrets.KeyProvider
import io.github.liotto1337.claudevm.secrets.SecretStore
import io.github.liotto1337.claudevm.ssh.Fixtures
import io.github.liotto1337.claudevm.ssh.SshConfig
import io.github.liotto1337.claudevm.ssh.SshResult
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.nio.file.Files
import java.util.Collections
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
class SshHubTest {
    private val events = Collections.synchronizedList(mutableListOf<Pair<String, JSONObject>>())
    private lateinit var hub: SshHub

    @Before fun setUp() {
        assumeTrue("нет тестового ключа", Fixtures.testKey.exists())
        val ctx: Context = ApplicationProvider.getApplicationContext()
        val k = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val store = SecretStore(ctx, KeyProvider { k })
        store.save("key", Fixtures.testKey.readText())
        hub = SshHub(store, Files.createTempDirectory("kh").resolve("known_hosts").toFile())
        hub.sink = ChunkBatcher.Sink { e, d ->
            events.add(e to d)
            // Ключ хоста — «Доверять», как нажал бы человек
            if (e == "hostkey") hub.answerHostKey(true)
        }
    }

    @After fun tearDown() {
        if (::hub.isInitialized) hub.close()
    }

    @Test fun `тот же адрес при живом соединении — без переподключения, состояние connected`() = runBlocking {
        val cfg = SshConfig("127.0.0.1", 22, "root")
        assertEquals(SshResult.Ok, hub.connect(cfg))
        val first = hub.session
        events.clear()
        assertEquals(SshResult.Ok, hub.connect(cfg))
        assertSame(first, hub.session)
        assertEquals(listOf("state"), events.map { it.first })
        assertEquals("connected", events[0].second.getString("state"))
        assertTrue(hub.status())
    }

    @Test fun `другой адрес — старое соединение закрывается`() = runBlocking {
        assertEquals(SshResult.Ok, hub.connect(SshConfig("127.0.0.1", 22, "root")))
        val first = hub.session!!
        hub.connect(SshConfig("127.0.0.1", 22, "nobody-${System.nanoTime() % 1000}"))
        assertFalse(first.connected)
    }

    @Test fun `exec и канал через хаб, данные — событием chunks`() = runBlocking {
        assertEquals(SshResult.Ok, hub.connect(SshConfig("127.0.0.1", 22, "root")))
        assertEquals("hi\n", hub.exec("echo hi", null, null).stdout)
        val ch = hub.openChannel("echo привет", null)
        val t = System.currentTimeMillis()
        while (events.none { it.first == "closed" } && System.currentTimeMillis() - t < 5000) Thread.sleep(20)
        val chunks = events.filter { it.first == "chunks" }.flatMap { e ->
            val a = e.second.getJSONArray("items"); (0 until a.length()).map { a.getJSONObject(it) }
        }.filter { it.getInt("ch") == ch }
        val text = chunks.sortedBy { it.getInt("seq") }.joinToString("") { String(java.util.Base64.getDecoder().decode(it.getString("b64"))) }
        assertEquals("привет\n", text)
        val closedAt = events.indexOfFirst { it.first == "closed" }
        assertTrue(events.subList(closedAt, events.size).none { it.first == "chunks" })
    }

    @Test fun `новый интерфейс — каналы прежнего закрываются, соединение остаётся`() = runBlocking {
        assertEquals(SshResult.Ok, hub.connect(SshConfig("127.0.0.1", 22, "root")))
        val ch = hub.openChannel("sleep 30", 80 to 24)
        events.clear()
        hub.closeAllChannels()
        val t = System.currentTimeMillis()
        while (events.none { it.first == "closed" && it.second.getInt("ch") == ch } && System.currentTimeMillis() - t < 5000) Thread.sleep(20)
        assertTrue(events.toString(), events.any { it.first == "closed" && it.second.getInt("ch") == ch })
        assertTrue(hub.status())
    }
}
