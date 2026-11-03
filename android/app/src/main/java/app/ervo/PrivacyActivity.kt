package app.ervo

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Health Connect opens this when someone taps "Read privacy policy" on Ervo's
 * permission screen. It shows Ervo's privacy page in the browser and closes.
 */
class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://erickb2021-lgtm.github.io/Ervo/privacy.html")))
        } catch (e: ActivityNotFoundException) {
            // No browser; nothing to show
        }
        finish()
    }
}
