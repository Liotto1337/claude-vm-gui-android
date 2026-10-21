package io.github.liotto1337.claudevm.ssh

/** Паузы переподключения, как src/shared/backoff.ts: 1, 2, 5, 10, 30 с, дальше 30. */
object Backoff {
    private val steps = longArrayOf(1000, 2000, 5000, 10000, 30000)
    fun delayMs(attempt: Int): Long = steps[(attempt - 1).coerceIn(0, steps.size - 1)]
}
