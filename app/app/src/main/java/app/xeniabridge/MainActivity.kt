package app.xeniabridge

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import kotlin.concurrent.thread
import android.content.ContentValues
import android.provider.MediaStore
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Hauptfenster: zeigt die Web-App des eigenen Servers (immer aktuell, alle Funktionen),
 * angemeldet über das Geräte-Token als Cookie.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var frame: BarFrame
    /** Von der Seite gemeldete Farben der Kopfzeile und der unteren Leiste (null: Standard). */
    private var barTop: Int? = null
    private var barBottom: Int? = null
    private lateinit var prefs: Prefs
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var errorShown = false
    /** Notbetrieb: Server nicht erreichbar, Web-App aus der APK spricht die Maschine direkt an (Modus bleibt „Server“). */
    @Volatile private var fallback = false
    private val direct: Boolean get() = prefs.direct || fallback
    /** App-Update meldet Fortschritt und Ergebnis: Einstellungen neu zeichnen */
    private val updateListener: () -> Unit = {
        runOnUiThread { if (::web.isInitialized && !isDestroyed) web.evaluateJavascript("window.dispatchEvent(new Event('xenios-app-update'))", null) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.configured) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        frame = BarFrame(this)
        frame.setBackgroundColor(getColor(R.color.surface))
        web = WebView(this)
        web.setBackgroundColor(getColor(R.color.surface))
        frame.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(frame)
        // Android 15 zeichnet randlos: Inhalt nicht unter Status- und Navigationsleiste legen
        frame.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            // Verbraucht: sonst meldet die WebView dieselben Ränder als safe-area und die Seite rückt ein zweites Mal ein
            WindowInsets.CONSUMED
        }
        applyBarAppearance()

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString XeniaApp/${BuildConfigInfo.VERSION}"
            // Kein Zoom mit zwei Fingern oder per Doppeltipp (die Schriftgröße des Systems gilt weiter)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }
        web.addJavascriptInterface(Bridge(), "XeniaApp")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, contentDisposition, mimeType, _ -> download(url, contentDisposition, mimeType) }

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }

        AppUpdate.onChange = updateListener

        setCookies()
        load(intent, fresh = true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!::web.isInitialized) return
        val reload = intent.getBooleanExtra(EXTRA_RELOAD, false)
        if (reload) setCookies()
        if (intent.hasExtra(EXTRA_PATH) || reload) load(intent, fresh = reload)
    }

    /** Adresse wählen (lokal, falls im WLAN erreichbar) – im Hintergrund, dann laden. */
    private fun load(intent: Intent?, fresh: Boolean) {
        val path = intent?.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") } ?: "/"
        if (prefs.direct) {
            // Direkt-Modus: Web-App aus der APK, Geräte-Zugriff über die Brücke
            web.loadUrl(DIRECT_ORIGIN + path)
            return
        }
        fallback = false
        val app = applicationContext
        thread(name = "xenia-base") {
            val base = try { Api.activeBase(app, fresh) } catch (_: Exception) { prefs.bases.firstOrNull() }
            runOnUiThread {
                if (base != null && !isFinishing) web.loadUrl(base.trimEnd('/') + path)
            }
        }
    }

    /** Token als Cookie für alle Adressen des Servers (https: __Host-xs, http im Heimnetz: xs). */
    private fun setCookies() {
        val token = prefs.token ?: return
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(web, false)
        for (base in prefs.bases) {
            val secure = base.startsWith("https://")
            val attrs = buildString {
                append(if (secure) "__Host-xs" else "xs")
                append("=$token; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 86400}")
                if (secure) append("; Secure")
            }
            cm.setCookie(base, attrs)
        }
        cm.flush()
    }

    private fun applyBarAppearance() {
        val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val bg = getColor(R.color.surface)
        val top = barTop ?: bg
        val bottom = barBottom ?: bg
        if (::frame.isInitialized) frame.setBars(top, bottom)
        // Android legt sonst einen halbdurchsichtigen Schleier über die Leisten (wirkt schwarz statt in App-Farbe)
        window.isNavigationBarContrastEnforced = false
        window.isStatusBarContrastEnforced = false
        // Bis Android 14 (nicht randlos) färbt das System die Leisten selbst
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            window.statusBarColor = top
            @Suppress("DEPRECATION")
            window.navigationBarColor = bottom
        }
        // Symbole dunkel auf hellen Leisten, hell auf dunklen
        fun light(c: Int) = if (barTop == null && barBottom == null) !dark else Color.luminance(c) > 0.5f
        var flags = 0
        if (light(top)) flags = flags or WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
        if (light(bottom)) flags = flags or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(flags, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
    }

    // Zoom-Tasten (Geräte- und Fernbedienungstasten) haben in der App keine Wirkung
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_ZOOM_IN || event.keyCode == KeyEvent.KEYCODE_ZOOM_OUT) return true
        return super.dispatchKeyEvent(event)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyBarAppearance()
    }

    override fun onResume() {
        super.onResume()
        Widgets.appVisible = true
        if (::web.isInitialized) web.onResume()
        ExactAlarms.askOnce(this)
        // nach der Rückkehr aus den Android-Einstellungen den Stand der Erlaubnis an die Web-Oberfläche melden
        if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new Event('xenios-exact-alarms'))", null)
        // App-Update: nach erteilter Erlaubnis weiter, höchstens einmal am Tag von selbst prüfen
        if (::web.isInitialized) AppUpdate.resume(this)
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        CookieManager.getInstance().flush()
        Widgets.appVisible = false
        Widgets.refreshAll(this)
        super.onPause()
    }

    override fun onDestroy() {
        if (AppUpdate.onChange === updateListener) AppUpdate.onChange = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    @Deprecated("Nur bis Android 12; ab 13 OnBackInvokedCallback")
    override fun onBackPressed() {
        handleBack()
    }

    /**
     * Zurück-Taste: die Web-App entscheidet (offenes Fenster schließen → Unterseite → übergeordnete Seite → Home).
     * Auf Home (oder ohne geladene Web-App) geht die App in den Hintergrund, statt sich zu beenden.
     */
    private fun handleBack() {
        if (!::web.isInitialized) { moveTaskToBack(true); return }
        web.evaluateJavascript("(typeof window.xeniosBack === 'function' && window.xeniosBack()) ? 'ja' : 'nein'") { r ->
            if (r?.contains("ja") != true) moveTaskToBack(true)
        }
    }

    // Activity-Result-API bräuchte AndroidX; hier reicht die klassische API
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    /** Server ausgefallen: auf den Notbetrieb umschalten, falls die Maschinen-IP bekannt ist. */
    private fun enterFallback(path: String?): Boolean {
        if (prefs.direct || fallback || prefs.machineIp.isNullOrBlank()) return false
        fallback = true
        web.loadUrl(DIRECT_ORIGIN + (path?.takeIf { it.startsWith("/") } ?: "/"))
        return true
    }

    private fun isOwnUrl(uri: Uri): Boolean = if (direct) uri.scheme == "https" && uri.host == DIRECT_HOST else prefs.bases.any { b ->
        val base = Uri.parse(b)
        uri.scheme == base.scheme && uri.host == base.host && uri.port == base.port
    }

    private fun download(url: String, contentDisposition: String?, mimeType: String?) {
        val uri = Uri.parse(url)
        if (!isOwnUrl(uri)) return
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val req = DownloadManager.Request(uri)
            .addRequestHeader("Authorization", "Bearer ${prefs.token}")
            .setMimeType(mimeType)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        getSystemService(DownloadManager::class.java).enqueue(req)
        Toast.makeText(this, getString(R.string.main_toast_download, name), Toast.LENGTH_SHORT).show()
    }

    private fun showLoadError(message: String) {
        if (errorShown || isFinishing) return
        errorShown = true
        AlertDialog.Builder(this)
            .setTitle(if (direct) R.string.main_error_title_page else R.string.main_error_title_server)
            .setMessage(if (direct) message else "$message\n\n${prefs.bases.joinToString("\n")}")
            .setPositiveButton(R.string.main_error_retry) { _, _ -> errorShown = false; load(intent, fresh = true) }
            .setNeutralButton(R.string.main_error_change) { _, _ -> errorShown = false; openSetup() }
            .setOnCancelListener { errorShown = false }
            .show()
    }

    private fun openSetup() {
        startActivity(Intent(this, SetupActivity::class.java))
    }

    private inner class Client : WebViewClient() {
        // Server im Heimnetz mit eigenem Zertifikat (https://IP:8443): nur genau das beim Einrichten gemerkte zulassen
        override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) {
            val pin = prefs.localPin
            val local = prefs.localUrl?.let { Uri.parse(it) }
            val url = Uri.parse(error.url)
            val cert = error.certificate.x509Certificate
            val ok = !pin.isNullOrEmpty() && cert != null && local != null && url.host == local.host && url.port == local.port &&
                LocalTls.applies(url.host) && DirectHttp.sha256Hex(cert.encoded).equals(pin, ignoreCase = true)
            if (ok) handler.proceed() else handler.cancel()
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (isOwnUrl(request.url)) return false
            // Fremde Links im Browser öffnen
            try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { }
            return true
        }

        // Direkt-Modus: Dateien der Web-App aus den Assets (web/…) ausliefern
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!direct || request.url.host != DIRECT_HOST) return null
            return serveAsset(request.url.path ?: "/")
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            if (enterFallback(request.url.path)) return
            showLoadError(error.description?.toString() ?: getString(R.string.main_error_unknown))
        }

        // Tunnel steht, Server dahinter nicht (Cloudflare liefert dann eine eigene Fehlerseite)
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode in Api.SERVER_DOWN) enterFallback(request.url.path)
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(params.createIntent(), REQ_FILE)
                true
            } catch (_: Exception) {
                fileCallback = null
                false
            }
        }
    }

    private fun serveAsset(rawPath: String): WebResourceResponse {
        var path = rawPath.trimStart('/')
        if (path.contains("..")) return notFound()
        // App-Routen (/timer, /steuerung …) liefern die App aus
        if (path.isEmpty() || !path.substringAfterLast('/').contains('.')) path = "index.html"
        val mime = when (path.substringAfterLast('.').lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
        return try {
            WebResourceResponse(mime, "utf-8", 200, "OK", mapOf("Cache-Control" to "no-cache"), assets.open("web/$path"))
        } catch (_: Exception) {
            notFound()
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))

    private val httpPool by lazy { Executors.newFixedThreadPool(4) }

    /** Für die Web-App: „window.XeniaApp“. Anmeldung öffnen, Wecker, im Direkt-Modus HTTP zu Maschine/Mühle und Dateien speichern. */
    private inner class Bridge {
        /** Farben und Manometer-Design der App für die Widgets (JSON, hell und dunkel); Widgets neu zeichnen */
        @JavascriptInterface
        fun setTheme(json: String) {
            if (json.length > 20_000) return
            val changed = prefs.widgetTheme != json
            prefs.widgetTheme = json
            // „Ohne Dampf einschalten“ einmalig aus der Web-App übernehmen; danach führt die App die Einstellung
            if (!prefs.noSteamOnSet) runCatching { prefs.noSteamOn = org.json.JSONObject(json).optBoolean("noSteamOn") }
            if (changed) Widgets.redrawAll(applicationContext)
        }

        /** Erlaubnis „Wecker und Erinnerungen“ (Widgets alle 5 s): erteilt? */
        @JavascriptInterface
        fun exactAlarms(): Boolean = ExactAlarms.allowed(this@MainActivity)

        @JavascriptInterface
        fun requestExactAlarms() {
            runOnUiThread { ExactAlarms.openSettings(this@MainActivity) }
        }

        @JavascriptInterface
        fun getNoSteamOn(): Boolean = prefs.noSteamOn

        @JavascriptInterface
        fun setNoSteamOn(on: Boolean) {
            prefs.noSteamOn = on
            Widgets.redrawAll(applicationContext)
        }

        /** Farben für Status- und Navigationsleiste (#rrggbb), passend zu Kopfzeile und unterer Leiste der Seite. */
        @JavascriptInterface
        fun setBars(top: String, bottom: String) {
            val t = runCatching { Color.parseColor(top) }.getOrNull() ?: return
            val b = runCatching { Color.parseColor(bottom) }.getOrNull() ?: return
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                barTop = t
                barBottom = b
                applyBarAppearance()
            }
        }

        @JavascriptInterface
        fun mode(): String = if (direct) "direct" else prefs.mode

        /** true im Notbetrieb (Server nicht erreichbar). */
        @JavascriptInterface
        fun fallback(): Boolean = fallback && !prefs.direct

        /** Notbetrieb verlassen und den Server erneut versuchen. */
        @JavascriptInterface
        fun retryServer() {
            runOnUiThread { errorShown = false; load(intent, fresh = true) }
        }

        /** Adressen für den Direkt-Modus (nur dort). */
        @JavascriptInterface
        fun directConfig(): String {
            if (!direct) return "{}"
            return JSONObject()
                .put("machineUrl", "http://" + prefs.machineIp)
                .put("machineApi", prefs.machineApi)
                .put("grinderUrl", prefs.grinderIp?.takeIf { it.isNotBlank() }?.let { "https://$it" } ?: JSONObject.NULL)
                .put("grinderPassword", prefs.grinderPassword ?: "")
                .put("version", getString(R.string.main_direct_version, BuildConfigInfo.VERSION))
                .toString()
        }

        /** HTTP zu Maschine/Mühle (nur Direkt-Modus, nur deren IPs); Antwort per window.__xeniaHttpDone(id, json). */
        @JavascriptInterface
        fun http(id: Int, json: String) {
            httpPool.execute {
                val result = try {
                    if (!direct) throw IllegalStateException(getString(R.string.main_http_direct_only))
                    val hosts = listOfNotNull(prefs.machineIp, prefs.grinderIp).filter { it.isNotBlank() }.toSet()
                    DirectHttp.request(JSONObject(json), hosts)
                } catch (e: Exception) {
                    JSONObject().put("error", e.message ?: e.javaClass.simpleName)
                }
                val js = "window.__xeniaHttpDone($id, ${JSONObject.quote(result.toString())})"
                runOnUiThread { if (!isFinishing) web.evaluateJavascript(js, null) }
            }
        }

        /** Datei (Base64) im Download-Ordner speichern. */
        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) {
            val safe = name.replace(Regex("[^A-Za-z0-9._\\- ]"), "_").take(80).ifBlank { "xenia.dat" }
            try {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safe)
                    put(MediaStore.Downloads.MIME_TYPE, mime.substringBefore(';'))
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException(getString(R.string.main_save_impossible))
                contentResolver.openOutputStream(uri)?.use { it.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT)) }
                runOnUiThread { Toast.makeText(this@MainActivity, getString(R.string.main_save_done, safe), Toast.LENGTH_SHORT).show() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, getString(R.string.main_save_failed, e.message.toString()), Toast.LENGTH_LONG).show() }
            }
        }

        @JavascriptInterface
        fun reauth() {
            runOnUiThread { openSetup() }
        }

        @JavascriptInterface
        fun version(): String = BuildConfigInfo.VERSION

        /** IANA-Zeitzone des Handys. Die WebView bleibt sonst auf UTC, dann liegt der Wecker eine Stunde daneben. */
        @JavascriptInterface
        fun timeZone(): String = java.util.TimeZone.getDefault().id

        /** Nächsten Wecker dieses Handys sofort an den Server melden; gibt den Zeitpunkt (ms) zurück, 0 = keiner. */
        @JavascriptInterface
        fun checkAlarm(): Long {
            val app = applicationContext
            thread(name = "xenia-alarm") { AlarmReport.sendIfChanged(app, force = true) }
            return AlarmReport.nextAlarm(app) ?: 0L
        }

        /** App, die den nächsten Wecker gestellt hat; "" = unbekannt. Hilft, wenn der gemeldete Wecker nicht zur Uhr-App passt. */
        @JavascriptInterface
        fun alarmSource(): String = AlarmReport.nextAlarmSource(applicationContext) ?: ""

        /** Wecker-Liste der Uhr-App öffnen (Android gibt anderen Apps nur den nächsten Wecker heraus). */
        @JavascriptInterface
        fun showAlarms() {
            runOnUiThread {
                try {
                    startActivity(Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS))
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, R.string.main_no_clock_app, Toast.LENGTH_SHORT).show()
                }
            }
        }

        /** App-Update: installierte und neueste Version, laufender Vorgang, Erlaubnis (JSON, siehe AppUpdate.state). */
        @JavascriptInterface
        fun appUpdate(): String = AppUpdate.state(applicationContext)

        /** Neuestes Release jetzt abfragen; Ergebnis per Ereignis „xenios-app-update“. */
        @JavascriptInterface
        fun checkAppUpdate() = AppUpdate.check(applicationContext, manual = true)

        /** Neue APK laden und installieren (fehlt die Erlaubnis, erst die Android-Einstellung öffnen). */
        @JavascriptInterface
        fun installAppUpdate() {
            runOnUiThread { if (!isFinishing) AppUpdate.install(this@MainActivity) }
        }

        /** Auf dieses Build hat die Oberfläche schon hingewiesen. */
        @JavascriptInterface
        fun appUpdateSeen(build: Long) {
            prefs.updateAnnounced = build
        }

        /** Bildschirm anlassen, solange das Dashboard offen ist (Tablet an der Wand). */
        @JavascriptInterface
        fun keepScreenOn(on: Boolean) {
            runOnUiThread { web.keepScreenOn = on }
        }
    }

    companion object {
        const val EXTRA_PATH = "path"
        const val EXTRA_RELOAD = "reload"
        // Direkt-Modus: reservierte Domain (.invalid wird nie aufgelöst), alle Anfragen beantwortet die App selbst
        const val DIRECT_HOST = "xenia.invalid"
        const val DIRECT_ORIGIN = "https://$DIRECT_HOST"
        private const val REQ_FILE = 42
    }
}

/** Rahmen um die WebView: malt die Flächen unter Status- und Navigationsleiste (das Padding) in eigenen Farben. */
class BarFrame(context: Context) : FrameLayout(context) {
    private val topPaint = Paint()
    private val bottomPaint = Paint()

    init { setWillNotDraw(false) }

    fun setBars(top: Int, bottom: Int) {
        topPaint.color = top
        bottomPaint.color = bottom
        setBackgroundColor(bottom)
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (paddingTop > 0) canvas.drawRect(0f, 0f, width.toFloat(), paddingTop.toFloat(), topPaint)
        if (paddingBottom > 0) canvas.drawRect(0f, (height - paddingBottom).toFloat(), width.toFloat(), height.toFloat(), bottomPaint)
    }
}
