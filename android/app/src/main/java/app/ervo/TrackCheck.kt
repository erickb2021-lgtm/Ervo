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
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Live package tracking while Ervo is closed.
 *
 * The web app hands over its open order cards that have a tracking number (id, number, carrier, title,
 * the step it last saw, the server to ask). About once an hour Android asks Ervo's server for each one;
 * the server asks the carrier. When a package moves to a new step (shipped, out for delivery, delivered)
 * or the carrier reports a problem, one notification shows. Tapping it opens Ervo, where the card
 * refreshes itself. Nothing is checked until the person has allowed Order tracking in the app.
 */
object TrackCheck {
    private const val PREFS = "ervo_track"
    private const val CHANNEL = "package_updates"
    private const val REQ = 4401
    private const val ACTION = "app.ervo.TRACK_CHECK"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The web app's current list of cards to watch (a JSON array). An empty list stops the checks. */
    fun sync(ctx: Context, json: String) {
        val list = try { JSONArray(json) } catch (e: Exception) { return }
        prefs(ctx).edit().putString("list", list.toString()).apply()
        if (list.length() > 0) schedule(ctx) else cancel(ctx)
    }

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, REQ, Intent(ctx, TrackCheckReceiver::class.java).setAction(ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /** About every hour, inexact, so it costs almost no battery. */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val hour = AlarmManager.INTERVAL_HOUR
        am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + hour, hour, pending(ctx))
    }

    fun cancel(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(ctx))
    }

    /** After a restart or an update the alarm is gone; plan it again if there is anything to watch. */
    fun reschedule(ctx: Context) {
        val raw = prefs(ctx).getString("list", null) ?: return
        val n = try { JSONArray(raw).length() } catch (e: Exception) { 0 }
        if (n > 0) schedule(ctx)
    }

    private fun stepOf(s: String): Int = when (s) { "delivered" -> 3; "out" -> 2; "shipped" -> 1; else -> 0 }

    /** Asks the server about every open card and notifies on anything new. Runs off the main thread. */
    fun check(ctx: Context) {
        val raw = prefs(ctx).getString("list", null) ?: return
        val list = try { JSONArray(raw) } catch (e: Exception) { return }
        var changed = false
        for (i in 0 until list.length()) {
            val t = list.optJSONObject(i) ?: continue
            val before = t.optInt("step", 0)
            if (before >= 3) continue
            val server = t.optString("server")
            val number = t.optString("number")
            if (server.isEmpty() || number.isEmpty()) continue
            val body = JSONObject().put("number", number).put("carrier", t.optString("carrier"))
            val r = post("$server/track", t.optString("origin"), body) ?: continue
            if (!r.optBoolean("ok", false)) continue
            val step = stepOf(r.optString("step"))
            val text = r.optString("text")
            val trouble = r.optBoolean("trouble", false)
            val newText = text.isNotEmpty() && text != t.optString("text")
            if (step > before || newText) {
                t.put("step", maxOf(step, before)).put("text", text)
                changed = true
                if (step > before || (trouble && newText)) {
                    val place = r.optString("place")
                    notify(ctx, t.optString("id"), step, "${t.optString("title").ifBlank { "Your package" }}: ${r.optString("status")}", if (place.isEmpty()) text else "$text · $place")
                }
            }
        }
        if (changed) prefs(ctx).edit().putString("list", list.toString()).apply()
    }

    private fun post(url: String, origin: String, body: JSONObject): JSONObject? = try {
        val con = URL(url).openConnection() as HttpURLConnection
        con.requestMethod = "POST"
        con.doOutput = true
        con.connectTimeout = 10000
        con.readTimeout = 15000
        con.setRequestProperty("Content-Type", "application/json")
        con.setRequestProperty("User-Agent", "Ervo-Android")
        if (origin.isNotEmpty()) con.setRequestProperty("Origin", origin)
        con.outputStream.use { it.write(body.toString().toByteArray()) }
        if (con.responseCode != 200) null
        else con.inputStream.bufferedReader().use { it.readText() }.let { JSONObject(it) }
    } catch (e: Exception) { null }

    private fun notify(ctx: Context, id: String, step: Int, title: String, text: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Package updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "When a package you're tracking ships, is out for delivery or is delivered"
            })
        }
        val open = PendingIntent.getActivity(
            ctx, (id + step).hashCode(),
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title.take(80))
            .setContentText(text.take(240))
            .setStyle(NotificationCompat.BigTextStyle().bigText(text.take(240)))
            .setColor(0xFF7C4DFF.toInt())
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify((id + step).hashCode(), n) } catch (e: SecurityException) { /* notifications are off */ }
    }
}

/** Runs the hourly check in the background; also plans it again after a restart or an update. */
class TrackCheckReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            TrackCheck.reschedule(app)
            return
        }
        val done = goAsync()
        Thread {
            try { TrackCheck.check(app) } catch (e: Exception) { /* next hour */ } finally { done.finish() }
        }.start()
    }
}
