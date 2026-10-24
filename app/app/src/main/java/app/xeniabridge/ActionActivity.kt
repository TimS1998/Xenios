package app.xeniabridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import kotlin.concurrent.thread

/** Führt einen App-Shortcut (Ein/Eco/Aus) aus, ohne die App zu öffnen. */
class ActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra("mode")
        if (!Prefs(this).configured || mode !in setOf("on", "off", "eco")) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        val app = applicationContext
        thread(name = "xenia-shortcut") {
            val msg = try {
                Api.power(app, mode!!)
                when (mode) {
                    "on" -> "Xenia wird eingeschaltet"
                    "eco" -> "Eco-Modus aktiv"
                    else -> "Xenia ausgeschaltet"
                }
            } catch (e: Exception) {
                Api.message(e)
            }
            runOnUiThread { Toast.makeText(app, msg, Toast.LENGTH_SHORT).show() }
            Thread.sleep(1500)
            Widgets.renderFresh(app)
        }
        finish()
    }
}
