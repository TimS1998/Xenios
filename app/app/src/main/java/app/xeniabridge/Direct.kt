package app.xeniabridge

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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

    fun sha256Hex(bytes: ByteArray): String =
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
    fun contextFor(pin: String?): SSLContext {
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

    /** Zertifikat einer https-Adresse im Heimnetz lesen (erster Kontakt, noch ohne Pin). */
    fun fingerprint(base: String): String? {
        val conn = URL(base.trimEnd('/') + "/healthz").openConnection() as? HttpsURLConnection ?: return null
        try {
            conn.sslSocketFactory = contextFor(null).socketFactory
            conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            conn.connect()
            val cert = conn.serverCertificates.firstOrNull() ?: return null
            return sha256Hex(cert.encoded)
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
    private fun base(context: Context): String = "http://" + (Prefs(context).machineIp ?: throw Api.ApiException(0, context.getString(R.string.direct_error_no_machine_ip)))

    private fun get(context: Context, path: String): JSONObject {
        val (code, text) = try {
            DirectHttp.text(base(context) + path)
        } catch (e: Api.ApiException) {
            throw e
        } catch (e: Exception) {
            throw Api.ApiException(502, context.getString(R.string.direct_error_machine_unreachable))
        }
        if (code != 200) throw Api.ApiException(code, context.getString(R.string.direct_error_machine_http, code))
        return try { JSONObject(text) } catch (_: Exception) { throw Api.ApiException(502, context.getString(R.string.direct_error_unexpected)) }
    }

    private fun post(context: Context, path: String, body: JSONObject) {
        val (code, _) = try {
            DirectHttp.text(base(context) + path, "POST", body.toString())
        } catch (e: Exception) {
            throw Api.ApiException(502, context.getString(R.string.direct_error_machine_unreachable))
        }
        if (code != 200) throw Api.ApiException(code, context.getString(R.string.direct_error_machine_http, code))
    }

    private fun JSONObject.num(k: String): Double? = if (!has(k) || isNull(k)) null else optString(k).toDoubleOrNull()

    fun state(context: Context): Api.State {
        val classic = Prefs(context).machineApi == "classic"
        val d = try { get(context, if (classic) "/api/v2/overview" else "/api/v2/diagram/get") } catch (e: Api.ApiException) {
            if (e.status == 0) throw e
            return Api.State(false, null, null, false, false, false, true, null, null, null, false)
        }
        val single = get(context, "/api/v2/overview_single")
        val general = if (classic) null else try { get(context, "/api/v2/general") } catch (_: Exception) { null }
        val status = d.num("MA_STATUS")?.toInt()
        val key = when (status) { 0 -> "off"; 1 -> "on"; 2 -> "eco"; 3 -> "brewing"; 4 -> "draining"; 5 -> "paddle"; 6 -> "fault"; else -> "unknown" }
        fun temp(raw: Double?, offset: Double?): Double? = raw?.let { if (it > 40) it - (offset ?: 0.0) else it }
        val bgOff = general?.num("BG_TEMPERATURE_OFFSET") ?: single.num("BG_TEMPERATURE_OFFSET")
        val bbOff = general?.num("BB_TEMPERATURE_OFFSET") ?: single.num("BB_TEMPERATURE_OFFSET")
        val group = temp(d.num("BG_SENS_TEMP_A"), bgOff)
        val groupSet = single.num("BG_SET_TEMP") ?: general?.num("BG_SET_TEMP")
        val on = status == 1 || status == 3 || status == 4 || status == 5
        // Neue Firmware: 2 = Dampfkessel an. Alte Firmware wie deren Original-Oberfläche: alles außer 1 (aus) ist an
        val sb = d.num("SB_STATUS")?.toInt()
        val steamOn = if (classic) sb != null && sb != 1 else sb == 2
        val steam = d.num("SB_SENS_PRESS")
        val steamSet = single.num("SB_SET_PRESS") ?: general?.num("SB_SET_PRESS")
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
            boiler = temp(d.num("BB_SENS_TEMP_A"), bbOff),
            boilerSet = single.num("BB_SET_TEMP") ?: general?.num("BB_SET_TEMP"),
            steamSet = steamSet,
        )
    }

    /** Wie die Original-Oberfläche: Maschine schalten und den Dampfkessel passend mitschalten. */
    fun power(context: Context, mode: String) {
        val classic = Prefs(context).machineApi == "classic"
        val action = when (mode) {
            "off" -> "0"
            "on" -> "1"
            "eco" -> "2"
            // Alte Xenia: eigene Aktion „an ohne Dampfkessel“; neue: einschalten und Dampfkessel aus
            Api.MODE_ON_NO_STEAM -> if (classic) "5" else "1"
            else -> throw Api.ApiException(400, context.getString(R.string.direct_error_invalid_mode))
        }
        post(context, "/api/v2/machine/control", JSONObject().put("action", action))
        if (classic) return
        val steam = when (mode) {
            "on" -> if (get(context, "/api/v2/general").num("MA_BOILER_START_MODE")?.toInt() == 2) 0 else 1
            else -> 0
        }
        post(context, "/api/v2/toggle/sb", JSONObject().put("TOGGLE", steam))
    }
}

/** Sucht Maschine und Mühle im WLAN des Handys (nur das eigene /24-Netz). */
/** Eigenes Zertifikat des Servers im Heimnetz (https://<IP>:8443): nur genau das gemerkte wird akzeptiert. */
object LocalTls {
    @Volatile var pin: String? = null

    /** Nur private IPv4-Adressen, nie Cloudflare oder andere Namen. */
    fun applies(host: String?): Boolean {
        val n = host?.split('.')?.mapNotNull { it.toIntOrNull() } ?: return false
        if (n.size != 4) return false
        return n[0] == 10 || (n[0] == 192 && n[1] == 168) || (n[0] == 172 && n[1] in 16..31)
    }

    /** Für HttpURLConnection: bei https auf eine private IP mit gemerktem Zertifikat dieses akzeptieren. */
    fun prepare(conn: HttpURLConnection) {
        val p = pin
        if (conn is HttpsURLConnection && !p.isNullOrEmpty() && applies(conn.url.host)) {
            conn.sslSocketFactory = DirectHttp.contextFor(p).socketFactory
            conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
        }
    }
}

object NetworkScan {
    data class Found(val ip: String, val kind: String, val name: String)

    fun ownSubnet(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        // WLAN bevorzugen (bei aktivem VPN ist das aktive Netz sonst das VPN), dann jedes Netz mit privater IPv4-Adresse
        val nets = (listOfNotNull(cm.activeNetwork) + cm.allNetworks).distinct()
        val wifiFirst = nets.sortedByDescending { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
        for (n in wifiFirst) {
            val lp = runCatching { cm.getLinkProperties(n) }.getOrNull() ?: continue
            val addr = lp.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && it.isSiteLocalAddress } ?: continue
            val parts = addr.hostAddress?.split('.') ?: continue
            if (parts.size == 4) return parts.take(3).joinToString(".")
        }
        return null
    }

    /** Fortschritt der Suche: abgefragte Adressen (von 254) und bisherige Treffer */
    fun interface Progress { fun update(done: Int, total: Int, found: Int) }

    fun scan(context: Context, progress: Progress? = null): List<Found> {
        val subnet = ownSubnet(context) ?: return emptyList()
        val pool = Executors.newFixedThreadPool(64)
        val found = java.util.Collections.synchronizedList(mutableListOf<Found>())
        val done = java.util.concurrent.atomic.AtomicInteger()
        for (i in 1..254) {
            val ip = "$subnet.$i"
            pool.execute {
                try { probeDevice(context, ip, found) } finally { progress?.update(done.incrementAndGet(), 254, found.size) }
            }
        }
        pool.shutdown()
        pool.awaitTermination(90, TimeUnit.SECONDS)
        return found.sortedBy { it.ip.substringAfterLast('.').toInt() }
    }

    private fun probeDevice(context: Context, ip: String, found: MutableList<Found>) {
                try {
                    // der ESP32 der Xenia antwortet im Stromsparmodus mitunter erst nach über einer Sekunde
                    val (code, text) = DirectHttp.text("http://$ip/api/v2/machine", timeoutMs = 2500)
                    if (code == 200 && text.contains("MA_TYPE")) {
                        val j = JSONObject(text)
                        val type = j.optInt("MA_TYPE")
                        // alte Firmware (4.x, z. B. DBL): eigene Modellnummern
                        val classic = j.optInt("FW_VERSION_MAJOR", 5) in 1..4
                        found += Found(ip, "machine", when (type) {
                            1 -> "Xenia 2K"; 2 -> "Xenia Dual Boiler"; 3 -> if (classic) "Xenia Dual Boiler + L" else "Xenia Brew-by-Sync"
                            4 -> "Xenia 303"; 5 -> "Xenia 2K + L"; else -> "Xenia"
                        })
                        return
                    }
                } catch (_: Exception) { }
                try {
                    val (code, text) = DirectHttp.text("https://$ip/rest_api/get_machine_info", "POST", "", timeoutMs = 1200, insecureTls = true)
                    if (code == 200 && text.contains("grinderType")) {
                        val fallback = context.getString(R.string.direct_scan_grinder)
                        found += Found(ip, "grinder", JSONObject(text).optString("grinderTypeName", fallback).ifBlank { fallback })
                    }
                } catch (_: Exception) { }
    }

    /** Sucht Xenios-Server im eigenen /24-Netz: /healthz antwortet mit dem Kopf X-Xenios-Instance (HTTPS 8443, HTTP 80/8080). */
    fun scanServers(context: Context, progress: Progress? = null): List<String> {
        val subnet = ownSubnet(context) ?: return emptyList()
        val pool = Executors.newFixedThreadPool(64)
        val found = java.util.Collections.synchronizedList(mutableListOf<String>())
        val done = java.util.concurrent.atomic.AtomicInteger() // je Adresse drei Abfragen (8443, 80, 8080)
        for (i in 1..254) {
            for (base in listOf("https://$subnet.$i:8443", "http://$subnet.$i", "http://$subnet.$i:8080")) {
                pool.execute {
                  try {
                    try {
                        val conn = URL("$base/healthz").openConnection() as HttpURLConnection
                        if (conn is HttpsURLConnection) {
                            conn.sslSocketFactory = DirectHttp.contextFor(null).socketFactory // nur Erkennung; gemerkt wird beim Verbinden
                            conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
                        }
                        try {
                            conn.connectTimeout = 1500
                            conn.readTimeout = 2000
                            if (conn.responseCode == 200 && conn.getHeaderField("X-Xenios-Instance") != null) found += base
                        } finally { conn.disconnect() }
                    } catch (_: Exception) { }
                  } finally {
                    val n = done.incrementAndGet()
                    if (n % 3 == 0) progress?.update(n / 3, 254, found.map { it.substringAfter("://").substringBefore(':') }.distinct().size)
                  }
                }
            }
        }
        pool.shutdown()
        pool.awaitTermination(60, TimeUnit.SECONDS)
        // je Server eine Adresse, HTTPS bevorzugt
        return found.groupBy { it.substringAfter("://").substringBefore(':') }
            .map { (_, list) -> list.firstOrNull { it.startsWith("https") } ?: list.first() }
            .sortedBy { it.substringAfter("://").substringBefore(':').substringAfterLast('.').toInt() }
    }
}
