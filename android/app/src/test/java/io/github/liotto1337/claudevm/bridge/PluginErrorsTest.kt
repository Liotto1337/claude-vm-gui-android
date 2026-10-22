package io.github.liotto1337.claudevm.bridge

import io.github.liotto1337.claudevm.ssh.NotConnectedException
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

class PluginErrorsTest {
    @Test fun `нет соединения — NOT_CONNECTED`() {
        assertEquals("NOT_CONNECTED", PluginErrors.code(NotConnectedException()))
    }

    @Test fun `другая ошибка — SSH_ERROR с её текстом`() {
        val e = IOException("No such file")
        assertEquals("SSH_ERROR", PluginErrors.code(e))
        assertEquals("No such file", PluginErrors.message(e))
    }
}
