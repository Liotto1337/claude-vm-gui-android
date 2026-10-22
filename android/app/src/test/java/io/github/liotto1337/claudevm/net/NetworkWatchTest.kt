package io.github.liotto1337.claudevm.net

import org.junit.Assert.assertEquals
import org.junit.Test

class NetworkWatchTest {
    private var reconnects = 0
    private val w = NetworkWatch { reconnects++ }

    @Test fun `первая сеть при подписке — не повод переподключаться`() {
        w.onAvailable("wifi")
        w.onAvailable("wifi")
        assertEquals(0, reconnects)
    }

    @Test fun `смена сети Wi-Fi → мобильная — переподключиться сразу, ровно один раз`() {
        w.onAvailable("wifi")
        w.onAvailable("mobile")
        assertEquals(1, reconnects)
    }

    @Test fun `Wi-Fi пропал, потом появилась мобильная — тоже переподключиться`() {
        w.onAvailable("wifi")
        w.onLost("wifi")
        w.onAvailable("mobile")
        assertEquals(1, reconnects)
    }
}
