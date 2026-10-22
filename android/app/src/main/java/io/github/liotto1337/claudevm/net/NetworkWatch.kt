package io.github.liotto1337.claudevm.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network

/**
 * Смена сети (Wi-Fi ↔ мобильная): старый TCP умирает молча, keepalive заметил бы это только через ~90 с —
 * переподключаемся сразу. Первая сеть после подписки — та, на которой соединение уже есть.
 */
class NetworkWatch(private val onChange: () -> Unit) {
    private var base: Any? = null

    fun onAvailable(network: Any) {
        if (base == null) {
            base = network
            return
        }
        if (network == base) return
        base = network
        onChange()
    }

    /** Пропажа сети сама по себе ничего не делает: переподключимся, когда появится другая. */
    fun onLost(@Suppress("UNUSED_PARAMETER") network: Any) {}

    private var callback: ConnectivityManager.NetworkCallback? = null

    fun register(ctx: Context) {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = this@NetworkWatch.onAvailable(network)
            override fun onLost(network: Network) = this@NetworkWatch.onLost(network)
        }
        callback = cb
        cm.registerDefaultNetworkCallback(cb)
    }

    fun unregister(ctx: Context) {
        val cb = callback ?: return
        callback = null
        runCatching { ctx.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) }
    }
}
