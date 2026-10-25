# Mahlkönig E64 WS – Web-Interface und Daten (Firmware V01.16 build #24)

Mühle unter `https://<mühle>/` (bei uns `https://192.168.178.54`). Die Angaben stammen aus lesenden Abfragen am 22.10.2026 nach Owner-Login, aus dem JavaScript der Oberfläche und aus dem Grind-by-Sync-Protokoll (Projekte `Skamba/gbs-anywhere` und `panterro/gbs-anywhere-bt`). **Es wurde nichts verstellt.**

| | |
|---|---|
| Modell | E64 WS (`grinderType 5`), „E64 family“, Hemro „HSG“-Firmware |
| Firmware | V01.16 build #24 vom 06.08.2026 (custom). Update-Paket `HEM-HSG-HMI-S01-Vxx.yy-<build>.swu`. Downgrades sperrt die Oberfläche. |
| Technik | Linux-Steuerung mit nginx und PHP (`?ver=ngx_5`), zusätzlich ein ESP-Funkmodul. SQLite-Datenbank, Lizenzen: ESP-IDF, FreeRTOS, lwIP, cJSON, libsodium, SPIFFS |
| Hostname | `hemro_hsg_<S/N>` |
| TLS | HTTPS mit **selbstsigniertem** Zertifikat |

Legende: 🟢 lesend · 🟡 ändert etwas · 🔴 gefährlich · ✅ live geprüft · 📄 aus dem Code der Oberfläche

---

## 1. Anmeldung und Sitzung

### `GET /login.php` 🟢 ✅
Funktioniert ohne Login und zeigt S/N, Modell und Firmware. Das Formular hat die Felder `userRole` (nur `Owner`) und `password`.

### `POST /login.php` 🟡 📄
`application/x-www-form-urlencoded`:
```
userRole=Owner&password=<Owner-Passwort>&login=
```
Danach gilt ein Sitzungs-Cookie (PHP-Sitzung). Weiter geht es zu `/index.php`. Ohne Sitzung leiten `/index.php` und `/wifi.php` auf `/login.php` um.

| Aufruf | Antwort ✅ | Zweck |
|---|---|---|
| `POST /rest_api/ping` | `pong` (angemeldet) / `expired` | Lebenszeichen, die Oberfläche sendet es jede Sekunde |
| `POST /rest_api/check_session` | `session_valid` / `session_invalid` | Sitzungsprüfung alle 15 s |
| `POST /rest_api/update_session` | – | Sitzung verlängern |

„Logout“ in der Oberfläche ruft nur `/login.php` auf.

---

## 2. REST-Befehle `/rest_api/<befehl>`

Allgemeines Antwortformat: `{"success": true|false, "errorCode": 0, "console": "<Text>", "data": …}`.
Unbekannter Befehl ✅: `HTTP 400 {"console":"Error, unknown REST command","success":false,"errorCode":0}`.
Ohne Sitzung ✅: `HTTP 400 {"console":"Access denied!","success":false,"errorCode":0}`.

| Befehl | Login nötig | Antwort |
|---|---|---|
| 🟢 `POST get_machine_info` ✅ | **nein** | `{"grinderType":5,"grinderTypeName":"E64 WS","error":""}` |
| 🟢 `POST get_wifi_info` ✅ | ja | `{"data":{"hostname":"hemro_hsg_<SN>","mode":"Station","apIp":"","apMacAddress":"","staIp":"192.168.178.54","staMacAddress":"…"},"console":"<ifconfig-Ausgabe>","success":true,"errorCode":0}` |
| 🟡 `POST scan_wifi` 📄 | ja | `{"success":true,"data":[{"ssid","channel","bssid","rssi"}]}` (startet eine WLAN-Suche) |
| 🟢 `GET get_fw_update_state` ✅ | – | `{ "state" : "ERROR", "progress" : "0%", "errorReason" : "No state file existing" }` (kein Update aktiv) |
| 🟢 `GET download_database` ✅ | ja | SQLite-Datei, `Content-Disposition: attachment; filename="HsgSqlite_SN<SN>_<YYYYMMDD>_<HHMMSS>.db"` (≈ 120 KB) |
| 🟢 `GET download_machine_logs` ✅ | ja | ZIP `HemroHsgMachineLogs_SN<SN>_<Datum>_<Zeit>.zip` (≈ 3 KB) mit Mahl- und Service-Log als CSV |
| 🔴 `POST kill_swupdate` 📄 | ja | bricht ein laufendes Firmware-Update ab |

