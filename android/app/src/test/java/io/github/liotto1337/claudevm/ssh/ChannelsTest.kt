package io.github.liotto1337.claudevm.ssh

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelsTest {
    @Test fun `пачки нумеруются с 0 подряд, data и stderr — общим счётчиком`() {
        val seq = ChunkSeq()
        assertEquals(listOf(0), seq.split(ByteArray(10)).map { it.first })
        assertEquals(listOf(1), seq.split(ByteArray(10)).map { it.first })
    }

    @Test fun `вывод больше 64 КБ режется на пачки не больше 32 КБ без потери байтов`() {
        val data = ByteArray(70_000) { (it % 251).toByte() }
        val parts = ChunkSeq().split(data)
        assertTrue(parts.all { it.second.size <= ChunkSeq.MAX })
        assertEquals(listOf(0, 1, 2), parts.map { it.first })
        assertArrayEquals(data, parts.flatMap { it.second.toList() }.toByteArray())
    }
}
