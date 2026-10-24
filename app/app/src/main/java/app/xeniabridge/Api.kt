package app.xeniabridge

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Aufrufe an den Xenios-Server (gleiche API wie die Web-App, Anmeldung per Bearer-Token). */
object Api {
    class ApiException(val status: Int, message: String) : IOException(message)

    data class State(
        val online: Boolean,
        val status: String?,
        val label: String?,
        val heated: Boolean,
        val steamOn: Boolean,
        val steamReady: Boolean,
        val tankOk: Boolean,
        val group: Double?,
        val groupSet: Double?,
        val steam: Double?,
        val shot: Boolean,
        val boiler: Double? = null,
        val boilerSet: Double? = null,
        val steamSet: Double? = null,
        /** Nächstes geplantes Einschalten (Wecker oder Server-Zeitplan) in ms, mit Grund. */
        val nextAt: Long? = null,
        val nextReason: String? = null,
    ) {
        /** Eingeschaltet im Sinne von „nicht Aus/Eco“ (an, Bezug, Nachlauf, Paddle, Störung). */
        val isOn: Boolean get() = online && status != null && status != "off" && status != "eco"
        val isEco: Boolean get() = online && status == "eco"
        val isOff: Boolean get() = online && status == "off"
    }

    fun request(context: Context, method: String, path: String, body: JSONObject? = null): JSONObject {
        val prefs = Prefs(context)
        val token = prefs.token ?: throw ApiException(401, "Nicht angemeldet")
        val base = activeBase(context)
        return try {
            call(base, method, path, body, token)
        } catch (e: IOException) {
            // Netzwechsel (WLAN ↔ mobil): einmal mit der anderen Adresse versuchen
            if (e is ApiException || prefs.bases.size < 2) throw e
            val other = activeBase(context, fresh = true)
            if (other == base) throw e
            call(other, method, path, body, token)
        }
    }

    @Volatile private var chosen: Pair<String, Long>? = null

    /**
     * Lokale Adresse, wenn sie gerade erreichbar ist (im WLAN), sonst die Cloudflare-Adresse.
     * Ergebnis gilt 2 min, damit nicht jeder Aufruf erst prüft.
     */
    fun activeBase(context: Context, fresh: Boolean = false): String {
        val prefs = Prefs(context)
        val local = prefs.localUrl?.takeIf { it.isNotBlank() }
        val remote = prefs.baseUrl?.takeIf { it.isNotBlank() }
        if (local == null) return remote ?: throw ApiException(0, "Nicht eingerichtet")
        if (remote == null) return local
        val c = chosen
        if (!fresh && c != null && System.currentTimeMillis() < c.second && (c.first == local || c.first == remote)) return c.first
        val pick = if (reachable(local)) local else remote
        chosen = pick to System.currentTimeMillis() + 120_000
        return pick
    }

    fun forgetChoice() {
        chosen = null
    }

    private fun reachable(base: String): Boolean = try {
        val conn = URL(base.trimEnd('/') + "/healthz").openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 1200
            conn.readTimeout = 1500
            conn.responseCode == 200
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        false
    }

    fun call(base: String, method: String, path: String, body: JSONObject?, token: String?): JSONObject {
        val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 6000
            conn.readTimeout = 8000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "XeniaApp/${BuildConfigInfo.VERSION}")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (method != "GET") {
                // Wie die Web-App: eigener Header als CSRF-Schutz
                conn.setRequestProperty("X-Xenia", "1")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write((body ?: JSONObject()).toString().toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
            if (code !in 200..299) {
                val msg = json.optString("error").ifBlank {
                    when (code) {
                        301, 302, 303, 307, 308 -> "Weiterleitung – evtl. Cloudflare Access aktiv? Die App braucht direkten Zugang."
                        else -> "Fehler $code"
                    }
                }
                throw ApiException(code, msg)
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    fun state(context: Context): State {
        if (Prefs(context).direct) return DirectMachine.state(context)
        val o = request(context, "GET", "/api/widget")
        fun dbl(k: String): Double? = if (o.isNull(k) || !o.has(k)) null else o.optDouble(k).takeIf { !it.isNaN() }
        return State(
            online = o.optBoolean("online"),
            status = if (o.isNull("status")) null else o.optString("status"),
            label = if (o.isNull("label")) null else o.optString("label"),
            heated = o.optBoolean("heated"),
            steamOn = o.optBoolean("steamOn"),
            steamReady = o.optBoolean("steamReady"),
            tankOk = o.optBoolean("tankOk", true),
            group = dbl("group"),
            groupSet = dbl("groupSet"),
            steam = dbl("steam"),
            shot = o.optBoolean("shot"),
            boiler = dbl("boiler"),
            boilerSet = dbl("boilerSet"),
            steamSet = dbl("steamSet"),
            nextAt = o.optJSONObject("next")?.optLong("at")?.takeIf { it > 0 },
            nextReason = o.optJSONObject("next")?.optString("reason"),
        )
    }

    /** mode: "on" | "off" | "eco" */
    fun power(context: Context, mode: String) {
        if (Prefs(context).direct) return DirectMachine.power(context, mode)
        request(context, "POST", "/api/machine/power", JSONObject().put("mode", mode))
    }

    /** Ein/Aus umschalten: Aus oder Eco → Ein, sonst → Aus. Gibt den gesendeten Modus zurück. */
    fun toggle(context: Context): String {
        val s = state(context)
        if (!s.online) throw ApiException(502, "Maschine nicht erreichbar")
        if (s.shot) throw ApiException(409, "Bezug läuft – bitte an der Maschine stoppen")
        val mode = if (s.isOn) "off" else "on"
        power(context, mode)
        return mode
    }

    /** Neue Geräte-Anmeldung. Liefert Token und Cookie-Namen für die WebView. */
    fun registerDevice(base: String, password: String, name: String): Pair<String, String> {
        val r = call(base, "POST", "/auth/device", JSONObject().put("password", password).put("name", name), null)
        val token = r.optString("token")
        if (token.isBlank()) throw ApiException(500, "Server liefert kein Token – Xenios aktualisieren?")
        return token to r.optString("cookie", "__Host-xs")
    }

    fun logout(base: String, token: String) {
        try { call(base, "POST", "/auth/logout", null, token) } catch (_: Exception) { }
    }

    fun message(e: Throwable): String = when (e) {
        is ApiException -> e.message ?: "Fehler"
        is java.net.UnknownHostException -> "Server nicht gefunden"
        is java.net.SocketTimeoutException -> "Zeitüberschreitung"
        is javax.net.ssl.SSLException -> "TLS-Fehler (gültiges Zertifikat nötig, z. B. Cloudflare)"
        else -> e.message ?: e.javaClass.simpleName
    }
}

object BuildConfigInfo {
    const val VERSION = "1.0"
}
