package io.github.liotto1337.claudevm

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VmBridgePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
