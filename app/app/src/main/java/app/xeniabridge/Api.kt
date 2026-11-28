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
        /** Vollständige Antwort von /api/widget (Bezüge, Verlauf, laufender Bezug …); im Direkt-Modus null */
        val raw: org.json.JSONObject? = null,
    ) {
        /** Eingeschaltet im Sinne von „nicht Aus/Eco“ (an, Bezug, Nachlauf, Paddle, Störung). */
        val isOn: Boolean get() = online && status != null && status != "off" && status != "eco"
        val isEco: Boolean get() = online && status == "eco"
        val isOff: Boolean get() = online && status == "off"
    }

    fun request(context: Context, method: String, path: String, body: JSONObject? = null): JSONObject {
        val prefs = Prefs(context)
        val token = prefs.token ?: throw ApiException(401, context.getString(R.string.api_error_not_logged_in))
        val base = activeBase(context)
        return try {
            call(context, base, method, path, body, token)
        } catch (e: IOException) {
            // Netzwechsel (WLAN ↔ mobil): einmal mit der anderen Adresse versuchen
            if (e is ApiException || prefs.bases.size < 2) throw e
            val other = activeBase(context, fresh = true)
            if (other == base) throw e
            call(context, other, method, path, body, token)
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
        if (local == null) return remote ?: throw ApiException(0, context.getString(R.string.api_error_not_configured))
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
        LocalTls.prepare(conn)
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

    fun call(context: Context, base: String, method: String, path: String, body: JSONObject?, token: String?): JSONObject {
        val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        LocalTls.prepare(conn)
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
                        301, 302, 303, 307, 308 -> context.getString(R.string.api_error_redirect)
                        else -> context.getString(R.string.api_error_http, code)
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
        // Notbetrieb nur, wenn die Maschine im Heimnetz wirklich antwortet. Sonst (kein Netz nach dem Aufwachen,
        // unterwegs) weiß die App nichts über die Maschine: den Fehler melden statt „Offline“ vorzutäuschen.
        return serverOrDirect(context, { serverState(context) }) { e ->
            (try { DirectMachine.state(context) } catch (_: IOException) { null })?.takeIf { it.online } ?: throw e
        }
    }

    private fun serverState(context: Context): State {
        val o = request(context, "GET", "/api/widget")
        // Maschinen-IP merken: damit geht es auch, wenn der Server einmal ausfällt
        o.optJSONObject("machine")?.let { m ->
            val prefs = Prefs(context)
            prefs.machineIp = m.optString("ip").ifBlank { null }
            prefs.machineApi = m.optString("api", "bbs")
        }
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
            raw = o,
        )
    }

    /** Dampfkessel ein/aus (nur mit Server) */
    fun steam(context: Context, on: Boolean) {
        request(context, "POST", "/api/machine/steam", JSONObject().put("on", on))
    }

    /** Laufendes Skript bzw. laufenden Bezug stoppen (nur mit Server) */
    fun stopScript(context: Context) {
        request(context, "POST", "/api/machine/scripts/stop", JSONObject())
    }

    /** Sollwert setzen, z. B. BG_SET_TEMP (nur mit Server) */
    fun setTarget(context: Context, key: String, value: Double) {
        request(context, "POST", "/api/machine/settings", JSONObject().put("changes", JSONObject().put(key, value)))
    }

    /** mode: "on" | "off" | "eco" | "on_nosteam" (ein, nur Brühkessel – ohne Dampfkessel) */
    fun power(context: Context, mode0: String) {
        // „Ein“ wie in der App: mit der Einstellung „Ohne Dampf einschalten“ ohne Dampfkessel
        val mode = if (mode0 == "on" && Prefs(context).noSteamOn) MODE_ON_NO_STEAM else mode0
        if (Prefs(context).direct) return DirectMachine.power(context, mode)
        val body = if (mode == MODE_ON_NO_STEAM) JSONObject().put("mode", "on").put("steam", false) else JSONObject().put("mode", mode)
        serverOrDirect(context, { request(context, "POST", "/api/machine/power", body); Unit }) { DirectMachine.power(context, mode) }
    }

    /** Einschalten ohne Dampfkessel (Widget-Knopf „o. Dampf“) */
    const val MODE_ON_NO_STEAM = "on_nosteam"

    /** Server nicht erreichbar (oder Cloudflare meldet ihn als down)? Dann die Maschine direkt im Heimnetz ansprechen. */
    private fun <T> serverOrDirect(context: Context, server: () -> T, direct: (IOException) -> T): T = try {
        server()
    } catch (e: IOException) {
        val down = e !is ApiException || e.status in SERVER_DOWN
        if (!down || Prefs(context).machineIp.isNullOrBlank()) throw e
        direct(e)
    }

    /** HTTP-Status, mit denen Cloudflare oder ein Proxy einen ausgefallenen Server meldet. */
    val SERVER_DOWN = setOf(502, 503, 504, 521, 522, 523, 530)

    /** Ein/Aus umschalten: Aus oder Eco → Ein, sonst → Aus. Gibt den gesendeten Modus zurück. */
    /** noSteam: immer ohne Dampfkessel einschalten (Widget „Ein ohne Dampf/Aus“) */
    fun toggle(context: Context, noSteam: Boolean = false): String {
        val s = state(context)
        if (!s.online) throw ApiException(502, context.getString(R.string.api_error_machine_unreachable))
        if (s.shot) throw ApiException(409, context.getString(R.string.api_error_shot_running))
        val mode = if (s.isOn) "off" else if (noSteam) MODE_ON_NO_STEAM else "on"
        power(context, mode)
        return mode
    }

    /** Neue Geräte-Anmeldung. Liefert Token und Cookie-Namen für die WebView. */
    fun registerDevice(context: Context, base: String, password: String, name: String): Pair<String, String> {
        val r = call(context, base, "POST", "/auth/device", JSONObject().put("password", password).put("name", name), null)
        val token = r.optString("token")
        if (token.isBlank()) throw ApiException(500, context.getString(R.string.api_error_no_token))
        return token to r.optString("cookie", "__Host-xs")
    }

    fun logout(context: Context, base: String, token: String) {
        try { call(context, base, "POST", "/auth/logout", null, token) } catch (_: Exception) { }
    }

    fun message(context: Context, e: Throwable): String = when (e) {
        is ApiException -> e.message ?: context.getString(R.string.error_generic)
        is java.net.UnknownHostException -> context.getString(R.string.api_error_unknown_host)
        is java.net.SocketTimeoutException -> context.getString(R.string.api_error_timeout)
        is javax.net.ssl.SSLException -> context.getString(R.string.api_error_tls)
        is java.net.ConnectException -> context.getString(R.string.api_error_no_connection, e.message ?: context.getString(R.string.api_error_refused))
        else -> e.message ?: e.javaClass.simpleName
    }
}

object BuildConfigInfo {
    const val VERSION = "1.0"
}
