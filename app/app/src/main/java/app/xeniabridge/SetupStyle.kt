package app.xeniabridge

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.TextView

/**
 * Einrichtungs-Bildschirm im Design der App (wie Anmeldung und Einrichtung der Web-App): Farben, Schrift, Knöpfe und
 * Eingabefelder aus dem zuletzt gemeldeten Design (Material oder Xenia, hell/dunkel, eigene Akzentfarbe); beim ersten
 * Start Material. Knöpfe wie .btn.filled bzw. .btn.tonal, Felder wie .field in app.css.
 */
object SetupStyle {
    fun apply(a: Activity, root: View) {
        val t = WidgetTheme.load(a)
        val d = a.resources.displayMetrics.density
        fun dp(v: Float) = v * d
        val regular = font(a, t, R.font.open_sans_regular, Typeface.create("sans-serif", Typeface.NORMAL))
        val medium = font(a, t, R.font.open_sans_semibold, Typeface.create("sans-serif-medium", Typeface.NORMAL))

        root.setBackgroundColor(t.surface)
        bars(a, t)

        val primaryButtons = setOf(R.id.connect)
        val tonalButtons = setOf(R.id.scan, R.id.help, R.id.scan_server, R.id.help_server)
        walk(root) { v ->
            when (v) {
                // RadioButton ist auch ein Button: zuerst prüfen
                is RadioButton -> {
                    v.typeface = regular
                    v.setTextColor(t.onSurface)
                    v.buttonTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(t.primary, t.outline))
                }
                is Button -> when (v.id) {
                    in primaryButtons -> button(v, t, medium, d, filled = true)
                    in tonalButtons -> button(v, t, medium, d, filled = false)
                }
                is EditText -> field(v, t, regular, d)
                is TextView -> when (v.id) {
                    R.id.setup_heading -> {
                        // wie .setup-card h1: 26 px, mittlere Stärke (Xenia: Open Sans normal)
                        v.typeface = if (t.xenia) regular else medium
                        v.setTextColor(t.onSurface)
                        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
                    }
                    R.id.error -> { v.typeface = regular; v.setTextColor(t.danger) }
                    else -> {
                        v.typeface = regular
                        if (v.alpha < 1f) {
                            // Erklärtexte und Hinweise: gedämpfte Schrift statt Transparenz
                            v.alpha = 1f
                            v.setTextColor(t.muted)
                            // Hinweis unter einem Feld: bündig mit der Beschriftung darüber
                            if (v.tag == "hint") v.setPaddingRelative(dp(4f).toInt(), 0, 0, 0)
                        } else if (v.tag == "label") {
                            // Beschriftung über einem Feld wie .field > span: 12 px, gedämpft
                            v.setTextColor(t.muted)
                            v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                            v.setPaddingRelative(dp(4f).toInt(), 0, 0, dp(4f).toInt())
                        } else v.setTextColor(t.onSurface)
                    }
                }
                is ProgressBar -> {
                    v.progressTintList = ColorStateList.valueOf(t.primary)
                    v.progressBackgroundTintList = ColorStateList.valueOf(t.highest)
                    v.indeterminateTintList = ColorStateList.valueOf(t.primary)
                }
            }
        }
    }

    private fun font(a: Activity, t: WidgetTheme, id: Int, material: Typeface): Typeface =
        if (t.xenia) runCatching { a.resources.getFont(id) }.getOrDefault(material) else material

    private fun walk(v: View, f: (View) -> Unit) {
        f(v)
        if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i), f)
    }

    private fun alpha(c: Int, a: Float) = Color.argb((Color.alpha(c) * a).toInt(), Color.red(c), Color.green(c), Color.blue(c))
    private fun states(enabled: Int, disabled: Int) =
        ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(disabled, enabled))

    /** .btn.filled (Akzentfarbe) bzw. .btn.tonal (Material: Fläche secondary-container; Xenia: Rand in der Akzentfarbe) */
    private fun button(b: Button, t: WidgetTheme, font: Typeface, d: Float, filled: Boolean) {
        val radius = if (t.xenia) 2f * d else 20f * d
        val bg = GradientDrawable().apply { cornerRadius = radius }
        val fg: Int
        if (filled) {
            bg.setColor(states(t.primary, alpha(t.onSurface, 0.12f)))
            fg = t.onPrimary
        } else if (t.xenia) {
            bg.setColor(Color.TRANSPARENT)
            bg.setStroke((1f * d).toInt().coerceAtLeast(1), states(t.primary, alpha(t.onSurface, 0.12f)))
            fg = t.onSurface
        } else {
            bg.setColor(states(t.secondaryContainer, alpha(t.onSurface, 0.12f)))
            fg = t.onSecondaryContainer
        }
        val mask = GradientDrawable().apply { cornerRadius = radius; setColor(Color.WHITE) }
        b.background = RippleDrawable(ColorStateList.valueOf(alpha(fg, 0.16f)), bg, mask)
        b.stateListAnimator = null // kein Schatten wie bei den Android-Standardknöpfen
        b.isAllCaps = false
        b.typeface = font
        b.letterSpacing = 0.007f
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        // eine Zeile; passt der Text nicht (schmale Handys, z. B. „IP finden – Anleitung“), wird die Schrift kleiner
        // statt umzubrechen (der Knopf würde sonst abgeschnitten und aus der Reihe rutschen)
        b.maxLines = 1
        b.setAutoSizeTextTypeUniformWithConfiguration(10, 14, 1, TypedValue.COMPLEX_UNIT_SP)
        b.setTextColor(states(fg, alpha(t.onSurface, 0.38f)))
        b.minHeight = (40 * d).toInt()
        b.minimumHeight = (40 * d).toInt()
        // feste Höhe wie .btn (40 px): die automatische Schriftgröße arbeitet nur mit fester Höhe zuverlässig
        b.layoutParams?.let { lp -> lp.height = (40 * d).toInt(); b.layoutParams = lp }
        b.setPadding((16 * d).toInt(), 0, (16 * d).toInt(), 0)
    }

    /** .field input: 48 px hoch, Rand outline, beim Tippen 2 px in der Akzentfarbe */
    private fun field(e: EditText, t: WidgetTheme, font: Typeface, d: Float) {
        fun box(stroke: Int, w: Float) = GradientDrawable().apply {
            cornerRadius = 8f * d
            setColor(Color.TRANSPARENT)
            setStroke((w * d).toInt().coerceAtLeast(1), stroke)
        }
        e.background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), box(t.primary, 2f))
            addState(intArrayOf(), box(t.outline, 1f))
        }
        e.typeface = font
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        e.setTextColor(t.onSurface)
        e.setHintTextColor(alpha(t.muted, 0.7f))
        e.highlightColor = alpha(t.primary, 0.3f)
        e.minHeight = (48 * d).toInt()
        e.setPadding((14 * d).toInt(), (10 * d).toInt(), (14 * d).toInt(), (10 * d).toInt())
        e.textCursorDrawable?.setTint(t.primary)
    }

    /** Leisten in der Seitenfarbe, Symbole dunkel auf hell bzw. hell auf dunkel */
    private fun bars(a: Activity, t: WidgetTheme) {
        val w = a.window
        w.isNavigationBarContrastEnforced = false
        w.isStatusBarContrastEnforced = false
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            w.statusBarColor = t.surface
            @Suppress("DEPRECATION")
            w.navigationBarColor = t.surface
        }
        val light = Color.luminance(t.surface) > 0.5f
        val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        w.insetsController?.setSystemBarsAppearance(if (light) mask else 0, mask)
    }
}
