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
    private lateinit var prefs: Prefs
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var errorShown = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.configured) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        val frame = FrameLayout(this)
        frame.setBackgroundColor(getColor(R.color.surface))
        web = WebView(this)
        web.setBackgroundColor(getColor(R.color.surface))
        frame.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(frame)
        // Android 15 zeichnet randlos: Inhalt nicht unter Status- und Navigationsleiste legen
        frame.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }
        applyBarAppearance()

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString XeniaApp/${BuildConfigInfo.VERSION}"
        }
        web.addJavascriptInterface(Bridge(), "XeniaApp")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, contentDisposition, mimeType, _ -> download(url, contentDisposition, mimeType) }

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) {
                if (web.canGoBack()) web.goBack() else finish()
            }
        }

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
        val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (dark) 0 else flags, flags)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyBarAppearance()
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        CookieManager.getInstance().flush()
        Widgets.refreshAll(this)
        super.onPause()
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    @Deprecated("Nur bis Android 12; ab 13 OnBackInvokedCallback")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    // Activity-Result-API bräuchte AndroidX; hier reicht die klassische API
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    private fun isOwnUrl(uri: Uri): Boolean = if (prefs.direct) uri.scheme == "https" && uri.host == DIRECT_HOST else prefs.bases.any { b ->
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
        Toast.makeText(this, "Download: $name", Toast.LENGTH_SHORT).show()
    }

    private fun showLoadError(message: String) {
        if (errorShown || isFinishing) return
        errorShown = true
        AlertDialog.Builder(this)
            .setTitle(if (prefs.direct) "Seite nicht ladbar" else "Server nicht erreichbar")
            .setMessage(if (prefs.direct) message else "$message\n\n${prefs.bases.joinToString("\n")}")
            .setPositiveButton("Erneut versuchen") { _, _ -> errorShown = false; load(intent, fresh = true) }
            .setNeutralButton("Verbindung ändern") { _, _ -> errorShown = false; openSetup() }
            .setOnCancelListener { errorShown = false }
            .show()
    }

    private fun openSetup() {
        startActivity(Intent(this, SetupActivity::class.java))
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (isOwnUrl(request.url)) return false
            // Fremde Links im Browser öffnen
            try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { }
            return true
        }

        // Direkt-Modus: Dateien der Web-App aus den Assets (web/…) ausliefern
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!prefs.direct || request.url.host != DIRECT_HOST) return null
            return serveAsset(request.url.path ?: "/")
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showLoadError(error.description?.toString() ?: "Unbekannter Fehler")
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
        @JavascriptInterface
        fun mode(): String = prefs.mode

        /** Adressen für den Direkt-Modus (nur dort). */
        @JavascriptInterface
        fun directConfig(): String {
            if (!prefs.direct) return "{}"
            return JSONObject()
                .put("machineUrl", "http://" + prefs.machineIp)
                .put("machineApi", prefs.machineApi)
                .put("grinderUrl", prefs.grinderIp?.takeIf { it.isNotBlank() }?.let { "https://$it" } ?: JSONObject.NULL)
                .put("grinderPassword", prefs.grinderPassword ?: "")
                .put("version", "App " + BuildConfigInfo.VERSION)
                .toString()
        }

        /** HTTP zu Maschine/Mühle (nur Direkt-Modus, nur deren IPs); Antwort per window.__xeniaHttpDone(id, json). */
        @JavascriptInterface
        fun http(id: Int, json: String) {
            httpPool.execute {
                val result = try {
                    if (!prefs.direct) throw IllegalStateException("Nur im Direkt-Modus")
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
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("Speichern nicht möglich")
                contentResolver.openOutputStream(uri)?.use { it.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT)) }
                runOnUiThread { Toast.makeText(this@MainActivity, "Gespeichert in Downloads: $safe", Toast.LENGTH_SHORT).show() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Speichern fehlgeschlagen: ${e.message}", Toast.LENGTH_LONG).show() }
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

        /** Wecker-Liste der Uhr-App öffnen (Android gibt anderen Apps nur den nächsten Wecker heraus). */
        @JavascriptInterface
        fun showAlarms() {
            runOnUiThread {
                try {
                    startActivity(Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS))
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Keine Uhr-App gefunden", Toast.LENGTH_SHORT).show()
                }
            }
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
