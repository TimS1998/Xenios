package app.xeniabridge

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import org.json.JSONObject
import java.util.Locale
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Farben und Manometer-Design der App für die Widgets. Die Web-App meldet sie (hell und dunkel) über
 * XeniaApp.setTheme; bei „System“ entscheidet die Helligkeit des Handys. Ohne Meldung: Material-Standard.
 */
class WidgetTheme(
    private val c: Map<String, Int>,
    private val g: Map<String, Int>,
    val mano: Boolean,
    val gaugeWhite: Boolean,
    val dark: Boolean,
    /** Design der App: Xenia (fast eckig, Open Sans, Schalter mit Rand in der Akzentfarbe) oder Material (rund) */
    val xenia: Boolean = false,
) {
    /** Eckenradien je Design (dp): Karte, Schalter/Knöpfe, Plaketten */
    val cardR get() = if (xenia) 6f else 22f
    val btnR: (Float) -> Float get() = { h -> if (xenia) 2f else h / 2 }
    val badgeR get() = if (xenia) 2f else 9f
    private fun col(k: String, light: Int, darkC: Int) = c[k] ?: if (dark) darkC else light
    val bg get() = col("bg", 0xFFFFFFFF.toInt(), 0xFF1F1F25.toInt())
    /** Seitenhintergrund (--surface), z. B. für den Einrichtungs-Bildschirm */
    val surface get() = col("surface", 0xFFFBF8FF.toInt(), 0xFF121318.toInt())
    val onSurface get() = col("onSurface", 0xFF1B1B21.toInt(), 0xFFE4E1E9.toInt())
    val muted get() = col("muted", 0xFF46464F.toInt(), 0xFFC6C5D0.toInt())
    val primary get() = col("primary", 0xFF4A5891.toInt(), 0xFFB8C4FF.toInt())
    val onPrimary get() = col("onPrimary", 0xFFFFFFFF.toInt(), 0xFF1F2A60.toInt())
    val primaryContainer get() = col("primaryContainer", 0xFFDDE1FF.toInt(), 0xFF374378.toInt())
    val onPrimaryContainer get() = col("onPrimaryContainer", 0xFF0B1A4B.toInt(), 0xFFDDE1FF.toInt())
    val secondaryContainer get() = col("secondaryContainer", 0xFFDEE1F9.toInt(), 0xFF424659.toInt())
    val onSecondaryContainer get() = col("onSecondaryContainer", 0xFF161B2C.toInt(), 0xFFDEE1F9.toInt())
    val outline get() = col("outline", 0xFF767680.toInt(), 0xFF90909A.toInt())
    val outlineVariant get() = col("outlineVariant", 0xFFC6C5D0.toInt(), 0xFF46464F.toInt())
    val highest get() = col("highest", 0xFFE3E1E9.toInt(), 0xFF35343A.toInt())
    val danger get() = col("danger", 0xFFC62828.toInt(), 0xFFEF5350.toInt())
    val onDanger get() = col("onDanger", 0xFFFFFFFF.toInt(), 0xFF2B0000.toInt())
    val success get() = col("success", 0xFF2E7D32.toInt(), 0xFF5FD07F.toInt())
    // Aktiv-Farbe der Segment-Knöpfe (Ein/Eco/Aus), wie --active der Web-Kacheln (Xenia: orange); fehlt sie, Akzentfarbe
    val active get() = c["active"] ?: primary
    val onActive get() = c["onActive"] ?: onPrimary
    val warning get() = col("warning", 0xFFE65100.toInt(), 0xFFFFB74D.toInt())
    fun gauge(k: String, def: Int) = g[k] ?: def

    companion object {
        fun load(context: Context): WidgetTheme {
            val sysDark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            val json = Prefs(context).widgetTheme?.let { runCatching { JSONObject(it) }.getOrNull() }
            val dark = when (json?.optString("mode", "system")) {
                "dark" -> true
                "light" -> false
                else -> sysDark
            }
            val part = json?.optJSONObject(if (dark) "dark" else "light")
            fun colors(o: JSONObject?): Map<String, Int> {
                val out = mutableMapOf<String, Int>()
                if (o != null) for (k in o.keys()) runCatching { out[k] = Color.parseColor(o.getString(k)) }
                return out
            }
            return WidgetTheme(
                colors(part?.optJSONObject("colors")),
                colors(part?.optJSONObject("gaugeColors")),
                json?.optBoolean("mano", false) ?: false,
                (part?.optString("gauge") ?: if (dark) "black" else "white") == "white",
                dark,
                json?.optString("palette") == "xenia",
            )
        }
    }
}

