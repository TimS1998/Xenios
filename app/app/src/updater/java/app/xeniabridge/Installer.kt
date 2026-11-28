package app.xeniabridge

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Variante mit Updater: lädt die APK in den Cache und installiert sie über den PackageInstaller, ab Android 12 ohne
 * Rückfrage, solange Android die Bedingungen dafür als erfüllt ansieht (siehe docs/Android-App.md, „App-Update“).
 * Braucht REQUEST_INSTALL_PACKAGES (src/updater/AndroidManifest.xml); deshalb kann Play Protect davor warnen.
 */
internal object Installer {
    const val SELF_INSTALL = true
    /** Asset dieser Variante im Release: Xenios-<Build>.apk */
    const val ASSET_SUFFIX = ""

    private const val MAX_SIZE = 200L * 1024 * 1024
    /** So lange nach dem Öffnen von „Unbekannte Apps installieren“ geht es nach der Rückkehr von selbst weiter */
    private const val RESUME_WINDOW = 10 * 60_000L

    /** Bestätigung der Installation, die Android verlangt hat, während die App nicht sichtbar war */
    @Volatile private var pendingConfirm: Intent? = null

    fun allowed(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Nach erteilter Erlaubnis weiterinstallieren, ausstehende Bestätigung zeigen. */
    fun resume(activity: Activity) {
        pendingConfirm?.let { pendingConfirm = null; showConfirm(activity, it) }
        val prefs = Prefs(activity)
        val asked = prefs.updateInstallAsked
        if (asked > 0 && allowed(activity)) {
            prefs.updateInstallAsked = 0
            if (System.currentTimeMillis() - asked < RESUME_WINDOW) AppUpdate.install(activity)
        }
    }

    /** Fehlt „Unbekannte Apps installieren“, erst dorthin führen; sonst laden, prüfen, installieren. */
    fun start(activity: Activity, release: AppUpdate.Release) {
        val prefs = Prefs(activity)
        if (!allowed(activity)) {
            prefs.updateInstallAsked = System.currentTimeMillis()
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } catch (_: Exception) {
                AppUpdate.report("", activity.getString(R.string.update_install_no_setting))
            }
            return
        }
        prefs.updateInstallAsked = 0
        AppUpdate.report("downloading")
        val app = activity.applicationContext
        AppUpdate.worker.execute {
            try {
                val apk = download(app, release)
                verify(app, apk, release)
                AppUpdate.report("installing")
                commit(app, apk)
                // Weiter geht es in onStatus; bei Erfolg beendet Android die App, um sie zu ersetzen
            } catch (e: Exception) {
                AppUpdate.report("", AppUpdate.message(app, e))
            }
        }
    }

    /** Geladene APKs früherer Updates wegräumen. */
    fun discard(context: Context) {
        File(context.cacheDir, "update").deleteRecursively()
    }

    private fun download(context: Context, r: AppUpdate.Release): File {
        if (r.size !in 1..MAX_SIZE) throw IOException(context.getString(R.string.update_install_bad_size))
        val dir = File(context.cacheDir, "update").apply { mkdirs() }
        val file = File(dir, "Xenios-${r.build}.apk")
        dir.listFiles()?.forEach { if (it != file) it.delete() }
        // Schon geladen (z. B. Bestätigung vorhin abgebrochen)?
        if (file.length() == r.size && (r.sha256 == null || sha256(file) == r.sha256)) return file
        val part = File(dir, "${file.name}.part")
        val conn = URL(r.url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("User-Agent", AppUpdate.UA)
            // github.com leitet zum Download-Server von GitHub weiter (HttpURLConnection folgt nur https → https)
            if (conn.responseCode != 200) throw IOException(context.getString(R.string.update_install_http, conn.responseCode))
            val md = MessageDigest.getInstance("SHA-256")
            var done = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > r.size) throw IOException(context.getString(R.string.update_install_too_big))
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                        AppUpdate.progress((done * 100 / r.size).toInt())
                    }
                }
            }
            if (done != r.size) throw IOException(context.getString(R.string.update_install_incomplete))
            if (r.sha256 != null && hex(md.digest()) != r.sha256) throw IOException(context.getString(R.string.update_install_checksum))
            if (!part.renameTo(file)) throw IOException(context.getString(R.string.update_install_save_failed))
            return file
        } finally {
            conn.disconnect()
            part.delete()
        }
    }

    /**
     * Nur eine APK dieser App mit der Build-Nummer aus dem Release und demselben Signaturschlüssel. Den Schlüssel prüft
     * Android bei der Installation ohnehin; hier gibt es dafür eine verständliche Meldung.
     */
    private fun verify(context: Context, apk: File, r: AppUpdate.Release) {
        val pm = context.packageManager
        val info = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: throw IOException(context.getString(R.string.update_install_unreadable))
        if (info.packageName != context.packageName) throw IOException(context.getString(R.string.update_install_other_app))
        if (info.longVersionCode != r.build) throw IOException(context.getString(R.string.update_install_build_mismatch))
        val si = info.signingInfo ?: return // manche Android-Versionen lesen die Signatur eines Archivs nicht
        val theirs = (if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory)?.toSet().orEmpty()
        val own = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.toSet().orEmpty()
        if (theirs.isNotEmpty() && own.isNotEmpty() && own.none { it in theirs }) {
            throw IOException(context.getString(R.string.update_install_other_key))
        }
    }

    private fun commit(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            setInstallReason(PackageManager.INSTALL_REASON_USER)
            // Ab Android 12: Update der App durch sich selbst ohne Rückfrage (braucht UPDATE_PACKAGES_WITHOUT_USER_ACTION)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            if (Build.VERSION.SDK_INT >= 33) setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("base.apk", 0, apk.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                // Explizit an den eigenen Receiver; MUTABLE, weil Android Status und Bestätigungs-Intent einträgt
                val status = Intent(context, UpdateReceiver::class.java)
                val pi = PendingIntent.getBroadcast(context, id, status, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                session.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw e
        }
    }

    /** Ergebnis des PackageInstallers. */
    fun onStatus(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android verlangt doch eine Bestätigung (siehe docs/Android-App.md, wann das passiert)
                @Suppress("DEPRECATION")
                val dialog: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (dialog == null) return AppUpdate.report("", context.getString(R.string.update_install_no_dialog))
                // Nur in der sichtbaren App öffnen; sonst beim nächsten Öffnen
                if (Widgets.appVisible) showConfirm(context, dialog) else { pendingConfirm = dialog }
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdate.report("")
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdate.report("", context.getString(R.string.update_install_aborted))
            else -> AppUpdate.report("", context.getString(R.string.update_install_failed, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: context.getString(R.string.update_install_unknown_reason)))
        }
    }

    private fun showConfirm(context: Context, dialog: Intent) {
        try {
            context.startActivity(dialog.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            AppUpdate.report("", context.getString(R.string.update_install_confirm_failed, e.message.toString()))
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return hex(md.digest())
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
}

/** Ergebnis der Installation (PackageInstaller-Session): Bestätigung zeigen, Abbruch oder Fehler melden. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Installer.onStatus(context, intent)
}
