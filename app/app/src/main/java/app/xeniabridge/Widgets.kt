package app.xeniabridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.service.quicksettings.TileService
import android.widget.RemoteViews
import android.widget.Toast
import java.util.Locale
import kotlin.concurrent.thread

/** Gemeinsame Logik für beide Widgets: Zustand holen, darstellen, Aktionen ausführen. */
object Widgets {
    const val ACTION_TOGGLE = "app.xeniabridge.widget.TOGGLE"
    const val ACTION_POWER = "app.xeniabridge.widget.POWER"
    const val ACTION_REFRESH = "app.xeniabridge.widget.REFRESH"
    const val EXTRA_MODE = "mode"

    private sealed interface View {
        data class Ok(val s: Api.State) : View
        data class Error(val msg: String, val login: Boolean) : View
        data object Busy : View
    }

    /** Im Hintergrund Zustand holen und alle Widgets neu zeichnen. */
    fun refreshAll(context: Context) {
        val app = context.applicationContext
        thread(name = "xenia-widgets") { renderFresh(app) }
    }

    private fun hasWidgets(context: Context): Boolean {
        val m = AppWidgetManager.getInstance(context)
        return m.getAppWidgetIds(ComponentName(context, PowerWidget::class.java)).isNotEmpty() ||
            m.getAppWidgetIds(ComponentName(context, StatusWidget::class.java)).isNotEmpty() ||
            m.getAppWidgetIds(ComponentName(context, LargeWidget::class.java)).isNotEmpty() ||
            m.getAppWidgetIds(ComponentName(context, WideWidget::class.java)).isNotEmpty()
    }

    /** Blockierend (aus einem Hintergrund-Thread aufrufen). */
    fun renderFresh(context: Context): Api.State? {
        if (!Prefs(context).configured) {
            render(context, View.Error(context.getString(R.string.state_login), true))
            return null
        }
        return try {
            val s = Api.state(context)
            render(context, View.Ok(s))
            scheduleFollowUp(context, s)
            AlarmReport.sendIfChanged(context)
            s
        } catch (e: Exception) {
            val login = e is Api.ApiException && e.status == 401
            render(context, View.Error(if (login) context.getString(R.string.state_login) else Api.message(e), login))
            null
        } finally {
            try {
                TileService.requestListeningState(context, ComponentName(context, PowerTileService::class.java))
            } catch (_: Exception) { }
        }
    }

