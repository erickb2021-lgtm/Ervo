package app.ervo

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.CalendarContract
import android.provider.Settings
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/**
 * Ervo's Android shell. The app screens live in assets/www and are served from a
 * secure local address, so the app works offline and nothing loads from the internet.
 * The phone's own speech recognizer, text-to-speech, photo picker, location and
 * Health Connect steps are shared with the screens through the ErvoNative bridge below.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var geoOrigin: String? = null
    private var geoCallback: GeolocationPermissions.Callback? = null

    private val stepsPermission = setOf(HealthPermission.getReadPermission(StepsRecord::class))

    // Voice: the system recognizer listens until the user stops talking, then returns the text
    private val voiceLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (result.resultCode == Activity.RESULT_OK && !text.isNullOrBlank()) {
            callJs("ervoVoiceResult", text)
        } else {
            callJs("ervoVoiceResult", "")
        }
    }

    // Photos: the system picker, handed back to the page's file input
    private val photoLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    // Location: only asked for when the user turns on weather in their greeting
    private val locationLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        geoCallback?.invoke(geoOrigin, granted, false)
        geoCallback = null
        geoOrigin = null
    }

    // Steps: Health Connect shows its own Allow / Don't allow screen
    private val healthLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        if (granted.containsAll(stepsPermission)) readSteps() else callJs("ervoSteps", """{"status":"denied"}""")
    }

    // Calendar: asked for the first time someone asks Ervo to remove an event
    private var pendingFind: Triple<String, Long, Long>? = null
    private val calendarLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val find = pendingFind
        pendingFind = null
        if (find != null && result.values.isNotEmpty() && result.values.all { it }) findEventsNow(find.first, find.second, find.third)
        else callJs("ervoEvents", """{"status":"denied"}""")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            setGeolocationEnabled(true)
            // Follow the phone's text size, but keep it from breaking the layout
            textZoom = (resources.configuration.fontScale * 100).toInt().coerceIn(85, 115)
        }
        webView.addJavascriptInterface(Bridge(), "ErvoNative")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) return false
                openOutside(request.url)
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    photoLauncher.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    callback.invoke(origin, true, false)
                } else {
                    geoOrigin = origin
                    geoCallback = callback
                    locationLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                }
            }

            // Links that open a new window (target="_blank") go to the browser or the matching app
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
                val href = view.hitTestResult.extra ?: return false
                openOutside(Uri.parse(href))
                return false
            }
        }

        tts = TextToSpeech(this) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.getDefault()
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl("https://$APP_HOST/assets/www/index.html")
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.ervoBack ? window.ervoBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
    }

    /** Methods the app screens can call as ErvoNative.method(). */
    inner class Bridge {
        @JavascriptInterface
        fun startListening() = runOnUiThread {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Talk to Ervo")
            }
            try {
                voiceLauncher.launch(intent)
            } catch (e: ActivityNotFoundException) {
                callJs("ervoVoiceError", "This phone doesn't have a speech recognizer. Try typing instead.")
            }
        }

        @JavascriptInterface
        fun stopListening() {
            // The system voice screen closes on its own when you stop talking
        }

        @JavascriptInterface
        fun speak(text: String) = runOnUiThread {
            if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ervo-reply")
        }

        @JavascriptInterface
        fun stopSpeaking() = runOnUiThread { tts?.stop() }

        /** Opens a website, or its app if installed (Google Calendar, Amazon, email). */
        @JavascriptInterface
        fun openUrl(url: String) = runOnUiThread {
            val uri = Uri.parse(url)
            if (uri.scheme in setOf("https", "http", "mailto", "market")) openOutside(uri)
        }

        /**
         * Opens the phone's own calendar app with the event filled in. The user picks
         * which calendar (Samsung, Google, Outlook...) and taps Save there.
         */
        @JavascriptInterface
        fun addCalendarEvent(title: String, beginMs: Double, endMs: Double, allDay: Boolean, notes: String) = runOnUiThread {
            val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
                putExtra(CalendarContract.Events.TITLE, title)
                putExtra(CalendarContract.Events.DESCRIPTION, notes)
                putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs.toLong())
                putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs.toLong())
                putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
            }
            try {
                startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                callJs("ervoCalendarError", "no-app")
            }
        }

        /** Finds events in the phone's calendars by words in the title, sent to window.ervoEvents. */
        @JavascriptInterface
        fun findEvents(query: String, fromMs: Double, toMs: Double) = runOnUiThread {
            if (hasPermission(Manifest.permission.READ_CALENDAR) && hasPermission(Manifest.permission.WRITE_CALENDAR)) {
                findEventsNow(query, fromMs.toLong(), toMs.toLong())
            } else {
                pendingFind = Triple(query, fromMs.toLong(), toMs.toLong())
                calendarLauncher.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
            }
        }

        /**
         * Removes one event the user picked, sent to window.ervoEventDeleted with an undo token.
         * For a repeating event only that one day is cancelled, not the whole series.
         */
        @JavascriptInterface
        fun deleteEvent(id: String, rawBegin: Double, repeats: Boolean) = runOnUiThread {
            lifecycleScope.launch {
                val token = withContext(Dispatchers.IO) {
                    try {
                        if (hasPermission(Manifest.permission.WRITE_CALENDAR)) removeEventNow(id.toLong(), rawBegin.toLong(), repeats) else null
                    } catch (e: Exception) {
                        null
                    }
                }
                callJs("ervoEventDeleted", JSONObject().put("id", id).put("ok", token != null).put("undo", token ?: "").toString())
            }
        }

        /** Puts back an event removed with deleteEvent, sent to window.ervoEventRestored. */
        @JavascriptInterface
        fun restoreEvent(token: String) = runOnUiThread {
            lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) {
                    try {
                        hasPermission(Manifest.permission.WRITE_CALENDAR) && restoreEventNow(token)
                    } catch (e: Exception) {
                        false
                    }
                }
                callJs("ervoEventRestored", JSONObject().put("token", token).put("ok", ok).toString())
            }
        }

        /** This app's version, like "0.2.1", so the screens can check for updates. */
        @JavascriptInterface
        fun appVersion(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: "0"

        /** Downloads a new Ervo.apk from Ervo's GitHub releases, then opens the installer. */
        @JavascriptInterface
        fun downloadUpdate(url: String) = runOnUiThread {
            if (!url.startsWith(UPDATE_PREFIX)) {
                callJs("ervoUpdate", """{"status":"error"}""")
                return@runOnUiThread
            }
            lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) { download(url) }
                if (ok) installUpdate() else callJs("ervoUpdate", """{"status":"error"}""")
            }
        }

        /** Tries the install again, after the user allows Ervo to install apps. */
        @JavascriptInterface
        fun installUpdate() = runOnUiThread { this@MainActivity.installUpdate() }

        /** Opens Android's "Install unknown apps" switch for Ervo (a one-time step). */
        @JavascriptInterface
        fun openInstallSettings() = runOnUiThread {
            openOutside(Uri.parse("package:$packageName"), Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
        }

        /** Colors the phone's status bar (top) and navigation bar (bottom) to match the screen. */
        @JavascriptInterface
        fun setBars(top: String, bottom: String, dark: Boolean) = runOnUiThread {
            try {
                window.statusBarColor = Color.parseColor(top)
                window.navigationBarColor = Color.parseColor(bottom)
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            } catch (e: IllegalArgumentException) {
                // Not a color; leave the bars as they are
            }
        }

        /** "ready", "needs_permission", "needs_update" or "unavailable", sent to window.ervoSteps. */
        @JavascriptInterface
        fun stepsStatus() = runOnUiThread {
            when (HealthConnectClient.getSdkStatus(this@MainActivity)) {
                HealthConnectClient.SDK_AVAILABLE -> lifecycleScope.launch {
                    val granted = try {
                        HealthConnectClient.getOrCreate(this@MainActivity).permissionController.getGrantedPermissions()
                    } catch (e: Exception) {
                        emptySet()
                    }
                    if (granted.containsAll(stepsPermission)) readSteps()
                    else callJs("ervoSteps", """{"status":"needs_permission"}""")
                }
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                    callJs("ervoSteps", """{"status":"needs_update"}""")
                else -> callJs("ervoSteps", """{"status":"unavailable"}""")
            }
        }

        /** Shows Health Connect's permission screen for reading steps. */
        @JavascriptInterface
        fun requestSteps() = runOnUiThread {
            when (HealthConnectClient.getSdkStatus(this@MainActivity)) {
                HealthConnectClient.SDK_AVAILABLE -> try {
                    healthLauncher.launch(stepsPermission)
                } catch (e: ActivityNotFoundException) {
                    callJs("ervoSteps", """{"status":"unavailable"}""")
                }
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                    // Send them to the Play Store to install or update Health Connect
                    openOutside(Uri.parse("market://details?id=$HEALTH_CONNECT_PACKAGE&url=healthconnect%3A%2F%2Fonboarding"))
                    callJs("ervoSteps", """{"status":"needs_update"}""")
                }
                else -> callJs("ervoSteps", """{"status":"unavailable"}""")
            }
        }
    }

    /** Reads today's steps and the last 7 days from Health Connect and sends them to the page. */
    private fun readSteps() {
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@MainActivity)
                val zone = ZoneId.systemDefault()
                val today = LocalDate.now(zone)
                val week = JSONArray()
                for (back in 6 downTo 0) {
                    val day = today.minusDays(back.toLong())
                    val result = client.aggregate(
                        AggregateRequest(
                            metrics = setOf(StepsRecord.COUNT_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(
                                day.atStartOfDay(zone).toInstant(),
                                day.plusDays(1).atStartOfDay(zone).toInstant()
                            )
                        )
                    )
                    week.put(JSONObject().put("date", day.toString()).put("steps", result[StepsRecord.COUNT_TOTAL] ?: 0L))
                }
                val todaySteps = week.getJSONObject(6).getLong("steps")
                callJs("ervoSteps", JSONObject().put("status", "ready").put("today", todaySteps).put("week", week).toString())
            } catch (e: Exception) {
                callJs("ervoSteps", """{"status":"error"}""")
            }
        }
    }

    private fun updateFile() = File(File(cacheDir, "updates").apply { mkdirs() }, "Ervo.apk")

    /** Saves the APK to the app's private cache, sending progress to window.ervoUpdate. */
    private fun download(url: String): Boolean {
        val target = updateFile()
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return false
            val total = conn.contentLengthLong
            var done = 0L
            var lastPct = -1
            conn.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        done += n
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        if (pct != lastPct) {
                            lastPct = pct
                            callJs("ervoUpdate", """{"status":"downloading","percent":$pct}""")
                        }
                    }
                }
            }
            total <= 0 || done == total
        } catch (e: Exception) {
            false
        }
    }

    /** Hands the downloaded APK to Android's installer, which asks the user to confirm. */
    private fun installUpdate() {
        val apk = updateFile()
        if (!apk.exists()) {
            callJs("ervoUpdate", """{"status":"error"}""")
            return
        }
        // The first time, the user has to let Ervo install updates (see openInstallSettings)
        if (!packageManager.canRequestPackageInstalls()) {
            callJs("ervoUpdate", """{"status":"needs_permission"}""")
            return
        }
        val uri = FileProvider.getUriForFile(this, "$packageName.files", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            callJs("ervoUpdate", """{"status":"installing"}""")
        } catch (e: ActivityNotFoundException) {
            callJs("ervoUpdate", """{"status":"error"}""")
        }
    }

    /**
     * Every event the user can edit between two times, in all calendars on the phone (Google
     * calendars synced to the phone included). Uses Instances, so each day of a repeating event
     * shows up too. If `query` has words, every word must be in the title.
     */
    private fun findEventsNow(query: String, fromMs: Long, toMs: Long) {
        lifecycleScope.launch {
            val json = withContext(Dispatchers.IO) {
                try {
                    val day = 24L * 60 * 60 * 1000
                    // All-day events are stored at midnight UTC, so look a day wider and let the app trim
                    val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
                        .appendPath((fromMs - day).toString()).appendPath((toMs + day).toString()).build()
                    val words = query.split(Regex("\\s+")).filter { it.length > 1 }.take(4)
                    val where = StringBuilder(
                        "${CalendarContract.Events.DELETED} = 0 AND " +
                            "${CalendarContract.Instances.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR} AND " +
                            "(${CalendarContract.Instances.STATUS} IS NULL OR ${CalendarContract.Instances.STATUS} != ${CalendarContract.Events.STATUS_CANCELED})"
                    )
                    val args = mutableListOf<String>()
                    words.forEach {
                        where.append(" AND ${CalendarContract.Instances.TITLE} LIKE ?")
                        args.add("%$it%")
                    }
                    val projection = arrayOf(
                        CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN,
                        CalendarContract.Instances.END, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.RRULE,
                        CalendarContract.Instances.CALENDAR_DISPLAY_NAME
                    )
                    val events = JSONArray()
                    contentResolver.query(uri, projection, where.toString(), args.toTypedArray(), "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
                        while (c.moveToNext() && events.length() < 80) {
                            val allDay = c.getInt(4) == 1
                            val begin = c.getLong(2)
                            val start = if (allDay) utcDayToLocal(begin) else begin
                            if (start < fromMs || start >= toMs) continue
                            events.put(
                                JSONObject()
                                    .put("id", c.getLong(0).toString())
                                    .put("title", c.getString(1) ?: "")
                                    .put("start", start)
                                    .put("end", if (allDay) utcDayToLocal(c.getLong(3)) else c.getLong(3))
                                    .put("rawBegin", begin)
                                    .put("allDay", allDay)
                                    .put("repeats", !c.getString(5).isNullOrBlank())
                                    .put("calendar", c.getString(6) ?: "")
                            )
                        }
                    }
                    JSONObject().put("status", "ready").put("events", events).toString()
                } catch (e: Exception) {
                    """{"status":"error"}"""
                }
            }
            callJs("ervoEvents", json)
        }
    }

    /** Midnight UTC of a day -> midnight of that same day on this phone. */
    private fun utcDayToLocal(ms: Long): Long {
        val date = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate()
        return date.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
    }

    // What Ervo needs to put an event back if the user taps Undo (kept until Ervo closes)
    private sealed class Undo {
        class Restore(val values: android.content.ContentValues, val reminders: List<Pair<Int, Int>>) : Undo()
        class DropException(val exceptionId: Long) : Undo()
    }
    private val undoStore = HashMap<String, Undo>()

    private fun removeEventNow(eventId: Long, rawBegin: Long, repeats: Boolean): String? {
        val token = java.util.UUID.randomUUID().toString()
        if (repeats) {
            // Cancel just this day of the repeating event
            val values = android.content.ContentValues().apply {
                put(CalendarContract.Events.ORIGINAL_INSTANCE_TIME, rawBegin)
                put(CalendarContract.Events.STATUS, CalendarContract.Events.STATUS_CANCELED)
            }
            val made = contentResolver.insert(Uri.withAppendedPath(CalendarContract.Events.CONTENT_EXCEPTION_URI, eventId.toString()), values) ?: return null
            undoStore[token] = Undo.DropException(ContentUris.parseId(made))
            return token
        }
        // Copy the event first, so Undo can put it back
        val cols = arrayOf(
            CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE, CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.EVENT_LOCATION, CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND,
            CalendarContract.Events.DURATION, CalendarContract.Events.ALL_DAY, CalendarContract.Events.EVENT_TIMEZONE,
            CalendarContract.Events.EVENT_END_TIMEZONE, CalendarContract.Events.AVAILABILITY, CalendarContract.Events.ACCESS_LEVEL
        )
        val eventUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId)
        val values = android.content.ContentValues()
        contentResolver.query(eventUri, cols, null, null, null)?.use { c ->
            if (!c.moveToFirst()) return null
            cols.forEachIndexed { i, col ->
                when (c.getType(i)) {
                    android.database.Cursor.FIELD_TYPE_INTEGER -> values.put(col, c.getLong(i))
                    android.database.Cursor.FIELD_TYPE_STRING -> values.put(col, c.getString(i))
                    else -> {}
                }
            }
        } ?: return null
        if (!values.containsKey(CalendarContract.Events.DTEND) && !values.containsKey(CalendarContract.Events.DURATION)) {
            values.put(CalendarContract.Events.DTEND, (values.getAsLong(CalendarContract.Events.DTSTART) ?: 0L) + 60 * 60 * 1000)
        }
        if (!values.containsKey(CalendarContract.Events.EVENT_TIMEZONE)) values.put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().id)
        val reminders = mutableListOf<Pair<Int, Int>>()
        contentResolver.query(
            CalendarContract.Reminders.CONTENT_URI, arrayOf(CalendarContract.Reminders.MINUTES, CalendarContract.Reminders.METHOD),
            "${CalendarContract.Reminders.EVENT_ID} = ?", arrayOf(eventId.toString()), null
        )?.use { c -> while (c.moveToNext()) reminders.add(c.getInt(0) to c.getInt(1)) }
        if (contentResolver.delete(eventUri, null, null) <= 0) return null
        undoStore[token] = Undo.Restore(values, reminders)
        return token
    }

    private fun restoreEventNow(token: String): Boolean {
        return when (val undo = undoStore.remove(token)) {
            is Undo.DropException -> contentResolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, undo.exceptionId), null, null) > 0
            is Undo.Restore -> {
                val made = contentResolver.insert(CalendarContract.Events.CONTENT_URI, undo.values) ?: return false
                val newId = ContentUris.parseId(made)
                undo.reminders.forEach { (minutes, method) ->
                    contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, android.content.ContentValues().apply {
                        put(CalendarContract.Reminders.EVENT_ID, newId)
                        put(CalendarContract.Reminders.MINUTES, minutes)
                        put(CalendarContract.Reminders.METHOD, method)
                    })
                }
                true
            }
            null -> false
        }
    }

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun callJs(function: String, text: String) {
        webView.post { webView.evaluateJavascript("window.$function && window.$function(${JSONObject.quote(text)})", null) }
    }

    private fun openOutside(uri: Uri, action: String = Intent.ACTION_VIEW) {
        try {
            startActivity(Intent(action, uri))
        } catch (e: ActivityNotFoundException) {
            // No app can open it; stay where we are
        }
    }

    override fun onResume() {
        super.onResume()
        // Coming back from Health Connect, Calendar or Amazon: let the page refresh
        if (::webView.isInitialized) webView.evaluateJavascript("window.ervoResume && window.ervoResume()", null)
    }

    override fun onPause() {
        super.onPause()
        tts?.stop()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata"
        // Updates only ever come from Ervo's own GitHub releases
        private const val UPDATE_PREFIX = "https://github.com/erickb2021-lgtm/Ervo/releases/download/"
    }
}
