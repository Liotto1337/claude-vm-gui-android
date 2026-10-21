package io.github.liotto1337.claudevm.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// org.json в JVM-тестах Android — заглушки; Robolectric даёт настоящий
@RunWith(RobolectricTestRunner::class)
class ChunkBatcherTest {
    private val sent = mutableListOf<Pair<String, JSONObject>>()
    private val b = ChunkBatcher(ChunkBatcher.Sink { e, d -> sent.add(e to d) }, schedule = {})

    @Test fun `пачки копятся и уходят одним событием chunks`() {
        b.add(1, 0, "data", byteArrayOf(1))
        b.add(1, 1, "stderr", byteArrayOf(2))
        assertEquals(0, sent.size)
        b.flush()
        assertEquals(1, sent.size)
        assertEquals("chunks", sent[0].first)
        val items = sent[0].second.getJSONArray("items")
        assertEquals(2, items.length())
        assertEquals("stderr", items.getJSONObject(1).getString("kind"))
        assertEquals("Ag==", items.getJSONObject(1).getString("b64"))
    }

    @Test fun `closed уходит после накопленных пачек своего канала`() {
        b.add(3, 0, "data", byteArrayOf(9))
        b.closed(3)
        assertEquals(listOf("chunks", "closed"), sent.map { it.first })
        assertEquals(3, sent[1].second.getInt("ch"))
    }

    @Test fun `пустой flush ничего не шлёт`() {
        b.flush()
        assertEquals(0, sent.size)
    }
}
