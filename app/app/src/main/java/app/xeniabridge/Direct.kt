package app.xeniabridge

import android.content.Context
import android.net.ConnectivityManager
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * HTTP zu Maschine und Mühle im Heimnetz (Direkt-Modus). Die Mühle hat ein selbstsigniertes Zertifikat:
 * Beim ersten Kontakt wird es angenommen und sein SHA-256-Fingerprint zurückgegeben; die Web-App merkt ihn sich.
 * Danach schickt sie den Fingerprint als "pin" mit, und jedes andere Zertifikat scheitert schon im TLS-Handshake –
 * bevor Cookie oder Passwort gesendet werden (wie der Server).
 */
object DirectHttp {
    private const val MAX_BODY = 20 * 1024 * 1024

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** pin = null: jedes Zertifikat (erster Kontakt); sonst nur genau dieses. */
    private fun tlsContext(pin: String?): SSLContext = SSLContext.getInstance("TLS").apply {
        init(null, arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (pin.isNullOrEmpty()) return
                val fp = chain.firstOrNull()?.let { sha256Hex(it.encoded) }
                if (!pin.equals(fp, ignoreCase = true)) throw java.security.cert.CertificateException("Zertifikat passt nicht zum gemerkten Fingerprint")
            }
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }), SecureRandom())
    }

    private val trustFirst: SSLContext by lazy { tlsContext(null) }
    private var pinned: Pair<String, SSLContext>? = null

    @Synchronized
    private fun contextFor(pin: String?): SSLContext {
        if (pin.isNullOrEmpty()) return trustFirst
        pinned?.let { if (it.first == pin) return it.second }
        return tlsContext(pin).also { pinned = pin to it }
    }

    /** req: {method, url, headers, body(base64)|null, timeoutMs, insecureTls, pin?} → {status, headers, body(base64), fingerprint} */
    fun request(req: JSONObject, allowedHosts: Set<String>): JSONObject {
        val url = URL(req.getString("url"))
        if (url.protocol != "http" && url.protocol != "https") throw IllegalArgumentException("Nur http/https")
        if (url.host !in allowedHosts) throw IllegalArgumentException("Adresse ${url.host} ist nicht freigegeben")
        val conn = url.openConnection() as HttpURLConnection
        try {
            if (conn is HttpsURLConnection && req.optBoolean("insecureTls")) {
                val pin = if (req.isNull("pin")) null else req.optString("pin", "")
                conn.sslSocketFactory = contextFor(pin).socketFactory
                conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
            }
            val timeout = req.optInt("timeoutMs", 8000)
            conn.connectTimeout = timeout
            conn.readTimeout = timeout
            conn.instanceFollowRedirects = false
            conn.requestMethod = req.optString("method", "GET")
            val headers = req.optJSONObject("headers")
            headers?.keys()?.forEach { k ->
                if (!k.equals("Content-Length", true) && !k.equals("Host", true)) conn.setRequestProperty(k, headers.getString(k))
            }
            val body = if (req.isNull("body")) null else Base64.decode(req.getString("body"), Base64.DEFAULT)
            if (body != null) {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            val status = conn.responseCode
            var fingerprint: String? = null
            if (conn is HttpsURLConnection) {
                val cert = conn.serverCertificates.firstOrNull()
                if (cert != null) fingerprint = sha256Hex(cert.encoded)
            }
            val outHeaders = JSONObject()
            for ((k, v) in conn.headerFields) if (k != null) outHeaders.put(k.lowercase(), JSONArray(v))
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val bytes = ByteArrayOutputStream()
            stream?.use { s ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    bytes.write(buf, 0, n)
                    if (bytes.size() > MAX_BODY) throw IllegalStateException("Antwort zu groß")
                }
            }
            return JSONObject()
                .put("status", status)
                .put("headers", outHeaders)
                .put("body", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                .put("fingerprint", fingerprint ?: JSONObject.NULL)
        } finally {
            conn.disconnect()
        }
    }

    /** Einfache Anfrage für Widgets und die Netzwerksuche. */
    fun text(url: String, method: String = "GET", body: String? = null, timeoutMs: Int = 4000, insecureTls: Boolean = false): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            if (conn is HttpsURLConnection && insecureTls) {
                conn.sslSocketFactory = trustFirst.socketFactory
                conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
            }
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.requestMethod = method
            conn.setRequestProperty("X-Requested-With", "XMLHttpRequest")
            if (body != null) {
                // wie die Original-Oberfläche: JSON-Text mit Formular-Content-Type
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            val text = (if (code >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to text
        } finally {
            conn.disconnect()
        }
    }
}

/** Maschine direkt (für Widgets, Kachel und Shortcuts im Direkt-Modus). Gleiche Berechnung wie public/shared/machine-core.js. */
object DirectMachine {
    private fun base(context: Context): String = "http://" + (Prefs(context).machineIp ?: throw Api.ApiException(0, "Keine Maschinen-IP eingerichtet"))

    private fun get(context: Context, path: String): JSONObject {
        val (code, text) = try {
            DirectHttp.text(base(context) + path)
        } catch (e: Api.ApiException) {
            throw e
        } catch (e: Exception) {
            throw Api.ApiException(502, "Maschine nicht erreichbar (nur im Heimnetz)")
        }
        if (code != 200) throw Api.ApiException(code, "Maschine antwortet HTTP $code")
        return try { JSONObject(text) } catch (_: Exception) { throw Api.ApiException(502, "Unerwartete Antwort der Maschine") }
    }

    private fun post(context: Context, path: String, body: JSONObject) {
        val (code, _) = try {
            DirectHttp.text(base(context) + path, "POST", body.toString())
        } catch (e: Exception) {
            throw Api.ApiException(502, "Maschine nicht erreichbar (nur im Heimnetz)")
        }
        if (code != 200) throw Api.ApiException(code, "Maschine antwortet HTTP $code")
    }

    private fun JSONObject.num(k: String): Double? = if (!has(k) || isNull(k)) null else optString(k).toDoubleOrNull()

    fun state(context: Context): Api.State {
        val d = try { get(context, "/api/v2/diagram/get") } catch (e: Api.ApiException) {
            if (e.status == 0) throw e
            return Api.State(false, null, null, false, false, false, true, null, null, null, false)
        }
        val single = get(context, "/api/v2/overview_single")
        val general = get(context, "/api/v2/general")
        val status = d.num("MA_STATUS")?.toInt()
        val key = when (status) { 0 -> "off"; 1 -> "on"; 2 -> "eco"; 3 -> "brewing"; 4 -> "draining"; 5 -> "paddle"; 6 -> "fault"; else -> "unknown" }
        fun temp(raw: Double?, offset: Double?): Double? = raw?.let { if (it > 40) it - (offset ?: 0.0) else it }
        val group = temp(d.num("BG_SENS_TEMP_A"), general.num("BG_TEMPERATURE_OFFSET"))
        val groupSet = single.num("BG_SET_TEMP") ?: general.num("BG_SET_TEMP")
        val on = status == 1 || status == 3 || status == 4
        val steamOn = d.num("SB_STATUS")?.toInt() == 2
        val steam = d.num("SB_SENS_PRESS")
        val steamSet = single.num("SB_SET_PRESS") ?: general.num("SB_SET_PRESS")
        return Api.State(
            online = true,
            status = key,
            label = null,
            heated = on && group != null && groupSet != null && group >= groupSet - 0.8,
            steamOn = steamOn,
            steamReady = on && steamOn && steam != null && steamSet != null && steam >= steamSet - 0.1,
            tankOk = single.num("PU_SENS_WATER_TANK_LEVEL")?.toInt() != 0,
            group = group,
            groupSet = groupSet,
            steam = steam,
            shot = status == 3,
            boiler = temp(d.num("BB_SENS_TEMP_A"), general.num("BB_TEMPERATURE_OFFSET")),
            boilerSet = single.num("BB_SET_TEMP") ?: general.num("BB_SET_TEMP"),
            steamSet = steamSet,
        )
    }

    /** Wie die Original-Oberfläche: Maschine schalten und den Dampfkessel passend mitschalten. */
    fun power(context: Context, mode: String) {
        val action = when (mode) { "off" -> "0"; "on" -> "1"; "eco" -> "2"; else -> throw Api.ApiException(400, "Ungültiger Modus") }
        post(context, "/api/v2/machine/control", JSONObject().put("action", action))
        val steam = when (mode) {
            "on" -> if (get(context, "/api/v2/general").num("MA_BOILER_START_MODE")?.toInt() == 2) 0 else 1
            else -> 0
        }
        post(context, "/api/v2/toggle/sb", JSONObject().put("TOGGLE", steam))
    }
}

/** Sucht Maschine und Mühle im WLAN des Handys (nur das eigene /24-Netz). */
object NetworkScan {
    data class Found(val ip: String, val kind: String, val name: String)

    fun ownSubnet(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val lp = cm.getLinkProperties(cm.activeNetwork) ?: return null
        val addr = lp.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && !it.isLoopbackAddress } ?: return null
        val parts = addr.hostAddress?.split('.') ?: return null
        if (parts.size != 4) return null
        return parts.take(3).joinToString(".")
    }

    fun scan(context: Context): List<Found> {
        val subnet = ownSubnet(context) ?: return emptyList()
        val pool = Executors.newFixedThreadPool(32)
        val found = java.util.Collections.synchronizedList(mutableListOf<Found>())
        for (i in 1..254) {
            val ip = "$subnet.$i"
            pool.execute {
                try {
                    val (code, text) = DirectHttp.text("http://$ip/api/v2/machine", timeoutMs = 900)
                    if (code == 200 && text.contains("MA_TYPE")) {
                        val type = JSONObject(text).optInt("MA_TYPE")
                        found += Found(ip, "machine", when (type) { 1 -> "Xenia 2K"; 2 -> "Xenia Dual Boiler"; 3 -> "Xenia Brew-by-Sync"; 4 -> "Xenia 303"; 5 -> "Xenia 2K + L"; else -> "Xenia" })
                        return@execute
                    }
                } catch (_: Exception) { }
                try {
                    val (code, text) = DirectHttp.text("https://$ip/rest_api/get_machine_info", "POST", "", timeoutMs = 1200, insecureTls = true)
                    if (code == 200 && text.contains("grinderType")) {
                        found += Found(ip, "grinder", JSONObject(text).optString("grinderTypeName", "Mühle").ifBlank { "Mühle" })
                    }
                } catch (_: Exception) { }
            }
        }
        pool.shutdown()
        pool.awaitTermination(60, TimeUnit.SECONDS)
        return found.sortedBy { it.ip.substringAfterLast('.').toInt() }
    }
}
