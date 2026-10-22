package io.github.liotto1337.claudevm.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.liotto1337.claudevm.bridge.SshHub
import io.github.liotto1337.claudevm.notify.Notifications
import io.github.liotto1337.claudevm.notify.SessionNotifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground-сервис «Подключено к ВМ»: держит процесс (а с ним SshHub) живым, пока приложение свёрнуто,
 * и раз в 5 с опрашивает сессии для уведомлений. За сменой сети следит сам SshHub. Система его не перезапускает:
 * убитый процесс — это закрытое соединение, «Подключено» без процесса не висит.
 */
class SshService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val hub = SshHub.get(this)
        if (intent?.action == ACTION_DISCONNECT) {
            hub.close()
            stopSelf()
            return START_NOT_STICKY
        }
        val n = Notifications.connection(this, hub.background.sessions, reconnecting = !hub.status())
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notifications.ID_CONNECTION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(Notifications.ID_CONNECTION, n)
        hub.onChange = { refresh() }
        if (loop == null) loop = scope.launch { notifyLoop(hub) }
        return START_NOT_STICKY
    }

    private fun refresh() {
        val hub = SshHub.get(this)
        val n = Notifications.connection(this, hub.background.sessions, reconnecting = !hub.status())
        runCatching { NotificationManagerCompat.from(this).notify(Notifications.ID_CONNECTION, n) }
    }

    private suspend fun notifyLoop(hub: SshHub) {
        var tmux = hub.background.tmux
        var notifier = notifierFor(hub, tmux)
        while (scope.isActive) {
            delay(POLL_MS)
            val b = hub.background
            if (b.tmux != tmux) {
                tmux = b.tmux
                notifier = notifierFor(hub, tmux)
            }
            // Пока приложение на экране, хватает интерфейса; вернулись к нему — начинаем заново, без старых состояний
            if (!b.notifications || hub.visible || !hub.status()) notifier = notifierFor(hub, tmux)
            else runCatching { notifier.tick() }
        }
    }

    private fun notifierFor(hub: SshHub, tmux: String) = SessionNotifier(
        exec = { hub.exec(it, null, 10_000) },
        post = { s, k, t -> Notifications.postSession(this, s, k, t) },
        cancel = { Notifications.cancelSession(this, it) },
        tmux = tmux,
        watched = { hub.background.watched },
    )

    /** Приложение смахнули из недавних — пользователь его закрыл: соединение тоже. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        SshHub.get(this).close()
        stopSelf()
    }

    override fun onDestroy() {
        loop?.cancel()
        SshHub.get(this).onChange = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        NotificationManagerCompat.from(this).cancel(Notifications.ID_CONNECTION)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_DISCONNECT = "io.github.liotto1337.claudevm.DISCONNECT"
        private const val POLL_MS = 5_000L

        fun start(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, SshService::class.java))
        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, SshService::class.java))
    }
}
