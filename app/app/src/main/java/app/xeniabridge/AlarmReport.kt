package app.xeniabridge

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Meldet dem Server den nächsten Wecker dieses Handys (Android stellt nur den nächsten bereit,
 * gesetzt von Uhr-Apps per setAlarmClock). Der Server schaltet die Maschine eine einstellbare Zeit vorher ein.
 */
object AlarmReport {
    fun nextAlarm(context: Context): Long? =
        context.getSystemService(AlarmManager::class.java)?.nextAlarmClock?.triggerTime

    /** App, die den nächsten Wecker gestellt hat (Name, sonst Paketname); null, wenn Android es nicht verrät. */
    fun nextAlarmSource(context: Context): String? {
        val pkg = context.getSystemService(AlarmManager::class.java)?.nextAlarmClock?.showIntent?.creatorPackage ?: return null
        return try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
            pkg
        }
    }

    /** Blockierend; nur senden, wenn sich der Wecker geändert hat oder die letzte Meldung älter als 6 h ist. */
    fun sendIfChanged(context: Context, force: Boolean = false) {
        val prefs = Prefs(context)
        if (!prefs.configured || prefs.direct) return // Wecker-Automatik nur mit Server
        val next = nextAlarm(context)
        val value = next ?: 0L
        val now = System.currentTimeMillis()
        if (!force && value == prefs.lastAlarmSent && now - prefs.lastAlarmReportAt < 6 * 3600_000L) return
        try {
            Api.request(context, "POST", "/api/wake/alarm", JSONObject().put("next", next ?: JSONObject.NULL))
            prefs.lastAlarmSent = value
            prefs.lastAlarmReportAt = now
        } catch (_: Exception) {
            // nächster Versuch beim nächsten Widget-Update oder App-Wechsel
        }
    }
}

/** Android meldet jede Änderung des nächsten Weckers. */
class AlarmChangedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED) return
        val app = context.applicationContext
        val pending = goAsync()
        thread(name = "xenia-alarm") {
            try {
                AlarmReport.sendIfChanged(app, force = true)
            } finally {
                pending.finish()
            }
        }
    }
}
