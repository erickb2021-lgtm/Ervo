package app.ervo

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.provider.Settings
import android.content.ContentValues
import android.provider.MediaStore
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.widget.Toast
import android.os.Build
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
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
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
open class MainActivity : AppCompatActivity() {

    /** True for VoiceActivity: Ervo pops up over whatever is on screen. */
    protected open val overlay = false

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
    private var afterCalendarAsk: ((Boolean) -> Unit)? = null
    private val calendarLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val then = afterCalendarAsk
        afterCalendarAsk = null
        if (then != null) { then(result.values.isNotEmpty() && result.values.all { it }); return@registerForActivityResult }
        val find = pendingFind
        pendingFind = null
        if (find != null && result.values.isNotEmpty() && result.values.all { it }) findEventsNow(find.first, find.second, find.third)
        else callJs("ervoEvents", """{"status":"denied"}""")
    }

    // Microphone for Ervo's own listening screen (the owl). Without it, the phone's voice popup is used.
    private val micLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) listenInApp() else listenWithPopup()
    }

    // "Hey Ervo": microphone, plus notifications on Android 13+ so the listening notice shows
    private val wakeLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.RECORD_AUDIO] == true || hasPermission(Manifest.permission.RECORD_AUDIO)) {
            WakeService.setEnabled(this, true)
            WakeService.start(this)
        }
        webView.postDelayed({ callJs("ervoWakeState", wakeStatusJson()) }, 400)
    }

    // Contacts: asked the first time someone asks Ervo to call a person
    private var pendingContact: String? = null
    private val contactsLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val name = pendingContact
        pendingContact = null
        if (granted && name != null) findContactsNow(name) else callJs("ervoContacts", """{"status":"denied"}""")
    }

    // Calls: with this, the call starts right away; without it, the dialer opens with the number in
    private var pendingCall: String? = null
    private val callLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val number = pendingCall ?: return@registerForActivityResult
        pendingCall = null
        placeCall(number, granted)
    }

    // Weather heads-up: Android 13+ asks before an app may send notifications
    private val notifyLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        callJs("ervoWeatherAlert", WeatherAlert.status(this).put("asked", true).put("granted", granted).toString())
    }

    private var recognizer: SpeechRecognizer? = null
    private var pendingWake: String? = null
    private var pendingShortcut: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        webView.setBackgroundColor(if (overlay) Color.TRANSPARENT else ContextCompat.getColor(this, R.color.ervo_background))
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            setGeolocationEnabled(true)
            // Follow the phone's font size, up to 200% (the layout is built to handle it)
            textZoom = (resources.configuration.fontScale * 100).toInt().coerceIn(85, 200)
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

        // 0.2.8: "Hey Ervo" is off for everyone once (the always-on mic dot worried people); it's opt-in now
        WakeService.resetOnce(this)
        // "Hey Ervo" was on: start listening again (Android only allows this while Ervo is open)
        if (WakeService.isEnabled(this) && hasPermission(Manifest.permission.RECORD_AUDIO) && !WakeService.running) {
            try { WakeService.start(this) } catch (e: Exception) { /* try again next time */ }
        }
        takeWakeIntent(intent)
        takeShortcutIntent(intent)
        // Updates are checked by Android too, so a broken page can never hide a fix
        UpdateCheck.schedule(this)
        takeUpdateIntent(intent)
        askNotificationsOnce()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            val frag = linkFragment(intent)
            webView.loadUrl("https://$APP_HOST/assets/www/index.html" + (if (overlay) "?overlay=1" else "") + (if (frag != null) "#$frag" else ""))
        }
        // Safety net: if the page's script crashed, offer to update or reload without it
        if (!overlay) webView.postDelayed({ checkPageAlive(0) }, 9000)

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
        /** Listens on Ervo's own screen (words show up as you talk); falls back to the phone's voice popup. */
        @JavascriptInterface
        fun startListening() = runOnUiThread {
            when {
                !SpeechRecognizer.isRecognitionAvailable(this@MainActivity) -> listenWithPopup()
                hasPermission(Manifest.permission.RECORD_AUDIO) -> listenInApp()
                else -> micLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        /** "Done": stop and use what was heard so far. */
        @JavascriptInterface
        fun stopListening() = runOnUiThread { recognizer?.stopListening() }

        /** "Cancel": stop and throw it away. */
        @JavascriptInterface
        fun cancelListening() = runOnUiThread { endListening() }

        // ---------- "Hey Ervo" ----------
        @JavascriptInterface
        fun wakeStatus(): String = wakeStatusJson()

        @JavascriptInterface
        fun setWake(on: Boolean) = runOnUiThread {
            if (!on) {
                WakeService.setEnabled(this@MainActivity, false)
                WakeService.stop(this@MainActivity)
                webView.postDelayed({ callJs("ervoWakeState", wakeStatusJson()) }, 400)
                return@runOnUiThread
            }
            wakeLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
        }

        /** "Display over other apps", so "Hey Ervo" can open Ervo while you're in another app. */
        @JavascriptInterface
        fun openOverlaySettings() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            } catch (e: ActivityNotFoundException) { /* not on this phone */ }
        }

        /** Where the user picks Ervo as the phone's digital assistant app. */
        @JavascriptInterface
        fun openAssistantSettings() = runOnUiThread {
            val tries = listOf(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS), Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS), Intent(Settings.ACTION_SETTINGS))
            for (i in tries) {
                try { startActivity(i); break } catch (e: Exception) { /* try the next one */ }
            }
        }

        /** The app shortcut Ervo was opened with (touch and hold the icon), once. */
        @JavascriptInterface
        fun takeShortcut(): String {
            val s = pendingShortcut ?: return ""
            pendingShortcut = null
            return s
        }

        /**
         * A short haptic through the phone's own haptic feedback, so it follows the phone's
         * "Touch feedback" setting. tap: sent; tick: picked an answer; long: touch and hold;
         * confirm: something got done; reject: something didn't work.
         */
        @JavascriptInterface
        fun haptic(kind: String) = runOnUiThread {
            val c = when (kind) {
                "tick" -> HapticFeedbackConstants.CLOCK_TICK
                "long" -> HapticFeedbackConstants.LONG_PRESS
                "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CONTEXT_CLICK
                "reject" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
                else -> HapticFeedbackConstants.KEYBOARD_TAP
            }
            webView.performHapticFeedback(c)
        }

        /** The phone's Display settings, where Dark mode is (Ervo follows it). */
        @JavascriptInterface
        fun openDisplaySettings() = runOnUiThread {
            try { startActivity(Intent(Settings.ACTION_DISPLAY_SETTINGS)) } catch (e: ActivityNotFoundException) { /* not on this phone */ }
        }

        /** What Ervo was opened with ("Hey Ervo, ..." or the assistant button), once. */
        @JavascriptInterface
        fun takeWake(): String {
            val w = pendingWake ?: return ""
            pendingWake = null
            return w
        }

        /** Let "Hey Ervo" listen again after Ervo has finished talking or listening. */
        @JavascriptInterface
        fun resumeWake() { WakeService.resume(this@MainActivity) }

        // ---------- contacts and calls ----------
        /** People in the phone's contacts whose name matches, sent to window.ervoContacts. */
        @JavascriptInterface
        fun findContacts(name: String) = runOnUiThread {
            if (hasPermission(Manifest.permission.READ_CONTACTS)) findContactsNow(name)
            else { pendingContact = name; contactsLauncher.launch(Manifest.permission.READ_CONTACTS) }
        }

        /** Calls a number the user picked. Emergency numbers are never called by Ervo. */
        @JavascriptInterface
        fun callNumber(number: String) = runOnUiThread {
            if (isEmergency(number)) { callJs("ervoCall", """{"status":"emergency"}"""); return@runOnUiThread }
            if (hasPermission(Manifest.permission.CALL_PHONE)) placeCall(number, true)
            else { pendingCall = number; callLauncher.launch(Manifest.permission.CALL_PHONE) }
        }

        /** Opens the phone's dialer with a number filled in. You tap Call yourself. */
        @JavascriptInterface
        fun dialNumber(number: String) = runOnUiThread { openOutside(Uri.fromParts("tel", number, null), Intent.ACTION_DIAL) }

        // ---------- clock ----------
        /** Starts a timer in the phone's Clock app. */
        @JavascriptInterface
        fun setTimer(seconds: Int, label: String) = runOnUiThread {
            clock(Intent(AlarmClock.ACTION_SET_TIMER).apply {
                putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceIn(1, 86400))
                if (label.isNotBlank()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            }, "timer")
        }

        /** Sets an alarm in the phone's Clock app. days: "2,3,4,5,6" (Mon-Fri), or "" for once. */
        @JavascriptInterface
        fun setAlarm(hour: Int, minute: Int, label: String, days: String) = runOnUiThread {
            clock(Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hour.coerceIn(0, 23))
                putExtra(AlarmClock.EXTRA_MINUTES, minute.coerceIn(0, 59))
                if (label.isNotBlank()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
                val list = ArrayList(days.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it in 1..7 })
                if (list.isNotEmpty()) putExtra(AlarmClock.EXTRA_DAYS, list)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            }, "alarm")
        }

        /** Opens the alarms list in the Clock app. */
        @JavascriptInterface
        fun showAlarms() = runOnUiThread { clock(Intent(AlarmClock.ACTION_SHOW_ALARMS), "show") }

        @JavascriptInterface
        fun speak(text: String) = runOnUiThread {
            // Spoken replies are off for now (the page doesn't call this anymore)
            if (ttsReady && SPEAK_REPLIES) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ervo-reply")
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

        /**
         * Adds an event straight to the phone's main calendar (a synced Google calendar if there
         * is one), sent to window.ervoEventAdded with the calendar's name and an undo token.
         */
        @JavascriptInterface
        fun insertEvent(title: String, startMs: Double, endMs: Double, allDay: Boolean, notes: String, location: String) = runOnUiThread {
            withCalendar({ ok ->
                if (!ok) { callJs("ervoEventAdded", """{"ok":false,"reason":"denied"}"""); return@withCalendar }
                lifecycleScope.launch {
                    val json = withContext(Dispatchers.IO) {
                        try { insertEventNow(title, startMs.toLong(), endMs.toLong(), allDay, notes, location) } catch (e: Exception) { """{"ok":false,"reason":"error"}""" }
                    }
                    callJs("ervoEventAdded", json)
                }
            })
        }

        /** Same as insertEvent, but on the calendar the user picked in Ervo (its id from listCalendars). */
        @JavascriptInterface
        fun insertEventIn(calendarId: String, title: String, startMs: Double, endMs: Double, allDay: Boolean, notes: String, location: String) = runOnUiThread {
            withCalendar({ ok ->
                if (!ok) { callJs("ervoEventAdded", """{"ok":false,"reason":"denied"}"""); return@withCalendar }
                lifecycleScope.launch {
                    val json = withContext(Dispatchers.IO) {
                        try { insertEventNow(title, startMs.toLong(), endMs.toLong(), allDay, notes, location, calendarId.toLongOrNull()) } catch (e: Exception) { """{"ok":false,"reason":"error"}""" }
                    }
                    callJs("ervoEventAdded", json)
                }
            })
        }

        /** Every calendar on the phone Ervo can add events to (each synced Google account too), sent to window.ervoCalendars. */
        @JavascriptInterface
        fun listCalendars() = runOnUiThread {
            withCalendar({ ok ->
                if (!ok) { callJs("ervoCalendars", """{"status":"denied"}"""); return@withCalendar }
                lifecycleScope.launch {
                    val json = withContext(Dispatchers.IO) {
                        try { calendarsJson() } catch (e: Exception) { """{"status":"error"}""" }
                    }
                    callJs("ervoCalendars", json)
                }
            })
        }

        /** True when Android already lets Ervo read the calendar (it never asks from here). */
        @JavascriptInterface
        fun calendarAllowed(): Boolean = hasPermission(Manifest.permission.READ_CALENDAR)

        /** Renames an event and/or moves it to a new start (keeping its length). Sent to window.ervoEventUpdated. */
        @JavascriptInterface
        fun updateEvent(id: String, title: String, startMs: Double) = runOnUiThread {
            withCalendar({ ok ->
                if (!ok) { callJs("ervoEventUpdated", """{"ok":false,"reason":"denied"}"""); return@withCalendar }
                lifecycleScope.launch {
                    val json = withContext(Dispatchers.IO) {
                        try { updateEventNow(id.toLong(), title, startMs.toLong()) } catch (e: Exception) { """{"ok":false,"reason":"error"}""" }
                    }
                    callJs("ervoEventUpdated", json)
                }
            })
        }

        /** Turns off alarms in the Clock app: "all" (Clock lets you pick) or the one at hour:minute. */
        @JavascriptInterface
        fun dismissAlarm(mode: String, hour: Int, minute: Int) = runOnUiThread {
            val intent = Intent(AlarmClock.ACTION_DISMISS_ALARM).apply {
                if (mode == "time") {
                    putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_TIME)
                    putExtra(AlarmClock.EXTRA_HOUR, hour.coerceIn(0, 23))
                    putExtra(AlarmClock.EXTRA_MINUTES, minute.coerceIn(0, 59))
                    putExtra(AlarmClock.EXTRA_IS_PM, hour >= 12)
                } else {
                    putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_ALL)
                }
            }
            val ok = try { startActivity(intent); true } catch (e: Exception) {
                try { startActivity(Intent(AlarmClock.ACTION_SHOW_ALARMS)); false } catch (e2: Exception) { false }
            }
            callJs("ervoClock", JSONObject().put("ok", ok).put("what", "dismiss").toString())
        }

        /** Ervo's page in Android Settings, where permissions can be turned off. */
        @JavascriptInterface
        fun openAppSettings() = runOnUiThread {
            openOutside(Uri.parse("package:$packageName"), Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        }

        /** Pop-up mode: close it, or open the full Ervo app. */
        @JavascriptInterface
        fun closeOverlay() = runOnUiThread { if (overlay) finish() }

        @JavascriptInterface
        fun openFullApp() = runOnUiThread {
            startActivity(Intent(this@MainActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            if (overlay) finish()
        }

        @JavascriptInterface
        fun isOverlay(): Boolean = overlay

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

        /** Weather heads-up before you leave: {on, hour, minute, days, lat, lon, city, fahrenheit} */
        @JavascriptInterface
        fun setWeatherAlert(settings: String) = runOnUiThread {
            val s = try { JSONObject(settings) } catch (e: Exception) { JSONObject() }
            WeatherAlert.save(this@MainActivity, s)
            if ((s.optBoolean("on") || s.optBoolean("ask")) && Build.VERSION.SDK_INT >= 33 && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
                notifyLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                callJs("ervoWeatherAlert", WeatherAlert.status(this@MainActivity).toString())
            }
        }

        @JavascriptInterface
        fun weatherAlertStatus(): String = WeatherAlert.status(this@MainActivity).toString()

        /** "Send a sample": shows what today's heads-up looks like, even on a calm day */
        @JavascriptInterface
        fun testWeatherAlert() { Thread { WeatherAlert.check(applicationContext, true) }.start() }

        /** Saves a picture Ervo drew to the phone's Pictures (Photos app), in an "Ervo" album. */
        @JavascriptInterface
        fun saveImage(base64: String, name: String): Boolean {
            val bytes = try { Base64.decode(base64, Base64.DEFAULT) } catch (e: IllegalArgumentException) { return false }
            if (bytes.isEmpty()) return false
            val safe = name.replace(Regex("[^A-Za-z0-9 ._-]"), "").ifBlank { "Ervo picture.jpg" }
            return try {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, safe)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Ervo")
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
                true
            } catch (e: Exception) { false }
        }

        /** Order reminders ("arrives tomorrow", "should arrive today"): planned by the web app, shown by OrderNotice. */
        @JavascriptInterface
        fun scheduleNotice(id: String, at: Double, title: String, text: String) {
            if (id.isBlank() || at.isNaN()) return
            OrderNotice.schedule(applicationContext, id.take(60), at.toLong(), title.take(80), text.take(240))
        }

        @JavascriptInterface
        fun cancelNotice(id: String) { if (id.isNotBlank()) OrderNotice.cancel(applicationContext, id.take(60)) }

        /** Share text with any app (Notes, Keep, Messages, email...) through Android's share sheet */
        @JavascriptInterface
        fun shareText(title: String, text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TITLE, title)
                .putExtra(Intent.EXTRA_TEXT, text)
            try { startActivity(Intent.createChooser(send, title.ifEmpty { "Share" })) } catch (e: Exception) { /* nothing can share */ }
        }

        /** Home-screen icon = Ervo's look. Remembered now, applied once Ervo goes to the background,
         *  because switching launcher aliases while the app is in front makes Android close it. */
        @JavascriptInterface
        fun setAppIcon(look: String) {
            val id = look.lowercase().filter { it.isLetter() }
            if (id in LOOK_IDS) pendingIcon = id
        }

        /** Can this phone unlock with a fingerprint, face or screen lock? */
        @JavascriptInterface
        fun biometricAvailable(): Boolean =
            BiometricManager.from(this@MainActivity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS

        /** Shows the phone's own unlock prompt; answers window.ervoBiometric("true" | "false"). */
        @JavascriptInterface
        fun biometricAuth(title: String) = runOnUiThread {
            val prompt = BiometricPrompt(this@MainActivity, ContextCompat.getMainExecutor(this@MainActivity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { callJs("ervoBiometric", "true") }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { callJs("ervoBiometric", "false") }
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title.ifBlank { "Unlock Ervo" })
                .setSubtitle("Fingerprint, face or your screen lock")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build()
            try { prompt.authenticate(info) } catch (e: Exception) { callJs("ervoBiometric", "false") }
        }

        /** Where they are (city level), for the weather notice after Ervo is closed. */
        @JavascriptInterface
        fun setPlace(lat: Double, lon: Double, city: String, fahrenheit: Boolean) = WeatherAlert.savePlace(applicationContext, lat, lon, city, fahrenheit)

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
            if (overlay) return@runOnUiThread
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

    // ---------- updates without the page (notification tap, or the page failed to start) ----------
    /** Once, shortly after a start on Android 13+: may Ervo show notifications (updates, the weather heads-up)? */
    private fun askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33 || hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return
        val p = getSharedPreferences("ervo_update", MODE_PRIVATE)
        if (p.getBoolean("asked_notify", false)) return
        p.edit().putBoolean("asked_notify", true).apply()
        webView.postDelayed({ if (!isFinishing) notifyLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }, 4000)
    }
    private var nativeUpdate = false
    private var pendingNativeInstall = false

    /** A few seconds after start: is the page's script alive? If not, show a way out. */
    private fun checkPageAlive(attempt: Int) {
        if (isFinishing || !::webView.isInitialized) return
        if (webView.progress < 100 && attempt < 4) { webView.postDelayed({ checkPageAlive(attempt + 1) }, 4000); return }
        webView.evaluateJavascript(
            "(function(){try{return (typeof window.ervoBack==='function'&&!!document.querySelector('.screen.active'))?'ok':'bad'}catch(e){return 'bad'}})()"
        ) { r -> if (r == null || !r.contains("ok")) showRecovery() }
    }

    private fun showRecovery() {
        if (isFinishing) return
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Ervo didn't start")
            .setMessage("Something went wrong loading Ervo. An update usually fixes it, and your chats and settings stay.")
            .setPositiveButton("Update Ervo") { _, _ -> updateNatively(null) }
            .setNegativeButton("Try Again") { _, _ -> webView.reload(); webView.postDelayed({ checkPageAlive(0) }, 9000) }
            .show()
    }

    /** Downloads the newest release and opens the installer, with no help from the page. */
    private fun updateNatively(known: UpdateCheck.Latest?) {
        nativeUpdate = true
        Toast.makeText(this, "Checking for the newest Ervo…", Toast.LENGTH_SHORT).show()
        lifecycleScope.launch {
            val latest = known ?: withContext(Dispatchers.IO) { try { UpdateCheck.check(this@MainActivity, false) } catch (e: Exception) { null } }
            if (latest == null) {
                Toast.makeText(this@MainActivity, "No newer version yet. Try again in a little while.", Toast.LENGTH_LONG).show()
                nativeUpdate = false
                return@launch
            }
            if (!latest.apkUrl.startsWith(UPDATE_PREFIX)) { nativeUpdate = false; return@launch }
            Toast.makeText(this@MainActivity, "Downloading Ervo ${latest.version}…", Toast.LENGTH_SHORT).show()
            val ok = withContext(Dispatchers.IO) { download(latest.apkUrl) }
            if (ok) installUpdate()
            else { Toast.makeText(this@MainActivity, "The download didn't finish. Check your connection and try again.", Toast.LENGTH_LONG).show(); nativeUpdate = false }
        }
    }

    /** The part after # of an https://ervo.company/app link, or null when the intent isn't one.
     *  The website's "Open in the Ervo app" button sends ?recover=<token> instead (an intent: link can't carry a #), so that becomes the fragment. */
    private fun linkFragment(intent: Intent?): String? {
        val d = intent?.data ?: return null
        if (intent.action != Intent.ACTION_VIEW || d.host != "ervo.company") return null
        d.fragment?.takeIf { it.isNotBlank() }?.let { return it }
        val recover = try { d.getQueryParameter("recover") } catch (e: Exception) { null }
        return recover?.takeIf { it.isNotBlank() }?.let { "recover=" + Uri.encode(it) }
    }

    /** Opened from the "Ervo X is ready" notification: go straight to the update. */
    private fun takeUpdateIntent(intent: Intent?) {
        val apk = intent?.getStringExtra(UpdateCheck.EXTRA_APK) ?: return
        val version = intent.getStringExtra(UpdateCheck.EXTRA_VERSION) ?: ""
        intent.removeExtra(UpdateCheck.EXTRA_APK)
        updateNatively(UpdateCheck.Latest(version, apk, emptyList()))
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
            if (nativeUpdate) {
                pendingNativeInstall = true
                Toast.makeText(this, "Allow Ervo to install updates, then come back to Ervo.", Toast.LENGTH_LONG).show()
                openOutside(Uri.parse("package:$packageName"), Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            } else callJs("ervoUpdate", """{"status":"needs_permission"}""")
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

    /** Runs `then(true)` once Ervo may read and write the calendar (asking Android first if needed). */
    private fun withCalendar(then: (Boolean) -> Unit) {
        if (hasPermission(Manifest.permission.READ_CALENDAR) && hasPermission(Manifest.permission.WRITE_CALENDAR)) { then(true); return }
        afterCalendarAsk = then
        calendarLauncher.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
    }

    /** The calendar new events go on: the primary synced Google calendar, else any the user can edit. */
    private fun mainCalendar(): Pair<Long, String>? {
        val cols = arrayOf(
            CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.ACCOUNT_NAME
        )
        var best: Pair<Long, String>? = null
        var bestScore = -1
        contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI, cols,
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR} AND ${CalendarContract.Calendars.VISIBLE} = 1",
            null, null
        )?.use { c ->
            while (c.moveToNext()) {
                val google = c.getString(2) == "com.google"
                val primary = c.getInt(3) == 1
                val score = (if (google) 2 else 0) + (if (primary) 1 else 0)
                if (score > bestScore) {
                    bestScore = score
                    best = c.getLong(0) to (c.getString(4)?.takeIf { it.contains("@") } ?: c.getString(1) ?: "your calendar")
                }
            }
        }
        return best
    }

    /** The calendars new events can go on, Google ones and the primary one first. */
    private fun calendarsJson(): String {
        val cols = arrayOf(
            CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.CALENDAR_COLOR, CalendarContract.Calendars.IS_PRIMARY
        )
        val rows = mutableListOf<Pair<Int, JSONObject>>()
        contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI, cols,
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR} AND ${CalendarContract.Calendars.VISIBLE} = 1",
            null, null
        )?.use { c ->
            while (c.moveToNext()) {
                val google = c.getString(3) == "com.google"
                val primary = c.getInt(5) == 1
                val color = String.format("#%06X", 0xFFFFFF and c.getInt(4))
                rows.add((if (google) 2 else 0) + (if (primary) 1 else 0) to JSONObject()
                    .put("id", c.getLong(0).toString())
                    .put("name", c.getString(1) ?: c.getString(2) ?: "Calendar")
                    .put("account", c.getString(2) ?: "")
                    .put("google", google)
                    .put("primary", primary)
                    .put("color", color))
            }
        }
        val list = JSONArray()
        rows.sortedByDescending { it.first }.forEach { list.put(it.second) }
        return JSONObject().put("status", "ready").put("calendars", list).toString()
    }

    /** One calendar by id, if it still exists and can be written to. */
    private fun calendarById(id: Long): Pair<Long, String>? {
        contentResolver.query(
            ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, id),
            arrayOf(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL),
            null, null, null
        )?.use { c ->
            if (c.moveToFirst() && c.getInt(2) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                return id to (c.getString(1)?.takeIf { it.contains("@") } ?: c.getString(0) ?: "your calendar")
            }
        }
        return null
    }

    private fun insertEventNow(title: String, startMs: Long, endMs: Long, allDay: Boolean, notes: String, location: String, pickedId: Long? = null): String {
        val (calId, calName) = (if (pickedId != null) calendarById(pickedId) else mainCalendar()) ?: return """{"ok":false,"reason":"no-calendar"}"""
        val values = android.content.ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calId)
            put(CalendarContract.Events.TITLE, title)
            if (notes.isNotBlank()) put(CalendarContract.Events.DESCRIPTION, notes)
            if (location.isNotBlank()) put(CalendarContract.Events.EVENT_LOCATION, location)
            if (allDay) {
                // All-day events are stored at midnight UTC of that day
                val day = java.time.Instant.ofEpochMilli(startMs).atZone(ZoneId.systemDefault()).toLocalDate()
                val utc = day.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
                put(CalendarContract.Events.DTSTART, utc)
                put(CalendarContract.Events.DTEND, utc + 24L * 60 * 60 * 1000)
                put(CalendarContract.Events.ALL_DAY, 1)
                put(CalendarContract.Events.EVENT_TIMEZONE, "UTC")
            } else {
                put(CalendarContract.Events.DTSTART, startMs)
                put(CalendarContract.Events.DTEND, endMs)
                put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().id)
            }
        }
        val made = contentResolver.insert(CalendarContract.Events.CONTENT_URI, values) ?: return """{"ok":false,"reason":"error"}"""
        val id = ContentUris.parseId(made)
        // A reminder 30 minutes before, like most calendar apps
        if (!allDay) contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, android.content.ContentValues().apply {
            put(CalendarContract.Reminders.EVENT_ID, id)
            put(CalendarContract.Reminders.MINUTES, 30)
            put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
        })
        val token = java.util.UUID.randomUUID().toString()
        undoStore[token] = Undo.DeleteNew(id)
        return JSONObject().put("ok", true).put("id", id.toString()).put("calendar", calName).put("undo", token).toString()
    }

    private fun updateEventNow(id: Long, title: String, newStart: Long): String {
        val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id)
        val old = android.content.ContentValues()
        var repeats = false
        contentResolver.query(uri, arrayOf(CalendarContract.Events.TITLE, CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND, CalendarContract.Events.RRULE), null, null, null)?.use { c ->
            if (!c.moveToFirst()) return """{"ok":false,"reason":"gone"}"""
            old.put(CalendarContract.Events.TITLE, c.getString(0))
            old.put(CalendarContract.Events.DTSTART, c.getLong(1))
            if (!c.isNull(2)) old.put(CalendarContract.Events.DTEND, c.getLong(2))
            repeats = !c.getString(3).isNullOrBlank()
        } ?: return """{"ok":false,"reason":"error"}"""
        if (repeats && newStart > 0) return """{"ok":false,"reason":"repeats"}"""
        val values = android.content.ContentValues()
        if (title.isNotBlank()) values.put(CalendarContract.Events.TITLE, title)
        if (newStart > 0) {
            val start = old.getAsLong(CalendarContract.Events.DTSTART)
            val end = old.getAsLong(CalendarContract.Events.DTEND) ?: (start + 60 * 60 * 1000)
            values.put(CalendarContract.Events.DTSTART, newStart)
            values.put(CalendarContract.Events.DTEND, newStart + (end - start))
        }
        if (values.size() == 0 || contentResolver.update(uri, values, null, null) <= 0) return """{"ok":false,"reason":"error"}"""
        val token = java.util.UUID.randomUUID().toString()
        undoStore[token] = Undo.Revert(id, old)
        return JSONObject().put("ok", true).put("undo", token).toString()
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
                    val calendars = JSONArray()
                    contentResolver.query(
                        CalendarContract.Calendars.CONTENT_URI,
                        arrayOf(CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE),
                        "${CalendarContract.Calendars.VISIBLE} = 1", null, null
                    )?.use { c ->
                        val seen = HashSet<String>()
                        while (c.moveToNext()) {
                            val name = c.getString(0) ?: continue
                            if (seen.add(name)) calendars.put(JSONObject().put("account", name).put("google", c.getString(1) == "com.google"))
                        }
                    }
                    JSONObject().put("status", "ready").put("events", events).put("calendars", calendars).toString()
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
        class DeleteNew(val eventId: Long) : Undo()
        class Revert(val eventId: Long, val values: android.content.ContentValues) : Undo()
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
            is Undo.DeleteNew -> contentResolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, undo.eventId), null, null) > 0
            is Undo.Revert -> contentResolver.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, undo.eventId), undo.values, null, null) > 0
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

    // ---------- listening on Ervo's own screen ----------
    private fun listenInApp() {
        WakeService.pause(this)
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) callJs("ervoVoicePartial", text)
            }
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                endListening()
                callJs("ervoVoiceResult", text)
            }
            override fun onError(error: Int) {
                endListening()
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> callJs("ervoVoiceResult", "")
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> callJs("ervoVoiceError", "I need an internet connection to hear you. Try again in a moment.")
                    else -> callJs("ervoVoiceError", "Something went wrong with the microphone. Try again.")
                }
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Wait for a real pause, so "set an alarm... actually never mind" is heard in full
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L)
        }
        // Give the "Hey Ervo" listener a moment to let go of the microphone
        webView.postDelayed({
            try { r.startListening(intent) } catch (e: Exception) { endListening(); listenWithPopup() }
        }, if (WakeService.running) 350L else 0L)
    }

    private fun endListening() {
        recognizer?.destroy()
        recognizer = null
        WakeService.resume(this)
    }

    private fun listenWithPopup() {
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

    // ---------- "Hey Ervo" and the assistant button ----------
    private fun wakeStatusJson(): String {
        val assistant = try {
            android.os.Build.VERSION.SDK_INT >= 29 &&
                getSystemService(android.app.role.RoleManager::class.java).isRoleHeld(android.app.role.RoleManager.ROLE_ASSISTANT)
        } catch (e: Exception) { false }
        return JSONObject()
            .put("on", WakeService.isEnabled(this) && WakeService.running)
            .put("mic", hasPermission(Manifest.permission.RECORD_AUDIO))
            .put("overlay", Settings.canDrawOverlays(this))
            .put("assistant", assistant)
            .toString()
    }

    /** Opened by "Hey Ervo" or as the phone's assistant: hand it to the page. */
    private fun takeWakeIntent(intent: Intent?): Boolean {
        val action = intent?.action ?: return false
        if (action != ACTION_WAKE && action != Intent.ACTION_ASSIST) return false
        val command = intent.getStringExtra(EXTRA_COMMAND).orEmpty()
        pendingWake = JSONObject().put("command", command).toString()
        intent.action = Intent.ACTION_MAIN // don't run it again after a rotation
        return true
    }

    /** Opened from an app shortcut (touch and hold Ervo's icon): ervo://shortcut/ideas and so on. */
    private fun takeShortcutIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (intent.action != ACTION_SHORTCUT || data.scheme != "ervo") return false
        val what = data.lastPathSegment.orEmpty()
        if (what !in listOf("talk", "side", "ideas", "psyche")) return false
        pendingShortcut = what
        intent.action = Intent.ACTION_MAIN // don't run it again after a rotation
        return true
    }

    override fun onNewIntent(intent: Intent) {
        takeUpdateIntent(intent)
        linkFragment(intent)?.let { frag ->
            val js = org.json.JSONObject.quote(frag)
            webView.evaluateJavascript("location.hash = $js; if (window.ervoHash) window.ervoHash();", null)
        }
        super.onNewIntent(intent)
        if (takeWakeIntent(intent)) {
            val w = pendingWake ?: return
            pendingWake = null
            callJs("ervoWake", w)
        } else if (takeShortcutIntent(intent)) {
            val s = pendingShortcut ?: return
            pendingShortcut = null
            callJs("ervoShortcut", s)
        }
    }

    override fun onStart() {
        super.onStart()
        visible = true
    }

    override fun onStop() {
        visible = false
        if (overlay) WakeService.resume(this) // pop-up closed: listen for "Hey Ervo" again
        applyPendingIcon() // a new home-screen icon waits until Ervo is out of sight
        if (!overlay) WeatherAlert.closeNotice(applicationContext) // one short weather line, now and then, when Ervo is put away
        super.onStop()
    }

    // ---------- contacts, calls and clock ----------
    private fun findContactsNow(name: String) {
        lifecycleScope.launch {
            val json = withContext(Dispatchers.IO) {
                try {
                    val words = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }.take(3)
                    val where = words.joinToString(" AND ") { "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?" }
                    val args = words.map { "%$it%" }.toTypedArray()
                    val list = JSONArray()
                    val seen = HashSet<String>()
                    contentResolver.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        arrayOf(
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER,
                            ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.LABEL,
                            ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY
                        ),
                        if (words.isEmpty()) null else where, if (words.isEmpty()) null else args,
                        "${ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY} DESC, ${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
                    )?.use { c ->
                        while (c.moveToNext() && list.length() < 12) {
                            val number = c.getString(1) ?: continue
                            val key = (c.getString(0) ?: "") + "|" + number.filter { it.isDigit() }.takeLast(10)
                            if (!seen.add(key)) continue
                            val label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(resources, c.getInt(2), c.getString(3)).toString()
                            list.put(JSONObject().put("name", c.getString(0) ?: "").put("number", number).put("label", label))
                        }
                    }
                    JSONObject().put("status", "ready").put("contacts", list).toString()
                } catch (e: Exception) {
                    """{"status":"error"}"""
                }
            }
            callJs("ervoContacts", json)
        }
    }

    private fun isEmergency(number: String): Boolean {
        val digits = number.filter { it.isDigit() || it == '+' }
        if (digits in setOf("911", "112", "999", "000", "110", "119", "118", "100", "101", "102", "108", "988", "15", "17", "18")) return true
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 29) getSystemService(TelephonyManager::class.java).isEmergencyNumber(digits)
            else PhoneNumberUtils.isEmergencyNumber(digits)
        } catch (e: Exception) {
            false
        }
    }

    private fun placeCall(number: String, direct: Boolean) {
        if (isEmergency(number)) { callJs("ervoCall", """{"status":"emergency"}"""); return }
        val uri = Uri.fromParts("tel", number, null)
        try {
            startActivity(Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, uri))
            callJs("ervoCall", JSONObject().put("status", if (direct) "calling" else "dialing").toString())
        } catch (e: Exception) {
            callJs("ervoCall", """{"status":"error"}""")
        }
    }

    private fun clock(intent: Intent, what: String) {
        val ok = try { startActivity(intent); true } catch (e: Exception) { false }
        callJs("ervoClock", JSONObject().put("ok", ok).put("what", what).toString())
    }

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
        // Back from "Install unknown apps" during a native update: finish installing
        if (pendingNativeInstall && packageManager.canRequestPackageInstalls()) { pendingNativeInstall = false; installUpdate() }
        // Coming back from Health Connect, Calendar or Amazon: let the page refresh
        if (::webView.isInitialized) webView.evaluateJavascript("window.ervoResume && window.ervoResume()", null)
    }

    override fun onPause() {
        super.onPause()
        tts?.stop()
    }

    @Volatile private var pendingIcon: String? = null
    private fun applyPendingIcon() {
        val id = pendingIcon ?: return
        pendingIcon = null
        val pm = packageManager
        val current = LOOK_IDS.firstOrNull { pm.getComponentEnabledSetting(ComponentName(this, "app.ervo.Look_$it")) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED }
            ?: "classic"
        if (current == id) return
        // Enable the new one first, so there is never a moment with no icon
        pm.setComponentEnabledSetting(ComponentName(this, "app.ervo.Look_$id"), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        LOOK_IDS.filter { it != id }.forEach { l ->
            pm.setComponentEnabledSetting(ComponentName(this, "app.ervo.Look_$l"), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
    }

    override fun onDestroy() {
        recognizer?.destroy()
        tts?.shutdown()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        // Every look with a launcher alias in the manifest (keep in step with docs/app/img/looks.json)
        val LOOK_IDS = listOf("classic", "business", "king", "detective", "explorer", "scientist", "wizard", "ninja", "samurai", "pirate", "pilot", "athlete", "soccer", "musician", "chef", "creative", "gamer", "space", "scholar", "tech", "builder", "winter", "holiday")
        private const val HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata"
        // Updates only ever come from Ervo's own GitHub releases
        private const val UPDATE_PREFIX = "https://github.com/erickb2021-lgtm/Ervo/releases/download/"
        const val ACTION_WAKE = "app.ervo.WAKE"
        const val ACTION_SHORTCUT = "app.ervo.SHORTCUT"
        private const val SPEAK_REPLIES = false
        const val EXTRA_COMMAND = "command"
        @Volatile var visible = false
    }
}
