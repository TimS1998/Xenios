# Xenios – API des eigenen Servers

Die App spricht **nur** mit dieser API, nie direkt mit Maschine oder Mühle. Alle Antworten sind JSON. Fehler kommen als `{"error":"<Text>"}` mit passendem HTTP-Status (400 ungültig, 401 nicht angemeldet, 403 gesperrt/CSRF, 409 Konflikt, 429 zu viele Versuche, 502 Gerät nicht erreichbar).

## Sicherheit
- **Anmeldung:** `POST /auth/login` setzt ein HttpOnly-Cookie (`__Host-xs` über HTTPS, sonst `xs`), `SameSite=Lax`, gleitend gültig 90 Tage. Der Server speichert nur einen SHA-256-Hash des Tokens (`data/sessions.json`).
- **Android-App:** Statt Cookie geht auch `Authorization: Bearer <token>` (Token aus `POST /auth/device`).
- **CSRF-Schutz:** Jede Anfrage außer GET braucht den Header `X-Xenia: 1`. Ist ein `Origin`-Header gesetzt, muss er zum Host passen.
- **Brute-Force-Schutz:** Nach 5 Fehlversuchen pro IP 1 min Sperre, danach doppelt so lang, höchstens 1 h. Zusätzlich gilt eine globale Bremse von 30 Fehlversuchen pro 10 min. Das Passwort wird mit scrypt (N = 32768) gehasht.
- **Header:** strenge Content-Security-Policy (`default-src 'self'`, keine Inline-Skripte), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS über HTTPS.
- **Heimnetz-HTTP (optional, `lan`):** eigener Port ohne Verschlüsselung für die Android-App zu Hause. Proxy-Header werden dort nie ausgewertet.
- **Ersteinrichtung:** Solange kein Passwort gesetzt ist, schreibt der Server beim Start einen 8-stelligen **Einrichtungscode** ins Log. Nur damit lässt sich der Server im Browser einrichten (gleiche Sperre gegen Durchprobieren wie beim Login). Danach antworten die Einrichtungs-Endpunkte mit 409.
- **Server-Einstellungen:** Jeder Wert wird serverseitig geprüft (Adressen nur `http(s)://host[:port]` ohne Pfad, Ports, Zeitzonen, mindestens ein Zugang bleibt offen). Per Umgebungsvariable gesetzte Werte sind gesperrt.
- **Geheimnisse:** Mühlen-Passwort und privater Push-Schlüssel liegen AES-256-GCM-verschlüsselt in `config.json` (an den Feldnamen gebunden). Schlüssel: `XENIOS_SECRET_KEY` / `XENIOS_SECRET_KEY_FILE` oder `data/secret.key`.
- **Mühle:** Das Zertifikat wird direkt nach dem TLS-Handshake mit dem gemerkten Fingerprint verglichen, bevor Header, Cookie oder Passwort gesendet werden (ohne TLS-Sitzungswiederaufnahme, damit jedes Mal geprüft wird).
- **App-Shortcuts:** `/?do=on|off|eco|steam` schaltet nur bei Aufrufen ohne fremde Herkunft (`Sec-Fetch-Site` `none`/`same-origin`); ein Link von einer anderen Webseite wird auf `/` umgeleitet.
- **Push:** Abos nur für die Push-Dienste der Browser (Google, Mozilla, Apple, Microsoft).
- **Proxy:** `CF-Connecting-IP` und `X-Forwarded-Proto` werden nur auf dem HTTP-Tunnel-Port und nur von vertrauten Adressen (`trustProxy`) ausgewertet.

