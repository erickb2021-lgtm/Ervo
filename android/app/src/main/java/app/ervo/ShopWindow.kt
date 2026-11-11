package app.ervo

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.Base64
import android.view.Gravity
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Ervo Shopping's window (0.5.16): a second WebView in a panel over the app, where Ervo drives a
 * store's website while the person watches. "mini" takes the lower part of the screen while Ervo
 * works; "full" is for the person to sign in or pay themselves. The app's JavaScript runs each step
 * through MainActivity.Bridge (shopEval, shopShot) and hears back through window.ervoShopEvent.
 */
@SuppressLint("SetJavaScriptEnabled")
class ShopWindow(
    private val activity: MainActivity,
    private val root: FrameLayout,
    private val pageScript: String,
    private val onEvent: (JSONObject) -> Unit,
) {
    private val dp = activity.resources.displayMetrics.density
    private val panel = LinearLayout(activity)
    private val title = TextView(activity)
    private val status = TextView(activity)
    private val takeOver = Button(activity)
    private val close = Button(activity)
    val web = WebView(activity)
    var mode = "hidden"
        private set

    init {
        panel.orientation = LinearLayout.VERTICAL
        panel.setBackgroundColor(Color.parseColor("#1d1d20"))
        panel.visibility = View.GONE
        panel.elevation = 12 * dp

        val header = LinearLayout(activity)
        header.orientation = LinearLayout.HORIZONTAL
        header.gravity = Gravity.CENTER_VERTICAL
        header.setPadding(px(12), px(8), px(8), px(8))
        header.setBackgroundColor(Color.parseColor("#27272b"))
        val words = LinearLayout(activity)
        words.orientation = LinearLayout.VERTICAL
        title.setTextColor(Color.WHITE)
        title.textSize = 14f
        title.typeface = Typeface.DEFAULT_BOLD
        status.setTextColor(Color.parseColor("#c7c7cc"))
        status.textSize = 12f
        status.maxLines = 1
        status.ellipsize = TextUtils.TruncateAt.END
        words.addView(title)
        words.addView(status)
        header.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        styleButton(takeOver, "Take over")
        styleButton(close, "Close")
        takeOver.setOnClickListener {
            setMode(if (mode == "full") "mini" else "full")
            emit("mode")
        }
        close.setOnClickListener { emit("close") } // the app decides what closing means, then calls close()
        header.addView(takeOver)
        header.addView(close)
        panel.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: return false
                if (scheme == "http" || scheme == "https") return false
                activity.openFromShop(request.url) // tel:, mailto:, intent: and app links go outside
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                status.text = "Loading…"
            }

            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(pageScript, null)
                emit("load", JSONObject().put("title", view.title ?: ""))
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (newProgress < 100) status.text = "Loading… $newProgress%"
            }
        }
        panel.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.BOTTOM))
    }

    private fun px(n: Int): Int = (n * dp).toInt()

    private fun styleButton(b: Button, label: String) {
        b.text = label
        b.textSize = 12f
        b.setTextColor(Color.WHITE)
        b.isAllCaps = false
        b.setBackgroundColor(Color.parseColor("#3a3a40"))
        b.setPadding(px(10), 0, px(10), 0)
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(34))
        lp.marginStart = px(6)
        b.layoutParams = lp
    }

    private fun emit(type: String, extra: JSONObject = JSONObject()) {
        onEvent(extra.put("type", type).put("mode", mode).put("url", web.url ?: ""))
    }

    fun isOpen(): Boolean = mode != "hidden"

    fun open(url: String, storeName: String) {
        title.text = "Ervo at $storeName"
        status.text = "Opening…"
        setMode("mini")
        web.loadUrl(url)
    }

    fun close() {
        setMode("hidden")
        web.stopLoading()
        web.loadUrl("about:blank")
    }

    fun go(url: String) = web.loadUrl(url)

    fun say(text: String) {
        status.text = text
    }

    fun setMode(m: String) {
        mode = m
        val lp = panel.layoutParams as FrameLayout.LayoutParams
        when (m) {
            "hidden" -> panel.visibility = View.GONE
            "full" -> {
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                panel.layoutParams = lp
                panel.visibility = View.VISIBLE
            }
            else -> {
                // Just under half the screen, so the chat and Ervo's card stay in view above it
                lp.height = (root.height * 0.46f).toInt().coerceAtLeast(px(300))
                panel.layoutParams = lp
                panel.visibility = View.VISIBLE
            }
        }
        takeOver.text = if (m == "full") "Give back to Ervo" else "Take over"
    }

    fun inject() = web.evaluateJavascript(pageScript, null)

    fun eval(id: String, js: String, done: (String, String) -> Unit) {
        web.evaluateJavascript(js) { r -> done(id, r ?: "null") }
    }

    /** Back inside the store's pages while the person has the window; false when there is nowhere to go. */
    fun back(): Boolean {
        if (!web.canGoBack()) return false
        web.goBack()
        return true
    }

    /** A picture of the window for Ervo's AI: a small JPEG data URL, or "" when it can't be taken. */
    fun shot(id: String, maxWidth: Int, done: (String, String) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || panel.visibility != View.VISIBLE || web.width == 0 || web.height == 0) {
            done(id, "")
            return
        }
        val loc = IntArray(2)
        web.getLocationInWindow(loc)
        val rect = Rect(loc[0], loc[1], loc[0] + web.width, loc[1] + web.height)
        val bmp = Bitmap.createBitmap(web.width, web.height, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(activity.window, rect, bmp, { result ->
                if (result != PixelCopy.SUCCESS) {
                    done(id, "")
                } else {
                    val scale = maxWidth.toFloat() / bmp.width
                    val small = if (scale < 1f) Bitmap.createScaledBitmap(bmp, maxWidth, (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
                    val out = ByteArrayOutputStream()
                    small.compress(Bitmap.CompressFormat.JPEG, 60, out)
                    done(id, "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: Exception) {
            done(id, "")
        }
    }
}
