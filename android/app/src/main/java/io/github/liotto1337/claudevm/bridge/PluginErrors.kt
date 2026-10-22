package io.github.liotto1337.claudevm.bridge

import io.github.liotto1337.claudevm.ssh.NotConnectedException

/** Ошибки вызовов плагина для JS: код и текст reject. */
object PluginErrors {
    fun code(e: Throwable): String = if (e is NotConnectedException) "NOT_CONNECTED" else "SSH_ERROR"
    fun message(e: Throwable): String = if (e is NotConnectedException) "NOT_CONNECTED" else e.message ?: e.javaClass.simpleName
}
