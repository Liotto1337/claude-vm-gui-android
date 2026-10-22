package io.github.liotto1337.claudevm.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.github.liotto1337.claudevm.MainActivity
import io.github.liotto1337.claudevm.R
import io.github.liotto1337.claudevm.service.SshService

/** Уведомления: постоянное «Подключено к ВМ» (канал «Подключение») и по сессиям (канал «Сессии»). */
object Notifications {
    const val CHANNEL_CONNECTION = "connection"
    const val CHANNEL_SESSIONS = "sessions"
    const val ID_CONNECTION = 1
    const val EXTRA_SESSION = "session"

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CHANNEL_CONNECTION, "Подключение", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CHANNEL_SESSIONS, "Сессии", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun openApp(ctx: Context, session: String?, request: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { if (session != null) putExtra(EXTRA_SESSION, session) }
        return PendingIntent.getActivity(ctx, request, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** «Подключено к ВМ · N сессий» или «Переподключение…», с кнопкой «Отключиться». */
    fun connection(ctx: Context, sessions: Int, reconnecting: Boolean): android.app.Notification {
        val stop = PendingIntent.getService(
            ctx, 0, Intent(ctx, SshService::class.java).setAction(SshService.ACTION_DISCONNECT), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(ctx, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_stat_claude)
            .setContentTitle("Claude VM")
            .setContentText(if (reconnecting) "Переподключение…" else "Подключено к ВМ · $sessions ${plural(sessions, "сессия", "сессии", "сессий")}")
            .setOngoing(true)
            .setContentIntent(openApp(ctx, null, 0))
            .addAction(0, "Отключиться", stop)
            .build()
    }

    private fun sessionId(session: String) = "s:$session".hashCode()

    /** Одно уведомление на сессию — новое заменяет старое; касание открывает приложение на этой сессии. */
    fun postSession(ctx: Context, session: String, kind: SessionNotifier.Kind, text: String) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        val title = if (kind == SessionNotifier.Kind.FINISHED) "$session: Claude закончил" else "$session: Claude ждёт ответа"
        val n = NotificationCompat.Builder(ctx, CHANNEL_SESSIONS)
            .setSmallIcon(R.drawable.ic_stat_claude)
            .setContentTitle(title)
            .apply { if (kind == SessionNotifier.Kind.WAITING && text.isNotEmpty()) setContentText(text) }
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, session, sessionId(session)))
            .build()
        runCatching { nm.notify(sessionId(session), n) }
    }

    fun cancelSession(ctx: Context, session: String) = NotificationManagerCompat.from(ctx).cancel(sessionId(session))

    /** Склонение после числа, как src/shared/plural.ts: 1 сессия, 2 сессии, 5 сессий. */
    fun plural(n: Int, one: String, few: String, many: String): String {
        val m10 = n % 10
        val m100 = n % 100
        return when {
            m10 == 1 && m100 != 11 -> one
            m10 in 2..4 && m100 !in 12..14 -> few
            else -> many
        }
    }
}