### Firmware-Update 🔴 (nicht verwenden)
- `GET /upload_swu.php?prepare|install|failed&message=…`
- `POST /upload_swu.php`: Blöcke von 500 KB (FormData `swuFile`, Header `Chunk-Pos`, `Chunk-Size`, `Chunked-File-Size`)
- Statusabfrage `get_fw_update_state`: `UPLOAD_STARTED → UPLOAD_IN_PROGRESS → UPLOAD_COMPLETED → EVALUATE_PACKAGE → UNPACK_APPLICATION → UNPACK_ROOTFS → UNPACK_FIRMWARE → ESP_* → REBOOT → UPDATE_COMPLETED` (Fehler: `*_FAILED`, `PACKAGE_NO_UPGRADE`, `TIMEOUT`, `ERROR`)

### WLAN 🔴
`/wifi.php` zeigt den Modus, die IP/MAC und eine Liste der WLANs in der Nähe. Das Formular (`POST /wifi.php`: `staSsid`, `staPassword`, `staDhcp`, `staStaticIp/Gateway/Netmask/Dns`, `saveConfig`) ändert die WLAN-Einstellungen.

> ⚠️ **Sicherheitsbefund:** `/wifi.php` schreibt das **WLAN-Passwort im Klartext** in den HTML-Quelltext (`value="…"`). Die heruntergeladene Datenbank enthält es ebenfalls (`settings.Wifi.StaPassword`), dazu die Owner-Anmeldedaten (`Role.Owner.LoginData`). Der Bridge-Server gibt die Datenbank deshalb **standardmäßig nicht** heraus und leitet nur unkritische Einstellungen weiter.

---

## 3. Mahl-Log (CSV aus `download_machine_logs`)

`HemroHsgGrindLogs_SN<SN>_<Datum>_<Zeit>.csv`:

| Spalte | Bedeutung / Einheit |
|---|---|
| `grind_id`, `grind_uuid` | laufende Nummer, UUID |
| `grind_date_time` | ISO-8601 UTC, z. B. `2026-10-22T16:07:24Z` |
| `recipe_index` | Rezeptplatz 1–6 (leer = manuell/ohne Platz) |
| `recipe_cpr_id`, `recipe_data_id` | interne Rezeptversion (`recipe_data`) |
| `grind_ddd` | Mahlscheibenabstand bzw. Mahlgrad-Position (ändert sich durch GbS: 1016 → 2222 → 1761 …) |
| `grind_duration` | Mahldauer in ms |
| `grind_duration_noload` | Leerlaufzeit in ms |
| `grind_weight` | gemahlenes Gewicht in **mg** (12303 = 12,3 g) |
| `grind_successfull` | 1 = ok, 0 = abgebrochen |
| `grind_trigger_id` / `grind_trigger` | 1 `StartButton`, 2 `PortafilterSwitch`, 3 `PortafilterDetection` |
| `recipe_gbs_enabled` | 1 = Grind-by-Sync aktiv |
| `grind_debug_data` | binär (meist leer) |
| `recipe_uuid`, `recipe_mode_id`/`recipe_mode` | 1 `Manually`, 2 `ByWeight` (GbW), 3 `ByTime` (GbT) |
| `recipe_amount` | Zielmenge: mg (GbW) bzw. ms (GbT) |
| `recipe_type_id`/`recipe_type` | 1 `SingleShot`, 2 `DoubleShot`, 3 `Custom`, 4 `Filter`, 5 `SingleLongShot`, 6 `DoubleLongShot` |
| `recipe_icon_id`/`recipe_icon` | 1 `BottomlessCup`, 3 `DoubleCup`, 4 `DoublePortafilter`, 5 `SingleCup`, 6 `SinglePortafilter` |
| `recipe_coarseness` | Mahlgrad laut Rezept |
| `recipe_brew_time` | Ziel-Bezugszeit in ms (für Grind-by-Sync) |
| `recipe_brew_weight` | Ziel-Getränkegewicht in mg |

