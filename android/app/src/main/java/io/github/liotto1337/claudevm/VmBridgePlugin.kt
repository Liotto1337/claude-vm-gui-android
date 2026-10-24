package io.github.liotto1337.claudevm

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import android.Manifest
import android.content.Intent
import android.os.Build
import io.github.liotto1337.claudevm.notify.Notifications
import io.github.liotto1337.claudevm.bridge.ChunkBatcher
import io.github.liotto1337.claudevm.bridge.PluginArgs
import io.github.liotto1337.claudevm.bridge.PluginErrors
import io.github.liotto1337.claudevm.bridge.SerialQueue
import io.github.liotto1337.claudevm.bridge.SshHub
import io.github.liotto1337.claudevm.ssh.SshConfig
import io.github.liotto1337.claudevm.ssh.SshResult
import io.github.liotto1337.claudevm.ssh.SshSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.Base64

/** Мост JS ↔ SshHub. Контракт — VmBridgePlugin в src/platform/android.ts. */
@CapacitorPlugin(name = "VmBridge", permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])])
class VmBridgePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var hub: SshHub
    private val sink = ChunkBatcher.Sink { e, d -> notifyListeners(e, JSObject(d.toString())) }

    override fun load() {
        hub = SshHub.get(context)
        hub.sink = sink
        // Новый WebView (пересоздание Activity, смена шрифта, падение рендерера): соединение переиспользуется,
        // а PTY и `tail -F` прежнего интерфейса никто уже не закроет — закрываем сами
        hub.closeAllChannels()
        // Приложение открыто касанием уведомления о сессии (холодный старт)
        activity?.intent?.let { openSessionFrom(it) }
    }

    private fun openSessionFrom(intent: Intent) {
        val name = intent.getStringExtra(Notifications.EXTRA_SESSION) ?: return
        intent.removeExtra(Notifications.EXTRA_SESSION)
        // Сессию открывают по её уведомлению — оно больше не нужно (и если сессия уже была открыта)
        Notifications.cancelSession(context, name)
        // Слушатель в JS может ещё не подписаться — событие ждёт его
        notifyListeners("openSession", JSObject().put("name", name), true)
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        openSessionFrom(intent)
    }

    override fun handleOnStart() {
        super.handleOnStart()
        hub.visible = true
    }

    override fun handleOnStop() {
        super.handleOnStop()
        hub.visible = false
    }

    override fun handleOnDestroy() {
        if (hub.sink === sink) hub.sink = null
        scope.cancel()
    }

    /** Ошибки — reject с кодом: NOT_CONNECTED, если соединения нет, иначе SSH_ERROR. */
    private suspend fun settle(call: PluginCall, block: suspend () -> JSObject?) {
        try {
            call.resolve(block() ?: JSObject())
        } catch (e: Exception) {
            call.reject(PluginErrors.message(e), PluginErrors.code(e))
        }
    }

    private fun run(call: PluginCall, block: suspend () -> JSObject?) {
        scope.launch { settle(call, block) }
    }

    // Операции с каналами — строго по очереди: иначе нажатия в терминале могли бы переставиться
    private val ordered = SerialQueue(scope)

    private fun runOrdered(call: PluginCall, block: suspend () -> JSObject?) = ordered.submit { settle(call, block) }

    private fun PluginCall.ch(): Int = getInt("ch") ?: -1

    @PluginMethod fun connect(call: PluginCall) = run(call) {
        val cfg = SshConfig(call.getString("host") ?: "", call.getInt("port") ?: 22, call.getString("username") ?: "")
        when (val r = hub.connect(cfg)) {
            SshResult.Ok -> JSObject().put("ok", true)
            is SshResult.Err -> JSObject().put("ok", false).put("code", r.code).put("message", r.message)
        }
    }

    @PluginMethod fun close(call: PluginCall) = run(call) { hub.close(); null }

    @PluginMethod fun status(call: PluginCall) = run(call) { JSObject().put("connected", hub.status()) }

    @PluginMethod fun exec(call: PluginCall) = run(call) {
        val r = hub.exec(call.getString("cmd") ?: "", call.getString("stdin"), PluginArgs.longOrNull(call, "timeoutMs"))
        JSObject().put("code", r.code).put("stdout", r.stdout).put("stderr", r.stderr)
    }

    @PluginMethod fun openChannel(call: PluginCall) = runOrdered(call) {
        val pty = call.getObject("pty")?.let { (it.getInteger("cols") ?: 80) to (it.getInteger("rows") ?: 24) }
        JSObject().put("ch", hub.openChannel(call.getString("cmd") ?: "", pty))
    }

    @PluginMethod fun write(call: PluginCall) = runOrdered(call) { hub.write(call.ch(), (call.getString("data") ?: "").toByteArray()); null }
    @PluginMethod fun end(call: PluginCall) = runOrdered(call) { hub.end(call.ch()); null }
    @PluginMethod fun closeChannel(call: PluginCall) = runOrdered(call) { hub.closeChannel(call.ch()); null }
    @PluginMethod fun resize(call: PluginCall) = runOrdered(call) { hub.resize(call.ch(), call.getInt("cols") ?: 80, call.getInt("rows") ?: 24); null }

    @PluginMethod fun writeFile(call: PluginCall) = run(call) {
        hub.writeFile(call.getString("path") ?: "", Base64.getDecoder().decode(call.getString("b64") ?: ""), PluginArgs.long(call, "offset"))
        null
    }

    @PluginMethod fun answerHostKey(call: PluginCall) = run(call) { hub.answerHostKey(call.getBoolean("trust", false) == true); null }

    @PluginMethod fun forgetHostKey(call: PluginCall) = run(call) {
        hub.forgetHostKey(call.getString("host") ?: "", call.getInt("port") ?: 22)
        null
    }

    @PluginMethod fun checkTcp(call: PluginCall) = run(call) {
        val ms = SshSession.checkTcp(call.getString("host") ?: "", call.getInt("port") ?: 22)
        JSObject().put("ok", ms != null).put("ms", ms)
    }

    @PluginMethod fun secretsSave(call: PluginCall) = run(call) {
        JSObject(hub.secretsSave(call.getString("name") ?: "", call.getString("value"), call.getString("passphrase")).toString())
    }

    @PluginMethod fun secretsHas(call: PluginCall) = run(call) { JSObject().put("value", hub.secretsHas(call.getString("name") ?: "")) }

    @PluginMethod fun setBackground(call: PluginCall) = run(call) {
        hub.setBackground(
            SshHub.Background(
                keepAlive = call.getBoolean("keepAlive", true) == true,
                notifications = call.getBoolean("notifications", true) == true,
                tmux = call.getString("tmux") ?: "tmux",
                sessions = call.getInt("sessions") ?: 0,
                watched = call.getArray("watched")?.toList<Any?>()?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            ),
        )
        null
    }

    /** Сессию открыли в приложении — её уведомление больше не нужно. */
    @PluginMethod fun clearNotification(call: PluginCall) = run(call) {
        call.getString("name")?.let { Notifications.cancelSession(context, it) }
        null
    }

    /** Разрешение на уведомления (Android 13+); раньше оно не нужно. */
    @PluginMethod fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", call, "notificationsResult")
    }

    @PermissionCallback
    private fun notificationsResult(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }
}
