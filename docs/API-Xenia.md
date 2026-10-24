# Xenia Espressomaschine – lokale HTTP-API (Firmware 4.226 / ESP 3.87)

Diese Dokumentation beschreibt die lokale Schnittstelle der Xenia (hier: **Xenia Brew-by-Sync**, `MA_TYPE 3`, Web-Oberfläche „Mahlkönig/Hemro“ v3.87) unter `http://<maschine>/` (bei uns `http://192.168.178.55`).

**Quellen:**

1. Lesende Live-Abfragen an der echten Maschine (22.10.2026, Maschine aus). Es wurde **nichts verstellt**.
2. Der JavaScript-Code der eingebauten Web-Oberfläche (`/js/<seite>.js`). Damit sind auch die schreibenden Aufrufe exakt belegt.
3. Die offizielle API-Beispielseite von xenia-espresso.de (ältere Endpunkte, mit ⚠️ markiert, falls nicht mehr in der aktuellen Oberfläche genutzt).
4. Das Grind-by-Sync-Protokoll der Mühle (siehe [API-Muehle-E64WS.md](API-Muehle-E64WS.md)).

Legende: 🟢 nur lesend · 🟡 ändert Zustand/Einstellungen · 🔴 gefährlich (Datenverlust, Netzwerkverlust, Firmware) · ✅ live geprüft · 📄 aus dem Code der Original-Oberfläche

---

## 1. Grundlegendes

