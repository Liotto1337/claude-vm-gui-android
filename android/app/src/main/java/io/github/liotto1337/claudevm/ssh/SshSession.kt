package io.github.liotto1337.claudevm.ssh

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.keepalive.KeepAliveRunner
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.OpenMode
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.method.AuthKeyboardInteractive
import net.schmizz.sshj.userauth.method.AuthMethod
import net.schmizz.sshj.userauth.method.AuthNone
import net.schmizz.sshj.userauth.method.AuthPassword
import net.schmizz.sshj.userauth.method.AuthPublickey
import net.schmizz.sshj.userauth.method.ChallengeResponseProvider
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.PublicKey
import java.security.Security
import java.util.EnumSet
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private const val HANDSHAKE_MS = 20_000L
private const val HOST_KEY_ANSWER_MS = 120_000L
private const val TCP_TIMEOUT_MS = 5_000
private const val TEXT_TCP_FAIL = "Не удалось соединиться за 5 с. Проверьте интернет и что ВМ включена"
private const val TEXT_SKIPPED = "Пропущено"

/**
 * Одно SSH-соединение с ВМ (sshj): вход, ключ хоста, exec, каналы (поток и PTY), SFTP, автопереподключение.
 * Как bridge/ssh.ts, но на Kotlin: соединение живёт в сервисе Android, а не в WebView.
 */
