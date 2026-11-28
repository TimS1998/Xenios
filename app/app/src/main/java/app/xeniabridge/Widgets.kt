package app.xeniabridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.SystemClock
import android.service.quicksettings.TileService
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Alle Widgets: Zustand holen, jedes Widget in seiner echten Größe zeichnen (Farben und Manometer-Design der App),
 * Klickflächen deckungsgleich darüber (Layouts aus widgets_gen), Aktionen ausführen.
 */
object Widgets {
    const val ACTION_TOGGLE = "app.xeniabridge.widget.TOGGLE"
    const val ACTION_POWER = "app.xeniabridge.widget.POWER"
    const val ACTION_STEAM = "app.xeniabridge.widget.STEAM"
    const val ACTION_NOSTEAM = "app.xeniabridge.widget.NOSTEAM"
    const val ACTION_TARGET = "app.xeniabridge.widget.TARGET"
    const val ACTION_STOP = "app.xeniabridge.widget.STOP"
    /** Antippen eines Fehlers: sofort neu laden und Fehler zeigen. */
    const val ACTION_REFRESH = "app.xeniabridge.widget.REFRESH"
    /** Automatisch (Android, Nachsehen beim Aufheizen, erneuter Versuch, App verlassen): kurze Aussetzer übergehen. */
    const val ACTION_UPDATE = "app.xeniabridge.widget.UPDATE"
    /** Ein (immer ohne Dampfkessel) / Aus mit einem Tipp */
    const val ACTION_TOGGLE_NOSTEAM = "app.xeniabridge.widget.TOGGLE_NOSTEAM"
    const val EXTRA_MODE = "mode"
    const val EXTRA_KEY = "key"
    const val EXTRA_DELTA = "delta"

    private const val QUIET_FAILS = 2
    private val RETRY_MS = longArrayOf(5_000, 10_000, 30_000, 60_000)

    /** Ein Widget-Typ: Klasse, Layout, Standardgröße (dp) für die erste Darstellung */
    private class Kind(val cls: Class<*>, val layout: Int, val w: Int, val h: Int)

    private val KINDS = listOf(
        Kind(PowerWidget::class.java, R.layout.widget_power, 140, 90),
        Kind(PowerNoSteamWidget::class.java, R.layout.widget_powerns, 140, 90),
        Kind(ModeWidget::class.java, R.layout.widget_mode, 300, 70),
        Kind(SwitchWidget::class.java, R.layout.widget_switch, 300, 150),
        Kind(LargeWidget::class.java, R.layout.widget_large, 300, 230),
        Kind(GaugesWidget::class.java, R.layout.widget_gauges, 300, 150),
        Kind(TargetsWidget::class.java, R.layout.widget_targets, 150, 150),
        Kind(CareWidget::class.java, R.layout.widget_care, 150, 70),
        Kind(HistoryWidget::class.java, R.layout.widget_history, 300, 150),
        Kind(LastShotWidget::class.java, R.layout.widget_lastshot, 150, 150),
        Kind(ShotsWidget::class.java, R.layout.widget_shots, 300, 150),
        Kind(ShotsLargeWidget::class.java, R.layout.widget_shotslarge, 300, 230),
    )

    /** Was gezeichnet wird: Zustand oder Fehler */
    /** note: Hinweis statt des Zustands, solange ein Schaltbefehl läuft (z. B. „Schaltet ein …“) */
    /** dim: gedämpfte Phase des Pulsierens, solange ein Schaltbefehl auf Bestätigung wartet */
    private class Data(val s: Api.State?, val error: String?, val login: Boolean, val noSteam: Boolean, val direct: Boolean, val note: String? = null, val dim: Boolean = false) {
        val raw: JSONObject? get() = s?.raw
    }

    fun refreshAll(context: Context) {
        context.sendBroadcast(Intent(context, PowerWidget::class.java).setAction(ACTION_UPDATE))
    }

    /** Nach Farb- oder Einstellungswechsel in der App: alle Widgets neu laden und zeichnen */
    fun redrawAll(context: Context) = refreshAll(context)

