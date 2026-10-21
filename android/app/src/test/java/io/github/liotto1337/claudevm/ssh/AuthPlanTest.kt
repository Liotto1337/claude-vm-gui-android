package io.github.liotto1337.claudevm.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

class AuthPlanTest {
    @Test fun `порядок ключ, пароль, keyboard-interactive`() =
        assertEquals(listOf("publickey", "password", "keyboard-interactive"), AuthPlan.build(null, hasKey = true, hasPassword = true))

    @Test fun `методы, которых сервер не предлагает, не пробуются`() =
        assertEquals(listOf("publickey"), AuthPlan.build(listOf("publickey"), hasKey = true, hasPassword = true))

    @Test fun `без ключа — только пароль и keyboard-interactive`() =
        assertEquals(listOf("password", "keyboard-interactive"), AuthPlan.build(null, hasKey = false, hasPassword = true))

    @Test fun `ничего нет — пусто`() = assertEquals(emptyList<String>(), AuthPlan.build(null, hasKey = false, hasPassword = false))
}

class BackoffTest {
    @Test fun `паузы 1, 2, 5, 10, 30 секунд, дальше 30`() =
        assertEquals(listOf(1000L, 2000L, 5000L, 10000L, 30000L, 30000L), (1..6).map { Backoff.delayMs(it) })
}
