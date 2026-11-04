package app.ervo

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * "Hey Ervo": listens with the phone's speech recognizer while it's turned on, and opens
 * Ervo when it hears its name. Runs as a foreground service, so Android shows a
 * notification the whole time (with a Turn off button). The user turns it on in Ervo.
 */
class WakeService : Service() {

    private var recognizer: SpeechRecognizer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var paused = false
    private val listenNow = Runnable { listenOnce() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                setEnabled(this, false)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> { paused = true; handler.removeCallbacks(listenNow); recognizer?.cancel() }
            ACTION_RESUME -> { paused = false; schedule(600) }
            else -> {
                if (!startInForeground()) { stopSelf(); return START_NOT_STICKY }
                running = true
                paused = false
                schedule(300)
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(listenNow)
        recognizer?.destroy()
        recognizer = null
        super.onDestroy()
    }

    private fun startInForeground(): Boolean {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Hey Ervo", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows while Ervo listens for \"Hey Ervo\""
            })
        }
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val off = PendingIntent.getService(
            this, 2, Intent(this, WakeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val note = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Listening for \"Hey Ervo\"")
            .setContentText("Say \"Hey Ervo\" and what you need.")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Turn off", off).build())
            .build()
        return try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(NOTE_ID, note)
            true
        } catch (e: Exception) {
            false // Android only allows this while Ervo is open
        }
    }

    private fun schedule(ms: Long) {
        handler.removeCallbacks(listenNow)
        if (!paused) handler.postDelayed(listenNow, ms)
    }

    private fun listenOnce() {
        if (paused) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf(); return
        }
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra("android.speech.extra.BIASING_STRINGS", arrayListOf("Hey Ervo", "Ervo"))
        }
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            recognizer?.destroy(); recognizer = null
            schedule(2000)
        }
    }

    private val listener = object : RecognitionListener {
        override fun onResults(results: Bundle?) {
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
            if (!wake(heard)) schedule(200)
        }
        override fun onError(error: Int) {
            when (error) {
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> stopSelf()
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                    recognizer?.destroy(); recognizer = null; schedule(1500)
                }
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> schedule(5000)
                else -> schedule(250) // nothing said: listen again
            }
        }
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    /** True if Ervo's name was in what was heard; opens Ervo with whatever came after it. */
    private fun wake(heard: List<String>): Boolean {
        for (text in heard) {
            val m = WAKE_WORD.find(text.lowercase(Locale.ROOT)) ?: continue
            val command = text.substring(m.range.last + 1).trim(' ', ',', '.', '!', '?')
            paused = true // Ervo takes over the microphone; it resumes this when it's done
            open(command)
            return true
        }
        return false
    }

    private fun open(command: String) {
        val intent = Intent(this, MainActivity::class.java)
            .setAction(MainActivity.ACTION_WAKE)
            .putExtra(MainActivity.EXTRA_COMMAND, command)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        val canPopUp = MainActivity.visible || (Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(this))
        if (canPopUp) {
            try { startActivity(intent); return } catch (e: Exception) { /* fall back to a notification */ }
        }
        // Android blocks apps from popping up over others without "Display over other apps",
        // so tap the notification instead.
        val tap = PendingIntent.getActivity(this, 3, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_HEARD, "Ervo heard you", NotificationManager.IMPORTANCE_HIGH))
        }
        nm.notify(HEARD_ID, Notification.Builder(this, CHANNEL_HEARD)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Ervo heard you")
            .setContentText(if (command.isBlank()) "Tap to talk to Ervo." else "Tap to: $command")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build())
        paused = false
        schedule(1500)
    }

    companion object {
        const val ACTION_STOP = "app.ervo.wake.STOP"
        const val ACTION_PAUSE = "app.ervo.wake.PAUSE"
        const val ACTION_RESUME = "app.ervo.wake.RESUME"
        private const val CHANNEL = "hey_ervo"
        private const val CHANNEL_HEARD = "ervo_heard"
        private const val NOTE_ID = 7
        private const val HEARD_ID = 8
        private const val PREFS = "ervo_wake"

        @Volatile var running = false

        // "Ervo" isn't a dictionary word, so accept the ways recognizers tend to spell it
        private val WAKE_WORD = Regex("\\b(?:(?:hey|hi|ok|okay|yo)[ ,]+)?(?:ervo|irvo|ervvo|erbo|arvo|elvo|hervo|her vo|air vo|urvo|urbo|eervo|ervos|ervo's)\\b")

        fun isEnabled(context: Context) = context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("on", false)
        fun setEnabled(context: Context, on: Boolean) = context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", on).apply()

        fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, WakeService::class.java))
        fun stop(context: Context) { if (running) context.startService(Intent(context, WakeService::class.java).setAction(ACTION_STOP)) }
        fun pause(context: Context) { if (running) context.startService(Intent(context, WakeService::class.java).setAction(ACTION_PAUSE)) }
        fun resume(context: Context) { if (running) context.startService(Intent(context, WakeService::class.java).setAction(ACTION_RESUME)) }
    }
}
