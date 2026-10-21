package io.github.liotto1337.claudevm.ssh

data class SshConfig(val host: String, val port: Int, val username: String)

data class ExecResult(val code: Int, val stdout: String, val stderr: String)

/** Итог подключения; code — из ErrorCode интерфейса (AUTH_FAILED, TCP_UNREACHABLE, HOSTKEY_MISMATCH, HOSTKEY_REJECTED). */
sealed class SshResult {
    data object Ok : SshResult()
    data class Err(val code: String, val message: String) : SshResult()
}

/** Вопрос про ключ хоста, как HostKeyPrompt в интерфейсе. kind — unknown или mismatch. */
data class HostKeyPrompt(val host: String, val port: Int, val kind: String, val fingerprint: String, val knownFingerprint: String? = null)

/** Пароль и закрытый ключ (расшифрованный): name — "password" или "key". */
fun interface SecretSource {
    fun read(name: String): String?
}

/** События сессии. Данные каналов — пачками с номером seq (общий счётчик для stdout и stderr канала). */
interface SshListener {
    fun onState(state: String, attempt: Int?) {}
    fun onPreflight(step: String, status: String, detail: String) {}
    fun onLost() {}
    fun onReconnected() {}
    /** Ответ на вопрос о ключе хоста; рукопожатие ждёт не дольше 120 с, потом — отказ */
    suspend fun onHostKey(p: HostKeyPrompt): Boolean = false
    fun onData(ch: Int, seq: Int, bytes: ByteArray) {}
    fun onStderr(ch: Int, seq: Int, bytes: ByteArray) {}
    fun onClose(ch: Int) {}
}

class NotConnectedException : IllegalStateException("NOT_CONNECTED")
