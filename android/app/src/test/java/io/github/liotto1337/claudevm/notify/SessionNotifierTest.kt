package io.github.liotto1337.claudevm.notify

import io.github.liotto1337.claudevm.ssh.ExecResult
import io.github.liotto1337.claudevm.ssh.Fixtures
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SessionNotifierTest {
    private val dir = File(Fixtures.repo, "tests/fixtures/screens")
    private fun screen(f: String) = File(dir, f).readText()

    /** Вывод команды опроса: сессии с claude — маркер и экран. */
    private var screens = mutableMapOf<String, String>()
    /** Опрос оборвался по таймауту: вывод без конца */
    private var partial = false
    private val posted = mutableListOf<Triple<String, SessionNotifier.Kind, String>>()
    private val cancelled = mutableListOf<String>()
    private val commands = mutableListOf<String>()
    /** Отслеживаемые сессии; по умолчанию — все, что встречаются в тестах до «Отслеживать» */
    private var watched: Set<String> = setOf("w", "a", "b")
    private val notifier = SessionNotifier(
        exec = { cmd ->
            commands.add(cmd)
            ExecResult(0, screens.entries.joinToString("") { (n, s) -> "${SessionNotifier.MARK}$n\n$s\n" } + if (partial) "" else SessionNotifier.END, "")
        },
        post = { s, k, t -> posted.add(Triple(s, k, t)) },
        cancel = { cancelled.add(it) },
        watched = { watched },
    )
    private fun tick(vararg s: Pair<String, String>) = runBlocking {
        screens = s.associate { (n, f) -> n to screen(f) }.toMutableMap()
        notifier.tick()
    }

    @Test fun `работал — стал ждать ввода — «Claude закончил»`() {
        tick("w" to "busy.ans")
        tick("w" to "prompt-empty.ans")
        assertEquals(listOf(Triple("w", SessionNotifier.Kind.FINISHED, "Claude закончил")), posted)
    }

    @Test fun `появилось меню — «ждёт ответа» с вопросом`() {
        tick("w" to "prompt-empty.ans")
        tick("w" to "permission-bash.ans")
        assertEquals(listOf(Triple("w", SessionNotifier.Kind.WAITING, "Bash command")), posted)
    }

    @Test fun `первая выборка ничего не шлёт, меню на меню — тоже`() {
        tick("w" to "permission-bash.ans")
        tick("w" to "permission-bash.ans")
        assertEquals(emptyList<Any>(), posted)
    }

    @Test fun `сессия пропала и появилась — первая выборка снова молчит`() {
        tick("w" to "busy.ans")
        tick()
        tick("w" to "prompt-empty.ans")
        assertEquals(emptyList<Any>(), posted)
    }

    @Test fun `сессии следятся по отдельности`() {
        tick("a" to "busy.ans", "b" to "prompt-empty.ans")
        tick("a" to "prompt-empty.ans", "b" to "trust.ans")
        assertEquals(setOf("a" to SessionNotifier.Kind.FINISHED, "b" to SessionNotifier.Kind.WAITING), posted.map { it.first to it.second }.toSet())
    }

    @Test fun `оборванный вывод опроса не снимает уведомления и не сбивает состояния`() {
        tick("a" to "busy.ans", "b" to "busy.ans")
        partial = true
        tick("a" to "prompt-empty.ans")
        partial = false
        assertEquals(emptyList<String>(), cancelled)
        assertEquals(emptyList<Any>(), posted)
        tick("a" to "prompt-empty.ans", "b" to "prompt-empty.ans")
        assertEquals(setOf("a", "b"), posted.map { it.first }.toSet())
    }

    @Test fun `опрос одной командой, сервер tmux — из настроек`() {
        val n = SessionNotifier(exec = { commands.add(it); ExecResult(0, "", "") }, post = { _, _, _ -> }, cancel = {}, tmux = "tmux -L cvg-smoke", watched = { setOf("w") })
        runBlocking { n.tick() }
        assertEquals(1, commands.size)
        assertTrue(commands[0], commands[0].contains("tmux -L cvg-smoke ls -F"))
        assertTrue(commands[0].contains("capture-pane -e -p"))
    }

    @Test fun `текст экрана с похожим маркером не создаёт сессий`() {
        screens = mutableMapOf("w" to "cvg:fake\n__cvg_sess__fake\n" + screen("busy.ans"))
        runBlocking { notifier.tick() }
        screens = mutableMapOf("w" to screen("prompt-empty.ans"))
        runBlocking { notifier.tick() }
        assertEquals(listOf("w"), posted.map { it.first })
    }

    @Test fun `«Отслеживать» — уведомление только от отмеченной сессии`() {
        watched = setOf("on")
        tick("on" to "busy.ans", "off" to "busy.ans")
        tick("on" to "prompt-empty.ans", "off" to "prompt-empty.ans")
        assertEquals(listOf(Triple("on", SessionNotifier.Kind.FINISHED, "Claude закончил")), posted)
    }

    @Test fun `ничего не отслеживается — опроса по SSH нет вовсе`() {
        watched = emptySet()
        tick("w" to "busy.ans")
        tick("w" to "prompt-empty.ans")
        assertEquals(emptyList<String>(), commands)
        assertEquals(emptyList<Any>(), posted)
    }

    @Test fun `отметку сняли — уведомление о сессии снимается`() {
        watched = setOf("w")
        tick("w" to "busy.ans")
        watched = emptySet()
        tick("w" to "prompt-empty.ans")
        assertEquals(listOf("w"), cancelled)
        assertEquals(emptyList<Any>(), posted)
    }
}
