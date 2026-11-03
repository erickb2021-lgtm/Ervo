package app.ervo

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.util.Locale

/**
 * Ervo's Android shell. The app screens live in assets/www and are served from a
 * secure local address, so the app works offline and nothing loads from the internet.
 * The phone's own speech recognizer, text-to-speech and photo picker are shared
 * with the screens through the small ErvoNative bridge below.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

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

            // Links that open a new window (target="_blank") go to the browser
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
    }

    private fun callJs(function: String, text: String) {
        webView.post { webView.evaluateJavascript("window.$function && window.$function(${JSONObject.quote(text)})", null) }
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            // No app can open it; stay where we are
        }
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
    }
}
