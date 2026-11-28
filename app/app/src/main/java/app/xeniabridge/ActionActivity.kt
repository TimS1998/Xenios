package app.xeniabridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import kotlin.concurrent.thread

/** Führt einen App-Shortcut (Ein/Ein ohne Dampf/Eco/Aus) aus, ohne die App zu öffnen. */
class ActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = intent.getStringExtra("mode")
        if (!Prefs(this).configured || mode !in setOf("on", "off", "eco", Api.MODE_ON_NO_STEAM)) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        val app = applicationContext
        thread(name = "xenia-shortcut") {
            val msg = try {
                Api.power(app, mode!!)
                when (mode) {
                    "on" -> app.getString(R.string.action_on)
                    Api.MODE_ON_NO_STEAM -> app.getString(R.string.action_on_nosteam)
                    "eco" -> app.getString(R.string.action_eco)
                    else -> app.getString(R.string.action_off)
                }
            } catch (e: Exception) {
                Api.message(app, e)
            }
            runOnUiThread { Toast.makeText(app, msg, Toast.LENGTH_SHORT).show() }
            Thread.sleep(1500)
            Widgets.renderFresh(app)
        }
        finish()
    }
}
