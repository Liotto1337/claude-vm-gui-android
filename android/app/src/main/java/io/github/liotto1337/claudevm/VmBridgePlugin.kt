package io.github.liotto1337.claudevm

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Мост JS ↔ SSH-сервис. Методы — каркас, реализация в задачах 5–7. */
@CapacitorPlugin(name = "VmBridge")
class VmBridgePlugin : Plugin() {
    private fun notYet(call: PluginCall) = call.reject("not implemented")

    @PluginMethod fun connect(call: PluginCall) = notYet(call)
    @PluginMethod fun close(call: PluginCall) = notYet(call)
    @PluginMethod fun exec(call: PluginCall) = notYet(call)
    @PluginMethod fun openChannel(call: PluginCall) = notYet(call)
    @PluginMethod fun write(call: PluginCall) = notYet(call)
    @PluginMethod fun end(call: PluginCall) = notYet(call)
    @PluginMethod fun closeChannel(call: PluginCall) = notYet(call)
    @PluginMethod fun resize(call: PluginCall) = notYet(call)
    @PluginMethod fun writeFile(call: PluginCall) = notYet(call)
    @PluginMethod fun answerHostKey(call: PluginCall) = notYet(call)
    @PluginMethod fun checkTcp(call: PluginCall) = notYet(call)
    @PluginMethod fun secretsSave(call: PluginCall) = notYet(call)
    @PluginMethod fun secretsHas(call: PluginCall) = notYet(call)
    @PluginMethod fun setBackground(call: PluginCall) = notYet(call)
}
