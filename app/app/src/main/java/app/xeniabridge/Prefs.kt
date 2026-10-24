package app.xeniabridge

import android.content.Context

/** Server-Adresse und Geräte-Token (nur app-privater Speicher, vom Backup ausgeschlossen). */
class Prefs(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("xenia", Context.MODE_PRIVATE)

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

    val configured: Boolean
        get() = if (direct) !machineIp.isNullOrBlank()
        else (!baseUrl.isNullOrBlank() || !localUrl.isNullOrBlank()) && !token.isNullOrBlank()

    /** Alle Adressen dieses Servers, lokale zuerst. */
    val bases: List<String>
        get() = listOfNotNull(localUrl?.takeIf { it.isNotBlank() }, baseUrl?.takeIf { it.isNotBlank() })

    fun clearToken() = p.edit().remove("token").apply()
}
