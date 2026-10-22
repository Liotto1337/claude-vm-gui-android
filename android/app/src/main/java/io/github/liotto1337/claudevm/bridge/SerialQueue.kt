package io.github.liotto1337.claudevm.bridge

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * Задачи по одной, строго в порядке поступления: запись в PTY, конец ввода, размер и закрытие каналов.
 * Отдельные корутины на пуле IO могли бы переставить нажатия (Enter обогнал бы конец команды).
 */
class SerialQueue(scope: CoroutineScope) {
    private val tasks = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (t in tasks) runCatching { t() }
        }
    }

    fun submit(task: suspend () -> Unit) {
        tasks.trySend(task)
    }
}