    /** Bildschirm an / entsperrt: Widgets sofort auf den aktuellen Stand bringen (nur solange der Prozess lebt) */
    private var screenReceiver: android.content.BroadcastReceiver? = null
    fun watchScreen(context: Context) {
        if (screenReceiver != null) return
        val app = context.applicationContext
        val r = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (hasWidgets(app)) refreshAll(app)
            }
        }
        val f = android.content.IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else app.registerReceiver(r, f)
            screenReceiver = r
        }
    }

    fun hasWidgets(context: Context): Boolean {
        val m = AppWidgetManager.getInstance(context)
        return KINDS.any { m.getAppWidgetIds(ComponentName(context, it.cls)).isNotEmpty() }
    }

    /** Blockierend (Hintergrund-Thread). quiet: kurze Aussetzer übergehen, der letzte Stand bleibt stehen. */
    fun renderFresh(context: Context, quiet: Boolean = false): Api.State? {
        val prefs = Prefs(context)
        if (!prefs.configured) {
            render(context, Data(null, context.getString(R.string.state_login), true, prefs.noSteamOn, prefs.direct))
            return null
        }
        return try {
            val s = withHolds(Api.state(context))
            lastState = s
            prefs.widgetFails = if (s.online) 0 else prefs.widgetFails + 1
            // Läuft gerade ein Schaltbefehl, bleibt dessen sofortige Anzeige stehen, bis er bestätigt ist
            if (switching == null) render(context, Data(s, null, false, prefs.noSteamOn, prefs.direct))
            scheduleFollowUp(context, s, prefs.widgetFails)
            AlarmReport.sendIfChanged(context)
            s
        } catch (e: Exception) {
            val login = e is Api.ApiException && e.status == 401
            val fails = prefs.widgetFails + 1
            prefs.widgetFails = fails
            if (login || !quiet || fails > QUIET_FAILS) {
                render(context, Data(null, if (login) context.getString(R.string.state_login) else Api.message(e), login, prefs.noSteamOn, prefs.direct))
            }
            if (!login) schedule(context, retryDelay(fails))
            null
        } finally {
            try {
                TileService.requestListeningState(context, ComponentName(context, PowerTileService::class.java))
            } catch (_: Exception) { }
        }
    }

    /**
     * Nächste Aktualisierung planen, so oft wie Android es erlaubt: Wecker liegen für Apps mindestens 5 s in der Zukunft
     * (kürzere setzt Android auf 5 s). Nur bei eingeschaltetem Bildschirm und nicht, solange die App selbst offen ist
     * (dann sind die Widgets nicht zu sehen; beim Verlassen der App geht es sofort weiter). Der Wecker weckt das Handy
     * nicht (ELAPSED_REALTIME): bei ausgeschaltetem Bildschirm fällt nichts an, beim Einschalten wird sofort aktualisiert.
     */
    private fun scheduleFollowUp(context: Context, s: Api.State, fails: Int) {
        schedule(context, if (!s.online) retryDelay(fails) else 5_000L)
    }

    private fun retryDelay(fails: Int): Long = RETRY_MS[(fails - 1).coerceIn(0, RETRY_MS.lastIndex)]

    /** Die App ist im Vordergrund: Widgets ruhen lassen */
    @Volatile var appVisible = false

    private fun schedule(context: Context, delay: Long) {
        if (appVisible || !hasWidgets(context)) return
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val i = Intent(context, PowerWidget::class.java).setAction(ACTION_UPDATE)
        val pi = PendingIntent.getBroadcast(context, 99, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // Bildschirm aus (CPU aber evtl. wach, z. B. Musik): nicht im Sekundentakt abfragen, nur einen späteren Termin
        // vormerken, der beim Einschalten nachgeholt wird
        if (context.getSystemService(android.os.PowerManager::class.java)?.isInteractive == false) {
            am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 60_000L, pi)
            return
        }
        val at = SystemClock.elapsedRealtime() + delay
        // Exakt mit der Erlaubnis „Wecker und Erinnerungen“ (SCHEDULE_EXACT_ALARM, siehe ExactAlarms); ohne bündelt Android die Wecker
        val exact = android.os.Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        runCatching { if (exact) am.setExact(AlarmManager.ELAPSED_REALTIME, at, pi) else am.set(AlarmManager.ELAPSED_REALTIME, at, pi) }
            .onFailure { am.set(AlarmManager.ELAPSED_REALTIME, at, pi) }
    }

    /** Läuft gerade eine Aktualisierung? Dann keine zweite parallel (die laufende plant die nächste). */
    private val updating = java.util.concurrent.atomic.AtomicBoolean(false)

    /** Gerade per Widget geänderte Sollwerte: bis der Server sie meldet (höchstens 20 s) gilt der neue Wert */
    private val targetHold = java.util.concurrent.ConcurrentHashMap<String, Pair<Double, Long>>()
    private fun withHolds(s: Api.State): Api.State {
        var r = s
        val now = System.currentTimeMillis()
        for ((key, h) in targetHold) {
            val cur = when (key) { "BG_SET_TEMP" -> s.groupSet; "BB_SET_TEMP" -> s.boilerSet; else -> s.steamSet }
            if (now > h.second || (cur != null && kotlin.math.abs(cur - h.first) < 0.05)) { targetHold.remove(key); continue }
            r = when (key) { "BG_SET_TEMP" -> r.copy(groupSet = h.first); "BB_SET_TEMP" -> r.copy(boilerSet = h.first); else -> r.copy(steamSet = h.first) }
        }
        return r
    }

    /** Letzter bekannter Zustand (für die sofortige Anzeige nach einem Tipp) */
    @Volatile private var lastState: Api.State? = null

    /** Laufender Schaltbefehl: weitere Tipps auf Schalter werden bis zur Bestätigung (höchstens 25 s) ignoriert */
    private class Switching(val until: Long)
    @Volatile private var switching: Switching? = null

    /** Erwarteter Zustand nach einem Schaltbefehl und der Hinweis dazu; null = keine sofortige Anzeige */
    private fun expect(action: String?, mode: String?, s: Api.State, noSteamPref: Boolean): Pair<Api.State, String>? {
        val off = s.isOff || !s.isOn && !s.isEco
        fun on(noSteam: Boolean) = s.copy(status = "on", heated = s.heated && !off, steamOn = !noSteam) to "Schaltet ein …"
        val toOff = s.copy(status = "off", steamOn = false) to "Schaltet aus …"
        return when (action) {
            ACTION_TOGGLE -> if (s.isOn) toOff else on(noSteamPref)
            ACTION_TOGGLE_NOSTEAM -> if (s.isOn) toOff else on(true)
            ACTION_POWER -> when (mode) {
                "off" -> toOff
                "eco" -> s.copy(status = "eco") to "Schaltet auf Eco …"
                else -> on(noSteamPref)
            }
            ACTION_STEAM -> if (mode == "on") s.copy(steamOn = true) to "Dampfkessel ein …" else s.copy(steamOn = false) to "Dampfkessel aus …"
            else -> null
        }
    }

    /** Bestätigt die Maschine den erwarteten Zustand? Beim Ein-/Ausschalten zählt der Zustand der Maschine, der Dampfkessel
     *  nur beim Schalten des Dampfkessels (die alte Xenia meldet ihn beim Einschalten teils erst später oder anders). */
    private fun reached(action: String?, exp: Api.State, now: Api.State) = now.online && when (action) {
        ACTION_STEAM -> now.isOn && now.steamOn == exp.steamOn
        else -> if (exp.status == "on") now.isOn else now.status == exp.status
    }

    /** Aktion aus einem Widget: sofort anzeigen, ausführen, bis zur Bestätigung nachsehen, neu zeichnen. Läuft im goAsync-Kontext. */
    fun handleAction(receiver: AppWidgetProvider, context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = receiver.goAsync()
        thread(name = "xenia-action") {
            try {
                val prefs = Prefs(app)
                when (intent.action) {
                    ACTION_REFRESH -> renderFresh(app)
                    ACTION_UPDATE -> if (updating.compareAndSet(false, true)) {
                        try { renderFresh(app, quiet = true) } finally { updating.set(false) }
                    }
                    ACTION_NOSTEAM -> {
                        prefs.noSteamOn = !prefs.noSteamOn
                        // Kippschalter sofort umlegen (die Einstellung liegt im Handy), danach frisch laden
                        lastState?.let { render(app, Data(it, null, false, prefs.noSteamOn, prefs.direct)) }
                        renderFresh(app)
                    }
                    else -> {
                        if (!prefs.configured) {
                            openApp(app, null)
                            return@thread
                        }
                        val isSwitch = intent.action in setOf(ACTION_TOGGLE, ACTION_TOGGLE_NOSTEAM, ACTION_POWER, ACTION_STEAM)
                        if (isSwitch) {
                            // Doppelte Tipps abfangen: solange ein Schaltbefehl läuft, nichts weiter auslösen
                            val busy = switching
                            if (busy != null && System.currentTimeMillis() < busy.until) return@thread
                            switching = Switching(System.currentTimeMillis() + 25_000) // länger als das Warten auf die Bestätigung (20 s)
                        }
                        // Sofort zeigen, was der Tipp bewirkt (erwarteter Zustand und „Schaltet ein …“)
                        val exp = lastState?.let { expect(intent.action, intent.getStringExtra(EXTRA_MODE), it, prefs.noSteamOn) }
                        if (isSwitch && exp != null) render(app, Data(exp.first, null, false, prefs.noSteamOn, prefs.direct, exp.second))
                        try {
                            when (intent.action) {
                                ACTION_TOGGLE -> Api.toggle(app)
                                ACTION_TOGGLE_NOSTEAM -> Api.toggle(app, noSteam = true)
                                ACTION_POWER -> Api.power(app, intent.getStringExtra(EXTRA_MODE) ?: "on")
                                ACTION_STEAM, ACTION_STOP, ACTION_TARGET -> {
                                    if (prefs.direct) throw Api.ApiException(0, "Im Direkt-Modus nur in der App")
                                    when (intent.action) {
                                        ACTION_STEAM -> Api.steam(app, intent.getStringExtra(EXTRA_MODE) == "on")
                                        ACTION_STOP -> Api.stopScript(app)
                                        else -> {
                                            val key = intent.getStringExtra(EXTRA_KEY) ?: return@thread
                                            val delta = intent.getDoubleExtra(EXTRA_DELTA, 0.0)
                                            // vom zuletzt angezeigten Wert aus rechnen: schnelle Tipps addieren sich korrekt
                                            val s = lastState ?: Api.state(app)
                                            val (cur, lo, hi) = when (key) {
                                                "BG_SET_TEMP" -> Triple(s.groupSet, 60.0, 96.0)
                                                "BB_SET_TEMP" -> Triple(s.boilerSet, 60.0, 96.0)
                                                else -> Triple(s.steamSet, 0.0, 1.8)
                                            }
                                            if (cur != null) {
                                                val v = ((cur + delta).coerceIn(lo, hi) * 10).roundToInt() / 10.0
                                                targetHold[key] = v to System.currentTimeMillis() + 20_000
                                                val shown = withHolds(s)
                                                lastState = shown
                                                render(app, Data(shown, null, false, prefs.noSteamOn, prefs.direct)) // sofort sichtbar
                                                Api.setTarget(app, key, v)
                                            }
                                        }
                                    }
                                }
                            }
                            if (isSwitch && exp != null) {
                                // bis zu 20 s jede Sekunde nachsehen, bis die Maschine den neuen Zustand meldet (der Server
                                // fragt nach einer Aktion so lange schnell nach)
                                for (i in 0 until 20) {
                                    // Pulsieren wie der Knopf in der App: zweimal pro Sekunde gedämpft / voll
                                    render(app, Data(exp.first, null, false, prefs.noSteamOn, prefs.direct, exp.second, dim = true))
                                    Thread.sleep(500)
                                    render(app, Data(exp.first, null, false, prefs.noSteamOn, prefs.direct, exp.second))
                                    Thread.sleep(500)
                                    val now = runCatching { Api.state(app) }.getOrNull() ?: continue
                                    lastState = now
                                    if (reached(intent.action, exp.first, now)) break
                                }
                            } else Thread.sleep(1200)
                        } catch (e: Exception) {
                            toast(app, Api.message(e))
                        } finally {
                            if (isSwitch) switching = null
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

    private fun openApp(context: Context, path: String?) {
        val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (path != null) i.putExtra(MainActivity.EXTRA_PATH, path)
        context.startActivity(i)
    }

    // --- Zeichnen ----------------------------------------------------------------------------------------------

    private fun render(context: Context, d: Data) {
        val m = AppWidgetManager.getInstance(context)
        val theme = WidgetTheme.load(context)
        for (k in KINDS) {
            for (id in m.getAppWidgetIds(ComponentName(context, k.cls))) {
                try {
                    m.updateAppWidget(id, views(context, m, id, k, d, theme))
                } catch (e: Exception) {
                    // Fehler sichtbar machen statt leer zu bleiben (ein Widget darf die anderen nicht aufhalten)
                    runCatching { m.updateAppWidget(id, errorViews(context, k, theme, "Widget-Fehler: ${e.javaClass.simpleName} ${e.message ?: ""}")) }
                }
            }
        }
    }

    /**
     * Ab Android 12 meldet der Startbildschirm alle Größen, in denen das Widget erscheinen kann (hoch-/querformat,
     * beim Ändern der Größe). Für jede wird ein eigenes, passendes Bild gezeichnet – nichts wird gestreckt.
     */
    private fun views(context: Context, m: AppWidgetManager, id: Int, k: Kind, d: Data, theme: WidgetTheme): RemoteViews {
        val o = m.getAppWidgetOptions(id)
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            val all: List<android.util.SizeF>? = if (android.os.Build.VERSION.SDK_INT >= 33) {
                o.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, android.util.SizeF::class.java)
            } else {
                @Suppress("DEPRECATION")
                o.getParcelableArrayList<android.util.SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
            }
            val sizes = all?.filter { it.width > 0 && it.height > 0 }?.distinct()?.take(4)
            if (!sizes.isNullOrEmpty()) {
                val limit = if (sizes.size > 1) 380_000f else 600_000f
                return RemoteViews(sizes.associateWith { sized(context, k, d, theme, it.width.roundToInt(), it.height.roundToInt(), limit) })
            }
        }
        var w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        var h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
        if (w <= 0 || h <= 0) { w = k.w; h = k.h }
        return sized(context, k, d, theme, w, h, 600_000f)
    }

    private fun painter(context: Context, theme: WidgetTheme, w: Int, h: Int, maxPx: Float): WidgetPainter {
        // Pixeldichte, aber Bitmap begrenzen (Widgets dürfen nur wenig Speicher übertragen)
        var scale = context.resources.displayMetrics.density
        if (w * h * scale * scale > maxPx) scale = sqrt(maxPx / (w * h))
        return WidgetPainter(context, theme, w.toFloat(), h.toFloat(), scale)
    }

    private fun errorViews(context: Context, k: Kind, theme: WidgetTheme, msg: String): RemoteViews {
        val p = painter(context, theme, k.w, k.h, 300_000f)
        p.card()
        val pad = WidgetSpecs.PAD
        p.textMid(msg, RectF(pad, pad, p.wDp - pad, p.hDp - pad), 10f, p.t.danger, 0, Paint.Align.CENTER)
        val rv = RemoteViews(context.packageName, k.layout)
        rv.setImageViewBitmap(R.id.img, p.bitmap)
        rv.setOnClickPendingIntent(R.id.root, broadcast(context, ACTION_REFRESH))
        return rv
    }

    private fun sized(context: Context, k: Kind, d: Data, theme: WidgetTheme, w: Int, h: Int, maxPx: Float): RemoteViews {
        val p = painter(context, theme, w, h, maxPx)
        p.card()
        val rv = RemoteViews(context.packageName, k.layout)
        val s = d.s
        if (s == null) {
            drawError(p, d)
            rv.setImageViewBitmap(R.id.img, p.bitmap)
            rv.setOnClickPendingIntent(R.id.root, if (d.login) openIntent(context, null) else broadcast(context, ACTION_REFRESH))
            return rv
        }
        when (k.cls) {
            PowerWidget::class.java -> { drawPower(p, s, "Ein/Aus", note = d.note, dim = d.dim); rv.setOnClickPendingIntent(R.id.root, broadcast(context, ACTION_TOGGLE)) }
            PowerNoSteamWidget::class.java -> { drawPower(p, s, "Ein ohne Dampf/Aus", noSteam = true, note = d.note, dim = d.dim); rv.setOnClickPendingIntent(R.id.root, broadcast(context, ACTION_TOGGLE_NOSTEAM)) }
            ModeWidget::class.java -> { drawMode(p, p.layout("mode"), s, d); bindSeg(context, rv, s) }
            SwitchWidget::class.java -> { drawSwitch(p, p.layout("switch"), s, d); bindSwitch(context, rv, s) }
            LargeWidget::class.java -> {
                // Keine Live-Ansicht des Bezugs: Android aktualisiert Widgets höchstens alle paar Sekunden, zu träge dafür
                drawLarge(p, p.layout("large"), s, d)
                rv.setViewVisibility(R.id.ov_large, View.VISIBLE)
                rv.setViewVisibility(R.id.ov_large_live, View.GONE)
                bindSwitch(context, rv, s)
            }
            GaugesWidget::class.java -> { drawGauges(p, p.layout("gauges"), s, d); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/")) }
            TargetsWidget::class.java -> {
                drawTargets(p, p.layout("targets"), s)
                rv.setOnClickPendingIntent(R.id.head, openIntent(context, "/"))
                val ids = listOf(Triple("BG_SET_TEMP", R.id.t1_minus, R.id.t1_plus), Triple("BB_SET_TEMP", R.id.t2_minus, R.id.t2_plus), Triple("SB_SET_PRESS", R.id.t3_minus, R.id.t3_plus))
                for ((key, minus, plus) in ids) {
                    val step = if (key == "SB_SET_PRESS") 0.1 else 0.5
                    rv.setOnClickPendingIntent(minus, broadcast(context, ACTION_TARGET, key = key, delta = -step))
                    rv.setOnClickPendingIntent(plus, broadcast(context, ACTION_TARGET, key = key, delta = step))
                }
            }
            CareWidget::class.java -> { drawCare(p, p.layout("care"), d); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/bezuege")) }
            HistoryWidget::class.java -> { drawHistory(p, p.layout("history"), d); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/")) }
            LastShotWidget::class.java -> { drawLastShot(p, p.layout("lastshot"), d); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/bezuege")) }
            ShotsWidget::class.java -> { drawShots(p, p.layout("shots"), d, false); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/bezuege")) }
            ShotsLargeWidget::class.java -> { drawShots(p, p.layout("shotslarge"), d, true); rv.setOnClickPendingIntent(R.id.root, openIntent(context, "/bezuege")) }
        }
        rv.setImageViewBitmap(R.id.img, p.bitmap)
        return rv
    }

    /** Kopf (öffnet die App) und Ein/Eco/Aus; jedes Layout mit diesen Flächen */
    private fun bindSeg(context: Context, rv: RemoteViews, s: Api.State) {
        rv.setOnClickPendingIntent(R.id.head, openIntent(context, "/"))
        val reachable = s.online
        rv.setOnClickPendingIntent(R.id.btn_on, if (reachable) broadcast(context, ACTION_POWER, mode = "on") else null)
        rv.setOnClickPendingIntent(R.id.btn_eco, if (reachable && !s.isOff) broadcast(context, ACTION_POWER, mode = "eco") else null)
        rv.setOnClickPendingIntent(R.id.btn_off, if (reachable && !s.isOff) broadcast(context, ACTION_POWER, mode = "off") else null)
    }

    private fun bindSwitch(context: Context, rv: RemoteViews, s: Api.State) {
        bindSeg(context, rv, s)
        val reachable = s.online
        rv.setOnClickPendingIntent(R.id.tg_steam, if (reachable && s.isOn) broadcast(context, ACTION_STEAM, mode = if (s.steamOn) "off" else "on") else null)
        rv.setOnClickPendingIntent(R.id.tg_nosteam, broadcast(context, ACTION_NOSTEAM))
    }

    private fun stateLabel(s: Api.State): String = when {
        !s.online -> "Offline"
        s.shot -> "Bezug läuft"
        s.isOff -> "Aus"
        s.isEco -> "Eco"
        s.status == "fault" -> "Störung"
        s.heated -> "Bereit"
        else -> "Heizt auf"
    }

    private fun stateDot(p: WidgetPainter, s: Api.State) = when {
        !s.online || s.isOff -> p.t.outline
        s.status == "fault" -> p.t.danger
        s.heated -> 0xFF2ECC40.toInt()
        s.isEco -> p.t.muted
        else -> 0xFFF5A623.toInt()
    }

    private fun fmt(v: Double?, digits: Int = 1) = WidgetPainter.fmt(v, digits)

    /** Zusatzdaten fehlen: Direkt-Modus (kein Server) oder Server zu alt (vor 2.12.13) */
    private fun missing(d: Data, what: String) = if (d.raw == null) "$what nur mit Server" else "Server aktualisieren (ab 2.12.13)"

    private fun drawError(p: WidgetPainter, d: Data) {
        val pad = WidgetSpecs.PAD
        val r = RectF(pad, pad, p.wDp - pad, p.hDp - pad)
        p.textMid(if (d.login) "Xenios – ${d.error}" else (d.error ?: "Fehler"), r, 12f, p.t.muted, 0, Paint.Align.CENTER)
        if (!d.login && p.hDp > 70) p.text("Antippen zum Neuladen", r.centerX(), r.bottom - 2, 10f, p.t.outline, 0, Paint.Align.CENTER)
    }

    private fun drawPower(p: WidgetPainter, s: Api.State, title: String, noSteam: Boolean = false, note: String? = null, dim: Boolean = false) {
        val rows = p.layout("power")
        // Titel wie bei den anderen Widgets („Xenios – Ein/Aus“, bei wenig Platz nur „Ein/Aus“)
        rows["head"]?.let { p.head(it, R.drawable.wi_power, title) }
        val r = rows["body"] ?: return
        val d = min(40f, r.height())
        val on = s.isOn || s.isEco
        val circle = if (on) p.t.primary else p.t.highest
        p.roundRect(RectF(r.left, r.centerY() - d / 2, r.left + d, r.centerY() + d / 2), d / 2, if (dim) p.withAlpha(circle, 0.55f) else circle)
        p.icon(R.drawable.wi_power, r.left + d / 2 - 11, r.centerY() - 11, 22f, if (on) p.t.onPrimary else p.t.onSurface)
        val tx = RectF(r.left + d + 10, r.top, r.right, r.bottom)
        val sub = if (s.online && !s.isOff && s.group != null) "${fmt(s.group)} °C${if (noSteam && !s.steamOn) " · ohne Dampf" else ""}"
            else if (noSteam && s.online) "ohne Dampf" else null
        val label = note ?: stateLabel(s)
        if (sub == null || note != null) p.textMid(label, tx, 14f, p.t.onSurface, 1)
        else {
            p.textMid(label, RectF(tx.left, tx.top, tx.right, tx.centerY() + 1), 14f, p.t.onSurface, 1)
            p.textMid(sub, RectF(tx.left, tx.centerY() + 1, tx.right, tx.bottom), 11.5f, p.t.muted)
        }
    }

    private fun drawSeg(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, dim: Boolean = false) {
        val reachable = s.online
        r["btn_on"]?.let { p.segButton(it, R.drawable.wi_power, "Ein", s.isOn, reachable, dim) }
        r["btn_eco"]?.let { p.segButton(it, R.drawable.wi_eco, "Eco", s.isEco, reachable && !s.isOff, dim) }
        r["btn_off"]?.let { p.segButton(it, R.drawable.wi_close, "Aus", s.isOff, reachable && !s.isOff, dim) }
    }

    private fun drawToggles(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, d: Data) {
        r["tg_steam"]?.let { p.toggleRow(it, R.drawable.wi_cloud, "Dampfkessel", if (s.steamOn && s.steam != null) "an · ${fmt(s.steam, 2)} bar" else if (s.steamOn) "an" else "aus", s.steamOn, s.online && s.isOn && !d.direct) }
        r["tg_nosteam"]?.let { p.toggleRow(it, R.drawable.wi_power, "Ohne Dampf einschalten", null, d.noSteam) }
    }

    /** 4×1 wie das frühere Widget: Status und Brühgruppe links, Ein/Eco/Aus rechts */
    private fun drawMode(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, d: Data) {
        // Kopfzeile mit Symbol und Titel, Zustand rechts (wie „Schalter“), darunter Ein/Eco/Aus über die ganze Breite
        val label = d.note ?: stateLabel(s)
        val right = if (d.note == null && s.online && !s.isOff && s.group != null) "$label · ${fmt(s.group)} °C" else label
        r["head"]?.let { p.head(it, R.drawable.wi_power, "Ein/Eco/Aus", right, dot = stateDot(p, s)) }
        drawSeg(p, r, s, d.dim)
    }

    private fun drawSwitch(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, d: Data) {
        r["head"]?.let { p.head(it, R.drawable.wi_toggle_tile, "Schalter", d.note ?: stateLabel(s), dot = stateDot(p, s)) }
        drawSeg(p, r, s, d.dim)
        drawToggles(p, r, s, d)
    }

    private fun drawLarge(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, d: Data) {
        val label = d.note ?: stateLabel(s)
        // ohne Zustand rechts oben: den zeigt groß die Zeile darunter
        r["head"]?.let { p.head(it, R.drawable.wi_power, "Espressomaschine") }
        r["status"]?.let { st ->
            val dia = min(46f, st.height())
            val on = s.isOn || s.isEco
            p.roundRect(RectF(st.left, st.centerY() - dia / 2, st.left + dia, st.centerY() + dia / 2), dia / 2, if (on) p.t.primary else p.t.highest)
            p.icon(R.drawable.wi_power, st.left + dia / 2 - 12, st.centerY() - 12, 24f, if (on) p.t.onPrimary else p.t.onSurface)
            val tx = RectF(st.left + dia + 12, st.top, st.right, st.bottom)
            p.textMid(label, RectF(tx.left, tx.top, tx.right, tx.centerY() + 4), 22f, p.t.onSurface, 1)
            val parts = mutableListOf<String>()
            if (s.online && !s.isOff && s.group != null) parts += "Brühgruppe ${fmt(s.group)} °C"
            if (s.online && s.steamOn && s.steam != null) parts += "Dampf ${fmt(s.steam, 2)} bar"
            if (parts.isEmpty()) parts += s.nextAt?.let { "Nächstes Einschalten ${java.text.SimpleDateFormat("EE HH:mm", Locale.GERMANY).format(java.util.Date(it))}" } ?: "Kein Einschalten geplant"
            p.textMid(parts.joinToString(" · "), RectF(tx.left, tx.centerY() + 4, tx.right, tx.bottom), 11.5f, p.t.muted)
        }
        r["badges"]?.let { b ->
            var x = b.left
            x += p.badge(if (s.tankOk) "Tank ok" else "Tank leer", x, b.centerY(), if (s.tankOk) p.withAlpha(p.t.success, 0.22f) else p.t.danger, if (s.tankOk) p.t.success else p.t.onDanger) + 4
            x += p.badge(if (s.steamOn) "Dampf an" else "Dampf aus", x, b.centerY(), p.t.primaryContainer, p.t.onPrimaryContainer) + 4
            // Nur zeichnen, was noch ganz in die Zeile passt
            fun fits(str: String) = x + p.measure(str, 10f, 1) + 12 <= b.right
            // Alte Xenia (DBL): verbundene Bluetooth-Waage, wie in der Status-Kachel
            if (d.raw?.optBoolean("scaleConnected") == true && fits("Waage verbunden"))
                x += p.badge("Waage verbunden", x, b.centerY(), p.withAlpha(p.t.success, 0.22f), p.t.success) + 4
            val today = d.raw?.optJSONArray("days")?.let { a -> a.optJSONObject(a.length() - 1)?.optInt("count") }
            if (today != null && fits("$today Bezüge heute")) p.badge("$today Bezüge heute", x, b.centerY(), p.t.primaryContainer, p.t.onPrimaryContainer)
        }
        drawSeg(p, r, s, d.dim)
        drawToggles(p, r, s, d)
    }

    private fun curveOf(a: JSONArray?): List<DoubleArray> {
        if (a == null) return emptyList()
        val out = ArrayList<DoubleArray>(a.length())
        for (i in 0 until a.length()) {
            val pt = a.optJSONArray(i) ?: continue
            out += DoubleArray(pt.length()) { k -> if (pt.isNull(k)) Double.NaN else pt.optDouble(k) }
        }
        return out
    }

    private fun drawGauges(p: WidgetPainter, r: Map<String, RectF>, s: Api.State, d: Data) {
        r["head"]?.let { p.head(it, R.drawable.wi_thermo, "Instrumente") }
        val body = r["body"] ?: return
        val gap = 6f
        // eher quadratisch: 2 × 2 wie im Dashboard, sonst 1 × 4
        val grid2 = body.width() / body.height() < 2.4f
        fun cell(k: Int): RectF = if (grid2) {
            val cw = (body.width() - gap) / 2
            val ch = (body.height() - gap) / 2
            val x = body.left + (k % 2) * (cw + gap)
            val y = body.top + (k / 2) * (ch + gap)
            RectF(x, y, x + cw, y + ch)
        } else {
            val gw = (body.width() - gap * 3) / 4
            RectF(body.left + k * (gw + gap), body.top, body.left + k * (gw + gap) + gw, body.bottom)
        }
        val live = s.online // wie die Home-Kachel: Werte auch bei ausgeschalteter Maschine
        val pump = d.raw?.optDouble("pump")?.takeIf { !it.isNaN() }
        val pumpSet = d.raw?.optDouble("pumpSet")?.takeIf { !it.isNaN() }
        p.gauge(cell(0), "Druck", if (live) pump else null, 1, "bar", pumpSet?.let { "Ziel ${fmt(it)} bar" },
            WidgetPainter.Scale(0.0, 12.0, 2.0, 0.5, 2.0, 11.0), WidgetPainter.Scale(0.0, 16.0, 2.0, 1.0, 2.0, null, "POMPA"))
        val tFlat = WidgetPainter.Scale(20.0, 110.0, 10.0, 2.5, 20.0, 100.0)
        p.gauge(cell(1), "Brühgruppe", if (live) s.group else null, 1, "°C", s.groupSet?.let { "Ziel ${fmt(it)} °C" }, tFlat, WidgetPainter.Scale(0.0, 120.0, 20.0, 5.0, 20.0, null, "GRUPPO"))
        p.gauge(cell(2), "Brühkessel", if (live) s.boiler else null, 1, "°C", s.boilerSet?.let { "Ziel ${fmt(it)} °C" }, tFlat, WidgetPainter.Scale(0.0, 120.0, 20.0, 5.0, 20.0, null, "CAFFÈ"))
        p.gauge(cell(3), "Dampfkessel", if (live) s.steam else null, 2, "bar", s.steamSet?.let { "${if (s.steamOn) "" else "aus · "}Ziel ${fmt(it)} bar" },
            WidgetPainter.Scale(0.0, 2.5, 0.5, 0.1, 1.0, 2.0), WidgetPainter.Scale(0.0, 3.0, 0.5, 0.1, 0.5, null, "CALDAIA"))
    }

    private fun drawTargets(p: WidgetPainter, r: Map<String, RectF>, s: Api.State) {
        r["head"]?.let { p.head(it, R.drawable.wi_thermo, "Sollwerte") }
        val rows = listOf(Triple("t1", "Gruppe", s.groupSet?.let { fmt(it) }), Triple("t2", "Kessel", s.boilerSet?.let { fmt(it) }), Triple("t3", "Dampf", s.steamSet?.let { fmt(it) }))
        for ((key, label, value) in rows) {
            val minus = r["${key}_minus"] ?: continue
            val plus = r["${key}_plus"] ?: continue
            val row = RectF(r["head"]?.left ?: minus.left, minus.top, minus.left, minus.bottom)
            p.textMid(label, row, 12.5f, p.t.onSurface, maxW = row.width())
            for ((zone, sign) in listOf(minus to "−", plus to "+")) {
                val dia = min(24f, min(zone.width(), zone.height()) - 4)
                val cr = RectF(zone.centerX() - dia / 2, zone.centerY() - dia / 2, zone.centerX() + dia / 2, zone.centerY() + dia / 2)
                p.roundRect(cr, dia / 2, p.t.secondaryContainer)
                p.textMid(sign, cr, 14f, p.t.onSecondaryContainer, 2, Paint.Align.CENTER)
            }
            p.textMid(value ?: "–", RectF(minus.right, minus.top, plus.left, minus.bottom), 12.5f, p.t.onSurface, 1, Paint.Align.CENTER)
        }
    }

    private fun drawCare(p: WidgetPainter, rows: Map<String, RectF>, d: Data) {
        // Kopfzeile wie bei den anderen Widgets: Symbol der Home-Kachel „Pflege“ und Titel
        rows["head"]?.let { p.head(it, R.drawable.wi_check, "Pflege") }
        val r = rows["body"] ?: return
        val care = d.raw?.optJSONObject("care")
        if (care == null) { p.textMid(missing(d, "Pflege"), r, 11.5f, p.t.muted, 0, Paint.Align.CENTER); return }
        val interval = max(1, care.optInt("intervalDays", 7))
        val since = if (care.isNull("daysSince")) null else care.optInt("daysSince")
        val left = since?.let { interval - it }
        val rad = min(26f, r.height() / 2)
        p.ring(r.left + rad, r.centerY(), rad, if (left == null) 1f else (left.toFloat() / interval).coerceIn(0f, 1f), if (left == null || left <= 0) "!" else "$left T")
        val tx = RectF(r.left + rad * 2 + 10, r.top, r.right, r.bottom)
        p.textMid("Backflush", RectF(tx.left, tx.top, tx.right, tx.centerY() + 2), 13f, p.t.onSurface, 1)
        val sub = when { since == null -> "fällig"; left != null && left <= 0 -> "fällig"; left == 1 -> "morgen"; else -> "in $left Tagen" }
        p.textMid(sub, RectF(tx.left, tx.centerY() + 2, tx.right, tx.bottom - 4), 11.5f, if (care.optBoolean("due")) p.t.warning else p.t.muted)
    }

    private fun drawHistory(p: WidgetPainter, r: Map<String, RectF>, d: Data) {
        r["head"]?.let { p.head(it, R.drawable.wi_history, "Verlauf (10 min)") }
        val body = r["body"] ?: return
        val h = d.raw?.optJSONArray("history")
        if (h == null) { p.textMid(missing(d, "Verlauf"), body, 11.5f, p.t.muted, 0, Paint.Align.CENTER); return }
        p.historyChart(body, curveOf(h))
    }

    private fun shotSummary(p: WidgetPainter, r: RectF, ls: JSONObject, big: Float) {
        val time = ls.optDouble("timeS").takeIf { !it.isNaN() }
        val at = ls.optLong("at", 0)
        val parts = listOfNotNull(ls.optDouble("yieldG").takeIf { !it.isNaN() }?.let { "${fmt(it)} g" }, ls.optDouble("ratio").takeIf { !it.isNaN() }?.let { "1:${fmt(it)}" })
        val third = r.height() / 3
        if (at > 0) p.textMid("Letzter · ${java.text.SimpleDateFormat("HH:mm", Locale.GERMANY).format(java.util.Date(at))}", RectF(r.left, r.top, r.right, r.top + third), 11.5f, p.t.muted)
        p.textMid(if (time != null) "${fmt(time, 0)} s" else "–", RectF(r.left, r.top + third, r.right, r.top + 2 * third), big, p.t.onSurface, 1)
        p.textMid(parts.joinToString(" · ").ifBlank { " " }, RectF(r.left, r.top + 2 * third, r.right, r.bottom), 11.5f, p.t.muted)
    }

    private fun drawLastShot(p: WidgetPainter, r: Map<String, RectF>, d: Data) {
        r["head"]?.let { p.head(it, R.drawable.wi_coffee_line, "Letzter Bezug") }
        val ls = d.raw?.optJSONObject("lastShot")
        val kpi = r["kpi"] ?: return
        val body = r["body"] ?: return
        if (ls == null) { p.textMid(if (d.raw?.has("days") == true) "Noch kein Bezug" else missing(d, "Bezüge"), RectF(kpi.left, kpi.top, kpi.right, body.bottom), 11.5f, p.t.muted, 0, Paint.Align.CENTER); return }
        val time = ls.optDouble("timeS").takeIf { !it.isNaN() }
        val tw = p.textMid(if (time != null) "${fmt(time, 0)} s" else "–", kpi, 22f, p.t.onSurface, 1)
        val parts = listOfNotNull(ls.optDouble("yieldG").takeIf { !it.isNaN() }?.let { "${fmt(it)} g" }, ls.optDouble("ratio").takeIf { !it.isNaN() }?.let { "1:${fmt(it)}" })
        p.textMid(parts.joinToString(" · "), RectF(kpi.left + tw + 8, kpi.top, kpi.right, kpi.bottom), 11.5f, p.t.muted)
        p.shotChart(body, curveOf(ls.optJSONArray("curve")))
    }

    private fun drawShots(p: WidgetPainter, r: Map<String, RectF>, d: Data, large: Boolean) {
        val days = d.raw?.optJSONArray("days")
        val times = d.raw?.optJSONArray("times")
        val dayVals = (0 until (days?.length() ?: 0)).mapNotNull { k -> days?.optJSONObject(k)?.let { it.optString("label") to it.optInt("count").toDouble() } }
        val timeVals = (0 until (times?.length() ?: 0)).mapNotNull { k -> times?.optJSONObject(k)?.let { it.optString("label") to it.optDouble("s") } }
        val total = dayVals.sumOf { it.second }.roundToInt()
        val avg = if (timeVals.isNotEmpty()) timeVals.sumOf { it.second } / timeVals.size else null
        r["head"]?.let { p.head(it, R.drawable.wi_calendar_bars, "Bezüge", if (large) avg?.let { a -> "Ø ${fmt(a, 0)} s" } else "$total in 7 Tagen") }
        if (d.raw?.has("days") != true) { (r["body"] ?: r["top"])?.let { p.textMid(missing(d, "Bezüge"), it, 11.5f, p.t.muted, 0, Paint.Align.CENTER) }; return }
        val ls = d.raw?.optJSONObject("lastShot")
        if (!large) {
            val body = r["body"] ?: return
            val left = RectF(body.left, body.top, body.left + min(110f, body.width() * 0.38f), body.bottom)
            if (ls != null) shotSummary(p, RectF(left.left, left.top + left.height() * 0.15f, left.right, left.bottom - left.height() * 0.15f), ls, 22f)
            p.barChart(RectF(left.right + 8, body.top, body.right, body.bottom), dayVals)
        } else {
            val top = r["top"] ?: return
            val bottom = r["bottom"] ?: return
            val left = RectF(top.left, top.top, top.left + min(110f, top.width() * 0.38f), top.bottom)
            if (ls != null) {
                shotSummary(p, left, ls, 22f)
                p.shotChart(RectF(left.right + 8, top.top, top.right, top.bottom), curveOf(ls.optJSONArray("curve")))
            } else p.textMid("Noch kein Bezug", top, 11.5f, p.t.muted, 0, Paint.Align.CENTER)
            val half = (bottom.width() - 10) / 2
            val b1 = RectF(bottom.left, bottom.top, bottom.left + half, bottom.bottom)
            val b2 = RectF(bottom.right - half, bottom.top, bottom.right, bottom.bottom)
            p.text("Pro Tag", b1.left, b1.top + 10, 10f, p.t.muted)
            p.text("Bezugszeiten", b2.left, b2.top + 10, 10f, p.t.muted)
            p.barChart(RectF(b1.left, b1.top + 14, b1.right, b1.bottom), dayVals)
            p.barChart(RectF(b2.left, b2.top + 14, b2.right, b2.bottom), timeVals)
        }
    }

    // --- Intents -----------------------------------------------------------------------------------------------

    private fun openIntent(context: Context, path: String?): PendingIntent {
        val i = Intent(context, MainActivity::class.java).setData(Uri.parse("xenios://open${path ?: "/"}"))
        if (path != null) i.putExtra(MainActivity.EXTRA_PATH, path)
        return PendingIntent.getActivity(context, 14, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Eigene Daten-URI je Aktion: so überschreiben sich die PendingIntents verschiedener Knöpfe nicht */
    private fun broadcast(context: Context, action: String, mode: String? = null, key: String? = null, delta: Double? = null): PendingIntent {
        val i = Intent(context, PowerWidget::class.java).setAction(action)
            .setData(Uri.parse("xenios://widget/$action/${mode ?: ""}/${key ?: ""}/${delta ?: ""}"))
        if (mode != null) i.putExtra(EXTRA_MODE, mode)
        if (key != null) i.putExtra(EXTRA_KEY, key)
        if (delta != null) i.putExtra(EXTRA_DELTA, delta)
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/** Gemeinsam für alle Widgets: Updates von Android und eigene Aktionen laufen per goAsync. */
abstract class XeniaWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
        Widgets.handleAction(this, context, Intent(Widgets.ACTION_UPDATE))

    /** Größe geändert: in der neuen Größe neu zeichnen */
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: android.os.Bundle) =
        Widgets.handleAction(this, context, Intent(Widgets.ACTION_UPDATE))

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_TOGGLE, Widgets.ACTION_TOGGLE_NOSTEAM, Widgets.ACTION_POWER, Widgets.ACTION_STEAM, Widgets.ACTION_NOSTEAM, Widgets.ACTION_TARGET,
            Widgets.ACTION_STOP, Widgets.ACTION_REFRESH, Widgets.ACTION_UPDATE -> Widgets.handleAction(this, context, intent)
            else -> super.onReceive(context, intent)
        }
    }
}

/** 2×1: Ein/Aus mit einem Tipp */
class PowerWidget : XeniaWidget()
/** 2×1: Ein ohne Dampfkessel / Aus mit einem Tipp */
class PowerNoSteamWidget : XeniaWidget()
/** 4×1: Status, Ein/Eco/Aus (wie das frühere Widget) */
class ModeWidget : XeniaWidget()
/** 4×2: Ein/Eco/Aus, Dampfkessel, Ohne Dampf einschalten */
class SwitchWidget : XeniaWidget()
/** 4×3: Status und Schalter */
class LargeWidget : XeniaWidget()
/** 4×2: Instrumente */
class GaugesWidget : XeniaWidget()
/** 2×2: Sollwerte */
class TargetsWidget : XeniaWidget()
/** 2×1: Pflege */
class CareWidget : XeniaWidget()
/** 4×2: Verlauf der letzten 10 Minuten */
class HistoryWidget : XeniaWidget()
/** 2×2: Letzter Bezug */
class LastShotWidget : XeniaWidget()
/** 4×2: Letzter Bezug und Bezüge pro Tag */
class ShotsWidget : XeniaWidget()
/** 4×3: Bezug, Bezüge pro Tag und Bezugszeiten */
class ShotsLargeWidget : XeniaWidget()