Beispiel (gekürzt):
```
37,25fd…,2026-10-22T16:07:24Z,2,0,19,1761,5099,0,12303,1,1,StartButton,1,,b121…,2,ByWeight,20000,2,DoubleShot,3,DoubleCup,213,30000,42000
34,2679…,2026-10-22T15:23:49Z,2,0,19,2161,6563,0,19257,1,3,PortafilterDetection,1,,b121…,2,ByWeight,20000,2,DoubleShot,3,DoubleCup,213,30000,42000
```

`HemroHsgServiceLogs_…csv`: `event_id,event_type_id,event_type,event_date_time,event_details`, z. B. `1,2,LogIn,"","{""@type"":""UserRole"",""role"":""OwnerHsg""}"`.

---

## 4. Datenbank (`download_database`, SQLite 3, Seitengröße 4096)

| Tabelle | Inhalt |
|---|---|
| `grind_log` | alle Mahlvorgänge (Spalten wie im CSV, ohne die Rezeptdetails) |
| `brew_events` | Bezüge, die die Maschine über Grind-by-Sync gemeldet hat: `brew_device_id` (`Xenia_Xenia DB with Power Controller_<Maschinen-SN>`), `brew_group` (`Group1`), `brew_dose_index`, `brew_dose_type_id` (1 BrewRatio, 2 BrewPulses, 3 Mass), `brew_stop_target`, `brew_validity`, `brew_duration` (ms), `brew_volume`, `brew_mass` (mg), `grind_id` |
| `recipe_entries` (WITHOUT ROWID) | Rezeptplätze 1–6: `recipe_index`, `recipe_data_id`, `recipe_active`, `recipe_cpr_id`, `recipe_gbs_data` (Blob, Lernstand) |
| `recipe_data` | Rezeptversionen (jede Änderung = neue Zeile): Modus, Menge, Typ, Symbol, Mahlgrad, Ziel-Bezugszeit/-gewicht |
| `gbs_algo_state` | Zustand des GbS-Algorithmus je Rezept/Maschine/Gruppe (`G0`, Blob 355 B) |
| `settings` | Schlüssel/Wert, siehe unten |
| `alert_log` / `alert_types` | Meldungen (`alert_active` 1 = aufgetreten, 0 = behoben mit `alert_related_id`) |
| `event_log` / `event_types` | Login, Passwortänderung, Kalibrierungen … |
| `portafilters` | erkannte Siebträger (Gewicht, Toleranz, Rezept) |
| `recipe_modes`, `recipe_types`, `recipe_icons`, `grind_trigger_modes`, `brew_dose_types` | Nachschlagetabellen |

**`settings`** (Auszug): `System.Language` (en_US), `System.WelcomeName`, `timezoneId` (Europe/Berlin), `Grinding.SelectedRecipeIndex`, `Grinding.OvershootWeight`, `Gbw.LastGbwCalibrationDate`, `Agsa.AgsaUponRecipeChange`, `Standby.LedEnabled`, `Cloud.ConnectionEnabled`, `Cloud.State.*`, `Gbs.State.*`, `Wifi.Mode/StaSsid/StaDhcp/Enabled`, **`Wifi.StaPassword` (geheim)**, **`Role.Owner.LoginData` (geheim)** sowie
```json
"M2m.CoffeeMachinesConfig": {"CoffeeMachines::CmXenia": {"host": "192.168.178.55", "pollInterval": 2000},
                              "activeCm": "CoffeeMachines::CmXenia", "manufacturer": "Xenia", "modelName": "", "serialNo": ""}
```

