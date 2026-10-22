package io.github.liotto1337.claudevm.notify

/**
 * Состояние экрана Claude Code для уведомлений в фоне — перенос notifyState/notifyQuestion из src/shared/screen-parse.ts.
 * Обе реализации сверяются с таблицей tests/fixtures/screens/notify-expected.json.
 */
object NotifyDetector {
    enum class State { MENU, BUSY, IDLE, UNKNOWN }

    private val DIALOG_FOOTER = Regex("Enter to confirm|Esc to cancel|Enter to select|Esc to exit|Press Enter to continue", RegexOption.IGNORE_CASE)
    private val ESC_SEQ = Regex("\u001b(?:\\[([0-9;:?]*)([@-~])|\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)|[@-Z\\\\-_])")
    private val PROMPT = Regex("^\\s*❯[\\s ]?")
    private val SPINNER = Regex("^\\s*[·✢✳✶✻✽✺*]\\s+(.+)$")
    private val INTERRUPT = Regex("esc to interrupt", RegexOption.IGNORE_CASE)

    fun state(screen: String): State {
        val plain = stripAnsi(screen)
        if (menuFooterIndex(plain) >= 0) return State.MENU
        if (inputText(screen) == null) return State.UNKNOWN
        return if (busy(plain)) State.BUSY else State.IDLE
    }

    /** Первая непустая строка под границей (`─` или `▔`) над выбранным вариантом, до 120 символов. */
    fun question(screen: String): String? {
        val lines = stripAnsi(screen).split('\n')
        val f = menuFooterIndex(lines.joinToString("\n"))
        if (f < 0) return null
        var s = f - 1
        while (s >= 0 && !Regex("^\\s*❯\\s").containsMatchIn(lines[s])) s--
        var r = s - 1
        while (r >= 0 && !isBoundary(lines[r])) r--
        return lines.subList(r + 1, maxOf(r + 1, s)).firstOrNull { it.isNotBlank() }?.trim()?.take(120)
    }

    fun stripAnsi(s: String, dropDim: Boolean = false): String {
        if (!dropDim) return ESC_SEQ.replace(s, "")
        val out = StringBuilder()
        var dim = false
        var last = 0
        for (m in ESC_SEQ.findAll(s)) {
            if (!dim) out.append(s, last, m.range.first)
            last = m.range.last + 1
            if (m.groupValues[2] != "m") continue
            for (p in m.groupValues[1].split(';', ':').map { it.toIntOrNull() ?: 0 }) {
                if (p == 2) dim = true else if (p == 0 || p == 22) dim = false
            }
        }
        if (!dim) out.append(s, last, s.length)
        return out.toString()
    }

    private fun isRule(line: String, chars: String) = Regex("^[$chars]{10,}$").matches(line.trim())
    private fun isBoundary(line: String) = isRule(line, "─") || isRule(line, "▔")

    private fun inputBox(lines: List<String>): Pair<Int, Int>? {
        for (j in lines.size - 1 downTo 1) {
            if (!isRule(lines[j], "─")) continue
            for (i in j - 1 downTo 0) {
                if (!isRule(lines[i], "─")) continue
                val next = lines.getOrNull(i + 1) ?: ""
                return if (PROMPT.containsMatchIn(next) && next.trimStart().startsWith("❯")) i to j else null
            }
            return null
        }
        return null
    }

    private fun inputText(screen: String): String? {
        val raw = screen.split('\n')
        val box = inputBox(raw.map { stripAnsi(it) }) ?: return null
        val body = raw.subList(box.first + 1, box.second).map { stripAnsi(it, dropDim = true) }
        if (body.isEmpty()) return ""
        return (listOf(PROMPT.replaceFirst(body[0], "")) + body.drop(1).map { it.removePrefix("  ") })
            .joinToString("\n") { it.trimEnd() }.trim()
    }

    private fun busy(plain: String): Boolean {
        val lines = plain.split('\n')
        val box = inputBox(lines)
        val footer = if (box != null) lines.drop(box.second + 1).joinToString("\n") else lines.takeLast(4).joinToString("\n")
        val above = if (box != null) lines.take(box.first) else lines
        if (!INTERRUPT.containsMatchIn(footer) && above.none { SPINNER.containsMatchIn(it) && INTERRUPT.containsMatchIn(it) }) return false
        return above.any { SPINNER.containsMatchIn(it) }
    }

    private fun menuFooterIndex(plain: String): Int {
        val lines = plain.split('\n').map { it.trimEnd() }
        val tail = lines.withIndex().filter { it.value.isNotBlank() }.takeLast(3)
        val footer = tail.reversed().firstOrNull { DIALOG_FOOTER.containsMatchIn(it.value) } ?: return -1
        val box = inputBox(lines)
        return if (box != null && box.second > footer.index) -1 else footer.index
    }
}