class SshSession(
    private val cfg: SshConfig,
    private val secrets: SecretSource,
    private val hostKeys: HostKeys,
    private val listener: SshListener,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var client: SSHClient? = null
    @Volatile private var closing = false
    @Volatile private var wake = CompletableDeferred<Unit>()
    private val channels = ConcurrentHashMap<Int, Chan>()
    private val nextCh = AtomicInteger(1)

    private class Chan(val session: Session, val cmd: Session.Command, val seq: ChunkSeq = ChunkSeq())

    init {
        ensureProvider()
    }

    val connected: Boolean get() = client?.let { it.isConnected && it.isAuthenticated } == true

    val config: SshConfig get() = cfg

    /** Проверка TCP, затем SSH; шаги — через onPreflight, как на экране подключения. */
    suspend fun connect(interactive: Boolean = true): SshResult = withContext(Dispatchers.IO) {
        closing = false
        listener.onState("connecting", null)
        listener.onPreflight("tcp", "running", "")
        val tcp = checkTcp(cfg.host, cfg.port)
        if (tcp == null) {
            listener.onPreflight("tcp", "fail", TEXT_TCP_FAIL)
            listener.onPreflight("ssh", "skipped", TEXT_SKIPPED)
            listener.onPreflight("tmux", "skipped", TEXT_SKIPPED)
            listener.onState("failed", null)
            return@withContext SshResult.Err("TCP_UNREACHABLE", "Порт ${cfg.port} на ${cfg.host} недоступен")
        }
        listener.onPreflight("tcp", "ok", "Порт открыт, соединение за $tcp мс")
        listener.onPreflight("ssh", "running", "")
        val (r, detail) = connectOnce(interactive)
        if (r is SshResult.Err) {
            listener.onPreflight("ssh", "fail", r.message)
            listener.onPreflight("tmux", "skipped", TEXT_SKIPPED)
            listener.onState("failed", null)
        } else {
            listener.onPreflight("ssh", "ok", detail)
            listener.onState("connected", null)
        }
        r
    }

    private enum class Verdict { OK, REJECTED, MISMATCH }

    /** Одна попытка рукопожатия и входа. Возвращает итог и способ входа для шага SSH. */
    private fun connectOnce(interactive: Boolean): Pair<SshResult, String> {
        val key = secrets.read("key")?.takeIf { it.isNotBlank() }
        val password = secrets.read("password")?.takeIf { it.isNotEmpty() }
        if (key == null && password == null)
            return SshResult.Err("AUTH_FAILED", "Нет ни ключа, ни пароля: импортируйте SSH-ключ или задайте пароль в настройках") to ""

        val knownTypes = hostKeys.knownTypes(cfg.host, cfg.port)
        val config = DefaultConfig().apply {
            keepAliveProvider = KeepAliveProvider.KEEP_ALIVE
            // Хост уже известен — только его типы ключей (как HostKeyAlgorithms в OpenSSH), иначе подмену не заметить
            if (knownTypes.isNotEmpty()) {
                val allowed = HostKeys.algorithms(knownTypes)
                keyAlgorithms = keyAlgorithms.filter { it.name in allowed }
            }
        }
        val c = SSHClient(config)
        var verdict = Verdict.OK
        var mismatchText = ""
        // Свой таймер рукопожатия: замирает, пока человек сверяет отпечаток
        val watchdog = Watchdog(HANDSHAKE_MS) { runCatching { c.socket?.close() } }
        c.addHostKeyVerifier(object : HostKeyVerifier {
            override fun verify(hostname: String, port: Int, pk: PublicKey): Boolean {
                val blob = Buffer.PlainBuffer().putPublicKey(pk).compactData
                val type = HostKeys.typeOf(blob)
                val fp = HostKeys.fingerprint(blob)
                when (hostKeys.check(cfg.host, cfg.port, type, blob)) {
                    HostKeys.Check.MATCH -> return true
                    HostKeys.Check.MISMATCH -> {
                        verdict = Verdict.MISMATCH
                        val known = hostKeys.knownFingerprint(cfg.host, cfg.port, type) ?: "неизвестен"
                        mismatchText = "Ключ сервера изменился. В known_hosts: $known, сервер прислал: $fp"
                        return false
                    }
                    HostKeys.Check.UNKNOWN -> {
                        if (!interactive) return false.also { verdict = Verdict.REJECTED }
                        watchdog.pause()
                        val trust = runBlocking {
                            withTimeoutOrNull(HOST_KEY_ANSWER_MS) {
                                listener.onHostKey(HostKeyPrompt(cfg.host, cfg.port, "unknown", fp))
                            } ?: false
                        }
                        watchdog.resume()
                        if (!trust) return false.also { verdict = Verdict.REJECTED }
                        // known_hosts не записать — доверяем ключу на эту сессию
                        runCatching { hostKeys.add(cfg.host, cfg.port, type, blob) }
                        return true
                    }
                }
            }

            override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = HostKeys.algorithms(knownTypes)
        })
        var offered: List<String>? = null
        try {
            c.connectTimeout = TCP_TIMEOUT_MS
            // Обмен ключами ждёт и ответа человека про ключ хоста; сам срок рукопожатия держит watchdog
            c.transport.timeoutMs = (HOST_KEY_ANSWER_MS + HANDSHAKE_MS).toInt()
            watchdog.start()
            c.connect(cfg.host, cfg.port)
            c.transport.timeoutMs = 30_000
            runCatching { c.auth(cfg.username, AuthNone()) }
            offered = c.userAuth.allowedMethods?.toList()
            val methods = AuthPlan.build(offered, key != null, password != null).mapNotNull { m -> authMethod(c, m, key, password) }
            var detail = ""
            var lastError: Exception? = null
            for ((name, method) in methods) {
                try {
                    c.auth(cfg.username, method)
                    detail = name
                    break
                } catch (e: UserAuthException) {
                    lastError = e
                }
            }
            if (!c.isAuthenticated) throw lastError ?: UserAuthException("no methods")
            watchdog.stop()
            (c.connection.keepAlive as? KeepAliveRunner)?.maxAliveCount = 3
            c.connection.keepAlive.keepAliveInterval = 30
            c.transport.setDisconnectListener { _, _ -> onClosed(c) }
            client = c
            return SshResult.Ok to detail
        } catch (e: Exception) {
            watchdog.stop()
            runCatching { c.disconnect() }
            val r = when {
                verdict == Verdict.MISMATCH -> SshResult.Err("HOSTKEY_MISMATCH", mismatchText)
                verdict == Verdict.REJECTED -> SshResult.Err("HOSTKEY_REJECTED", "Ключ сервера не принят")
                watchdog.fired -> SshResult.Err("TCP_UNREACHABLE", "Сервер не ответил за 20 с")
                knownTypes.isNotEmpty() && e.message?.contains("settlement", ignoreCase = true) == true ->
                    SshResult.Err("HOSTKEY_MISMATCH", "Сервер не предложил ключ известного типа (${knownTypes.joinToString(", ")}). Возможна подмена сервера")
                e is UserAuthException -> SshResult.Err("AUTH_FAILED", authFailedText(offered, key != null, password != null))
                else -> SshResult.Err("TCP_UNREACHABLE", e.message ?: e.javaClass.simpleName)
            }
            return r to ""
        }
    }

    private fun authMethod(c: SSHClient, name: String, key: String?, password: String?): Pair<String, AuthMethod>? = when (name) {
        "publickey" -> key?.let { k -> runCatching { "импортированный ключ" to AuthPublickey(c.loadKeys(k, null, null)) }.getOrNull() }
        "password" -> password?.let { p ->
            "пароль" to AuthPassword(object : PasswordFinder {
                override fun reqPassword(resource: Resource<*>?) = p.toCharArray()
                override fun shouldRetry(resource: Resource<*>?) = false
            })
        }
        "keyboard-interactive" -> password?.let { p ->
            "пароль" to AuthKeyboardInteractive(object : ChallengeResponseProvider {
                override fun getSubmethods(): List<String> = emptyList()
                override fun init(resource: Resource<*>?, name: String?, instruction: String?) {}
                override fun getResponse(prompt: String?, echo: Boolean): CharArray = if (echo) CharArray(0) else p.toCharArray()
                override fun shouldRetry() = false
            })
        }
        else -> null
    }

    private fun authFailedText(offered: List<String>?, hasKey: Boolean, hasPassword: Boolean): String = when {
        !hasPassword -> "Сервер не принял ключ. Проверьте, что его открытая часть есть в ~/.ssh/authorized_keys"
        offered != null && "password" !in offered && "keyboard-interactive" !in offered ->
            "На сервере выключен вход по паролю. Используйте SSH-ключ"
        hasKey -> "Сервер не принял ни ключ, ни пароль"
        else -> "Сервер не принял пароль"
    }

    private fun onClosed(c: SSHClient) {
        if (c !== client) return
        client = null
        channels.keys.toList().forEach { closeChannelState(it) }
        if (closing) return
        listener.onLost()
        scope.launch { reconnectLoop() }
    }

    private suspend fun reconnectLoop() {
        var attempt = 1
        while (!closing) {
            listener.onState("reconnecting", attempt)
            wake = CompletableDeferred()
            withTimeoutOrNull(Backoff.delayMs(attempt)) { wake.await() }
            attempt++
            if (closing) return
            if (checkTcp(cfg.host, cfg.port) == null) continue
            // Новый неизвестный ключ при переподключении не принимаем без человека
            val (r, _) = connectOnce(interactive = false)
            if (closing) {
                client?.disconnect()
                return
            }
            if (r is SshResult.Ok) {
                listener.onState("connected", null)
                listener.onReconnected()
                return
            }
            if (r is SshResult.Err && (r.code == "HOSTKEY_MISMATCH" || r.code == "HOSTKEY_REJECTED")) {
                listener.onState("failed", null)
                return
            }
        }
    }

    /** Сеть сменилась: старый TCP мог умереть молча — переподключиться сразу, не дожидаясь keepalive. */
    fun forceReconnect() {
        if (closing) return
        val c = client
        if (c != null) runCatching { c.socket?.close() } else wake.complete(Unit)
    }

    /** Только для тестов: обрыв, как при потере сети. */
    fun simulateDrop() {
        runCatching { client?.socket?.close() }
    }

    private fun need(): SSHClient = client?.takeIf { it.isConnected } ?: throw NotConnectedException()

    suspend fun exec(command: String, stdin: String? = null, timeoutMs: Long? = null): ExecResult = withContext(Dispatchers.IO) {
        val session = need().startSession()
        try {
            val cmd = session.exec(command)
            val out = ByteArrayOutputStream()
            val err = ByteArrayOutputStream()
            val readers = listOf(thread { cmd.inputStream.copyTo(out) }, thread { cmd.errorStream.copyTo(err) })
            if (stdin != null) cmd.outputStream.apply { write(stdin.toByteArray()); flush() }
            runCatching { cmd.outputStream.close() }
            var timedOut = false
            if (timeoutMs != null) {
                // По истечении join бросает исключение; канал закрывается в фоне (sshj ждёт подтверждения сервера),
                // а результат — то, что успело прийти
                timedOut = runCatching { cmd.join(timeoutMs, TimeUnit.MILLISECONDS) }.isFailure
                if (timedOut) thread { runCatching { cmd.close() } }
            } else cmd.join()
            readers.forEach { it.join(if (timedOut) 200 else 2000) }
            ExecResult(cmd.exitStatus ?: -1, out.toString(Charsets.UTF_8), err.toString(Charsets.UTF_8))
        } finally {
            thread { runCatching { session.close() } }
        }
    }

    fun openStream(command: String): Int = open(command, null)

    fun openPty(command: String, cols: Int, rows: Int): Int = open(command, cols to rows)

    private fun open(command: String, pty: Pair<Int, Int>?): Int {
        val session = need().startSession()
        pty?.let { (cols, rows) -> session.allocatePTY("xterm-256color", cols, rows, 0, 0, emptyMap()) }
        val cmd = session.exec(command)
        val id = nextCh.getAndIncrement()
        val chan = Chan(session, cmd)
        channels[id] = chan
        val readers = listOf(
            pump(cmd.inputStream) { bytes, len -> chan.seq.split(bytes, len).forEach { (s, b) -> listener.onData(id, s, b) } },
            pump(cmd.errorStream) { bytes, len -> chan.seq.split(bytes, len).forEach { (s, b) -> listener.onStderr(id, s, b) } },
        )
        thread {
            readers.forEach { it.join() }
            runCatching { cmd.join(2, TimeUnit.SECONDS) }
            closeChannelState(id)
        }
        return id
    }

    private fun pump(input: InputStream, emit: (ByteArray, Int) -> Unit): Thread = thread {
        val buf = ByteArray(ChunkSeq.MAX)
        runCatching {
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (n > 0) emit(buf, n)
            }
        }
    }

    private fun closeChannelState(id: Int) {
        val chan = channels.remove(id) ?: return
        runCatching { chan.cmd.close() }
        runCatching { chan.session.close() }
        listener.onClose(id)
    }

    fun write(ch: Int, data: ByteArray) {
        val chan = channels[ch] ?: return
        runCatching { chan.cmd.outputStream.apply { write(data); flush() } }
    }

    /** Конец stdin (EOF): `cat` и `tail` с `cat >/dev/null` завершаются. */
    fun end(ch: Int) {
        runCatching { channels[ch]?.cmd?.outputStream?.close() }
    }

    fun close(ch: Int) {
        runCatching { channels[ch]?.cmd?.close() }
    }

    fun resize(ch: Int, cols: Int, rows: Int) {
        runCatching { (channels[ch]?.cmd as? SessionChannel)?.changeWindowDimensions(cols, rows, 0, 0) }
    }

    /** Запись файла по SFTP с правами 0600; onProgress — сколько байт отправлено. */
    suspend fun writeFile(path: String, data: ByteArray, onProgress: (Long) -> Unit) = withContext(Dispatchers.IO) {
        need().newSFTPClient().use { sftp ->
            val modes = EnumSet.of(OpenMode.WRITE, OpenMode.CREAT, OpenMode.TRUNC)
            sftp.open(path, modes, FileAttributes.Builder().withPermissions(0x180).build()).use { f ->
                var off = 0
                while (off < data.size) {
                    val n = minOf(ChunkSeq.MAX, data.size - off)
                    f.write(off.toLong(), data, off, n)
                    off += n
                    onProgress(off.toLong())
                }
            }
        }
    }

    fun close() {
        closing = true
        wake.complete(Unit)
        val c = client
        client = null
        channels.keys.toList().forEach { closeChannelState(it) }
        runCatching { c?.disconnect() }
        listener.onState("idle", null)
        scope.cancel()
    }

    companion object {
        /** Время соединения TCP в мс или null — порт недоступен за 5 с. */
        fun checkTcp(host: String, port: Int): Long? {
            val t = System.currentTimeMillis()
            return runCatching { Socket().use { it.connect(InetSocketAddress(host, port), TCP_TIMEOUT_MS) } }
                .map { System.currentTimeMillis() - t }.getOrNull()
        }

        /** Урезанный BouncyCastle Android заменяется полным: без него sshj не умеет ed25519 и часть шифров. */
        fun ensureProvider() {
            val bc = Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)
            if (bc?.javaClass?.name == BouncyCastleProvider::class.java.name) return
            Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
            Security.insertProviderAt(BouncyCastleProvider(), 1)
        }
    }
}

/** Таймер рукопожатия, который можно приостановить на время вопроса пользователю. */
private class Watchdog(private val limitMs: Long, private val onFire: () -> Unit) {
    @Volatile var fired = false
        private set
    private var spent = 0L
    private var since = 0L
    private var running = false
    private var stopped = false
    private val lock = Object()

    fun start() = synchronized(lock) {
        running = true
        since = System.currentTimeMillis()
        thread(isDaemon = true) {
            synchronized(lock) {
                while (!stopped) {
                    val left = limitMs - spent - (if (running) System.currentTimeMillis() - since else 0)
                    if (running && left <= 0) {
                        fired = true
                        stopped = true
                        onFire()
                        break
                    }
                    lock.wait(if (running) left.coerceAtLeast(1) else 0)
                }
            }
        }
    }

    fun pause() = synchronized(lock) {
        if (running) spent += System.currentTimeMillis() - since
        running = false
        lock.notifyAll()
    }

    fun resume() = synchronized(lock) {
        running = true
        since = System.currentTimeMillis()
        lock.notifyAll()
    }

    fun stop() = synchronized(lock) {
        stopped = true
        lock.notifyAll()
    }
}
