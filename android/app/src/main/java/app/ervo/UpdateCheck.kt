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
import java.net.HttpURLConnection
import java.net.URL

/**
 * Update check that lives outside the web page.
 *
 * The page has its own "Check for Updates", but if the page's script ever crashes (0.3.7 opened to a
 * black screen) there is no way to reach it. So Android itself looks at Ervo's GitHub releases a few
 * times a day and, when a newer Ervo.apk is out, shows one notification. Tapping it downloads and
 * installs the update without the page (MainActivity.updateNatively). Android still asks before installing.
 */
object UpdateCheck {
    private const val PREFS = "ervo_update"
    private const val CHANNEL = "updates"
    private const val REQ = 4301
    private const val API = "https://api.github.com/repos/erickb2021-lgtm/Ervo/releases/latest"
    const val PREFIX = "https://github.com/erickb2021-lgtm/Ervo/releases/download/"
    const val EXTRA_APK = "ervo_update_apk"
    const val EXTRA_VERSION = "ervo_update_version"

    data class Latest(val version: String, val apkUrl: String, val notes: List<String>)

    fun current(ctx: Context): String =
        try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0" } catch (e: Exception) { "0" }

    /** true when a is a higher version than b ("0.3.10" beats "0.3.9") */
    fun newer(a: String, b: String): Boolean {
        val x = a.removePrefix("v").split(".").map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        val y = b.removePrefix("v").split(".").map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = (x.getOrNull(i) ?: 0) - (y.getOrNull(i) ?: 0)
            if (d != 0) return d > 0
        }
        return false
    }

    /** The newest release on GitHub, or null when offline or when there is no Ervo.apk on it. */
    fun fetchLatest(): Latest? {
        val json = try {
            val con = URL(API).openConnection() as HttpURLConnection
            con.setRequestProperty("Accept", "application/vnd.github+json")
            con.setRequestProperty("User-Agent", "Ervo-Android")
            con.connectTimeout = 8000
            con.readTimeout = 8000
            if (con.responseCode != 200) return null
            con.inputStream.bufferedReader().use { it.readText() }.let { JSONObject(it) }
        } catch (e: Exception) { return null }
        val tag = json.optString("tag_name").removePrefix("v")
        if (tag.isEmpty()) return null
        val assets = json.optJSONArray("assets") ?: return null
        var apk = ""
        for (i in 0 until assets.length()) {
            val a = assets.optJSONObject(i) ?: continue
            if (a.optString("name") == "Ervo.apk") apk = a.optString("browser_download_url")
        }
        if (!apk.startsWith(PREFIX)) return null
        val notes = json.optString("body").lines()
            .filter { it.trimStart().startsWith("- ") || it.trimStart().startsWith("* ") }
            .map { it.trim().drop(2).replace("**", "") }
        return Latest(tag, apk, notes)
    }

    /** Looks for a newer version. With notify, shows the notification once per version. Returns the update, if any. */
    fun check(ctx: Context, notify: Boolean): Latest? {
        val latest = fetchLatest() ?: return null
        if (!newer(latest.version, current(ctx))) return null
        if (notify) {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (p.getString("notified", "") != latest.version) {
                notify(ctx, latest)
                p.edit().putString("notified", latest.version).apply()
            }
        }
        return latest
    }

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, REQ, Intent(ctx, UpdateCheckReceiver::class.java).setAction("app.ervo.UPDATE_CHECK"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /** Checks about every six hours (inexact, so it costs almost no battery). */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val six = 6 * AlarmManager.INTERVAL_HOUR
        am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + six, six, pending(ctx))
    }

    private fun notify(ctx: Context, latest: Latest) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Ervo updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "One notification when a new version of Ervo is ready"
            })
        }
        val open = PendingIntent.getActivity(
            ctx, REQ + 1,
            Intent(ctx, MainActivity::class.java)
                .putExtra(EXTRA_APK, latest.apkUrl)
                .putExtra(EXTRA_VERSION, latest.version)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val body = latest.notes.firstOrNull()?.let { "$it. Tap to update; your chats and settings stay." }
            ?: "Tap to update. Your chats and settings stay."
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Ervo ${latest.version} is ready")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setColor(0xFF7C4DFF.toInt())
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(REQ, n) } catch (e: SecurityException) { /* notifications are off */ }
    }
}

/** Runs the update check in the background; also plans it again after a restart or an update. */
class UpdateCheckReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            UpdateCheck.schedule(app)
            return
        }
        val done = goAsync()
        Thread {
            try { UpdateCheck.check(app, true) } catch (e: Exception) { /* next time */ } finally { done.finish() }
        }.start()
    }
}
