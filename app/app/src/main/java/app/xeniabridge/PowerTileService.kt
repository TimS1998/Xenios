package app.xeniabridge

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import kotlin.concurrent.thread

/** Schnelleinstellungs-Kachel: zeigt den Zustand und schaltet Ein/Aus. */
class PowerTileService : TileService() {
    private val main = Handler(Looper.getMainLooper())

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        if (!Prefs(this).configured) {
            openApp()
            return
        }
        paint(null, busy = true)
        thread(name = "xenia-tile") {
            try {
                Api.toggle(this)
                Thread.sleep(1200)
            } catch (e: Exception) {
                main.post { Toast.makeText(this, Api.message(e), Toast.LENGTH_SHORT).show() }
            }
            val s = Widgets.renderFresh(applicationContext)
            main.post { paint(s) }
        }
    }

    private fun refresh() {
        if (!Prefs(this).configured) {
            paint(null)
            return
        }
        thread(name = "xenia-tile") {
            val s = try { Api.state(this) } catch (_: Exception) { null }
            main.post { paint(s) }
        }
    }

    private fun paint(s: Api.State?, busy: Boolean = false) {
        val tile = qsTile ?: return
        tile.icon = Icon.createWithResource(this, R.drawable.ic_power)
        tile.label = getString(R.string.tile_label)
        when {
            busy -> {
                tile.subtitle = "…"
            }
            s == null || !s.online -> {
                tile.state = Tile.STATE_UNAVAILABLE
                tile.subtitle = if (Prefs(this).configured) getString(R.string.state_offline) else getString(R.string.state_login)
            }
            else -> {
                tile.state = if (s.isOn) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
                tile.subtitle = when {
                    s.shot -> "Bezug läuft"
                    s.isEco -> "Eco"
                    s.isOff -> "Aus"
                    s.heated -> "Bereit"
                    else -> "Heizt auf"
                }
            }
        }
        tile.updateTile()
    }

    // Die alte Intent-Variante wird nur unter Android 14 genutzt
    @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
