package app.ervo

/**
 * Ervo as a pop-up: opened by "Hey Ervo" or the phone's assistant button. It's the same app,
 * drawn see-through over whatever is on screen, with glowing edges, a small owl and an
 * "Ask Ervo" bar at the bottom. Tapping outside closes it.
 */
class VoiceActivity : MainActivity() {
    override val overlay: Boolean get() = true
}
