package io.github.liotto1337.claudevm.bridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Collections
import kotlin.random.Random

class SerialQueueTest {
    @Test fun `задачи выполняются строго по порядку, даже если засыпают`() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val q = SerialQueue(scope)
        val done = Collections.synchronizedList(mutableListOf<Int>())
        repeat(1000) { i -> q.submit { if (Random.nextInt(20) == 0) delay(1); done.add(i) } }
        val t = System.currentTimeMillis()
        while (done.size < 1000 && System.currentTimeMillis() - t < 10_000) Thread.sleep(10)
        scope.cancel()
        assertEquals((0 until 1000).toList(), done.toList())
    }

    @Test fun `ошибка задачи не останавливает очередь`() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val q = SerialQueue(scope)
        val done = Collections.synchronizedList(mutableListOf<Int>())
        q.submit { error("сбой") }
        q.submit { done.add(1) }
        val t = System.currentTimeMillis()
        while (done.isEmpty() && System.currentTimeMillis() - t < 5_000) Thread.sleep(10)
        scope.cancel()
        assertEquals(listOf(1), done.toList())
    }
}