**Meldungstypen (`alert_types`)**: 1 HopperNotMounted, 2 FanFailure, 3 SecurityDataMissing, 4 SystemConfigurationMissing, 5 AgsaBlockage, 6 AgsaTimeout, 7 AgsaFaultPin, 8 DiscCalibrationMissing, 9 LoadcellCalibrationMissing, 10 DddFailed, 11 Ntc1Failed, 12 Ntc2Failed, 13 WifiConnectionFailed, 14 WifiDisconnectionFailed, 15 DateTimeInvalid, 16 NewFirmwareUpdateAvailable, 17 AgsaBlockagePrediction, 18 AgsaOvercurrent, 19 AgsaBlockedByHopper, 20 EspUartFailed, 21 EspAliveFailed, 22 EspSdioFailed, 23 EspFuseFailed, 24 InternetConnectionFailed, 25 Fan1Failure, 26 Fan2Failure, 27 AgsaLimitLowerHit, 28 PfHolderTouchedAtPurgeGrindStart, 29 LoadCellDisabled, 30 PortafilterSwitchDisabled, 31 LoadCellCalibrationReminder, 32 UnreliableGbwOperation, 33 NotInProductionCloud, 34 ConnectivityDiagnosisProblem, 35 FastPortafilterSwapDetected, 36 BrewEventIgnoredForGbs.
(AGSA = automatische Mahlgradverstellung, DDD = Scheibenabstandsmessung, NTC = Temperaturfühler)

**Ereignistypen (`event_types`)**: 1 GrinderStartUp, 2 LogIn, 3 FailedLogIn, 4 LogInTimeOut, 5 LogOut, 6 PasswordChange, 7 DateTimeChange, 8 DiscUsageReset, 9 FactoryReset, 10 AgsaCalibration, 11 AgsaLowerLimitSet, 12 LoadcellCalibration, 13 LoadcellEnable, 14 LoadcellGbwResolutionChange.

Bei uns aktive Rezepte: Platz 1 (einfach, 12 g GbW, Mahlgrad 100, Ziel 24 s / 48 g) und Platz 2 (doppelt, 20 g GbW, Mahlgrad 213, Ziel 30 s / 42 g, Grind-by-Sync mit Lernstand).

---

## 5. Grind-by-Sync