## Endpunkte

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/healthz` | – | `ok` (ohne Anmeldung, für Monitoring) |
| GET | `/auth/session` | – | `{"authenticated":bool,"setup":bool}` (`setup` = noch nicht eingerichtet) |
| POST | `/auth/setup/check` | `{"code"}` | Einrichtungscode prüfen (nur vor der Einrichtung) |
| POST | `/auth/setup/probe` | `{"code","kind":"machine"\|"grinder","url","password"?}` | Verbindung zu Xenia bzw. Mühle testen: `{ok,name,detail?,fingerprint?,login?}` |
| POST | `/auth/setup` | `{"code","password","machineUrl"?,"grinder"?:{enabled,url,password},"timezone"?}` | Ersteinrichtung abschließen; setzt das Sitzungs-Cookie |
| POST | `/auth/login` | `{"password":"…","remember":true}` | `{"ok":true}` + Cookie |
| POST | `/auth/logout` | – | `{"ok":true}` |
| POST | `/auth/device` | `{"password":"…","name":"Pixel 8"}` | `{"token","cookie","sessionDays"}`: eigene Sitzung für die Android-App (Token als Cookie bzw. `Authorization: Bearer`) |
| GET | `/api/sessions` | – | angemeldete Geräte (`id` gekürzt, `current` = diese Sitzung) |
| DELETE | `/api/sessions/:id` | – | ein Gerät abmelden (`{"self":bool}`) |
| POST | `/api/sessions/revoke-all` | – | alle Geräte abmelden |
| GET | `/api/admin/config` | – | Server-Einstellungen: `values` (Pfad → Wert, Passwörter leer), `secrets` (gesetzt?), `locked` (per Umgebungsvariable), `timezones`, `status` (Version, Zertifikat, gemerktes Mühlen-Zertifikat, Zugänge, Schlüsselquelle …) |
| PUT | `/api/admin/config` | `{"changes":{"machine.url":"http://…","features.paddle":false,…}}` | prüfen, in `config.json` speichern, sofort anwenden; Antwort wie GET plus `applied` |
| POST | `/api/admin/password` | `{"current","next"}` | App-Passwort ändern; alle anderen Sitzungen enden |
| POST | `/api/admin/probe` | `{"kind","url","password"?}` | Verbindungstest (bei gleicher Mühlen-Adresse mit gemerktem Zertifikat und gespeichertem Passwort) |
| POST | `/api/admin/grinder/unpin` | – | gemerktes Zertifikat der Mühle vergessen |
| POST | `/api/admin/tls/renew` | – | HTTPS-Zertifikat neu erzeugen (sofort aktiv) |
| GET | `/api/state` | – | `{machine, grinder, server}` (siehe unten) |
| GET | `/api/stream` | – | **Server-Sent Events**: `snapshot`, `machine`, `grinder`, `event`, `server` (Funktionen geändert); höchstens 50 gleichzeitig |
| GET | `/api/shots` | – | Bezugs-Protokoll (bis 500 Einträge, Druckkurven für die neuesten 20), `total` |
| GET | `/api/shots.csv` | – | gesamtes Protokoll als CSV (Excel, Semikolon) |
| GET | `/api/widget` | – | kompakter Zustand für Widgets/Kachel: `{online,status,label,heated,steamOn,steamReady,tankOk,group,groupSet,boiler,boilerSet,steam,steamSet,shot,next:{at,reason}|null}` |
| POST | `/api/machine/power` | `{"mode":"on"\|"off"\|"eco","steam":bool?}` | `{"ok":true}` |
| POST | `/api/machine/steam` | `{"on":bool}` | `{"ok":true}` |
| POST | `/api/machine/temperature` | `{"group":93.5,"boiler":93.5?}` | `{"ok":true}` |
| GET | `/api/machine/settings` | – | Rohwerte `/api/v2/general` |
| POST | `/api/machine/settings` | `{"changes":{"SB_SET_PRESS":1.4}}` | `{"ok":true}` (Grenzen wie Original-UI) |
| GET | `/api/machine/scripts` | – | `{scripts:[{id,title,type}], ops, builtin}` |
| GET | `/api/machine/scripts/:id` | – | `{id,title,content,steps:[{op,args}]}` |
| GET | `/api/machine/scripts/:id/export` | – | Datei `Xenia-<Titel>.script` (`{"<Titel>":"<Inhalt>"}`, wie die Original-UI) |
| POST | `/api/machine/scripts/import` | `{"file":"<Inhalt der .script-Datei>","name"?,"kind"?}` | Skript anlegen; Befehle werden geprüft und neu aufgebaut |
| POST | `/api/machine/scripts` | `{"name","steps":[{op,args}]}` | neues Skript |
| PUT | `/api/machine/scripts/:id` | `{"name","steps"}` | Skript ändern |
| DELETE | `/api/machine/scripts/:id` | – | Skript löschen (nur ID > 9) |
| POST | `/api/machine/scripts/:id/run` | – | Skript/Bezug starten (`7` einfach, `8` doppelt, `2` Dauerbezug) |
| POST | `/api/machine/scripts/stop` | – | `{"stopped":bool}` |
| GET / PUT | `/api/machine/switches` | `{"singleDoseG"?,"doubleDoseG"?,"buttons"?:{"RIGHT_RIGHT":{"short":7,"long":0},…}}` | Tastenbelegung (Skript-IDs) und Dosis-Gewichte |
| GET / PUT | `/api/machine/timers` | `{"days":[{day,on,off,brew,steam,enabled}×7],"ecoAfterMin","offAfterMin"}` | Zeiten in **Minuten seit Mitternacht** |
| POST | `/api/machine/clock/sync` | `{"tz":322}?` | Uhr der Maschine auf Serverzeit stellen, optional Zeitzone (Index aus `/api/machine/timezones`) wählen |
| GET / PUT | `/api/schedule` | `{"rules":[{"time":"06:30","days":[0,1,2,3,4],"action":"on"|"eco"|"off","enabled","label"}]}` | weitere Schaltzeiten, die der Server ausführt (Montag = 0, max. 50) |
| GET / PUT | `/api/wake` | `{"config":{"enabled","leadMin":15,"steam":null|bool,"from":"03:00","to":"11:00","days":[0..6]},"devices":{"<id>":bool}}` | Wecker-Automatik: Einstellungen, gemeldete Handys, geplantes Einschalten |
| POST | `/api/wake/alarm` | `{"next":<ms>|null}` | nächster Wecker dieses Geräts (Android-App, per Bearer) |
| DELETE | `/api/wake/devices/:id` | – | Handy aus der Wecker-Liste entfernen |
| GET | `/api/machine/timezones` | – | `{current, list:[{index,name}]}` |
| GET | `/api/machine/paddle` | – | `{status,pressure,supplyValve,drainValve}` |
| POST | `/api/machine/paddle` | `{"level":0..100}` | Pumpe direkt |
| POST | `/api/machine/paddle/stop` | – | Pumpe aus |
| GET | `/api/machine/details` | – | Maschine/Info/Netzwerk (Seriennummer und MACs gekürzt) |
| GET | `/api/raw/machine/<name>` | – | nur lesende Original-Endpunkte (Whitelist) zur Diagnose |
| GET | `/api/grinder` | – | Mühlen-Zustand |
| POST | `/api/grinder/refresh` | – | sofort neu einlesen |
| GET | `/api/grinder/grinds.csv` | – | Mahl-Log |
| GET | `/api/grinder/logs.zip` | – | Original-Log-ZIP |
| GET | `/api/grinder/database` | – | nur wenn `grinder.allowDatabaseDownload = true` |
| GET | `/api/push/key` | – | VAPID-Schlüssel und Themen |
| POST | `/api/push/subscribe` | `{"subscription", "prefs":{heated,shot,steam,tank,power,fault,offline,grinder}}` | Push anmelden/ändern |
| POST | `/api/push/prefs` | `{"endpoint"}` | Einstellungen dieses Geräts |
| POST | `/api/push/unsubscribe` | `{"endpoint"}` | abmelden |
| POST | `/api/push/test` | `{"endpoint"}` | Test-Benachrichtigung |

### `machine` (Auszug)
```json
{"online":true,"status":1,"statusKey":"on","statusLabel":"An","steamOn":true,
 "temp":{"group":93.4,"boiler":93.6,"groupSet":93.5,"boilerSet":93.5},
 "pressure":{"pump":0,"steam":1.58,"steamSet":1.6,"pumpSet":9},
 "power":{"group":12,"boiler":8,"pump":0},"scale":{"weight":0,"rate":0},"flow":{"volume":0,"rate":0,"ml":0},
 "shot":{"running":false,"timeMs":0,"curve":[]},"lastShot":{"timeMs":27000,"weight":37.8,"maxPressure":9,"curve":[[t,bar,g,ml],…]},
 "tankOk":true,"heated":true,"steamReady":true,"counters":{"extractions":351,"energyKwh":0.73},
 "clock":{"machine":"2026-08-07T09:00:20"}}
```

### Push-Ereignisse
| Thema | Auslöser |
|---|---|
| `heated` | Brühgruppe erreicht Solltemperatur − 0,8 °C (einmal pro Einschalten) |
| `shot` | Bezug beendet (≥ 3 s): Zeit, Gewicht/Menge, Maximaldruck |
| `steam` | Dampfdruck erreicht |
| `tank` | Wassertank leer |
| `power` | Maschine ein-/ausgeschaltet, **nicht** über die App (Timer, Taste, Auto-Aus) |
| `fault` | `MA_STATUS 6` |
| `offline` | Maschine 3 min nicht erreichbar / wieder erreichbar |
| `grinder` | wichtige Meldungen der Mühle (Behälter, Lüfter, Mahlgradverstellung, Waage) |

### Abfragerhythmus (schont den ESP32)
- App offen und Maschine an: 1 s · App offen und Maschine aus: 4 s · keine App offen: 5 s (an) / 10 s (aus)
- Einstellungen, Zähler, Tank: alle 60 s
- Mühle: alle 2 min (App offen), sonst alle 10 min
