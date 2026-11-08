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
import java.util.Calendar
import kotlin.math.roundToInt

/**
 * Weather heads-up before you leave home.
 *
 * You pick the time you usually leave and the days. About 20 minutes before, Ervo checks the
 * forecast for your city (Open-Meteo, no account needed) and sends ONE notification, but only
 * if it matters: rain, snow, storms, strong wind, or very hot or cold. A nice day stays quiet.
 * (Microsoft's AI guidelines 3 and 4: interrupt only when it fits the moment.)
 *
 * Settings live in SharedPreferences "ervo_weather"; the web app changes them through the bridge.
 */
object WeatherAlert {
    private const val PREFS = "ervo_weather"
    private const val CHANNEL = "weather_alerts"
    private const val LEAD_MIN = 20
    private const val REQ = 4207

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun status(ctx: Context): JSONObject {
        val p = prefs(ctx)
        return JSONObject()
            .put("on", p.getBoolean("on", false))
            .put("hour", p.getInt("hour", 8))
            .put("minute", p.getInt("minute", 0))
            .put("days", p.getString("days", "23456"))
            .put("city", p.getString("city", ""))
            .put("notify", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
    }

    /** settings: {on, hour, minute, days:"23456" (1 = Sunday ... 7 = Saturday), lat, lon, city, fahrenheit} */
    fun save(ctx: Context, s: JSONObject) {
        prefs(ctx).edit()
            .putBoolean("on", s.optBoolean("on", false))
            .putInt("hour", s.optInt("hour", 8).coerceIn(0, 23))
            .putInt("minute", s.optInt("minute", 0).coerceIn(0, 59))
            .putString("days", s.optString("days", "23456").filter { it in '1'..'7' }.ifEmpty { "1234567" })
            .putFloat("lat", s.optDouble("lat", 0.0).toFloat())
            .putFloat("lon", s.optDouble("lon", 0.0).toFloat())
            .putString("city", s.optString("city", ""))
            .putBoolean("fahrenheit", s.optBoolean("fahrenheit", true))
            .apply()
        schedule(ctx)
    }

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, REQ, Intent(ctx, WeatherAlertReceiver::class.java).setAction("app.ervo.WEATHER_CHECK"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /** Sets (or clears) the next check: LEAD_MIN minutes before the next leave time on a picked day. */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pending(ctx)
        am.cancel(pi)
        val p = prefs(ctx)
        if (!p.getBoolean("on", false)) return
        val days = p.getString("days", "23456") ?: "23456"
        val now = System.currentTimeMillis()
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, p.getInt("hour", 8))
        c.set(Calendar.MINUTE, p.getInt("minute", 0))
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.MINUTE, -LEAD_MIN)
        for (i in 0..8) {
            if (c.timeInMillis > now + 30_000 && days.contains(c.get(Calendar.DAY_OF_WEEK).toString())) break
            c.add(Calendar.DAY_OF_MONTH, 1)
        }
        // Inexact is fine (no special permission); Android may shift it a few minutes to save battery
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.timeInMillis, pi)
    }

    /** Checks the forecast now. force = send a notification even on a calm day (the "Send a sample" button). */
    fun check(ctx: Context, force: Boolean) {
        val p = prefs(ctx)
        val lat = p.getFloat("lat", 0f).toDouble()
        val lon = p.getFloat("lon", 0f).toDouble()
        if (lat == 0.0 && lon == 0.0) return
        val f = p.getBoolean("fahrenheit", true)
        val city = p.getString("city", "") ?: ""
        val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
            "&hourly=temperature_2m,precipitation_probability,weather_code,wind_gusts_10m&forecast_hours=12&timezone=auto" +
            "&temperature_unit=${if (f) "fahrenheit" else "celsius"}&wind_speed_unit=${if (f) "mph" else "kmh"}"
        val json = try {
            val con = URL(url).openConnection() as HttpURLConnection
            con.connectTimeout = 8000
            con.readTimeout = 8000
            con.inputStream.bufferedReader().use { it.readText() }.let { JSONObject(it) }
        } catch (e: Exception) { return }
        val h = json.optJSONObject("hourly") ?: return
        val times = h.optJSONArray("time") ?: return
        val temp = h.optJSONArray("temperature_2m")
        val rain = h.optJSONArray("precipitation_probability")
        val code = h.optJSONArray("weather_code")
        val gust = h.optJSONArray("wind_gusts_10m")
        val n = times.length()
        fun at(i: Int) = times.optString(i).substringAfter('T').let { hhmm ->
            val hr = hhmm.substringBefore(':').toIntOrNull() ?: 0
            val ap = if (hr < 12) "AM" else "PM"
            "${if (hr % 12 == 0) 12 else hr % 12} $ap"
        }
        var title = ""
        var body = ""
        val where = if (city.isNotEmpty()) " in $city" else ""
        // Most serious first: storms, snow, rain, wind, heat, cold
        val storm = (0 until n).firstOrNull { (code?.optInt(it) ?: 0) >= 95 }
        val snow = (0 until n).firstOrNull { (code?.optInt(it) ?: 0) in 71..86 && (rain?.optInt(it) ?: 0) >= 40 }
        val wet = (0 until n).firstOrNull { (rain?.optInt(it) ?: 0) >= 50 }
        // Open-Meteo can send null for an hour; skip those so a missing number never looks like 0 degrees
        fun nums(arr: org.json.JSONArray?) = (0 until n).mapNotNull { i -> arr?.optDouble(i)?.takeIf { !it.isNaN() } }
        val temps = nums(temp)
        val maxGust = nums(gust).maxOrNull() ?: 0.0
        if (temps.isEmpty() && !force) return
        val hi = temps.maxOrNull() ?: 0.0
        val lo = temps.minOrNull() ?: 0.0
        val u = if (f) "°F" else "°C"
        when {
            storm != null -> { title = "⛈️ Storms today$where"; body = "Thunderstorms around ${at(storm)}. Bring an umbrella and give yourself extra time." }
            snow != null -> { title = "❄️ Snow on the way$where"; body = "Snow likely around ${at(snow)} (${rain?.optInt(snow)}%). Dress warm and leave a little early." }
            wet != null -> { title = "☔ Rain before you're back"; body = "${rain?.optInt(wet)}% chance of rain around ${at(wet)}$where. Grab an umbrella on your way out." }
            maxGust >= (if (f) 40.0 else 65.0) -> { title = "💨 Windy out$where"; body = "Gusts up to ${maxGust.roundToInt()} ${if (f) "mph" else "km/h"} today. Hold on to your hat." }
            temps.isNotEmpty() && hi >= (if (f) 95.0 else 35.0) -> { title = "🥵 Hot one today$where"; body = "Up to ${hi.roundToInt()}$u. Bring water and stay in the shade when you can." }
            temps.isNotEmpty() && lo <= (if (f) 35.0 else 2.0) -> { title = "🧥 Cold out$where"; body = "As low as ${lo.roundToInt()}$u. Grab a jacket before you go." }
            force -> { title = "🌤️ All clear$where"; body = "No rain or storms in the next 12 hours, ${lo.roundToInt()}$u to ${hi.roundToInt()}$u. This is what your heads-up will look like." }
            else -> return // a calm day: no notification
        }
        notify(ctx, title, body)
    }

    private fun notify(ctx: Context, title: String, body: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Weather before you leave", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Rain, snow, storms, wind, heat or cold, a little before you usually leave home"
            })
        }
        val open = PendingIntent.getActivity(
            ctx, REQ + 1, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSubText("Ervo · Before you leave")
            .setColor(0xFF7C4DFF.toInt())
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(REQ, n) } catch (e: SecurityException) { /* notifications are off */ }
    }
}

/** Runs the weather check (and plans the next one); also re-plans it after the phone restarts. */
class WeatherAlertReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            WeatherAlert.schedule(app)
            return
        }
        val done = goAsync()
        Thread {
            try { WeatherAlert.check(app, false) } finally {
                WeatherAlert.schedule(app)
                done.finish()
            }
        }.start()
    }
}
