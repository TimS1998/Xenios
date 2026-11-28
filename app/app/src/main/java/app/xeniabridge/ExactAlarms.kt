package app.xeniabridge

import android.app.Activity
import android.app.AlarmManager
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Erlaubnis für exakte Wecker („Wecker und Erinnerungen“): damit aktualisieren sich die Widgets alle 5 s. Bis Android 13
 * ist sie automatisch erteilt, ab Android 14 muss man sie einmal erlauben. Ohne sie bündelt Android die Wecker.
 */
object ExactAlarms {
    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true

    /** Öffnet die Einstellung „Wecker und Erinnerungen“ dieser App */
    fun openSettings(context: Context) {
        if (Build.VERSION.SDK_INT < 31) return
        val i = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
        runCatching { context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }

    /** Einmaliger Hinweis, sobald ein Widget auf dem Startbildschirm liegt und die Erlaubnis fehlt */
    fun askOnce(activity: Activity) {
        val prefs = Prefs(activity)
        if (allowed(activity) || prefs.exactAlarmAsked || !Widgets.hasWidgets(activity)) return
        prefs.exactAlarmAsked = true
        AlertDialog.Builder(activity)
            .setTitle(R.string.exact_title)
            .setMessage(R.string.exact_text)
            .setPositiveButton(R.string.exact_allow) { _, _ -> openSettings(activity) }
            .setNegativeButton(R.string.exact_later, null)
            .show()
    }
}

/** Erlaubnis erteilt oder entzogen: Widgets neu laden (plant den nächsten Wecker passend) */
class ExactAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Widgets.refreshAll(context)
    }
}
