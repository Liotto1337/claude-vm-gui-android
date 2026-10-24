package io.github.liotto1337.claudevm.bridge

import android.app.Application
import android.net.ConnectivityManager
import androidx.test.core.app.ApplicationProvider
import io.github.liotto1337.claudevm.notify.Notifications
import io.github.liotto1337.claudevm.notify.SessionNotifier
import io.github.liotto1337.claudevm.secrets.KeyProvider
import io.github.liotto1337.claudevm.secrets.SecretStore
import io.github.liotto1337.claudevm.ssh.Fixtures
import io.github.liotto1337.claudevm.ssh.SshConfig
import io.github.liotto1337.claudevm.ssh.SshResult
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.nio.file.Files
import java.util.Collections
import javax.crypto.KeyGenerator

/** Хаб с контекстом приложения: foreground-сервис и слежение за сетью. */
@RunWith(RobolectricTestRunner::class)
class SshHubBackgroundTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val states = Collections.synchronizedList(mutableListOf<String>())
    private lateinit var knownHosts: File
    private lateinit var hub: SshHub
    private val cfg = SshConfig("127.0.0.1", 22, "root")

    @Before fun setUp() {
        assumeTrue("нет тестового ключа", Fixtures.testKey.exists())
        val k = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val store = SecretStore(app, KeyProvider { k })
        store.save("key", Fixtures.testKey.readText())
        knownHosts = Files.createTempDirectory("kh").resolve("known_hosts").toFile()
        hub = SshHub(store, knownHosts, app)
        hub.sink = ChunkBatcher.Sink { e, d ->
            if (e == "state") states.add(d.getString("state"))
            if (e == "hostkey") hub.answerHostKey(true)
        }
    }

    @After fun tearDown() {
        if (::hub.isInitialized) hub.close()
    }

    private val callbacks get() = shadowOf(app.getSystemService(ConnectivityManager::class.java)).networkCallbacks

    @Test fun `смена сети отслеживается и без «Держать связь в фоне»`() = runBlocking {
        hub.setBackground(SshHub.Background(keepAlive = false))
        assertEquals(SshResult.Ok, hub.connect(cfg))
        assertEquals(1, callbacks.size)
        hub.close()
        assertEquals(0, callbacks.size)
    }

    @Test fun `ключ сервера сменился при переподключении — сервис останавливается, «Переподключение…» не висит`() = runBlocking {
        assertEquals(SshResult.Ok, hub.connect(cfg))
        while (shadowOf(app).nextStoppedService != null) Unit
        // Другой ключ ed25519 для того же адреса — сервер выглядит подменённым
        knownHosts.writeText("127.0.0.1 " + File(Fixtures.testKey.path + ".pub").readText().trim() + "\n")
        hub.session!!.simulateDrop()
        val t = System.currentTimeMillis()
        while ("failed" !in states && System.currentTimeMillis() - t < 15_000) Thread.sleep(50)
        assertTrue(states.toString(), "failed" in states)
        assertNotNull(shadowOf(app).nextStoppedService)
        assertEquals(0, callbacks.size)
    }

    @Test fun `сняли «Отслеживать» — висящее уведомление о сессии снимается (и когда приложение на экране)`() {
        Notifications.postSession(app, "a", SessionNotifier.Kind.WAITING, "Выбор")
        Notifications.postSession(app, "b", SessionNotifier.Kind.WAITING, "Выбор")
        val nm = shadowOf(app.getSystemService(android.app.NotificationManager::class.java))
        assertEquals(2, nm.allNotifications.size)
        hub.setBackground(SshHub.Background(watched = setOf("a", "b")))
        hub.setBackground(SshHub.Background(watched = setOf("b")))
        assertEquals(1, nm.allNotifications.size)
    }
}
