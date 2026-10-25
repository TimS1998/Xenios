package app.xeniabridge

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.Html
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * Einrichtung: Modus „Mit Server“ (Server-Adresse + App-Passwort → Geräte-Token)
 * oder „Direkt im Heimnetz“ (IP-Adressen von Maschine und Mühle, ohne Server).
 */
class SetupActivity : Activity() {
    private lateinit var error: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        val root = findViewById<View>(R.id.scroll)
        root.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }

        val prefs = Prefs(this)
        val url = findViewById<EditText>(R.id.url)
        val local = findViewById<EditText>(R.id.local_url)
        val password = findViewById<EditText>(R.id.password)
        val name = findViewById<EditText>(R.id.name)
        val machineIp = findViewById<EditText>(R.id.machine_ip)
        val grinderIp = findViewById<EditText>(R.id.grinder_ip)
        val grinderPw = findViewById<EditText>(R.id.grinder_pw)
        val apiGroup = findViewById<RadioGroup>(R.id.machine_api)
        val modeGroup = findViewById<RadioGroup>(R.id.mode)
        val serverBox = findViewById<View>(R.id.server_box)
        val directBox = findViewById<View>(R.id.direct_box)
        error = findViewById(R.id.error)
        val connect = findViewById<Button>(R.id.connect)
        val progress = findViewById<ProgressBar>(R.id.progress)

        url.setText(prefs.baseUrl ?: "")
        local.setText(prefs.localUrl ?: "")
        name.setText(prefs.deviceName ?: Build.MODEL)
        machineIp.setText(prefs.machineIp ?: "")
        grinderIp.setText(prefs.grinderIp ?: "")
        grinderPw.setText(prefs.grinderPassword ?: "")
        apiGroup.check(if (prefs.machineApi == "classic") R.id.api_classic else R.id.api_bbs)

        fun showMode(direct: Boolean) {
            serverBox.visibility = if (direct) View.GONE else View.VISIBLE
            directBox.visibility = if (direct) View.VISIBLE else View.GONE
            error.visibility = View.GONE
        }
        modeGroup.check(if (prefs.direct) R.id.mode_direct else R.id.mode_server)
        showMode(prefs.direct)
        modeGroup.setOnCheckedChangeListener { _, id -> showMode(id == R.id.mode_direct) }

        findViewById<Button>(R.id.help).setOnClickListener { showIpHelp() }
        findViewById<Button>(R.id.scan).setOnClickListener { button ->
            button.isEnabled = false
            progress.visibility = View.VISIBLE
            error.visibility = View.GONE
            thread(name = "xenia-scan") {
                val found = try { NetworkScan.scan(applicationContext) } catch (_: Exception) { emptyList() }
                runOnUiThread {
                    button.isEnabled = true
                    progress.visibility = View.GONE
                    if (found.isEmpty()) {
                        showError("Nichts gefunden. Ist das Handy im selben WLAN wie Maschine und Mühle? Sonst die IPs von Hand eintragen (Anleitung).")
                        return@runOnUiThread
                    }
                    val labels = found.map { "${if (it.kind == "machine") "Maschine" else "Mühle"}: ${it.name} – ${it.ip}" }.toTypedArray()
                    AlertDialog.Builder(this)
                        .setTitle("Gefunden – antippen zum Übernehmen")
                        .setItems(labels) { _, i ->
                            val f = found[i]
                            if (f.kind == "machine") machineIp.setText(f.ip) else grinderIp.setText(f.ip)
                        }
                        .setPositiveButton("Fertig", null)
                        .show()
                    // eindeutige Treffer gleich eintragen
                    found.singleOrNull { it.kind == "machine" }?.let { if (machineIp.text.isBlank()) machineIp.setText(it.ip) }
                    found.singleOrNull { it.kind == "grinder" }?.let { if (grinderIp.text.isBlank()) grinderIp.setText(it.ip) }
                }
            }
        }

        connect.setOnClickListener {
            error.visibility = View.GONE
            val direct = modeGroup.checkedRadioButtonId == R.id.mode_direct
            connect.isEnabled = false
            progress.visibility = View.VISIBLE
            val done = { msg: String? ->
                runOnUiThread {
                    if (msg != null) {
                        showError(msg)
                        connect.isEnabled = true
                        progress.visibility = View.GONE
                    } else {
                        Widgets.refreshAll(this)
                        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_RELOAD, true))
                        finish()
                    }
                }
            }
            if (direct) {
                val m = machineIp.text.toString().trim()
                val g = grinderIp.text.toString().trim()
                val api = if (apiGroup.checkedRadioButtonId == R.id.api_classic) "classic" else "bbs"
                if (!isPrivateIp(m)) return@setOnClickListener done("Maschine: bitte eine IP-Adresse im Heimnetz eingeben, z. B. 192.168.178.55")
                if (g.isNotEmpty() && !isPrivateIp(g)) return@setOnClickListener done("Mühle: bitte eine IP-Adresse im Heimnetz eingeben, z. B. 192.168.178.54")
                thread(name = "xenia-setup") {
                    val (code, text) = try { DirectHttp.text("http://$m/api/v2/status", timeoutMs = 4000) } catch (_: Exception) { 0 to "" }
                    if (code != 200 || !text.contains("MA_STATUS")) return@thread done("Unter $m antwortet keine Xenia. Gleiches WLAN? IP richtig?")
                    prefs.mode = "direct"
                    prefs.machineIp = m
                    prefs.machineApi = api
                    prefs.grinderIp = g.ifBlank { null }
                    prefs.grinderPassword = grinderPw.text.toString().ifBlank { null }
                    done(null)
                }
                return@setOnClickListener
            }

            val remoteText = url.text.toString().trim()
            val localText = local.text.toString().trim()
            val base = if (remoteText.isEmpty()) null else normalize(remoteText)
            val localBase = if (localText.isEmpty()) null else normalizeLocal(localText)
            if (remoteText.isNotEmpty() && base == null) return@setOnClickListener done("Server-Adresse: https:// (http nur im eigenen Netz)")
            if (localText.isNotEmpty() && localBase == null) return@setOnClickListener done("Lokale Adresse: nur Heimnetz-Adressen wie http://192.168.178.32")
            if (base == null && localBase == null) return@setOnClickListener done("Bitte mindestens eine Adresse eingeben")
            val pw = password.text.toString()
            if (pw.isEmpty()) return@setOnClickListener done("Bitte das App-Passwort eingeben")
            val device = name.text.toString().trim().ifBlank { Build.MODEL }
            thread(name = "xenia-setup") {
                try {
                    // Im WLAN zuerst lokal anmelden, sonst über Cloudflare
                    var result: Pair<String, String>? = null
                    var lastError: Exception? = null
                    for (b in listOfNotNull(localBase, base)) {
                        try {
                            result = Api.registerDevice(b, pw, device)
                            break
                        } catch (e: Api.ApiException) {
                            throw e // Server erreicht, aber z. B. falsches Passwort
                        } catch (e: Exception) {
                            lastError = e
                        }
                    }
                    val (token, _) = result ?: throw lastError ?: Exception("Server nicht erreichbar")
                    // alte Anmeldung dieses Geräts auf dem Server entfernen
                    val old = prefs.token
                    val oldBase = prefs.bases.firstOrNull()
                    if (old != null && oldBase != null) Api.logout(oldBase, old)
                    prefs.mode = "server"
                    prefs.baseUrl = base
                    prefs.localUrl = localBase
                    prefs.token = token
                    prefs.deviceName = device
                    Api.forgetChoice()
                    AlarmReport.sendIfChanged(applicationContext, force = true)
                    done(null)
                } catch (e: Exception) {
                    done(Api.message(e))
                }
            }
        }
    }

    private fun showError(msg: String) {
        error.text = msg
        error.visibility = View.VISIBLE
    }

    private fun showIpHelp() {
        val subnet = NetworkScan.ownSubnet(this)
        val html = """
            <p><b>Am einfachsten:</b> „Im WLAN suchen“ tippen. Die App fragt alle Geräte im WLAN dieses Handys ab${if (subnet != null) " ($subnet.1–254)" else ""} und zeigt Maschine und Mühle an.</p>
            <p><b>Fritz!Box</b> (Adressen 192.168.178.x):</p>
            <ol>
            <li>Im Browser <b>fritz.box</b> öffnen und anmelden.</li>
            <li><b>Heimnetz → Netzwerk → Netzwerkverbindungen</b>.</li>
            <li>Die <b>Maschine</b> heißt meist <b>ESP32-…</b> oder <b>espressif</b>, die <b>Mühle</b> <b>hemro_hsg_…</b> bzw. „Hemro“.</li>
            <li>Die IP-Adresse steht in der Spalte „IP-Adresse“.</li>
            <li>Tipp: Beim Gerät auf „Bearbeiten“ und <b>„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“</b> anhaken. Sonst kann sich die Adresse nach einem Neustart ändern.</li>
            </ol>
            <p><b>Andere Router:</b> In der Router-Oberfläche oder -App nach „Geräte“, „Clients“ oder „DHCP“ suchen und dort nach ESP32 bzw. Hemro schauen.</p>
            <p><b>An der Mühle:</b> Im Menü der E64 WS unter Netzwerk/WLAN steht ihre IP-Adresse.</p>
            <p><b>Prüfen:</b> Im Browser des Handys <b>http://&lt;IP&gt;/</b> öffnen. Bei der Maschine erscheint die Xenia-Oberfläche. Bei der Mühle <b>https://&lt;IP&gt;/</b> öffnen und die Zertifikatswarnung bestätigen.</p>
        """.trimIndent()
        AlertDialog.Builder(this)
            .setTitle("IP-Adressen finden")
            .setMessage(Html.fromHtml(html, Html.FROM_HTML_MODE_COMPACT))
            .setPositiveButton("OK", null)
            .show()
    }

    companion object {
        /** https erzwingen; http nur für Adressen im eigenen Netz. */
        fun normalize(input: String): String? {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.contains("://")) s = "https://$s"
            val u = Uri.parse(s)
            val host = u.host ?: return null
            if (u.scheme != "https" && !(u.scheme == "http" && isLocalHost(host))) return null
            return "${u.scheme}://${u.encodedAuthority}"
        }

        /** Heimnetz-Adresse: http oder https, aber nur private IPs bzw. lokale Namen (nie das Internet im Klartext). */
        fun normalizeLocal(input: String): String? {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return null
            if (!s.contains("://")) s = "http://$s"
            val u = Uri.parse(s)
            val host = u.host ?: return null
            if (u.scheme != "http" && u.scheme != "https") return null
            if (!isLocalHost(host)) return null
            return "${u.scheme}://${u.encodedAuthority}"
        }

        fun isLocalHost(host: String): Boolean {
            val h = host.lowercase()
            if (h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".fritz.box") || h.endsWith(".home.arpa")) return true
            return isPrivateIp(h)
        }

        /** Nur reine private IPv4-Adressen (Direkt-Modus spricht die Geräte per IP an). */
        fun isPrivateIp(ip: String): Boolean {
            val p = ip.split('.')
            if (p.size != 4) return false
            val n = p.map { it.toIntOrNull() ?: return false }
            if (n.any { it !in 0..255 }) return false
            return n[0] == 10 || (n[0] == 192 && n[1] == 168) || (n[0] == 172 && n[1] in 16..31)
        }
    }
}
