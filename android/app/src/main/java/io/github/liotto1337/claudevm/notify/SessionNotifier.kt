package io.github.liotto1337.claudevm.notify

import io.github.liotto1337.claudevm.ssh.ExecResult

/**
 * Опрос сессий с claude, пока приложение свёрнуто: одна команда по SSH на все сессии.
 * Уведомления — по переходам: работал → поле ввода («Claude закончил»), не меню → меню («ждёт ответа» + вопрос).
 * Первая выборка сессии ничего не шлёт: о том, что было до сворачивания, не сообщаем.
 */
class SessionNotifier(
    private val exec: suspend (String) -> ExecResult,
    private val post: (session: String, kind: Kind, text: String) -> Unit,
    private val cancel: (session: String) -> Unit,
    private val tmux: String = "tmux",
) {
    enum class Kind { FINISHED, WAITING }

    private val last = mutableMapOf<String, NotifyDetector.State>()

    /** Команда: для каждой сессии, где на переднем плане claude (или node), — маркер с именем и экран. */
    private val command: String
        get() = "$tmux ls -F '#{session_name}\t#{pane_current_command}' 2>/dev/null | " +
            "while IFS=\"\$(printf '\\t')\" read -r n c; do case \"\$c\" in claude|node) " +
            "printf '\\0cvg:%s\\n' \"\$n\"; $tmux capture-pane -e -p -t \"=\$n:\" 2>/dev/null ;; esac; done"

    suspend fun tick() {
        val out = exec(command).stdout
        val now = mutableMapOf<String, NotifyDetector.State>()
        val questions = mutableMapOf<String, String?>()
        for (part in out.split(MARK).drop(1)) {
            val name = part.substringBefore('\n')
            val screen = part.substringAfter('\n', "")
            now[name] = NotifyDetector.state(screen)
            questions[name] = NotifyDetector.question(screen)
        }
        for ((name, state) in now) {
            val prev = last[name] ?: continue
            if (prev == NotifyDetector.State.BUSY && state == NotifyDetector.State.IDLE) post(name, Kind.FINISHED, "Claude закончил")
            else if (prev != NotifyDetector.State.MENU && state == NotifyDetector.State.MENU) post(name, Kind.WAITING, questions[name] ?: "")
        }
        // Пропавшие сессии забываем и снимаем их уведомления
        for (gone in last.keys - now.keys) cancel(gone)
        last.clear()
        last.putAll(now)
    }

    companion object {
        /** Начало блока сессии: нулевой байт в выводе capture-pane не встречается — текст экрана маркер не подделает */
        const val MARK = "\u0000cvg:"
    }
}