    /** Während die Maschine aufheizt, öfter nachsehen (sonst nur alle 30 min). */
    private fun scheduleFollowUp(context: Context, s: Api.State) {
        if (!hasWidgets(context)) return
        val delay = when {
            s.shot -> 30_000L
            s.isOn && !s.heated -> 120_000L
            else -> return
        }
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + delay, broadcast(context, StatusWidget::class.java, ACTION_REFRESH, null, 99))
    }

    /** Aktion aus einem Widget: ausführen, kurz warten, neu zeichnen. Läuft im goAsync-Kontext. */
    fun handleAction(receiver: AppWidgetProvider, context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = receiver.goAsync()
        thread(name = "xenia-action") {
            try {
                when (intent.action) {
                    ACTION_REFRESH -> renderFresh(app)
                    ACTION_TOGGLE, ACTION_POWER -> {
                        val prefs = Prefs(app)
                        if (!prefs.configured) {
                            openApp(app)
                            return@thread
                        }
                        render(app, View.Busy)
                        try {
                            if (intent.action == ACTION_TOGGLE) Api.toggle(app) else Api.power(app, intent.getStringExtra(EXTRA_MODE) ?: "on")
                            Thread.sleep(1500)
                        } catch (e: Exception) {
                            toast(app, Api.message(e))
                        }
                        renderFresh(app)
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }

    private fun toast(context: Context, msg: String) {
        android.os.Handler(android.os.Looper.getMainLooper()).post { Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
    }

    private fun openApp(context: Context) {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun dateTime(ms: Long): String =
        java.text.SimpleDateFormat("EE HH:mm", Locale.GERMANY).format(java.util.Date(ms))

    private fun fmt(v: Double?, digits: Int = 1): String =
        if (v == null) "–" else String.format(Locale.GERMANY, "%.${digits}f", v)

    private fun bgFor(s: Api.State): Int = when {
        !s.online -> R.drawable.widget_bg_offline
        s.isEco -> R.drawable.widget_bg_eco
        s.isOff -> R.drawable.widget_bg_off
        s.heated -> R.drawable.widget_bg_ready
        else -> R.drawable.widget_bg_on
    }

    private fun title(s: Api.State): String = when {
        !s.online -> "Offline"
        s.shot -> "Bezug läuft"
        s.isOff -> "Aus"
        s.isEco -> "Eco"
        s.status == "fault" -> "Störung"
        s.heated -> "Bereit"
        else -> "Heizt auf"
    }

    private fun render(context: Context, v: View) {
        val m = AppWidgetManager.getInstance(context)
        for (id in m.getAppWidgetIds(ComponentName(context, PowerWidget::class.java))) m.updateAppWidget(id, powerViews(context, v))
        for (id in m.getAppWidgetIds(ComponentName(context, StatusWidget::class.java))) m.updateAppWidget(id, statusViews(context, v))
        for (id in m.getAppWidgetIds(ComponentName(context, LargeWidget::class.java))) m.updateAppWidget(id, statusViews(context, v, R.layout.widget_large))
        for (id in m.getAppWidgetIds(ComponentName(context, WideWidget::class.java))) m.updateAppWidget(id, statusViews(context, v, R.layout.widget_wide))
    }

    private fun powerViews(context: Context, v: View): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_power)
        when (v) {
            is View.Ok -> {
                rv.setInt(R.id.root, "setBackgroundResource", bgFor(v.s))
                rv.setTextViewText(R.id.label, if (v.s.isOn) "An" else title(v.s))
            }
            is View.Error -> {
                rv.setInt(R.id.root, "setBackgroundResource", R.drawable.widget_bg_offline)
                rv.setTextViewText(R.id.label, if (v.login) v.msg else "Fehler")
            }
            View.Busy -> rv.setTextViewText(R.id.label, "…")
        }
        rv.setOnClickPendingIntent(R.id.root, if (v is View.Error && v.login) openAppIntent(context) else broadcast(context, PowerWidget::class.java, ACTION_TOGGLE, null, 1))
        return rv
    }

    /** Status (3×2), schmal (4×1) oder groß (4×2, mit Einzelwerten und nächstem Einschalten); gleiche IDs. */
    private fun statusViews(context: Context, v: View, layout: Int = R.layout.widget_status): RemoteViews {
        val large = layout == R.layout.widget_large
        val rv = RemoteViews(context.packageName, layout)
        var on = false
        var eco = false
        var off = false
        var reachable = false
        when (v) {
            is View.Ok -> {
                val s = v.s
                reachable = s.online
                on = s.isOn
                eco = s.isEco
                off = s.isOff
                rv.setInt(R.id.root, "setBackgroundResource", bgFor(s))
                // Im 4×1 bleibt neben den Knöpfen kaum Platz: nur der Zustand
                rv.setTextViewText(R.id.status, if (layout == R.layout.widget_wide) title(s) else "Kaffeemaschine · ${title(s)}")
                if (large) {
                    val live = s.online && !s.isOff
                    rv.setTextViewText(R.id.v_group, if (live) "${fmt(s.group)} °C" else "–")
                    rv.setTextViewText(R.id.k_group, if (live && s.groupSet != null) "Gruppe · Ziel ${fmt(s.groupSet)}" else "Brühgruppe")
                    rv.setTextViewText(R.id.v_boiler, if (live) "${fmt(s.boiler)} °C" else "–")
                    rv.setTextViewText(R.id.v_steam, if (live && s.steamOn) "${fmt(s.steam)} bar" else "aus")
                    val next = s.nextAt?.let { "Nächstes Einschalten: ${dateTime(it)}${s.nextReason?.let { r -> " · $r" } ?: ""}" } ?: "Kein Einschalten geplant"
                    rv.setTextViewText(R.id.next, if (!s.tankOk) "Tank leer! · $next" else if (!s.online) "Maschine nicht erreichbar · $next" else next)
                }
                val parts = mutableListOf<String>()
                if (s.online && !s.isOff) {
                    parts += "${fmt(s.group)} °C (Ziel ${fmt(s.groupSet)})"
                    if (s.steamOn) parts += "Dampf ${fmt(s.steam)} bar"
                }
                if (!s.tankOk) parts += "Tank leer!"
                if (!large) rv.setTextViewText(R.id.details, if (parts.isEmpty()) (if (s.online) "Tippen zum Öffnen" else "Maschine nicht erreichbar") else parts.joinToString(" · "))
            }
            is View.Error -> {
                rv.setInt(R.id.root, "setBackgroundResource", R.drawable.widget_bg_offline)
                rv.setTextViewText(R.id.status, "Kaffeemaschine")
                rv.setTextViewText(if (large) R.id.next else R.id.details, v.msg)
            }
            View.Busy -> rv.setTextViewText(if (large) R.id.next else R.id.details, "Wird geschaltet …")
        }
        // Aktiven Modus hervorheben; bei Maschine aus nur „Ein“ bedienbar (wie in der App)
        fun button(id: Int, active: Boolean, enabled: Boolean, mode: String, req: Int) {
            rv.setInt(id, "setBackgroundResource", if (active) R.drawable.widget_btn_active else R.drawable.widget_btn)
            rv.setTextColor(id, when {
                active -> 0xFF1B1B21.toInt()
                enabled -> 0xFFFFFFFF.toInt()
                else -> 0x66FFFFFF
            })
            rv.setOnClickPendingIntent(id, if (enabled && !active) broadcast(context, StatusWidget::class.java, ACTION_POWER, mode, req) else null)
        }
        val busy = v is View.Busy
        button(R.id.btn_on, on, reachable && !busy, "on", 10)
        button(R.id.btn_eco, eco, reachable && !busy && !off, "eco", 11)
        button(R.id.btn_off, off, reachable && !busy && !off, "off", 12)
        rv.setOnClickPendingIntent(R.id.refresh, broadcast(context, StatusWidget::class.java, ACTION_REFRESH, null, 13))
        rv.setOnClickPendingIntent(R.id.header, openAppIntent(context))
        return rv
    }

    private fun openAppIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(context, 14, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun broadcast(context: Context, cls: Class<*>, action: String, mode: String?, req: Int): PendingIntent {
        val i = Intent(context, cls).setAction(action)
        if (mode != null) i.putExtra(EXTRA_MODE, mode)
        return PendingIntent.getBroadcast(context, req, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/** 1×1: Ein/Aus mit einem Tipp; Farbe zeigt den Zustand. */
class PowerWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refreshAll(context)

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_TOGGLE, Widgets.ACTION_POWER, Widgets.ACTION_REFRESH -> Widgets.handleAction(this, context, intent)
            else -> super.onReceive(context, intent)
        }
    }
}

/** 3×2: Status, Temperatur, Dampf und Ein/Eco/Aus. */
class StatusWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refreshAll(context)

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_TOGGLE, Widgets.ACTION_POWER, Widgets.ACTION_REFRESH -> Widgets.handleAction(this, context, intent)
            else -> super.onReceive(context, intent)
        }
    }
}

/** 4×2: Status, Brühgruppe/Brühkessel/Dampf, nächstes geplantes Einschalten, Ein/Eco/Aus. */
class LargeWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refreshAll(context)

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_TOGGLE, Widgets.ACTION_POWER, Widgets.ACTION_REFRESH -> Widgets.handleAction(this, context, intent)
            else -> super.onReceive(context, intent)
        }
    }
}

/** 4×1: Status und Temperatur, Ein/Eco/Aus in einer Zeile. */
class WideWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.refreshAll(context)

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_TOGGLE, Widgets.ACTION_POWER, Widgets.ACTION_REFRESH -> Widgets.handleAction(this, context, intent)
            else -> super.onReceive(context, intent)
        }
    }
}
