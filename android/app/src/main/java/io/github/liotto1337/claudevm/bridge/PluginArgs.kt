package io.github.liotto1337.claudevm.bridge

import com.getcapacitor.PluginCall

/**
 * Целые числа из вызовов плагина. JSON отдаёт небольшие числа как Integer, а `PluginCall.getLong` читает только Long:
 * смещение части файла становилось 0 — каждая часть затирала файл с начала (на ВМ оставалась последняя часть),
 * таймаут команды пропадал.
 */
object PluginArgs {
    fun long(call: PluginCall, key: String): Long = call.data.optLong(key, 0L)

    fun longOrNull(call: PluginCall, key: String): Long? = if (call.data.has(key) && !call.data.isNull(key)) call.data.optLong(key) else null
}
