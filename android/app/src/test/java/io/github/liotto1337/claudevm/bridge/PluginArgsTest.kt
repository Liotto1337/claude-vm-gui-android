package io.github.liotto1337.claudevm.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Числа из JS приходят в JSON как Integer: смещение части файла и таймаут команды должны читаться и тогда. */
@RunWith(RobolectricTestRunner::class)
class PluginArgsTest {
    private fun call(json: String) = PluginCall(null, "VmBridge", "1", "writeFile", JSObject(json))

    @Test fun `смещение части файла — Integer из JSON, а не 0`() {
        assertEquals(262144L, PluginArgs.long(call("{\"offset\":262144}"), "offset"))
        assertEquals(5_000_000_000L, PluginArgs.long(call("{\"offset\":5000000000}"), "offset"))
        assertEquals(0L, PluginArgs.long(call("{}"), "offset"))
    }

    @Test fun `таймаут команды — Integer читается, нет — null`() {
        assertEquals(3000L, PluginArgs.longOrNull(call("{\"timeoutMs\":3000}"), "timeoutMs"))
        assertEquals(null, PluginArgs.longOrNull(call("{}"), "timeoutMs"))
    }

    @Test fun `причина бага — PluginCall getLong не читает Integer`() {
        assertEquals(null, call("{\"offset\":262144}").getLong("offset"))
    }
}
