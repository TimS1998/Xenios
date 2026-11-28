package app.xeniabridge

import android.content.Context

/** Server-Adresse und Geräte-Token (nur app-privater Speicher, vom Backup ausgeschlossen). */
class Prefs(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("xenia", Context.MODE_PRIVATE)

    init { LocalTls.pin = p.getString("localPin", null) } // für Aufrufe, bevor Prefs anderswo gelesen wurde (Api.call, Netzwerksuche)

    /** SHA-256 des eigenen Zertifikats des Servers für https://<IP>:8443 (beim ersten Verbinden gemerkt). */
    var localPin: String?
        get() = p.getString("localPin", null)
        set(v) { p.edit().putString("localPin", v).apply(); LocalTls.pin = v }

    var baseUrl: String?
        get() = p.getString("url", null)
        set(v) = p.edit().putString("url", v).apply()

    /** Optionale Adresse im Heimnetz (z. B. http://192.168.178.32); wird bevorzugt, wenn erreichbar. */
    var localUrl: String?
        get() = p.getString("local", null)
        set(v) = p.edit().putString("local", v).apply()

    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit().putString("token", v).apply()

    var deviceName: String?
        get() = p.getString("device", null)
        set(v) = p.edit().putString("device", v).apply()

    var lastAlarmSent: Long
        get() = p.getLong("alarmSent", -1L)
        set(v) = p.edit().putLong("alarmSent", v).apply()

    var lastAlarmReportAt: Long
        get() = p.getLong("alarmAt", 0L)
        set(v) = p.edit().putLong("alarmAt", v).apply()

    /** Widget-Updates in Folge ohne Live-Zustand der Maschine (bestimmt den Abstand der erneuten Versuche). */
    /** Hinweis zur Erlaubnis „Wecker und Erinnerungen“ schon gezeigt */
    var exactAlarmAsked: Boolean
        get() = p.getBoolean("exactAlarmAsked", false)
        set(v) = p.edit().putBoolean("exactAlarmAsked", v).apply()

    var widgetFails: Int
        get() = p.getInt("widgetFails", 0)
        set(v) = p.edit().putInt("widgetFails", v).apply()

    /** "server" (über Xenios) oder "direct" (Maschine/Mühle direkt im Heimnetz, ohne Server). */
    var mode: String
        get() = p.getString("mode", null) ?: "server"
        set(v) = p.edit().putString("mode", v).apply()

    val direct: Boolean get() = mode == "direct"

    var machineIp: String?
        get() = p.getString("machineIp", null)
        set(v) = p.edit().putString("machineIp", v).apply()

    var grinderIp: String?
        get() = p.getString("grinderIp", null)
        set(v) = p.edit().putString("grinderIp", v).apply()

    var grinderPassword: String?
        get() = p.getString("grinderPw", null)
        set(v) = p.edit().putString("grinderPw", v).apply()

    /** "bbs" = neue Xenia (Brew-by-Sync), "classic" = alte Xenia (DBL-API). */
    var machineApi: String
        get() = p.getString("machineApi", null) ?: "bbs"
        set(v) = p.edit().putString("machineApi", v).apply()

    val configured: Boolean
        get() = if (direct) !machineIp.isNullOrBlank()
        else (!baseUrl.isNullOrBlank() || !localUrl.isNullOrBlank()) && !token.isNullOrBlank()

    /** Alle Adressen dieses Servers, lokale zuerst. */
    val bases: List<String>
        get() = listOfNotNull(localUrl?.takeIf { it.isNotBlank() }, baseUrl?.takeIf { it.isNotBlank() })

    fun clearToken() = p.edit().remove("token").apply()

    /** Farben und Manometer-Design der App für die Widgets (JSON von der Web-App, hell und dunkel) */
    var widgetTheme: String?
        get() = p.getString("widgetTheme", null)
        set(v) = p.edit().putString("widgetTheme", v).apply()

    /** Einschalten ohne Dampfkessel (gilt für App, Widgets und Shortcut „Ein“); null = noch nie gesetzt */
    var noSteamOn: Boolean
        get() = p.getBoolean("noSteamOn", false)
        set(v) = p.edit().putBoolean("noSteamOn", v).putBoolean("noSteamOnSet", true).apply()
    val noSteamOnSet: Boolean get() = p.getBoolean("noSteamOnSet", false)

    /** Letzte Widget-Daten (/api/widget), um bei Farbwechseln ohne Netz neu zu zeichnen */
    var widgetCache: String?
        get() = p.getString("widgetCache", null)
        set(v) = p.edit().putString("widgetCache", v).apply()

    /** App-Update: neuestes Release mit APK (JSON, siehe AppUpdate) und Zeitpunkt der letzten erfolgreichen Prüfung */
    var updateRelease: String?
        get() = p.getString("updateRelease", null)
        set(v) = p.edit().putString("updateRelease", v).apply()

    var updateCheckedAt: Long
        get() = p.getLong("updateCheckedAt", 0L)
        set(v) = p.edit().putLong("updateCheckedAt", v).apply()

    /** Wann für ein Update zu „Unbekannte Apps installieren“ geführt wurde (0 = nicht) */
    var updateInstallAsked: Long
        get() = p.getLong("updateInstallAsked", 0L)
        set(v) = p.edit().putLong("updateInstallAsked", v).apply()

    /** Build, auf das die Web-App schon einmal hingewiesen hat (Hinweis nur einmal je neuer Version) */
    var updateAnnounced: Long
        get() = p.getLong("updateAnnounced", 0L)
        set(v) = p.edit().putLong("updateAnnounced", v).apply()
}
