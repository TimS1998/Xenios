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
    @Volatile private var busy = false
    @Volatile private var last: Api.State? = null

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
        // Doppelte Tipps abfangen, bis die Maschine den neuen Zustand meldet
        if (busy) return
        busy = true
        val wasOn = last?.isOn == true
        paint(null, busy = true, note = getString(if (wasOn) R.string.switch_note_off else R.string.switch_note_on))
        thread(name = "xenia-tile") {
            try {
                Api.toggle(this)
                // bis zu 8 s jede Sekunde nachsehen, bis der Zustand umgeschlagen ist
                for (i in 0 until 8) {
                    Thread.sleep(1000)
                    val now = runCatching { Api.state(this) }.getOrNull() ?: continue
                    if (now.online && now.isOn != wasOn) break
                }
            } catch (e: Exception) {
                main.post { Toast.makeText(this, Api.message(this, e), Toast.LENGTH_SHORT).show() }
            } finally {
                busy = false
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

    private fun paint(s: Api.State?, busy: Boolean = false, note: String? = null) {
        if (s != null) last = s
        val tile = qsTile ?: return
        tile.icon = Icon.createWithResource(this, R.drawable.ic_power)
        tile.label = getString(R.string.tile_label)
        when {
            busy -> {
                // sofort den Zielzustand zeigen
                tile.state = if (note == getString(R.string.switch_note_on)) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
                tile.subtitle = note ?: "…"
            }
            s == null || !s.online -> {
                tile.state = Tile.STATE_UNAVAILABLE
                tile.subtitle = if (Prefs(this).configured) getString(R.string.state_offline) else getString(R.string.state_login)
            }
            else -> {
                tile.state = if (s.isOn) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
                tile.subtitle = when {
                    s.shot -> getString(R.string.state_shot)
                    s.isEco -> getString(R.string.state_eco)
                    s.isOff -> getString(R.string.state_off)
                    s.heated -> getString(R.string.state_ready)
                    else -> getString(R.string.state_heating)
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
