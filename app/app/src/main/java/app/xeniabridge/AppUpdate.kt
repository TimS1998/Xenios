package app.xeniabridge

import android.app.Activity
import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * App-Update aus den GitHub-Releases: Das neueste Release liefert je Variante eine APK, `Xenios-<Build>.apk` (mit
 * Updater) und `Xenios-<Build>-ohne-Updater.apk`. Ist die Build-Nummer höher als die installierte, übernimmt der
 * [Installer] der Variante: Mit Updater lädt und installiert die App selbst, ohne Updater öffnet sie den Download im
 * Browser (siehe docs/Android-App.md, „App-Update“).
 */
object AppUpdate {
    private const val REPO = "TimS1998/Xenios"
    private const val LATEST_URL = "https://api.github.com/repos/$REPO/releases/latest"
    /** Nur Assets aus den Releases dieses Repos */
    private const val DOWNLOAD_PREFIX = "https://github.com/$REPO/releases/download/"
    /** APK der eigenen Variante */
    private val ASSET = Regex("""Xenios-(\d+)""" + Regex.escape(Installer.ASSET_SUFFIX) + """\.apk""")
    private val SHA256 = Regex("[0-9a-f]{64}")
    internal val UA = "Xenios-App/${BuildConfig.VERSION_CODE} (+https://github.com/$REPO)"
    private const val DAY = 24 * 3600_000L
    private const val HOUR = 3600_000L

    /** Neuestes Release mit APK dieser Variante, wie es GitHub meldet. */
    internal class Release(val build: Long, val tag: String, val url: String, val size: Long, val sha256: String?) {
        /** Wie versionName der App: „2.5.0 (412)“ */
        val label: String get() = "${tag.removePrefix("v")} ($build)"
        val newer: Boolean get() = build > BuildConfig.VERSION_CODE
        fun toJson(): String = JSONObject().put("build", build).put("tag", tag).put("url", url).put("size", size)
            .put("sha256", sha256 ?: JSONObject.NULL).toString()
    }

    private fun parse(json: String?): Release? = try {
        json?.let { JSONObject(it) }?.let { Release(it.getLong("build"), it.getString("tag"), it.getString("url"), it.getLong("size"), it.optString("sha256").takeIf { s -> SHA256.matches(s) }) }
    } catch (_: Exception) {
        null
    }

    // Laufender Vorgang, nur im Speicher: "" (nichts), "checking", "downloading", "installing"
    @Volatile private var phase = ""
    @Volatile private var progress = 0
    @Volatile private var error: String? = null
    /** Letzter automatischer Versuch (auch erfolglos), damit offline nicht bei jedem Öffnen erneut gefragt wird */
    @Volatile private var lastTry = 0L
    /** Netz und Dateien nacheinander, nie im UI-Thread */
    internal val worker = Executors.newSingleThreadExecutor()

    /** Meldet Änderungen an die offene App (MainActivity), damit die Einstellungen neu zeichnen. */
    @Volatile var onChange: (() -> Unit)? = null
    private fun changed() = onChange?.invoke()

    /** Für den Installer: neuer Abschnitt (Fortschritt auf 0) bzw. Ende ("") mit optionalem Fehler. */
    internal fun report(phase: String, error: String? = null) {
        this.phase = phase
        this.progress = 0
        this.error = error
        changed()
    }

    internal fun progress(percent: Int) {
        if (percent == progress) return
        progress = percent
        changed()
    }

    /** Stand für die Web-Oberfläche (JSON). */
    fun state(context: Context): String {
        val prefs = Prefs(context)
        val latest = parse(prefs.updateRelease)
        return JSONObject()
            .put("installed", BuildConfig.VERSION_NAME)
            .put("installedBuild", BuildConfig.VERSION_CODE)
            .put("latest", latest?.label ?: JSONObject.NULL)
            .put("latestBuild", latest?.build ?: 0L)
            .put("available", latest?.newer == true)
            .put("announced", prefs.updateAnnounced)
            .put("checkedAt", prefs.updateCheckedAt)
            .put("phase", phase)
            .put("progress", progress)
            .put("error", error ?: JSONObject.NULL)
            // false: Variante ohne Updater, „Herunterladen“ öffnet den Browser
            .put("selfInstall", Installer.SELF_INSTALL)
            .put("allowed", Installer.allowed(context))
            .toString()
    }

    /** Beim Öffnen der App: Installer fortsetzen (Erlaubnis, Bestätigung), höchstens einmal am Tag von selbst prüfen. */
    fun resume(activity: Activity) {
        Installer.resume(activity)
        changed() // die Erlaubnis kann sich in den Android-Einstellungen geändert haben
        val now = System.currentTimeMillis()
        if (now - Prefs(activity).updateCheckedAt >= DAY && now - lastTry >= HOUR) check(activity, manual = false)
    }

    /** Neuestes Release abfragen. Automatisch still (offline, Rate-Limit); auf Knopfdruck mit Grund in der Oberfläche. */
    @Synchronized
    fun check(context: Context, manual: Boolean) {
        if (phase.isNotEmpty()) return
        val app = context.applicationContext
        lastTry = System.currentTimeMillis()
        if (manual) report("checking")
        worker.execute {
            try {
                val latest = fetchLatest(app)
                val prefs = Prefs(app)
                prefs.updateRelease = latest?.toJson()
                prefs.updateCheckedAt = System.currentTimeMillis()
                if (latest?.newer != true) Installer.discard(app)
                if (manual) error = null
            } catch (e: Exception) {
                if (manual) error = message(app, e)
            } finally {
                if (manual) phase = ""
                changed()
            }
        }
    }

    private fun fetchLatest(context: Context): Release? {
        val conn = URL(LATEST_URL).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8000
            conn.readTimeout = 10_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", UA)
            when (val code = conn.responseCode) {
                200 -> Unit
                404 -> return null // noch kein Release
                403, 429 -> throw IOException(context.getString(R.string.update_error_rate_limited))
                else -> throw IOException(context.getString(R.string.update_error_http, code))
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val build = ASSET.matchEntire(a.optString("name"))?.groupValues?.get(1)?.toLongOrNull() ?: continue
                val url = a.optString("browser_download_url")
                if (!url.startsWith(DOWNLOAD_PREFIX, ignoreCase = true) || url.contains("..")) continue
                // GitHub nennt die SHA-256 der Datei („sha256:…“); fehlt sie, bleibt die Prüfung der Signatur
                val sha = a.optString("digest").removePrefix("sha256:").takeIf { SHA256.matches(it) }
                return Release(build, json.optString("tag_name"), url, a.optLong("size"), sha)
            }
            return null
        } finally {
            conn.disconnect()
        }
    }

    /** Neue Version holen: je nach Variante selbst installieren oder den Download im Browser öffnen. */
    @Synchronized
    fun install(activity: Activity) {
        if (phase.isNotEmpty()) return
        val release = parse(Prefs(activity).updateRelease)?.takeIf { it.newer } ?: return
        Installer.start(activity, release)
    }

    internal fun message(context: Context, e: Exception): String = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException, is java.net.SocketTimeoutException -> context.getString(R.string.update_error_no_connection)
        else -> e.message ?: e.javaClass.simpleName
    }
}
