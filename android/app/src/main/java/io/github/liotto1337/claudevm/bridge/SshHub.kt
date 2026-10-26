package io.github.liotto1337.claudevm.bridge

import android.content.Context
import io.github.liotto1337.claudevm.notify.Notifications
import io.github.liotto1337.claudevm.net.NetworkWatch
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
    /** watched — сессии с отметкой «Отслеживать»: уведомления только от них */
    data class Background(
        val keepAlive: Boolean = true,
        val notifications: Boolean = true,
        val tmux: String = "tmux",
        val sessions: Int = 0,
        val watched: Set<String> = emptySet(),
    )

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
    /** Переподключение остановлено (ключ сервера сменился): связи нет и не будет, пока человек не подключится заново */
    @Volatile private var failed = false
    private var watch: NetworkWatch? = null

    private fun emit(event: String, data: JSONObject = JSONObject()) = batcher.emitAfterChunks(event, data)

    /** События сессии — только пока она текущая: устаревшая (закрытая при новом connect) не мигает интерфейсу «ошибкой». */
    private fun listenerFor(owner: () -> SshSession?): SshListener = object : SshListener {
        private fun live() = owner() === session
        override fun onState(state: String, attempt: Int?) { if (live()) listener.onState(state, attempt) }
        override fun onPreflight(step: String, status: String, detail: String) { if (live()) listener.onPreflight(step, status, detail) }
        override fun onLost() { if (live()) listener.onLost() }
        override fun onReconnected() { if (live()) listener.onReconnected() }
        override suspend fun onHostKey(p: HostKeyPrompt): Boolean = live() && listener.onHostKey(p)
        override fun onData(ch: Int, seq: Int, bytes: ByteArray) { if (live()) listener.onData(ch, seq, bytes) }
        override fun onStderr(ch: Int, seq: Int, bytes: ByteArray) { if (live()) listener.onStderr(ch, seq, bytes) }
        override fun onClose(ch: Int) { if (live()) listener.onClose(ch) }
    }

    private val listener = object : SshListener {
        override fun onState(state: String, attempt: Int?) {
            failed = state == "failed"
            emit("state", JSONObject().put("state", state).apply { if (attempt != null) put("attempt", attempt) })
            onChange?.invoke()
            if (failed) sync()
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
        session = null
        failed = false
        current?.close()
        var self: SshSession? = null
        val next = SshSession(cfg, secrets, HostKeys(knownHosts), listenerFor { self })
        self = next
        session = next
        val r = next.connect(interactive = true)
        if (r is SshResult.Err) {
            next.close()
            if (session === next) session = null
        }
        sync()
        return r
    }

    fun forgetHostKey(host: String, port: Int) = HostKeys(knownHosts).remove(host, port)

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
    fun closeAllChannels() = session?.closeAllChannels()
    fun end(ch: Int) = session?.end(ch)
    fun closeChannel(ch: Int) = session?.close(ch)
    fun resize(ch: Int, cols: Int, rows: Int) = session?.resize(ch, cols, rows)
    suspend fun writeFile(path: String, data: ByteArray, offset: Long) = need().writeFile(path, data, offset) {}
    fun readFile(path: String, out: java.io.OutputStream, onProgress: (Long, Long) -> Unit) = need().readFile(path, out, onProgress)
    fun forceReconnect() = session?.forceReconnect()

    fun close() {
        answerHostKey(false)
        session?.close()
        session = null
        sync()
    }

    fun setBackground(b: Background) {
        val changed = b.sessions != background.sessions
        // Сняли «Отслеживать» (или сессию удалили) — её уведомление больше не нужно. Здесь, а не в опросе:
        // снять отметку можно только в открытом приложении, а тогда опрос своих состояний не помнит
        appCtx?.let { ctx -> for (gone in background.watched - b.watched) Notifications.cancelSession(ctx, gone) }
        background = b
        sync()
        if (changed) onChange?.invoke()
    }

    /**
     * Пока есть соединение (или оно переподключается): слежение за сетью и, если включено «Держать связь в фоне», —
     * foreground-сервис. Переподключение остановлено — ни того ни другого: «Переподключение…» не висит.
     */
    @Synchronized private fun sync() {
        val ctx = appCtx ?: return
        val live = session != null && !failed
        if (live && watch == null) watch = NetworkWatch { forceReconnect() }.also { it.register(ctx) }
        if (!live && watch != null) {
            watch?.unregister(ctx)
            watch = null
        }
        if (live && background.keepAlive) runCatching { SshService.start(ctx) } else SshService.stop(ctx)
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
