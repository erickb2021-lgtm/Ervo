package app.ervo

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * Order reminders: "arrives tomorrow", "should arrive today", "is on the way".
 *
 * The web app plans each one (id, time, title, text) from an order card; the time and words are
 * remembered here so they survive a restart, and an inexact alarm shows the notification. Tapping
 * it opens Ervo. Nothing is fetched: Ervo tracks what the person told it.
 */
object OrderNotice {
    private const val PREFS = "ervo_orders"
    private const val CHANNEL = "order_notices"
    private const val ACTION = "app.ervo.ORDER_NOTICE"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun pending(ctx: Context, id: String): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, id.hashCode(), Intent(ctx, OrderNoticeReceiver::class.java).setAction(ACTION).putExtra("id", id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    fun schedule(ctx: Context, id: String, at: Long, title: String, text: String) {
        if (at < System.currentTimeMillis()) return
        prefs(ctx).edit().putString(id, JSONObject().put("at", at).put("title", title).put("text", text).toString()).apply()
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, id)) } catch (e: SecurityException) { /* alarms are off */ }
    }

    fun cancel(ctx: Context, id: String) {
        prefs(ctx).edit().remove(id).apply()
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(ctx, id))
    }

    /** After a restart or an update the alarms are gone; plan the ones still ahead again. */
    fun reschedule(ctx: Context) {
        val all = prefs(ctx).all
        for ((id, raw) in all) {
            val j = try { JSONObject(raw as String) } catch (e: Exception) { continue }
            val at = j.optLong("at", 0L)
            if (at > System.currentTimeMillis()) schedule(ctx, id, at, j.optString("title"), j.optString("text"))
            else prefs(ctx).edit().remove(id).apply()
        }
    }

    fun show(ctx: Context, id: String) {
        val raw = prefs(ctx).getString(id, null) ?: return
        prefs(ctx).edit().remove(id).apply()
        val j = try { JSONObject(raw) } catch (e: Exception) { return }
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Order reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "The day before and the day a package should arrive"
            })
        }
        val open = PendingIntent.getActivity(
            ctx, id.hashCode() + 1,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val text = j.optString("text")
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(j.optString("title").ifBlank { "Your package" })
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setColor(0xFF7C4DFF.toInt())
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(id.hashCode(), n) } catch (e: SecurityException) { /* notifications are off */ }
    }
}

class OrderNoticeReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            OrderNotice.reschedule(app)
            return
        }
        val id = intent.getStringExtra("id") ?: return
        OrderNotice.show(app, id)
    }
}
