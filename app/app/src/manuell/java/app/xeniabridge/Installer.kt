package app.xeniabridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Variante ohne Updater: ohne das Recht, Apps zu installieren (kein REQUEST_INSTALL_PACKAGES), deshalb ohne Warnung
 * von Play Protect. Die App meldet neue Versionen und öffnet den Download im Browser; installiert wird von Hand.
 */
internal object Installer {
    const val SELF_INSTALL = false
    /** Asset dieser Variante im Release: Xenios-<Build>-ohne-Updater.apk */
    const val ASSET_SUFFIX = "-ohne-Updater"

    fun allowed(context: Context): Boolean = true

    fun resume(activity: Activity) = Unit

    /** APK dieser Variante im Browser herunterladen; die Installation übernimmt Android wie beim ersten Mal. */
    fun start(activity: Activity, release: AppUpdate.Release) {
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(release.url)))
        } catch (_: Exception) {
            AppUpdate.report("", activity.getString(R.string.update_install_no_browser))
        }
    }

    fun discard(context: Context) = Unit
}
