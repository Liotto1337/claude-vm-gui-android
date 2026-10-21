package io.github.liotto1337.claudevm

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.github.liotto1337.claudevm.bridge.ChunkBatcher
import io.github.liotto1337.claudevm.bridge.SshHub
import io.github.liotto1337.claudevm.ssh.NotConnectedException
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
@CapacitorPlugin(name = "VmBridge")
class VmBridgePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var hub: SshHub
    private val sink = ChunkBatcher.Sink { e, d -> notifyListeners(e, JSObject(d.toString())) }

    override fun load() {
        hub = SshHub.get(context)
        hub.sink = sink
    }

    override fun handleOnDestroy() {
        if (hub.sink === sink) hub.sink = null
        scope.cancel()
    }

    /** Ошибки — reject с кодом: NOT_CONNECTED, если соединения нет. */
    private fun run(call: PluginCall, block: suspend () -> JSObject?) {
        scope.launch {
            try {
                call.resolve(block() ?: JSObject())
            } catch (e: NotConnectedException) {
                call.reject("NOT_CONNECTED", "NOT_CONNECTED")
            } catch (e: Exception) {
                call.reject(e.message ?: e.javaClass.simpleName, "NOT_CONNECTED")
            }
        }
    }

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
        val r = hub.exec(call.getString("cmd") ?: "", call.getString("stdin"), call.getLong("timeoutMs"))
        JSObject().put("code", r.code).put("stdout", r.stdout).put("stderr", r.stderr)
    }

    @PluginMethod fun openChannel(call: PluginCall) = run(call) {
        val pty = call.getObject("pty")?.let { (it.getInteger("cols") ?: 80) to (it.getInteger("rows") ?: 24) }
        JSObject().put("ch", hub.openChannel(call.getString("cmd") ?: "", pty))
    }

    @PluginMethod fun write(call: PluginCall) = run(call) { hub.write(call.ch(), (call.getString("data") ?: "").toByteArray()); null }
    @PluginMethod fun end(call: PluginCall) = run(call) { hub.end(call.ch()); null }
    @PluginMethod fun closeChannel(call: PluginCall) = run(call) { hub.closeChannel(call.ch()); null }
    @PluginMethod fun resize(call: PluginCall) = run(call) { hub.resize(call.ch(), call.getInt("cols") ?: 80, call.getInt("rows") ?: 24); null }

    @PluginMethod fun writeFile(call: PluginCall) = run(call) {
        hub.writeFile(call.getString("path") ?: "", Base64.getDecoder().decode(call.getString("b64") ?: ""), call.getLong("offset") ?: 0)
        null
    }

    @PluginMethod fun answerHostKey(call: PluginCall) = run(call) { hub.answerHostKey(call.getBoolean("trust", false) == true); null }

    @PluginMethod fun checkTcp(call: PluginCall) = run(call) {
        val ms = SshSession.checkTcp(call.getString("host") ?: "", call.getInt("port") ?: 22)
        JSObject().put("ok", ms != null).put("ms", ms)
    }

    @PluginMethod fun secretsSave(call: PluginCall) = run(call) {
        JSObject(hub.secretsSave(call.getString("name") ?: "", call.getString("value"), call.getString("passphrase")).toString())
    }

    @PluginMethod fun secretsHas(call: PluginCall) = run(call) { JSObject().put("value", hub.secretsHas(call.getString("name") ?: "")) }

    @PluginMethod fun setBackground(call: PluginCall) = run(call) { null }
}