### E64 WS ↔ Xenia (diese Mühle)
Die Mühle ist **Client** und fragt die Xenia per HTTP ab (Port 80, ~2 s). Ablauf und Regeln: [API-Xenia.md, Abschnitt 14](API-Xenia.md#14-grind-by-sync-mühle--maschine). Wichtige Meldungen auf dem Mühlen-Display:
- „Xenia is in standby/ECO state. Please wake it up.“ (`MA_STATUS` 0/2)
- „Xenia is warming up. Please wait for the cup symbol to stop blinking.“ (`BG_SENS_TEMP ≤ BG_SET_TEMP − 2`)
- „Xenia tank is empty. Please refill it.“ (`TANK_LEVEL ≠ 1`)
- „Xenia is brewing. Please wait until it's finished.“ (`MA_STATUS` 3)

### Bezug an die Mühle melden („GbS faken“)? Stand 24.10.2026
Frage: Kann Xenios der Mühle einen Bezug mitteilen, egal ob er über die App oder an der Mühle gestartet wurde?

**Wie die E64 WS zählt.** Die Mühle hat keine Schnittstelle, über die man ihr einen Bezug melden könnte. Sie holt sich alles selbst, indem sie die „Xenia“ unter der eingestellten Adresse alle 2 s abfragt (`/api/v2/mako`). Einen Bezug wertet sie nur aus, wenn **sie ihn selbst angefordert hat**: Nach einem GbS-Mahlvorgang zeigt sie „Press grinder rotary knob to start brewing“, der Druck auf den Drehknopf schickt `POST /api/v2/scripts/execute {"ID":9}`, und am Ende liest sie `REAL_EXTRACTION_TIME_MS` beim Übergang auf `MA_STATUS 4`. Alles andere (Start in der App, an der Xenia, per Paddle) zählt als Spülung; die Mühle meldet dann ggf. `BrewEventIgnoredForGbs`.

**Was gbs-anywhere macht** ([Skamba/gbs-anywhere](https://github.com/Skamba/gbs-anywhere), Rust, AGPL-3.0): Es *ist* die Xenia aus Sicht der Mühle. Man trägt am Display der Mühle (*Settings → Connectivity → Machine To Machine → Xenia → Configuration*) die IP des Rechners statt der Maschine ein. gbs-anywhere beantwortet `/api/v2/machine` und `/api/v2/mako` auf Port 80, nimmt Knopfdruck und Mahlergebnis (`/api/v2/brewratio`) an, und Zeit und Gewicht des Bezugs tippt man am Handy ein (oder eine Integration liefert sie: La-Marzocco-Cloud, Half-Decent-Waage). Auch dort gilt: **Ohne Knopfdruck an der Mühle wertet die E64 WS den Bezug nicht** („Brew started without a grinder request: the grinder will count it as a flush“). [panterro/gbs-anywhere-bt](https://github.com/panterro/gbs-anywhere-bt) ist ein Ableger mit Bluetooth-Waagen.

**Ergebnis für Xenios:**

| Fall | Geht? | Warum |
|---|---|---|
| Start über den Drehknopf der Mühle | geht schon heute, ohne Xenios | Die Mühle spricht direkt mit der echten Xenia; Xenios zeichnet den Bezug zusätzlich auf. |
| Start über die Xenios-App (oder an der Xenia) | **nein** | Die Entscheidung trifft die Firmware der Mühle anhand ihres eigenen Knopfdrucks. Von außen lässt sich dieser Zustand nicht setzen, auch nicht mit einem Proxy. |
| Knopfdruck an der Mühle, aber ein anderes Xenia-Skript | **ja, mit dem Vermittler** | Xenios lässt sich als „Xenia“ eintragen, reicht alle Abfragen an die echte Xenia durch und biegt nur `scripts/execute {"ID":9}` auf das in der App gewählte Profil um. Der Bezug zählt für GbS. |

**Umsetzung (Grind-by-Sync-Vermittler, `server/src/gbs.js`):** Weil Xenios die Antworten der echten Xenia unverändert weitergibt, stimmen Seriennummer, Statuswechsel und Zeitpunkte von selbst. Port 80 nimmt nur Verbindungen von der IP der Mühle an, und nur die Abfragen der Mühle werden weitergereicht. Das Profil bekommt den Stopp beim Zielgewicht aus `brewratio` (Befehl 27), sonst wäre die Bezugszeit fest und der GbS-Algorithmus lernte nichts. Läuft der Server nicht, fällt Grind-by-Sync aus. Eigene Umsetzung nach dieser Protokollbeschreibung, kein Code aus gbs-anywhere (AGPL). Einrichtung: [Einrichtung.md, Abschnitt 6](Einrichtung.md#6-grind-by-sync-mit-druckprofilen-optional).

### Zum Vergleich: E65/E80 GbS („Generic WiFi“)
Bei diesen Modellen ist die Maschine der Client. Sie spricht die Mühle über HTTPS-Port **30001** an (`POST /grinderApi/pairingApplication`, `pairingStatus`, `brewJobs`, `brewAccept`, `brewDone`, jeweils mit `"version":1`). Die E64 WS hat diese Schnittstelle nicht. Sie ist hier nur der Vollständigkeit halber erwähnt.

---

## 6. Was die Mühle **nicht** anbietet
- Keine Live-Werte (aktuelles Rezept, Mahlgrad, laufender Mahlvorgang) über HTTP. Der Bridge-Server liest deshalb regelmäßig die Datenbank: alle 2 min bei geöffneter App, sonst alle 10 min.
- Keine Fernsteuerung (Mahlen starten, Rezepte ändern) über das Web-Interface.
