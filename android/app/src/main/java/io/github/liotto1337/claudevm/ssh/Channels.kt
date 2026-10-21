package io.github.liotto1337.claudevm.ssh

/** Нумерация пачек канала: с 0 подряд, не больше MAX байт в пачке. Общая для stdout и stderr — сохраняет их порядок. */
class ChunkSeq {
    private var next = 0

    @Synchronized
    fun split(bytes: ByteArray, len: Int = bytes.size): List<Pair<Int, ByteArray>> =
        (0 until len step MAX).map { off -> next++ to bytes.copyOfRange(off, minOf(off + MAX, len)) }

    companion object {
        const val MAX = 32 * 1024
    }
}
