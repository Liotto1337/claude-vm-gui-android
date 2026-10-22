package io.github.liotto1337.claudevm.bridge

import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Пачки каналов копятся и уходят в JS одним событием «chunks» не чаще раза в 16 мс:
 * мост Capacitor не захлёбывается при большом выводе. «closed» канала уходит после его пачек.
 */
class ChunkBatcher(
    private val sink: Sink,
    private val schedule: (Runnable) -> Unit = { r -> timer.schedule(r, 16, TimeUnit.MILLISECONDS) },
) {
    fun interface Sink {
        fun emit(event: String, data: JSONObject)
    }

    private var items = JSONArray()
    private var scheduled = false
    /** Забрать накопленное и отправить — одно действие: иначе «closed» мог бы уйти, пока таймер ещё отправляет последнюю пачку */
    private val sending = Any()

    @Synchronized
    fun add(ch: Int, seq: Int, kind: String, bytes: ByteArray) {
        items.put(JSONObject().put("ch", ch).put("seq", seq).put("kind", kind).put("b64", Base64.getEncoder().encodeToString(bytes)))
        if (!scheduled) {
            scheduled = true
            schedule(Runnable { flush() })
        }
    }

    fun flush() = synchronized(sending) {
        val out = synchronized(this) {
            scheduled = false
            items.also { items = JSONArray() }
        }
        if (out.length() > 0) sink.emit("chunks", JSONObject().put("items", out))
    }

    /** Отправить событие после всех накопленных пачек. */
    fun emitAfterChunks(event: String, data: JSONObject) = synchronized(sending) {
        flush()
        sink.emit(event, data)
    }

    fun closed(ch: Int) = emitAfterChunks("closed", JSONObject().put("ch", ch))

    private companion object {
        val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "cvg-chunks").apply { isDaemon = true } }
    }
}