| Thema | Verhalten |
|---|---|
| Protokoll | Nur **HTTP** (Port 80), keinerlei Verschlüsselung |
| Anmeldung | **Keine.** Jeder im WLAN kann die Maschine steuern. Deshalb gehört die Maschine nie direkt ins Internet, nur über den Xenios-Server. |
| Antwortformat | `application/json`. Einfache Aktionen antworten mit `HTTP 200` und leerem Body. |
| Unbekannte Pfade | **`HTTP 200` mit der HTML-Startseite** (`text/html`), nicht 404. Prüfe deshalb immer den `Content-Type`. |
| Anfrage-Format (POST) | Die Original-Oberfläche nutzt jQuery `$.post(url, JSON.stringify(obj))`. Der Body ist **JSON-Text**, der Content-Type ist `application/x-www-form-urlencoded; charset=UTF-8`. Werte werden oft als **Strings** gesendet (`{"action":"1"}`). Der Xenios-Server macht es genauso. |
| Fehler | `HTTP 500` bei manchen Aktionen (z. B. Skript stoppen, wenn keines läuft). `HTTP 403` bei „kein Platz für Skript“. `HTTP 400` bei ungültigen Skriptdaten. |
| Antwortzeiten | 75–400 ms. Der ESP32 verträgt keine parallelen Anfragen gut, daher Anfragen **nacheinander** stellen. Die Original-Oberfläche fragt höchstens 1×/s ab. |
| Gefährliche GETs | Einige **GET**-Aufrufe haben Nebenwirkungen (Tara, alle Skripte löschen, WLAN vergessen …), siehe [Abschnitt 13](#13-gefährliche-endpunkte). Nie „zum Ausprobieren“ aufrufen. |

### Präfixe der Feldnamen

| Präfix | Bedeutung |
|---|---|
| `MA_` | Maschine allgemein |
| `BG_` | Brühgruppe (Brew Group) |
| `BB_` | Brühkessel (Brew Boiler) |
| `SB_` | Dampfkessel (Steam Boiler) |
| `PU_` | Pumpe, Durchflussmesser, Waage |
| `TI_` | Wochen-Timer |
| `SWITCH_SET_` | Tastenbelegung der Paddel |
| `*_SENS_*` | gemessener Wert · `*_SET_*` Sollwert · `*_LEVEL_PW_CONTROL` Heiz-/Pumpenleistung in % |

---

## 2. Codes und Kodierungen

### `MA_STATUS` – Maschinenzustand

| Wert | Bedeutung (Web-Oberfläche) | Grind-by-Sync-Name |
|---|---|---|
| 0 | Aus (OFF / Standby) | OFF |
| 1 | An (ON) | ON |
| 2 | Eco | ECO |
| 3 | Bezug läuft („finally coffee!!“) | ACTIVE SERVING |
| 4 | Nachlauf / Ablassen (DRAINING) | ACTIVE FINISHING |
| 5 | Paddle-Modus | TESTING |
| 6 | Störung (FAULT) | FAULT |

### `SB_STATUS` – Dampfkessel
`2` = Dampfkessel **an**, `1` = aus (live gesehen bei ausgeschalteter Maschine). Die Original-Oberfläche prüft nur `== 2`.

### `MA_TYPE` – Modell

| 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Undefiniert | Xenia 2K | Xenia Dual Boiler (X DB) | **Xenia Brew-by-Sync** | Xenia 303 | Xenia 2K + L |

`MA_SUBTYPE 1` war bei unserer Maschine gesetzt. Die Mühle meldet sie als „Xenia DB with Power Controller“.

### Uhrzeit und Datum (`MA_CLOCK`, `MA_CALENDAR`)

- `MA_CLOCK` = `(Stunde << 16) | (Minute << 8) | Sekunde`. Beispiel `589844 = 0x090014` → 09:00:20.
- `MA_CALENDAR` = `(Tag << 24) | (Monat << 16) | Jahr`. Beispiel `117966826 = 0x070807EA` → 07.08.2026.

> ⚠️ **Befund:** Die Uhr unserer Maschine stand am 22.10.2026 auf **07.08.2026 09:00**. Die Wochen-Timer schalten deshalb zur falschen Zeit. Korrektur: `POST /api/v2/timer2/sync` (siehe [Abschnitt 9](#9-wochen-timer-und-uhr)) oder die App → Timer → „Uhr stellen“.

### Temperaturen

`BG_SENS_TEMP_A` und `BB_SENS_TEMP_A` sind **Rohwerte**. Die Original-Oberfläche zieht `BG_TEMPERATURE_OFFSET` bzw. `BB_TEMPERATURE_OFFSET` (bei uns 3 °C) ab, **aber erst oberhalb von 40 °C**. `/api/v2/mako` liefert `BG_SENS_TEMP` bereits korrigiert (Rohwert − Offset).

### Wochen-Timer-Zeiten

- **Lesen** (`GET /api/v2/timer2`): gepackt wie `MA_CLOCK` (`h<<16 | m<<8 | s`). `0` bedeutet „nicht gesetzt“.
- **Schreiben** (`POST /api/v2/timer2`): **Sekunden seit Mitternacht** (`h*3600 + m*60`).
- Kesselauswahl `TI_<TAG>_ON1_BOILER` / `_STATUS`: `0` keiner (= aus), `1` Brühkessel, `2` Dampfkessel, `3` beide.
- Tagesnamen in der Firmware: `MONDAY TUESDAY WEDNESDAY **THUSRDAY** FRIDAY SATURDAY SUNDAY`. Der Tippfehler gehört zur Firmware und muss so verwendet werden.

---

## 3. Status und Live-Daten 🟢

### `GET /api/v2/status` ✅
```json
{"MA_STATUS":0}
```

### `GET /api/v2/diagram/get` ✅ (Alias `GET /api/v2/diagram_get` ✅)
Live-Messwerte. Die Original-Oberfläche fragt sie im Sekundentakt ab.
```json
{"BG_LEVEL_PW_CONTROL":0,"BB_LEVEL_PW_CONTROL":0,"PU_LEVEL_PW_CONTROL":0,
 "BG_SENS_TEMP_A":35.5,"BB_SENS_TEMP_A":39.1,
 "PU_SENS_FLOW_METER_VOLUME":0,"PU_SENS_FLOW_METER_FLOWRATE":0,
 "PU_LOADCELL_VOLUME":0,"PU_LOADCELL_RATE":0,"PU_SENS_FLOW_METER_ML":0,
 "PU_SENS_PRESS":0,"SB_SENS_PRESS":0,"SB_STATUS":1,"EXTRACTION_TIME_MS":0,"MA_STATUS":0}
```
| Feld | Einheit | Bedeutung |
|---|---|---|
| `BG_/BB_/PU_LEVEL_PW_CONTROL` | % | Heizleistung Brühgruppe/-kessel, Pumpenleistung |
| `BG_SENS_TEMP_A`, `BB_SENS_TEMP_A` | °C (roh) | Temperatur Brühgruppe/-kessel |
| `PU_SENS_PRESS` | bar | Brühdruck |
| `SB_SENS_PRESS` | bar | Dampfkesseldruck |
| `PU_LOADCELL_VOLUME`, `PU_LOADCELL_RATE` | g, g/s | integrierte Waage (Gewicht, Durchfluss) |
| `PU_SENS_FLOW_METER_ML`/`_VOLUME`/`_FLOWRATE` | ml, ml/s | Durchflussmesser |
| `EXTRACTION_TIME_MS` | ms | laufende Bezugszeit |

### `GET /api/v2/overview` ✅
Zähler, Energie und Momentanwerte.
```json
{"MA_EXTRACTIONS":350,"MA_OPERATING_HOURS":20,"MA_STATUS":0,"MA_CLOCK":589844,"MA_CUR_PWR":0,
 "MA_MAX_PWR":10,"MA_ENERGY_TOTAL_KWH":0.729577,"BG_SENS_TEMP_A":35.5,"BG_LEVEL_PW_CONTROL":0,
 "PU_SENS_PRESS":0,"PU_LEVEL_PW_CONTROL":0,"PU_SET_LEVEL_PW_CONTROL":0,"PU_SENS_FLOW_METER_ML":0,
 "SB_SENS_PRESS":0,"BB_SENS_TEMP_A":39.1,"BB_LEVEL_PW_CONTROL":0,"SB_STATUS":1,
 "MA_LAST_EXTRACTION_ML":"","MA_SET_TIMER_POWERDOWN":10,"PU_SENS_SCALE_VOLUME":0,"SCALE_WEIGHT":0,
 "PU_SENS_SCALE_RATE":0,"PU_SENS_FLOW_METER_VOLUME":0,"PU_SENS_FLOW_METER_FLOWRATE":0}
```

### `GET /api/v2/overview_single` ✅
Sollwerte, Tank und MAC.
```json
{"BG_SET_TEMP":92,"BG_TEMPERATURE_OFFSET":3,"PU_SET_PRESS":9,"BB_OFFSET_TO_BG":0,"BB_TEMPERATURE_OFFSET":3,
 "PU_SENS_WATER_TANK_LEVEL":1,"SB_SET_PRESS":1.6,"BB_SET_TEMP":92,"PSP":70,
 "MA_MAC":"xx:xx:xx:xx:xx:xx","MA_EXTRACTIONS_START":0,"POP_UP":0}
```
`PU_SENS_WATER_TANK_LEVEL`: `1` = Tank voll/ok. Andere Werte = leer. Die Mühle verweigert dann das Mahlen. `PSP` ist laut alter Doku `ps.Port.SetPump`; die Bedeutung von 70 ist unbekannt.

### `GET /api/v2/mako` ✅ – Endpunkt für die Mühle (Grind-by-Sync)
Diesen Endpunkt fragt die Mahlkönig E64 WS etwa alle 2 s ab.
```json
{"MA_STATUS":0,"PU_SENS_FLOW_METER_VOLUME":0,"PU_SENS_FLOW_METER_FLOWRATE":0,"MA_EXTRACTION_STATUS":0,
 "BG_SET_TEMP":92,"BG_SENS_TEMP":32.5,"REAL_EXTRACTION_TIME_MS":10487,"TANK_LEVEL":1,
 "TIMESTAMP":"2026-08-07 05:54:38","script":""}
```
`REAL_EXTRACTION_TIME_MS` = Dauer des letzten Bezugs (für das Grind-by-Sync-Einstellen). `MA_EXTRACTION_STATUS 2` = vom Benutzer abgebrochen.

---

## 4. Ein/Aus, Eco, Dampf 🟡

### `POST /api/v2/machine/control` 📄
```json
{"action":"1"}
```
`"0"` = aus, `"1"` = an, `"2"` = Eco. Antwort: HTTP 200, leer.

Die Original-Oberfläche schaltet den Dampfkessel jeweils **mit**:

| Schalter | Aufrufe |
|---|---|
| Maschine an | `control {"action":"1"}` + `toggle/sb {"TOGGLE":1}` |
| Maschine aus | `control {"action":"0"}` + `toggle/sb {"TOGGLE":0}` |
| Eco an | `control {"action":"2"}` + `toggle/sb {"TOGGLE":0}` |
| Eco aus | `control {"action":"1"}` + `toggle/sb {"TOGGLE":1}` |

### `POST /api/v2/toggle/sb` 📄
```json
{"TOGGLE":1}
```
`1` = Dampfkessel an, `0` = aus.
⚠️ Die alte API-Doku nennt `POST /api/v2/toggle_sb {"TOGGLE": true}`. Die aktuelle Oberfläche nutzt `/toggle/sb` mit `0`/`1`.

---

## 5. Einstellungen (Temperaturen, Dampf, Allgemein)

### `GET /api/v2/general` 🟢 ✅
```json
{"BB_FILL_LEVEL":1,"BB_SET_TEMP":92,"BB_SET_ECO_TEMP":70,"BB_SET_TEMP_HYST":2,"BB_SET_POWER":500,
 "BB_TEMPERATURE_OFFSET":3,"BG_SET_TEMP":92,"BG_SET_ECO_TEMP":70,"BG_SET_TEMP_HYST":2,"BG_SET_POWER":300,
 "BG_TEMPERATURE_OFFSET":3,"PU_SET_MAX_TIMER":90,"SB_SET_PRESS":1.6,"SB_SET_ECO_PRESS":0.5,
 "SB_SET_PRESS_HYST":0.1,"SB_SET_POWER":1200,"SB_STATUS":1,"MA_FIX_WATER_SUPPLY":0,"MA_FAST_HEATUP_TYPE":0,
 "MA_HEATUP_FLUSH_DURATION":0,"MA_BOILER_START_MODE":1,"MA_START_EXTRACTIONCOUNTER_EVENT":0,"MA_STATUS":0,"VIEW":1}
```

### `POST /api/v2/general` 🟡 📄
Die Original-Oberfläche sendet **alle** folgenden Felder als **Strings**. Im Basic-Modus sendet sie nur `BB_SET_TEMP` (= Wert der Brühgruppe), `BG_SET_TEMP`, `SB_SET_PRESS` und `MA_BOILER_START_MODE`.

| Feld | Bereich | Bedeutung |
|---|---|---|
| `BG_SET_TEMP` / `BB_SET_TEMP` | 60–96 °C (0,1) | Solltemperatur Brühgruppe / Brühkessel |
| `BG_SET_ECO_TEMP` / `BB_SET_ECO_TEMP` | 40–95 °C | Eco-Temperatur |
| `BG_SET_TEMP_HYST` / `BB_SET_TEMP_HYST` | 2–5 K | Hysterese |
| `PU_SET_MAX_TIMER` | 30–120 s | maximale Bezugszeit |
| `SB_SET_PRESS` | 0–1,8 bar | Dampfdruck |
| `SB_SET_ECO_PRESS` | 0–1,0 bar | Dampfdruck Eco |
| `SB_SET_PRESS_HYST` | 0,1–0,3 bar | Hysterese Dampf |
| `MA_BOILER_START_MODE` | 1 \| 2 | 1 = Brüh- + Dampfkessel an, 2 = nur Brühkessel |
| `MA_FAST_HEATUP_TYPE` | 0 \| 1 | 0 = keine Aufheiz-Spülung, 1 = automatische Spülung |
| `MA_HEATUP_FLUSH_DURATION` | 1–20 s | Spüldauer (nur bei Typ 1 relevant) |
| `MA_START_EXTRACTIONCOUNTER_EVENT` | 0 \| 1 \| 2 | Bezugszeit startet bei Pumpenstart / 1 bar / erstem Tropfen |

Beispiel:
```json
{"BB_SET_TEMP":"93","BB_SET_ECO_TEMP":"70","BB_SET_TEMP_HYST":"2","BG_SET_TEMP":"93","BG_SET_ECO_TEMP":"70",
 "BG_SET_TEMP_HYST":"2","PU_SET_MAX_TIMER":"90","SB_SET_PRESS":"1.6","SB_SET_ECO_PRESS":"0.5",
 "SB_SET_PRESS_HYST":"0.1","MA_BOILER_START_MODE":"1","MA_FAST_HEATUP_TYPE":"0",
 "MA_HEATUP_FLUSH_DURATION":"1","MA_START_EXTRACTIONCOUNTER_EVENT":"0"}
```
Empfehlung: vorher `GET /api/v2/general` lesen, nur die gewünschten Werte ändern und dann alle Felder senden. Der Bridge-Server macht genau das.

### Ältere Einzel-Endpunkte ⚠️ (offizielle API-Beispielseite, von der aktuellen Oberfläche nicht genutzt, nicht live geprüft)
| Aufruf | Body |
|---|---|
| `POST /api/v2/inc_dec` | `{"BG_SET_TEMP":95.5,"BB_SET_TEMP":95.5}` – Temperaturen direkt setzen |
| `POST /api/v2/inc_dec_bb` | `{"BB_SET_TEMP":0.1}` – Brühkessel ±0,1 |
| `POST /api/v2/inc_dec_sb` | `{"SB_SET_PRESS":0.1}` – Dampfdruck ±0,1 |
| `POST /api/v2/machine` | `{"MA_HEATUP_FLUSH_EN":0,"MA_SET_TIMER_ECO_MA":"12","MA_SET_TIMER_POWERDOWN":"10","MA_FIX_WATER_SUPPLY":"0","MA_MAX_AMPERE":"10"}` |
| `GET/POST /api/v2/language` | `{"pref_lang":"en"}` (GET live ✅: `{"pref_lang":"en"}`) |

### `POST /api/v2/view` 🟡 📄
```json
{"VIEW":1}
```
Ansicht der Web-Oberfläche: 0 = Basic, 1 = Expert. Der Wert wird auf der Maschine gespeichert.

---

## 6. Maschinen-Info 🟢

### `GET /api/v2/machine` ✅
```json
{"MA_TYPE":3,"MA_SUBTYPE":1,"MA_EXTRACTIONS":350,"MA_OPERATING_HOURS":20,"MA_EXTRACTIONS_START":0,
 "MA_FIX_WATER_SUPPLY":0,"MA_HEATUP_FLUSH_DURATION":0,"MA_BOILER_START_MODE":1,"MA_EXTENDED_THERMAL_STABILITY":0,
 "MA_SET_TIMER_ECO_MA":20,"MA_SET_TIMER_POWERDOWN":10,"MA_MAX_AMPERE":10,"MA_ENERGY_TOTAL_KWH":0.729577,
 "PU_SET_BREW_TIMER_1":37,"FW_VERSION_MAJOR":4,"FW_VERSION_MINOR":226,"PU_SET_QUANTITY_MEASUREMENT":3,
 "ESP_FW_MAJOR":3,"ESP_FW_MINOR":87,"BLE":0,"MA_DELAY":-1,"BT_SCALE_NAME":"","MA_SN":"<seriennummer>"}
```
`FW_VERSION_*` = Steuerplatine (Atmel), `ESP_FW_*` = WLAN-Modul/Webserver. Die Mühle liest `MA_TYPE`, `MA_SN` und die Versionen.

### `GET /api/v2/info` ✅
```json
{"MSN":"","FW_VERSION_MAJOR":4,"FW_VERSION_MINOR":226,"ESP_FW_MAJOR":3,"ESP_FW_MINOR":87,"MA_TYPE":3,
 "MA_EXTRACTIONS":350,"MA_OPERATING_HOURS":5,"MA_MAC":"7120","MA_TIMEZONE":1,"TZ_IND":322,
 "MA_CLOCK":589844,"MA_CALENDAR":117966826,"VIEW":1}
```
`TZ_IND` = Index in `/tz/tz.json` (322 = Europe/Berlin).

### `GET /tz/tz.json` 🟢 📄
Zeitzonenliste `{ "<index>": [name, POSIX-TZ-String, …, MA_TIMEZONE] }`.

---

## 7. Skripte

Skripte sind Abläufe aus Befehlen. ID-Bereiche:

| IDs | Art |
|---|---|
| 0–9 | eingebaut, nicht löschbar: **2** Dauerbezug, **7** einfache Dosis, **8** doppelte Dosis, **9** Bezug starten (von der Mühle per Drehknopf ausgelöst) |
| 10–149 | eigene Skripte |
| 150–199 | Druckprofil-Skripte (Pressure Modeler) |
| 200–249 | Paddle-Aufnahmen |

### Skript-Format (`instruction` / `Content`)
Text mit `;`-getrennten Befehlen `"<opcode> <arg1> <arg2>"`. Immer mit `1;` beginnen und mit `7;` enden. Zeiten in **ms**, Drücke bei Opcode 4 in **mbar**.
Beispiel: `1;13;3 40 2000;12 4000;4 9000 25000;6;7;` = Ventil auf → 40 % Pumpe für 2 s → 4 s warten → 9 bar für 25 s → Pumpe aus.

| Op | Befehl | Argumente (Übertragung) |
|---|---|---|
| 1 | Start (Kopf) | – |
| 2 | Pumpe an | – |
| 3 | Pumpenleistung | Leistung 1–100 %, Dauer ms (0,1–45 s) |
| 4 | Pumpendruck | Druck **mbar** (0–10 bar), Dauer ms (0,1–45 s) |
| 5 | Durchfluss nach Waage („Wait until x gram“ / „Scale pump flow rate“) | 1–100 ml/s, Dauer ms |
| 6 | Pumpe aus | – |
| 7 | Ende | – |
| 8 | Brühkessel-Leistung | 1–400 % |
| 9 | Brühgruppen-Leistung | 1–400 % |
| 12 | Warten | ms (0,1–120 s) |
| 13 / 14 | Brühventil öffnen / schließen | – |
| 15 / 16 | Ablassventil öffnen / schließen | – |
| 17 | Ablassen & beenden | – |
| 20 | Piepton | Anzahl 1–3, Dauer 1–5000 ms |
| 25 | Auf Zieltemperatur warten | 88–96 °C |
| 26 | Warten bis Druck | 0–10 bar |
| 27 | Bezug stoppen bei | 1–400 g/ml |
| 28 | Eco-Modus | – |
| 29 | Druck begrenzen | 0–10 bar |
| 30 | Durchfluss begrenzen | 0–5 ml/s |
| 31 | Zieltemperatur wiederherstellen | – |
| 32 / 33 | Vorgabe einfaches / doppeltes Sieb (Totvolumen Durchflussmesser) | – |

Namen (`name`): `^(?! )[A-Za-z0-9\-_# ]*(?<! )$`, also keine Umlaute und kein Leerzeichen am Anfang oder Ende.

### Aufrufe
| Methode & Pfad | Body | Antwort / Hinweis |
|---|---|---|
| 🟢 `GET /api/v2/scriptslist` ✅ | – | `{"index_list":[…],"title_list":[…]}` (bei uns leer) |
| 🟢 `POST /api/v2/scripts/read` 📄 | `{"FILE_NAME":"012"}` | `{"Title":"…","Content":"1;…;7;"}` |
| 🟢 `POST /api/v2/scripts/iddownload` 📄 | `{"ID":"012"}` | `{"<Titel>":"<Inhalt>"}` (Export als `Xenia-<Titel>.script`) |
| 🟡 `POST /api/v2/scripts/execute` 📄 | `{"ID":8}` | startet das Skript bzw. den Bezug |
| 🟡 `GET /api/v2/scripts/stop` 📄 | – | 200 = gestoppt, **500 = kein Skript aktiv** |
| 🟡 `POST /api/v2/scripts/create` 📄 | siehe unten | 200 · 403 = kein Platz · 400 = ungültig |
| 🟡 `POST /api/v2/scriptsedit` 📄 | `{"SCRIPT_ID":12}` | markiert ein Skript zum Bearbeiten |
| 🟢 `GET /api/v2/scripts/edit` ✅ | – | `{"id":"none"}` bzw. die markierte ID |
| 🔴 `POST /api/v2/scripts/delete` 📄 | `{"scr_file_name":"012.S","title_file_name":"012.T"}` | löscht ein Skript (nur ID > 9) |
| 🔴 `GET /api/v2/scripts/alldelete` 📄 | – | **löscht ALLE Skripte** (die Oberfläche verlangt die Eingabe „OK“) |

`scripts/create` beim Neuanlegen:
```json
{"Edit":"","script_id":"","switch":null,"script":"none","name":"Blooming","instruction":"1;13;3 40 2000;12 4000;4 9000 25000;6;7;"}
```
Beim Bearbeiten erst `scriptsedit {"SCRIPT_ID":12}` senden, dann `create` mit `"Edit":"Enabled","script_id":12`. Paddle-Aufnahmen haben `"script":"paddle"` und einen Namen wie `paddle_YYYY_MM_DD_hh_mm_ss`.

---

## 8. Paddle (direkte Pumpensteuerung) 🟡

| Methode & Pfad | Body | Antwort |
|---|---|---|
| `GET /api/v2/paddle` 📄 | – | `{"VIEW":…, "BB_SET_SUPPLY_VALVE":0/1, "BB_SET_SUPPLY_VALVE_2":0/1, "MA_STATUS":…, "PU_SET_LEVEL_PW_CONTROL":0..100}` |
| `GET /api/v2/paddle/press` 📄 | – | wie oben + `PU_SENS_PRESS`; die Seite fragt es 1×/s ab |
| `POST /api/v2/paddle/pumppower` 📄 | `{"PU_SET_LEVEL_PW_CONTROL":40}` | **startet die Pumpe** mit 0–100 %, antwortet mit dem Ventilzustand. Schlägt fehl, solange die Maschine ablässt. |
| `GET /api/v2/paddle/stop` 📄 | – | Pumpe aus / Paddle beenden |

`BB_SET_SUPPLY_VALVE` = Brühventil, `BB_SET_SUPPLY_VALVE_2` = Ablassventil.
Aufnahme in der Oberfläche: Pumpenwechsel werden als Skript `1;13;3 <p> ;<Δms>;12 <Δms>;3 <p> …;17;7;` gespeichert.

---

## 9. Wochen-Timer und Uhr

### `GET /api/v2/timer2` 🟢 ✅
```json
{"MA_TYPE":3,"TI_MONDAY_ON1":0,"TI_TUESDAY_ON1":0,…,"TI_MONDAY_ON2":0,…,
 "TI_MONDAY_ON1_BOILER":0,…,"TI_SUNDAY_ON2_BOILER":0,
 "MA_SET_TIMER_ECO_MA":20,"MA_SET_TIMER_POWERDOWN":10,"MA_TIMEZONE":1,"TZ_IND":322,
 "MA_CLOCK":589844,"MA_CALENDAR":117966826,"VIEW":1}
```
`ON1` = Einschaltzeit, `ON2` = Ausschaltzeit (gepackt `h<<16|m<<8|s`). `MA_SET_TIMER_ECO_MA` = Eco nach x Minuten, `MA_SET_TIMER_POWERDOWN` = Aus nach x Minuten (0 = deaktiviert, 1–240). Beim Xenia 2K (`MA_TYPE 1`) gibt es keine Brühkessel-Auswahl.

### `POST /api/v2/timer2` 🟡 📄
```json
{"TI_MONDAY_ON1_STATUS":3,"TI_MONDAY_ON2_STATUS":3,"TI_MONDAY_ON1":23400,"TI_MONDAY_ON2":32400,
 "TI_TUESDAY_ON1_STATUS":0, …,
 "MA_SET_TIMER_ECO_MA":"20","MA_SET_TIMER_POWERDOWN":"10"}
```
Zeiten in **Sekunden seit Mitternacht** (23400 = 06:30). `_STATUS` siehe Kesselauswahl. `ON2_STATUS` = `ON1_STATUS`, weil die Aus-Zeit keine eigene Auswahl hat. Die beiden `MA_SET_TIMER_*`-Felder sendet die Oberfläche nur im Expert-Modus.

### `POST /api/v2/timer3` 🟡 📄
`{"MA_SET_TIMER_ECO_MA":0|1}` oder `{"MA_SET_TIMER_POWERDOWN":0|1}` schaltet den Eco- bzw. Abschalt-Timer ab oder an.

### `POST /api/v2/timer2/sync` 🟡 📄 – Uhrzeit und Zeitzone setzen
```json
{"TZ_IND":"322","TZ_STR":"CET-1CEST,M3.5.0,M10.5.0/3","MA_TIMEZONE":1,"UTC_EPOCH":1792690000}
```
`TZ_STR` und `MA_TIMEZONE` stammen aus `/tz/tz.json[TZ_IND]`. Mit `UTC_EPOCH` stellt der ESP32 die Uhr auch ohne Internet (NTP).

---

## 10. Tastenbelegung und Waage

### `GET /api/v2/switches` 🟢 ✅
```json
{"SWITCH_SET_LEFT_LEFT_0":2,"SWITCH_SET_LEFT_LEFT_1":0,"SWITCH_SET_RIGHT_LEFT_0":8,"SWITCH_SET_RIGHT_LEFT_1":0,
 "SWITCH_SET_RIGHT_RIGHT_0":7,"SWITCH_SET_RIGHT_RIGHT_1":0,
 "MA_BEVERAGE_WEIGHT_SGL_INT_SCALE":18,"MA_BEVERAGE_WEIGHT_DBL_INT_SCALE":40,"MA_SET_TIMER_POWERDOWN":10,"VIEW":1}
```
`SWITCH_SET_<Hebel>_<Richtung>_<0 kurz | 1 lang>` = Skript-ID. Der linke Hebel nach rechts (`LEFT_RIGHT`) ist fest Ein/Aus. Bei uns: links◀ kurz = Dauerbezug (2), rechts◀ kurz = doppelte Dosis (8), rechts▶ kurz = einfache Dosis (7).
`MA_BEVERAGE_WEIGHT_*_INT_SCALE` = Zielgewicht in g für einfache/doppelte Dosis mit der internen Waage.

### `POST /api/v2/switches` 🟡 📄
```json
{"MA_BEVERAGE_WEIGHT_SGL_INT_SCALE":"18","MA_BEVERAGE_WEIGHT_DBL_INT_SCALE":"40"}
```
Das Senden von `SWITCH_SET_*` ist in der aktuellen Oberfläche auskommentiert, die Firmware übernimmt die Werte aber: `{"SWITCH_SET_RIGHT_RIGHT_1":"7", …}` wurde am 23.10.2026 gespeichert und zurückgelesen (danach wieder zurückgesetzt). Ob der Taster danach wirklich das neue Skript startet, ist noch an der Maschine zu prüfen. Taster: `LEFT_RIGHT` = oben links (Ein/Aus, fest), `LEFT_LEFT` = unten links (Krone), `RIGHT_RIGHT` = oben rechts (Tasse), `RIGHT_LEFT` = unten rechts (zwei Tassen).

---

## 11. Netzwerk

| Aufruf | Bedeutung |
|---|---|
| 🟢 `GET /api/v2/network` ✅ | `{"WIFI_NAME":"<SSID>","WIFI_SIGNAL_STRENGTH":"-66","WIFI_ENCRYPTION":"WPA2_PSK","WIFI_SOFT_AP":"172.16.0.1","WIFI_SOFT_AP_MAC":"…","WIFI_AP_SSID":"<SSID>","WIFI_AP_IP":"192.168.178.55","WIFI_AP_MAC":"…","WIFI_STATUS":3,"VIEW":1}`. `WIFI_STATUS 3` = verbunden. Signal: > −55 sehr gut, > −67 gut, > −75 schwach. |
| 🟡 `GET /api/v2/network/forcescan` 📄 | WLAN-Suche starten |
| 🟢 `GET /api/v2/network/list` 📄 | `{"networks":["SSID", …]}` |
| 🔴 `POST /api/v2/network/connect` 📄 | `{"WIFI_WANTED_NAME":"<ssid>","WIFI_PASSWORD":"…"}` – WLAN wechseln |
| 🔴 `GET /api/v2/network/forget` 📄 | **WLAN vergessen**: Die Maschine fällt aus dem Netz (danach nur noch über den eigenen Access Point 172.16.0.1 erreichbar) |

---

## 12. Service/Werk (Seite „Factory“)

| Aufruf | Bedeutung |
|---|---|
| 🟢 `GET /api/v2/brewgroup/pid` ✅ | `{"BG_P_VAL":18,"BG_I_VAL":0.00033,"BG_D_VAL":0,"BG_SET_SENSOR_SLOPE":0.03501,"BG_SET_SENSOR_OFFSET":-14.2,"BG_SET_POWER":300,"BG_TEMPERATURE_OFFSET":3}` |
| 🟢 `GET /api/v2/brewboiler/pid` ✅ | `{"BB_P_VAL":10,"BB_I_VAL":0.0001,"BB_D_VAL":0,"BB_SET_SENSOR_SLOPE":0.03528,"BB_SET_SENSOR_OFFSET":-15.1,"BB_TEMPERATURE_OFFSET":3,"BB_SET_POWER":500}` |
| 🟢 `GET /api/v2/pump/pid` ✅ | `{"PU_P_VAL":0.014,"PU_I_VAL":0.0009,"PU_D_VAL":0.0045,"PU_SET_SENSOR_OFFSET":-3.7,"PU_SET_SENSOR_SLOPE":0.0048}` |
| 🟢 `GET /api/v2/steamboiler/pid` ✅ | `{"SB_SET_SENSOR_OFFSET":-1.2556,"SB_SET_SENSOR_SLOPE":0.00175,"SB_SET_POWER":1200}` |
| 🟢 `GET /api/v2/mahlkonig/get` ✅ | `{"PU_SET_QUANTITY_MEASUREMENT":3,"MA_DISPLAY_INSTALLED":2,"MA_SUBTYPE":1,"PU_SET_QUANTITY_THRESHOLD_SINGLE_FILTER":20,"PU_SET_QUANTITY_THRESHOLD_DOUBLE_FILTER":30,"PU_SENS_FLOW_METER_ML_PER_PULSE":0,"PU_SENS_FLOW_METER_ML_PER_PULSE2":0,"MA_LOADCELL_CALCULATION_FACTOR":1.62,"MA_LOADCELL_FLOWRATE_STOP_FACTOR_SGL":1.2,"MA_LOADCELL_FLOWRATE_STOP_FACTOR_DBL":1.2,"MA_FIX_WATER_SUPPLY":0,"BB_FILL_LEVEL":1,"PASS_UNLOCKED":0}` |
| 🔴 `POST /api/v2/machine/pid` ⚠️ | PID-Werte schreiben (alte Doku): `BG_/BB_/PU_P_VAL, _I_VAL, _D_VAL, *_SET_SENSOR_SLOPE/OFFSET, BB_OFFSET_TO_BG` |
| 🟡 `POST /api/v2/scale/factors` 📄 | `{"MA_LOADCELL_FLOWRATE_STOP_FACTOR_SGL":1.2,"MA_LOADCELL_FLOWRATE_STOP_FACTOR_DBL":1.2}` (0,5–2,0) |
| 🔴 `GET /api/v2/loadcell/tara` 📄 | **Waage tarieren** (Schritt 1 der Kalibrierung) |
| 🔴 `POST /api/v2/loadcell/weight` 📄 | `{"LOADCELL_WEIGHT":<g×10>,"CALIBRATE":1}` – Waage kalibrieren |

`PASS_UNLOCKED 0` und die Fehlermeldung „Please check your password“ deuten auf eine Passwortsperre für Werkseinstellungen hin. Diese wurde nicht getestet.

---

## 13. Gefährliche Endpunkte

Diese Aufrufe **sperrt** der Xenios-Server grundsätzlich. Sie sind nur über die Original-Oberfläche im WLAN erreichbar.

| Aufruf | Folge |
|---|---|
| `GET /api/v2/scripts/alldelete` | alle Skripte gelöscht |
| `GET /api/v2/network/forget` | Maschine verliert das WLAN |
| `POST /api/v2/network/connect` | WLAN-Wechsel, evtl. nicht mehr erreichbar |
| `GET /api/v2/loadcell/tara`, `POST /api/v2/loadcell/weight` | Waage tariert bzw. falsch kalibriert |
| `POST /api/v2/machine/pid`, `POST /api/v2/scale/factors` | Regelverhalten verändert |
| `POST /upload/<datei>`, `POST /api/v2/upload`, `GET /api/v2/upload/get_time` | Firmware-Update (`firmware.bin`/`Firmware_*.bin` = ESP, `littlefs.bin`/`Xenia_littlefs*.bin`/`Mahlkoenig_littlefs*.bin` = Web-Oberfläche, `baseboard.bin`/`Baseboard_*.bin` = Steuerplatine, `get_time` startet das Flashen der Steuerplatine). Antwort `{"error":3}` = OK, 2 = Flash fehlgeschlagen, 1 = falscher Modus. Nur bei ausgeschalteter Maschine (`MA_STATUS 0`). |
| 🟢 `GET /api/v2/upload/status` ✅ | `{"status":"good"}`, nur lesend |

---

## 14. Grind-by-Sync (Mühle ↔ Maschine)

Die Mahlkönig E64 WS ist mit der Xenia gekoppelt (`M2m.CoffeeMachinesConfig` in der Mühle: Host 192.168.178.55, Abfrage alle 2000 ms). Ablauf:

1. Die Mühle fragt `GET /api/v2/machine` (Identität) und alle ~2 s `GET /api/v2/mako` ab.
2. Mahlen ist nur erlaubt, wenn `MA_STATUS` 1 oder 4 ist, `BG_SENS_TEMP > BG_SET_TEMP − 2` gilt und `TANK_LEVEL == 1` ist. Sonst zeigt die Mühle z. B. „Xenia is warming up“.
3. Nach einem GbS-Mahlvorgang sendet die Mühle `POST /api/v2/brewratio {"SYNC_BEVERAGE_WEIGHT":…, "SYNC_FILTER":…}`.
4. Drehknopf an der Mühle → `POST /api/v2/scripts/execute {"ID":9}` startet den Bezug.
5. Die Mühle übernimmt `REAL_EXTRACTION_TIME_MS` beim Übergang auf `MA_STATUS 4`. Ihr Algorithmus passt den Mahlgrad an. Bezüge über 80 s oder mit `MA_EXTRACTION_STATUS 2` werden verworfen, bei ≤ 10 s wird nichts angepasst. Bezüge, die nicht die Mühle gestartet hat, zählen als Spülung.

Details zur Mühlenseite: [API-Muehle-E64WS.md](API-Muehle-E64WS.md). Druckprofile über den Drehknopf: Xenios kann zwischen Mühle und Xenia vermitteln und Skript 9 gegen ein Profil mit Stopp beim Zielgewicht (Befehl 27) tauschen, siehe [Einrichtung.md, Abschnitt 6](Einrichtung.md#6-grind-by-sync-mit-druckprofilen-optional).