/** Zeichnet ein Widget in eine Bitmap. Maße in dp; s = Pixel je dp. */
class WidgetPainter(private val ctx: Context, val t: WidgetTheme, val wDp: Float, val hDp: Float, val s: Float) {
    val bitmap: Bitmap = Bitmap.createBitmap(max(1, (wDp * s).roundToInt()), max(1, (hDp * s).roundToInt()), Bitmap.Config.ARGB_8888)
    val c = Canvas(bitmap)
    // Schrift je Design: Xenia „Open Sans“ wie die Web-Oberfläche der Maschine, Material die Systemschrift
    private fun font(id: Int, fallback: Typeface): Typeface = runCatching { ctx.resources.getFont(id) }.getOrDefault(fallback)
    /** Text aus strings.xml (für die Widgets, die nur den Painter haben) */
    fun str(id: Int, vararg args: Any): String = if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
    fun plural(id: Int, n: Int, vararg args: Any): String = ctx.resources.getQuantityString(id, n, *args)
    private val regular: Typeface = if (t.xenia) font(R.font.open_sans_regular, Typeface.SANS_SERIF) else Typeface.create("sans-serif", Typeface.NORMAL)
    private val medium: Typeface = if (t.xenia) font(R.font.open_sans_semibold, Typeface.SANS_SERIF) else Typeface.create("sans-serif-medium", Typeface.NORMAL)
    private val bold: Typeface = if (t.xenia) font(R.font.open_sans_semibold, Typeface.DEFAULT_BOLD) else Typeface.create("sans-serif", Typeface.BOLD)

    fun px(dp: Float) = dp * s
    // Hinweis: bei Farbverläufen (shader) muss die Farbe deckend sein – Android übernimmt ihre Deckkraft für den Verlauf
    private fun fill(color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }
    private fun stroke(color: Int, wDp: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; this.color = color; strokeWidth = px(wDp); strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }

    /** Zeilen und Spalten wie die Klickflächen im Layout (WidgetSpecs), in dp. */
    fun layout(spec: String): Map<String, RectF> {
        val rows = WidgetSpecs.ROWS[spec] ?: return emptyMap()
        val pad = WidgetSpecs.PAD
        val out = mutableMapOf<String, RectF>()
        // Kopfzeile und Abstand darunter mit fester Höhe (der Titel bleibt oben), der Rest nach Gewicht – wie im Layout
        val total = rows.filter { !it.fixed }.sumOf { it.weight.toDouble() }.toFloat()
        val inner = hDp - 2 * pad
        val flex = (inner - rows.filter { it.fixed }.sumOf { it.weight.toDouble() }.toFloat()).coerceAtLeast(0f)
        var y = pad
        for (r in rows) {
            val h = if (r.fixed) r.weight else if (total > 0f) flex * r.weight / total else 0f
            val rect = RectF(pad, y, wDp - pad, y + h)
            r.name?.let { out[it] = rect }
            r.cols?.let { cols ->
                val sum = cols.sumOf { it.second.toDouble() }.toFloat()
                val avail = rect.width() - r.gap * (cols.size - 1)
                var x = rect.left
                for ((name, w) in cols) {
                    val cw = avail * w / sum
                    name?.let { out[it] = RectF(x, rect.top, x + cw, rect.bottom) }
                    x += cw + r.gap
                }
            }
            y += h
        }
        return out
    }

    fun card() {
        c.drawRoundRect(RectF(0f, 0f, px(wDp), px(hDp)), px(t.cardR), px(t.cardR), fill(t.bg))
    }

