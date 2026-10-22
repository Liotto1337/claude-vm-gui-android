package io.github.liotto1337.claudevm.notify

import io.github.liotto1337.claudevm.ssh.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Та же таблица, что у Vitest (notify-expected.test.ts): детекторы на TS и Kotlin не должны разойтись. */
class NotifyDetectorTest {
    private val dir = File(Fixtures.repo, "tests/fixtures/screens")
    private val json = File(dir, "notify-expected.json").readText()
    private fun section(name: String): Map<String, String> {
        val body = Regex("\"$name\"\\s*:\\s*\\{([^}]*)\\}").find(json)!!.groupValues[1]
        return Regex("\"([^\"]+)\"\\s*:\\s*\"([^\"]*)\"").findAll(body).associate { it.groupValues[1] to it.groupValues[2] }
    }
    private fun screen(f: String) = File(dir, f).readText()

    @Test fun `состояния всех снимков как в таблице`() {
        val states = section("states")
        assertEquals(dir.list()!!.filter { it.endsWith(".ans") }.sorted(), states.keys.sorted())
        for ((f, s) in states) assertEquals(f, s, NotifyDetector.state(screen(f)).name.lowercase())
    }

    @Test fun `вопросы меню как в таблице`() {
        for ((f, q) in section("questions")) assertEquals(f, q, NotifyDetector.question(screen(f)))
    }

    @Test fun `без меню вопроса нет`() = assertEquals(null, NotifyDetector.question(screen("prompt-empty.ans")))
}
