package io.github.liotto1337.claudevm.service

import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import io.github.liotto1337.claudevm.notify.Notifications
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class SshServiceLifecycleTest {
    private fun started(): Pair<SshService, Int> {
        val svc = Robolectric.buildService(SshService::class.java).create().get()
        return svc to svc.onStartCommand(Intent(), 0, 1)
    }

    @Test fun `запуск — foreground с уведомлением «Подключение», без перезапуска системой`() {
        val (svc, r) = started()
        assertEquals(Service.START_NOT_STICKY, r)
        val n = shadowOf(svc).lastForegroundNotification
        assertNotNull(n)
        assertEquals(Notifications.CHANNEL_CONNECTION, n.channelId)
    }

    @Test fun `тип сервиса в манифесте — specialUse`() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val info = ctx.packageManager.getServiceInfo(ComponentName(ctx, SshService::class.java), 0)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE, info.foregroundServiceType)
    }

    @Test fun `приложение смахнули из недавних — сервис останавливается`() {
        val (svc, _) = started()
        svc.onTaskRemoved(Intent())
        assertTrue(shadowOf(svc).isStoppedBySelf)
    }

    @Test fun `остановка снимает уведомление «Подключено» (не висит без живого процесса)`() {
        val (svc, _) = started()
        svc.onDestroy()
        assertTrue(shadowOf(svc).isForegroundStopped)
        assertTrue(shadowOf(svc).notificationShouldRemoved)
    }

    @Test fun `кнопка «Отключиться» в уведомлении останавливает сервис`() {
        val svc = Robolectric.buildService(SshService::class.java).create().get()
        svc.onStartCommand(Intent(SshService.ACTION_DISCONNECT), 0, 1)
        assertTrue(shadowOf(svc).isStoppedBySelf)
    }
}