    private fun rpx(r: RectF) = RectF(px(r.left), px(r.top), px(r.right), px(r.bottom))

    fun roundRect(r: RectF, radiusDp: Float, color: Int, strokeColor: Int? = null) {
        val rr = rpx(r)
        c.drawRoundRect(rr, px(radiusDp), px(radiusDp), fill(color))
        if (strokeColor != null) {
            val p = stroke(strokeColor, 1f)
            val inset = px(0.5f)
            c.drawRoundRect(RectF(rr.left + inset, rr.top + inset, rr.right - inset, rr.bottom - inset), px(radiusDp), px(radiusDp), p)
        }
    }

    private fun textPaint(sizeDp: Float, color: Int, weight: Int = 0, align: Paint.Align = Paint.Align.LEFT) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = px(sizeDp)
        this.color = color
        typeface = when (weight) { 2 -> bold; 1 -> medium; else -> regular }
        textAlign = align
    }

    /** Text auf Grundlinie y (dp); kürzt mit „…“, wenn maxW (dp) überschritten. Liefert die Breite in dp. */
    fun text(str: String, x: Float, y: Float, sizeDp: Float, color: Int, weight: Int = 0, align: Paint.Align = Paint.Align.LEFT, maxW: Float? = null): Float {
        val p = textPaint(sizeDp, color, weight, align)
        var s0 = str
        if (maxW != null && p.measureText(s0) > px(maxW)) {
            while (s0.length > 1 && p.measureText("$s0…") > px(maxW)) s0 = s0.dropLast(1)
            s0 = "$s0…"
        }
        c.drawText(s0, px(x), px(y), p)
        return p.measureText(s0) / s
    }

    fun measure(str: String, sizeDp: Float, weight: Int = 0) = textPaint(sizeDp, 0, weight).measureText(str) / s

    /** Text vertikal mittig in einem Bereich (dp) */
    fun textMid(str: String, r: RectF, sizeDp: Float, color: Int, weight: Int = 0, align: Paint.Align = Paint.Align.LEFT, maxW: Float? = null): Float {
        val p = textPaint(sizeDp, color, weight, align)
        val base = r.centerY() - (p.ascent() + p.descent()) / 2 / s
        val x = when (align) { Paint.Align.CENTER -> r.centerX(); Paint.Align.RIGHT -> r.right; else -> r.left }
        return text(str, x, base, sizeDp, color, weight, align, maxW ?: r.width())
    }

    fun icon(res: Int, x: Float, y: Float, sizeDp: Float, color: Int) {
        val d = ctx.getDrawable(res)?.mutate() ?: return
        d.setTint(color)
        d.setBounds(px(x).roundToInt(), px(y).roundToInt(), px(x + sizeDp).roundToInt(), px(y + sizeDp).roundToInt())
        d.draw(c)
    }

    /** Kopfzeile „Xenios – Name“ mit Symbol; rechts optional ein Abzeichen oder Text. */
    fun head(r: RectF, iconRes: Int, name: String, right: String? = null, rightBadge: Pair<Int, Int>? = null, dot: Int? = null) {
        val sz = min(15f, r.height())
        icon(iconRes, r.left, r.centerY() - sz / 2, sz, t.primary)
        var rightW = 0f
        if (right != null) {
            if (rightBadge != null) {
                rightW = badgeRight(right, r.right, r.centerY(), rightBadge.first, rightBadge.second)
            } else {
                rightW = textMid(right, r, 11.5f, t.muted, align = Paint.Align.RIGHT) + 2
                if (dot != null) {
                    c.drawCircle(px(r.right - rightW - 6), px(r.centerY()), px(4f), fill(dot))
                    rightW += 12
                }
            }
        }
        val title = str(R.string.widget_head_title, name)
        val avail = r.width() - sz - 6 - rightW - 6
        // wo kein Platz für „Xenios – “ ist, nur den Namen
        val label = if (measure(title, 11.5f) <= avail) title else name
        textMid(label, RectF(r.left + sz + 6, r.top, r.right - rightW - 6, r.bottom), 11.5f, t.muted, maxW = avail)
    }

    fun badgeRight(str: String, right: Float, cy: Float, bg: Int, fg: Int): Float {
        val w = measure(str, 10f, 1) + 12
        val r = RectF(right - w, cy - 9, right, cy + 9)
        roundRect(r, t.badgeR, bg)
        textMid(str, r, 10f, fg, 1, Paint.Align.CENTER)
        return w
    }

    fun badge(str: String, x: Float, cy: Float, bg: Int, fg: Int): Float {
        val w = measure(str, 10f, 1) + 12
        val r = RectF(x, cy - 9, x + w, cy + 9)
        roundRect(r, t.badgeR, bg)
        textMid(str, r, 10f, fg, 1, Paint.Align.CENTER)
        return w
    }

    /** Segment-Knopf (Ein/Eco/Aus) */
    /** dim: gedämpfte Phase des Pulsierens (Schaltbefehl wartet auf Bestätigung) */
    fun segButton(r: RectF, iconRes: Int, label: String, active: Boolean, enabled: Boolean, dim: Boolean = false) {
        // wie die Kachel „Schalter“: Material pillenförmig mit dezentem Rand, Xenia fast eckig mit Rand in der Akzentfarbe
        val rad = t.btnR(r.height())
        if (active) roundRect(r, rad, if (dim) withAlpha(t.active, 0.55f) else t.active) else roundRect(r, rad, Color.TRANSPARENT, if (t.xenia) t.primary else t.outlineVariant)
        val fg = when { active -> t.onActive; enabled -> t.onSurface; else -> withAlpha(t.onSurface, 0.38f) }
        val tw = measure(label, 12.5f, 1)
        val isz = 15f
        val total = isz + 4 + tw
        val x0 = r.centerX() - total / 2
        icon(iconRes, x0, r.centerY() - isz / 2, isz, fg)
        textMid(label, RectF(x0 + isz + 4, r.top, r.right, r.bottom), 12.5f, fg, 1)
    }

    fun withAlpha(color: Int, a: Float) = Color.argb((Color.alpha(color) * a).roundToInt(), Color.red(color), Color.green(color), Color.blue(color))

    /** Zeile mit Symbol, Text (+ grauer Zusatz) und Umschalter rechts */
    fun toggleRow(r: RectF, iconRes: Int, label: String, extra: String?, on: Boolean, enabled: Boolean = true) {
        val fg = if (enabled) t.onSurface else withAlpha(t.onSurface, 0.38f)
        icon(iconRes, r.left, r.centerY() - 8, 16f, t.muted)
        val swW = 36f
        val swH = 20f
        val sw = RectF(r.right - swW, r.centerY() - swH / 2, r.right, r.centerY() + swH / 2)
        val labelW = textMid(label, RectF(r.left + 24, r.top, sw.left - 8, r.bottom), 12.5f, fg)
        if (extra != null) textMid(" $extra", RectF(r.left + 24 + labelW, r.top, sw.left - 8, r.bottom), 11.5f, t.muted)
        if (on) roundRect(sw, 10f, if (enabled) t.primary else withAlpha(t.primary, 0.38f))
        else roundRect(sw, 10f, t.highest, t.outline)
        val knobX = if (on) sw.right - 10 else sw.left + 10
        c.drawCircle(px(knobX), px(sw.centerY()), px(if (on) 7f else 6f), fill(if (on) t.onPrimary else t.outline))
    }

    /** Ring mit Fortschritt und Beschriftung (wie die Kacheln) */
    fun ring(cx: Float, cy: Float, rDp: Float, progress: Float, label: String, sub: String? = null) {
        val rect = RectF(px(cx - rDp), px(cy - rDp), px(cx + rDp), px(cy + rDp))
        c.drawArc(rect, 0f, 360f, false, stroke(t.highest, rDp * 0.16f))
        if (progress > 0) c.drawArc(rect, -90f, 360f * min(1f, progress), false, stroke(t.primary, rDp * 0.16f))
        val size = rDp * 0.42f
        if (sub == null) {
            textMid(label, RectF(cx - rDp, cy - rDp, cx + rDp, cy + rDp), size, t.onSurface, 1, Paint.Align.CENTER)
        } else {
            textMid(label, RectF(cx - rDp, cy - rDp, cx + rDp, cy + rDp * 0.2f), size, t.onSurface, 1, Paint.Align.CENTER)
            textMid(sub, RectF(cx - rDp, cy + rDp * 0.1f, cx + rDp, cy + rDp * 0.6f), size * 0.45f, t.muted, 0, Paint.Align.CENTER)
        }
    }

    // --- Instrumente -------------------------------------------------------------------------------------------
    class Scale(val min: Double, val max: Double, val major: Double, val minor: Double, val labelEvery: Double, val redFrom: Double? = null, val brand: String? = null)

    /** Anzeige im Design der App: flach (Material) oder Manometer (Xenia, Zifferblatt weiß/schwarz). */
    fun gauge(r: RectF, title: String, value: Double?, digits: Int, unit: String, target: String?, flat: Scale, mano: Scale) {
        val sc = if (t.mano) mano else flat
        val titleH = 14f
        val footH = if (t.mano) 28f else 14f
        val size = max(10f, min(r.width(), r.height() - titleH - footH))
        // senkrecht mittig im Feld (Titel, Instrument und Zeilen darunter als Block)
        val oy = max(0f, (r.height() - titleH - size - footH) / 2)
        textMid(title, RectF(r.left, r.top + oy, r.right, r.top + oy + titleH), 10f, t.muted, 0, Paint.Align.CENTER)
        val cx = r.centerX()
        val top = r.top + oy + titleH
        val u = size / 200f // dp je SVG-Einheit
        fun P(x: Double, y: Double) = Pair(cx - size / 2 + (x * u).toFloat(), top + (y * u).toFloat())
        fun ang(v: Double) = 135.0 + (min(sc.max, max(sc.min, v)) - sc.min) / (sc.max - sc.min) * 270.0
        fun polar(rr: Double, deg: Double): Pair<Float, Float> { val a = Math.toRadians(deg); return P(100 + rr * cos(a), 100 + rr * sin(a)) }
        val faceC = t.gauge("face", if (t.mano) (if (t.gaugeWhite) 0xFFF3F1EA.toInt() else 0xFF2B2E33.toInt()) else t.bg)
        val ink = if (t.mano) t.gauge("ink", if (t.gaugeWhite) 0xFF1C1C1C.toInt() else 0xFFECEBE6.toInt()) else t.gauge("tick", t.muted)
        val needleC = t.gauge("needle", if (t.mano) (if (t.gaugeWhite) 0xFF151515.toInt() else 0xFFF4F4F2.toInt()) else t.primary)
        val (ccx, ccy) = P(100.0, 100.0)
        if (t.mano) {
            // Chromring, Lippe, Zifferblatt
            val bez = fill(0xFF000000.toInt()).apply {
                shader = LinearGradient(px(ccx - 98 * u), px(ccy - 98 * u), px(ccx + 98 * u), px(ccy + 98 * u),
                    intArrayOf(0xFFFFFFFF.toInt(), 0xFFB9BCC0.toInt(), 0xFFF4F5F6.toInt(), 0xFF8D9196.toInt(), 0xFFE9EBED.toInt()),
                    floatArrayOf(0f, .22f, .45f, .7f, 1f), Shader.TileMode.CLAMP)
            }
            c.drawCircle(px(ccx), px(ccy), px(98 * u), bez)
            c.drawCircle(px(ccx), px(ccy), px(87 * u), stroke(0x73000000, 2.5f * u))
            c.drawCircle(px(ccx), px(ccy), px(85 * u), fill(faceC))
        } else {
            c.drawCircle(px(ccx), px(ccy), px(92 * u), fill(faceC))
            c.drawCircle(px(ccx), px(ccy), px(89 * u), stroke(t.gauge("ring", t.outlineVariant), 6f * u))
        }
        // Skala
        var i = 0
        while (true) {
            val v = sc.min + i * sc.minor
            if (v > sc.max + 1e-9) break
            val majorTick = Math.abs((v - sc.min) / sc.major - Math.round((v - sc.min) / sc.major)) < 1e-6
            val deg = ang(v)
            val (x1, y1) = polar(if (majorTick) 70.0 else 74.0, deg)
            val (x2, y2) = polar(if (t.mano) 80.0 else 82.0, deg)
            val red = !t.mano && sc.redFrom != null && v >= sc.redFrom - 1e-9
            c.drawLine(px(x1), px(y1), px(x2), px(y2), stroke(if (red) t.danger else ink, (if (majorTick) 2.4f else if (t.mano) 1f else 1.4f) * u).apply { strokeCap = Paint.Cap.BUTT })
            val atEnd = Math.abs(v - sc.min) < 1e-9 || Math.abs(v - sc.max) < 1e-9
            val lab = Math.abs((v - sc.min) / sc.labelEvery - Math.round((v - sc.min) / sc.labelEvery)) < 1e-6
            if (majorTick && lab && (t.mano || !atEnd)) {
                val (lx, ly) = polar(if (t.mano) 57.0 else 58.0, deg)
                val txt = if (t.mano) fmtScale(v) else v.roundToInt().toString()
                text(txt, lx, ly + (if (t.mano) 4f else 3f) * u, (if (t.mano) 12f else 9f) * u, if (t.mano) ink else t.muted, 0, Paint.Align.CENTER)
            }
            i++
        }
        if (t.mano) {
            text(unit, ccx, P(0.0, 74.0).second, 11f * u, ink, 0, Paint.Align.CENTER)
            sc.brand?.let { text(it, ccx, P(0.0, 128.0).second, 8.5f * u, ink, 2, Paint.Align.CENTER) }
            val gold = { x: Float, y: Float, rr: Float ->
                fill(0xFF000000.toInt()).apply { shader = RadialGradient(px(x - rr * .2f), px(y - rr * .3f), px(rr * 1.4f), intArrayOf(0xFFF3D98A.toInt(), 0xFFC9A13B.toInt(), 0xFF8A6A1C.toInt()), floatArrayOf(0f, .6f, 1f), Shader.TileMode.CLAMP) }
            }
            for (sx in listOf(89.0, 111.0)) { val (x, y) = P(sx, 141.0); c.drawCircle(px(x), px(y), px(3.6f * u), gold(x, y, 3.6f * u)) }
        }
        // Nadel
        val deg = ang(value ?: sc.min)
        val pts = if (t.mano) listOf(82.0 to 99.2, 100.0 to 98.3, 172.0 to 100.0, 100.0 to 101.7, 82.0 to 100.8) else listOf(100.0 to 96.0, 168.0 to 100.0, 100.0 to 104.0)
        val path = Path()
        val a = Math.toRadians(deg)
        pts.forEachIndexed { k, (x, y) ->
            val dx = x - 100; val dy = y - 100
            val (px0, py0) = P(100 + dx * cos(a) - dy * sin(a), 100 + dx * sin(a) + dy * cos(a))
            if (k == 0) path.moveTo(px(px0), px(py0)) else path.lineTo(px(px0), px(py0))
        }
        path.close()
        c.drawPath(path, fill(needleC))
        if (t.mano) {
            c.drawCircle(px(ccx), px(ccy), px(7.5f * u), fill(0xFF000000.toInt()).apply { shader = RadialGradient(px(ccx - 2 * u), px(ccy - 2 * u), px(10 * u), intArrayOf(0xFFF3D98A.toInt(), 0xFFC9A13B.toInt(), 0xFF8A6A1C.toInt()), floatArrayOf(0f, .6f, 1f), Shader.TileMode.CLAMP) })
            c.drawCircle(px(ccx), px(ccy), px(2.2f * u), fill(0xFF6B5214.toInt()))
        } else {
            c.drawCircle(px(ccx), px(ccy), px(7f * u), fill(needleC))
            text(fmt(value, digits), ccx, P(0.0, 156.0).second, 26f * u, t.onSurface, 2, Paint.Align.CENTER)
            text(unit, ccx, P(0.0, 174.0).second, 10f * u, t.muted, 0, Paint.Align.CENTER)
        }
        // Darunter: Manometer Wert + Ziel, flach nur das Ziel (immer lesbar)
        var fy = top + size + 2
        if (t.mano) {
            textMid(if (value == null) "–" else "${fmt(value, digits)} $unit", RectF(r.left, fy, r.right, fy + 14), 11.5f, t.onSurface, 1, Paint.Align.CENTER)
            fy += 14
        }
        if (target != null) textMid(target, RectF(r.left, fy, r.right, fy + 13), 9f, t.muted, 0, Paint.Align.CENTER)
    }

    private fun fmtScale(v: Double): String { val r = Math.round(v * 10) / 10.0; return if (r == Math.floor(r)) r.toLong().toString() else r.toString() }

    // --- Diagramme ---------------------------------------------------------------------------------------------
    /** Bezugskurve: Druck (blau, Fläche) und Gewicht (grün, gestrichelt) über die Zeit */
    fun shotChart(r: RectF, curve: List<DoubleArray>, minSeconds: Double = 20.0) {
        if (curve.size < 2) { textMid(str(R.string.widget_chart_no_curve), r, 11f, t.muted, 0, Paint.Align.CENTER); return }
        val tMax = max(minSeconds, curve.maxOf { it[0] })
        val wMax = max(10.0, (curve.mapNotNull { if (it.size > 2 && !it[2].isNaN()) it[2] else null }.maxOrNull() ?: 0.0) * 1.1)
        val left = r.left + 14; val right = r.right - 16; val top = r.top + 4; val bottom = r.bottom - 12
        val grid = stroke(t.outlineVariant, 0.6f)
        for (k in 0..4) { val y = bottom - (bottom - top) * k / 4; c.drawLine(px(left), px(y), px(right), px(y), grid); text("${k * 3}", left - 3, y + 3, 8f, t.muted, 0, Paint.Align.RIGHT) }
        fun x(v: Double) = left + ((right - left) * v / tMax).toFloat()
        fun yP(v: Double) = bottom - ((bottom - top) * min(12.0, max(0.0, v)) / 12.0).toFloat()
        fun yW(v: Double) = bottom - ((bottom - top) * min(wMax, max(0.0, v)) / wMax).toFloat()
        val p = Path(); val area = Path()
        curve.forEachIndexed { k, pt -> val xx = px(x(pt[0])); val yy = px(yP(if (pt.size > 1 && !pt[1].isNaN()) pt[1] else 0.0)); if (k == 0) { p.moveTo(xx, yy); area.moveTo(xx, px(bottom)); area.lineTo(xx, yy) } else { p.lineTo(xx, yy); area.lineTo(xx, yy) } }
        area.lineTo(px(x(curve.last()[0])), px(bottom)); area.close()
        c.drawPath(area, fill(0x294A7BD8))
        c.drawPath(p, stroke(0xFF4A7BD8.toInt(), 2f))
        if (curve.any { it.size > 2 && !it[2].isNaN() && it[2] > 0 }) {
            val w = Path()
            curve.forEachIndexed { k, pt -> val xx = px(x(pt[0])); val yy = px(yW(if (pt.size > 2 && !pt[2].isNaN()) pt[2] else 0.0)); if (k == 0) w.moveTo(xx, yy) else w.lineTo(xx, yy) }
            c.drawPath(w, stroke(t.success, 1.5f).apply { pathEffect = DashPathEffect(floatArrayOf(px(4f), px(3f)), 0f) })
        }
        var sec = 5
        while (sec < tMax) { text("$sec s", x(sec.toDouble()), r.bottom - 1, 8f, t.muted, 0, Paint.Align.CENTER); sec += if (tMax > 40) 10 else 5 }
    }

    /** Verlauf: Temperaturen (links, °C) und Drücke (rechts, bar) der letzten 10 Minuten */
    fun historyChart(r: RectF, samples: List<DoubleArray>) {
        if (samples.size < 2) { textMid(str(R.string.widget_chart_no_history), r, 11f, t.muted, 0, Paint.Align.CENTER); return }
        val left = r.left + 20; val right = r.right - 16; val top = r.top + 4; val bottom = r.bottom - 12
        val grid = stroke(t.outlineVariant, 0.6f)
        for (k in 0..4) {
            val y = bottom - (bottom - top) * k / 4
            c.drawLine(px(left), px(y), px(right), px(y), grid)
            text("${20 + k * 22}", left - 3, y + 3, 8f, t.muted, 0, Paint.Align.RIGHT)
            text("${k * 3}", right + 3, y + 3, 8f, t.muted)
        }
        fun x(sec: Double) = left + ((right - left) * (sec + 600) / 600).toFloat()
        fun yT(v: Double) = bottom - ((bottom - top) * (min(110.0, max(20.0, v)) - 20) / 90).toFloat()
        fun yB(v: Double) = bottom - ((bottom - top) * min(12.0, max(0.0, v)) / 12).toFloat()
        val series = listOf(Triple(1, 0xFFE0703A.toInt(), true), Triple(2, 0xFFC9A227.toInt(), true), Triple(3, 0xFF4A7BD8.toInt(), false), Triple(4, 0xFF3AA58A.toInt(), false))
        for ((idx, color, temp) in series) {
            val path = Path(); var started = false
            for (sm in samples) {
                if (sm.size <= idx || sm[idx].isNaN()) { started = false; continue }
                val xx = px(x(sm[0])); val yy = px(if (temp) yT(sm[idx]) else yB(sm[idx]))
                if (!started) { path.moveTo(xx, yy); started = true } else path.lineTo(xx, yy)
            }
            c.drawPath(path, stroke(color, 1.6f))
        }
        for (m in listOf(8, 6, 4, 2)) text("-$m min", x(-m * 60.0), r.bottom - 1, 8f, t.muted, 0, Paint.Align.CENTER)
    }

    /** Säulen mit Werten darüber und Beschriftung darunter; die letzte hervorgehoben */
    fun barChart(r: RectF, values: List<Pair<String, Double>>, unit: String = "") {
        if (values.isEmpty()) { textMid(str(R.string.widget_chart_no_shots), r, 11f, t.muted, 0, Paint.Align.CENTER); return }
        val vMax = max(1.0, values.maxOf { it.second })
        val top = r.top + 12; val bottom = r.bottom - 12
        val slot = r.width() / values.size
        val bw = min(26f, slot * 0.62f)
        // Beschriftung nur so oft, dass sie sich nicht überlappt; gezählt von der letzten (aktuellen) Säule aus
        val labelW = values.maxOf { measure(it.first, 8f) } + 4
        val stride = max(1, Math.ceil((labelW / slot).toDouble()).toInt())
        val valueW = values.maxOf { measure(fmtShort(it.second) + unit, 8.5f, 1) } + 3
        val valueStride = max(1, Math.ceil((valueW / slot).toDouble()).toInt())
        values.forEachIndexed { k, (label, v) ->
            val cx = r.left + slot * (k + 0.5f)
            val h = ((bottom - top) * v / vMax).toFloat()
            val last = k == values.lastIndex
            if (h > 0) roundRect(RectF(cx - bw / 2, bottom - h, cx + bw / 2, bottom), 3f, if (last) t.primary else withAlpha(t.primary, 0.45f))
            // Werte über den Säulen ebenfalls ohne Überlappung (bei schmalen Säulen ausgedünnt)
            if ((values.lastIndex - k) % valueStride == 0) text(fmtShort(v) + unit, cx, bottom - h - 3, 8.5f, t.onSurface, 1, Paint.Align.CENTER)
            if ((values.lastIndex - k) % stride == 0) text(label, cx, r.bottom - 1, 8f, t.muted, 0, Paint.Align.CENTER)
        }
    }

    private fun fmtShort(v: Double) = if (v == Math.floor(v)) v.toLong().toString() else String.format(Locale.GERMANY, "%.1f", v)

    companion object {
        fun fmt(v: Double?, digits: Int = 1): String = if (v == null || v.isNaN()) "–" else String.format(Locale.GERMANY, "%.${digits}f", v)
    }
}
