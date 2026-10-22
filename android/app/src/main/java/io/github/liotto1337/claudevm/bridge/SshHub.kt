package io.github.liotto1337.claudevm.bridge

import android.content.Context
import io.github.liotto1337.claudevm.secrets.KeyImport
import io.github.liotto1337.claudevm.secrets.SecretStore
import io.github.liotto1337.claudevm.service.SshService
import io.github.liotto1337.claudevm.ssh.ExecResult
import io.github.liotto1337.claudevm.ssh.HostKeyPrompt
import io.github.liotto1337.claudevm.ssh.HostKeys
import io.github.liotto1337.claudevm.ssh.NotConnectedException
import io.github.liotto1337.claudevm.ssh.SshConfig
import io.github.liotto1337.claudevm.ssh.SshListener
import io.github.liotto1337.claudevm.ssh.SshResult
import io.github.liotto1337.claudevm.ssh.SshSession
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject
import java.io.File

/**
 * Единственное SSH-соединение приложения. Живёт в процессе, а не в Activity: пересоздание Activity
 * (поворот, смена темы) и перезагрузка WebView его не рвут. События уходят в sink — его ставит плагин.
 */
class SshHub(private val secrets: SecretStore, private val knownHosts: File, private val appCtx: Context? = null) {
    /** Настройки фона из интерфейса: keepAlive — foreground-сервис, notifications — уведомления, tmux — команда tmux (тесты: свой сервер), sessions — сколько сессий в списке. */
    data class Background(val keepAlive: Boolean = true, val notifications: Boolean = true, val tmux: String = "tmux", val sessions: Int = 0)

    @Volatile var background = Background()
        private set
    /** Activity на экране (onStart…onStop): уведомления о сессиях не нужны */
    @Volatile var visible = true
    /** Изменилось состояние соединения или число сессий — сервис обновляет своё уведомление */
    @Volatile var onChange: (() -> Unit)? = null

    @Volatile var sink: ChunkBatcher.Sink? = null
    private val batcher = ChunkBatcher({ e, d -> sink?.emit(e, d) })
    @Volatile var session: SshSession? = null
        private set
    @Volatile private var hostKeyAnswer: CompletableDeferred<Boolean>? = null

    private fun emit(event: String, data: JSONObject = JSONObject()) {
        batcher.flush()
        sink?.emit(event, data)
    }

    private val listener = object : SshListener {
        override fun onState(state: String, attempt: Int?) {
            emit("state", JSONObject().put("state", state).apply { if (attempt != null) put("attempt", attempt) })
            onChange?.invoke()
            if (state == "failed") syncService()
        }
        override fun onPreflight(step: String, status: String, detail: String) =
            emit("preflight", JSONObject().put("step", step).put("status", status).put("detail", detail))
        override fun onLost() = emit("lost")
        override fun onReconnected() = emit("reconnected")
        override suspend fun onHostKey(p: HostKeyPrompt): Boolean {
            val answer = CompletableDeferred<Boolean>()
            hostKeyAnswer?.complete(false)
            hostKeyAnswer = answer
            emit("hostkey", JSONObject().put("host", p.host).put("port", p.port).put("kind", p.kind).put("fingerprint", p.fingerprint))
            return answer.await()
        }
        override fun onData(ch: Int, seq: Int, bytes: ByteArray) = batcher.add(ch, seq, "data", bytes)
        override fun onStderr(ch: Int, seq: Int, bytes: ByteArray) = batcher.add(ch, seq, "stderr", bytes)
        override fun onClose(ch: Int) = batcher.closed(ch)
    }

    /** Соединение уже живо с тем же адресом — не переподключаемся, только сообщаем состояние. */
    suspend fun connect(cfg: SshConfig): SshResult {
        val current = session
        if (current != null && current.connected && current.config == cfg) {
            emit("state", JSONObject().put("state", "connected"))
            return SshResult.Ok
        }
        current?.close()
        val next = SshSession(cfg, secrets, HostKeys(knownHosts), listener)
        session = next
        val r = next.connect(interactive = true)
        if (r is SshResult.Err) {
            next.close()
            if (session === next) session = null
        }
        syncService()
        return r
    }

    fun answerHostKey(trust: Boolean) {
        hostKeyAnswer?.complete(trust)
        hostKeyAnswer = null
    }

    fun status(): Boolean = session?.connected == true

    private fun need(): SshSession = session ?: throw NotConnectedException()

    suspend fun exec(cmd: String, stdin: String?, timeoutMs: Long?): ExecResult = need().exec(cmd, stdin, timeoutMs)
    fun openChannel(cmd: String, pty: Pair<Int, Int>?): Int =
        pty?.let { (cols, rows) -> need().openPty(cmd, cols, rows) } ?: need().openStream(cmd)
    fun write(ch: Int, data: ByteArray) = session?.write(ch, data)
    fun end(ch: Int) = session?.end(ch)
    fun closeChannel(ch: Int) = session?.close(ch)
    fun resize(ch: Int, cols: Int, rows: Int) = session?.resize(ch, cols, rows)
    suspend fun writeFile(path: String, data: ByteArray, offset: Long) = need().writeFile(path, data, offset) {}
    fun forceReconnect() = session?.forceReconnect()

    fun close() {
        answerHostKey(false)
        session?.close()
        session = null
        syncService()
    }

    fun setBackground(b: Background) {
        val changed = b.sessions != background.sessions
        background = b
        syncService()
        if (changed) onChange?.invoke()
    }

    /** Foreground-сервис — пока есть соединение (или оно переподключается) и включено «Держать связь в фоне». */
    private fun syncService() {
        val ctx = appCtx ?: return
        if (session != null && background.keepAlive) runCatching { SshService.start(ctx) } else SshService.stop(ctx)
    }

    /** Ключ проверяется при импорте: тип, нужна ли парольная фраза. Ответ — как Result интерфейса. */
    fun secretsSave(name: String, value: String?, passphrase: String?): JSONObject {
        if (name == "password") {
            secrets.save("password", value)
            return JSONObject().put("ok", true)
        }
        if (value.isNullOrEmpty()) {
            secrets.save("key", null)
            secrets.save("passphrase", null)
            return JSONObject().put("ok", true)
        }
        return when (val r = KeyImport.parse(value, passphrase)) {
            is KeyImport.Result.Ok -> {
                secrets.save("key", value)
                secrets.save("passphrase", passphrase)
                JSONObject().put("ok", true).put("keyType", r.type)
            }
            KeyImport.Result.NeedsPassphrase -> invalid("Ключ защищён парольной фразой")
            is KeyImport.Result.Invalid -> invalid(r.message)
        }
    }

    private fun invalid(message: String) = JSONObject().put("ok", false).put("code", "CONFIG_INVALID").put("message", message)

    fun secretsHas(name: String): String = secrets.has(name)

    companion object {
        @Volatile private var instance: SshHub? = null

        fun get(ctx: Context): SshHub = instance ?: synchronized(this) {
            instance ?: SshHub(SecretStore(ctx.applicationContext), File(ctx.filesDir, "known_hosts"), ctx.applicationContext).also { instance = it }
        }
    }
}
