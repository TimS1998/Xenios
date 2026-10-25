# Android-App

Native App (Kotlin, ohne Fremd-Bibliotheken, ab Android 11) im Ordner [`app/`](../app). Sie zeigt die Web-App des eigenen Servers und ergänzt, was eine Web-App nicht kann:

| Funktion | Beschreibung |
|---|---|
| **App-Fenster** | Die komplette Web-App (Dashboard, Home, Skripte, Schalter, Paddle, Timer, Mühle, Einstellungen). Sie ist immer auf dem Stand des Servers, ohne App-Update. |
| **Dashboard (Tablet)** | Übersicht nur zum Ansehen, hochkant und quer: Status, Instrumente, Live-Druckkurve während eines Bezugs (erscheint dann ganz oben), letzter Bezug und Mahlvorgang, Bezüge pro Tag, Bezugszeiten, Mahlgewichte, Verlauf. Über das Regler-Symbol oben rechts lassen sich Kacheln ein-/ausblenden, verschieben und auf volle Breite stellen; die Auswahl gilt pro Gerät. Dort auch „Beim Start öffnen“ und „Bildschirm anlassen“ (für ein Tablet an der Wand). |
| **Widget „Kaffeemaschine Ein/Aus“** (1×1) | Ein Tipp schaltet ein (aus Aus oder Eco) bzw. aus. Die Farbe zeigt den Zustand: grau = aus, blau = heizt, grün = bereit, gelb = Eco, rot = offline. |
| **Widget „Kaffeemaschine“** (3×2, veränderbar) | Status, Brühtemperatur mit Ziel, Dampfdruck, Tank-Warnung und die Knöpfe **Ein / Eco / Aus**. Ist die Maschine aus, ist nur „Ein“ bedienbar. Antippen der Kopfzeile öffnet die App, ↻ aktualisiert. |
| **Widget „Kaffeemaschine schmal“** (4×1) | Status und Temperatur, Ein / Eco / Aus in einer Zeile. |
| **Widget „Kaffeemaschine groß“** (4×2) | Status, Brühgruppe mit Ziel, Brühkessel, Dampfdruck, **nächstes geplantes Einschalten** (Wecker oder Server-Zeitplan) und Ein / Eco / Aus. |
| **Schnelleinstellungs-Kachel** | Im Benachrichtigungs-Schatten: zeigt Aus/Heizt auf/Bereit/Eco und schaltet Ein/Aus. |
| **Wecker-Automatik** | Die App meldet dem Server den nächsten Wecker des Handys (Android stellt nur den nächsten bereit; die Uhr-App von Google und die meisten Wecker-Apps tragen ihn dort ein). Der Server schaltet die Maschine eine einstellbare Zeit vorher ein. Bei mehreren Handys zählt der früheste. Einstellungen: *Timer → Wecker* (an/aus, Vorlauf, Dampfkessel, frühester/spätester Wecker, Wochentage, welche Handys zählen). „Wecker prüfen“ meldet den Wecker des Handys, auf dem die App gerade offen ist, sofort; „Alle Wecker in der Uhr-App ansehen“ öffnet die Wecker-Liste. Eine vollständige Liste aller Wecker gibt Android anderen Apps nicht heraus. |
| **App-Shortcuts** | Langdruck auf das App-Symbol: Einschalten, Eco, Ausschalten (ohne die App zu öffnen), Timer und Dashboard. Manche Launcher zeigen nur vier davon, dann fehlt der letzte („Dashboard“). Für ein Tablet stattdessen im Dashboard „Beim Start öffnen“ einschalten. |

Widgets aktualisieren sich beim Schalten, beim Verlassen der App, alle 30 min und während des Aufheizens alle 2 min.

## Anmeldung und Sicherheit
- Beim ersten Start fragt die App nach der **Server-Adresse** (Cloudflare, z. B. `https://xenia.example.com`), optional einer **lokalen Adresse** (z. B. `http://192.168.178.32`) und dem **App-Passwort**. Mindestens eine Adresse ist nötig.
- Ist die lokale Adresse erreichbar (Handy im WLAN), nutzen App, Widgets und Kachel sie, sonst automatisch die Cloudflare-Adresse. Die Wahl wird alle 2 min und bei Verbindungsfehlern neu getroffen.
- Der Server legt dafür eine eigene Sitzung an (`POST /auth/device`). Sie erscheint unter *Einstellungen → Angemeldete Geräte* als `Android-App: <Gerätename>` und lässt sich dort widerrufen.
- Das Token liegt nur im app-privaten Speicher und ist vom Backup ausgeschlossen. Die WebView nutzt es als Cookie, Widgets und Kachel als `Authorization: Bearer`.
- Die Cloudflare-Adresse braucht **HTTPS mit gültigem Zertifikat**. **http** (unverschlüsselt) erlaubt die App nur für Adressen im eigenen Netz: private IPs (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) und Namen wie `*.fritz.box`, `*.local`. Im WLAN sind Passwort und Token damit im Klartext unterwegs, deshalb nur im eigenen, verschlüsselten WLAN nutzen. Das selbstsignierte Zertifikat auf Port 8443 akzeptiert die App nicht.
- Damit der Server unter `http://<PC-IP>/` antwortet, in `config.json` setzen: `"lan": { "enabled": true, "host": "0.0.0.0", "port": 80 }` und den Server neu starten. Die Windows-Firewall muss Node.js im privaten Netz erlauben (Standard-Abfrage beim ersten Start).
- **Cloudflare Access** (zusätzliche Anmeldeseite vor dem Tunnel) verträgt sich nicht mit Widgets: deren Aufrufe würden umgeleitet. Für die App den Tunnel ohne Access betreiben. Der Schutz übernimmt das App-Passwort mit Sperre gegen Durchprobieren.
- „Abmelden“ in der App oder ein widerrufenes Token führt zurück zur Anmeldung der App.

## Direkt-Modus (ohne Server, nur im Heimnetz)
Bei der Einrichtung „Direkt im Heimnetz“ wählen und dieselbe Umschaltung wie am Server: **Neue Xenia** (Brew-by-Sync) oder **Alte Xenia** (DBL / offizielle API). Die IP-Adressen von Maschine und optional der Mühle eintragen, dazu optional das Owner-Passwort der Mühle. Ohne Mühle bleiben Mühlen-Navigation, Kacheln und Grind-by-Sync aus; Dosis und Mahlgrad trägt man beim Bezug selbst ein. Bei der alten API blendet die App Paddle, den Wochenplan der Maschine und „Uhr stellen“ aus und zählt die Bezugszeit selbst. Die App bringt die Web-Oberfläche selbst mit und nutzt denselben Geräte-Code wie der Server (`public/shared/`). Sie spricht Maschine (http) und Mühle (https mit gemerktem Zertifikat) direkt an. Widgets, Kachel und Shortcuts funktionieren ebenfalls.

Ohne Server entfallen Push-Benachrichtigungen, die weiteren Schaltzeiten, das Einschalten vor dem Wecker und der Zugriff von unterwegs.

**IP-Adressen finden**
1. In der Einrichtung **„Im WLAN suchen“** tippen. Die App fragt alle Geräte im eigenen WLAN ab (x.x.x.1–254).
2. Oder in der Fritz!Box: `fritz.box` → *Heimnetz → Netzwerk → Netzwerkverbindungen*. Die Maschine heißt meist **ESP32-…** bzw. **espressif**, die Mühle **hemro_hsg_…** (Hemro).
3. Bei beiden Geräten dort „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“ anhaken.
4. Prüfen: `http://<IP>/` zeigt die Xenia-Oberfläche. Für die Mühle `https://<IP>/` öffnen und die Zertifikatswarnung bestätigen.

## Noch nicht enthalten
- **Push-Benachrichtigungen** in der App. Die Web-App nutzt Web-Push, das in einer WebView nicht verfügbar ist. Native Push bräuchte Firebase Cloud Messaging. Bis dahin: Benachrichtigungen über die Web-App in Chrome.

## APK bauen

### Per GitHub Actions (empfohlen)
Der Workflow [`.github/workflows/app.yml`](../.github/workflows/app.yml) baut bei jeder Änderung in `app/` oder `server/web/` (oder manuell über *Actions → Android-App bauen → Run workflow*) eine signierte APK. Sie liegt danach als Artefakt **Xenios-APK** am Lauf.

**Releases:** Ein Tag `v*` (z. B. `git tag v2.0.0 && git push origin v2.0.0`) startet [`release.yml`](../.github/workflows/release.yml). Das erzeugt ein GitHub-Release mit der APK zum Herunterladen und veröffentlicht das Docker-Image in GitHub Packages.

Damit Updates sich über die installierte App installieren lassen, muss jede APK mit **demselben Schlüssel** signiert sein. Dafür im Repository unter *Settings → Secrets and variables → Actions* vier Secrets anlegen:

| Secret | Inhalt |
|---|---|
| `XENIOS_KEYSTORE_BASE64` | Keystore als Base64 |
| `XENIOS_KEYSTORE_PASSWORD` | Keystore-Passwort |
| `XENIOS_KEY_ALIAS` | `xenia` |
| `XENIOS_KEY_PASSWORD` | Schlüssel-Passwort |

Den Keystore in `app/keystore/` ablegen (wird nie eingecheckt, siehe `.gitignore`). Liegen dort die vier Werte als Dateien, setzt die GitHub-CLI sie so:
```bash
cd app/keystore
for s in XENIOS_KEYSTORE_BASE64 XENIOS_KEYSTORE_PASSWORD XENIOS_KEY_ALIAS XENIOS_KEY_PASSWORD; do gh secret set "$s" < "$s.txt"; done
```
**Den Ordner `app/keystore/` sicher aufbewahren.** Ohne den Schlüssel lassen sich keine Updates mehr über die vorhandene App installieren, nur neu installieren.

Ohne Secrets baut der Workflow trotzdem, signiert aber mit einem wechselnden Debug-Schlüssel.

### Lokal (Android Studio)
Ordner `app/` in Android Studio öffnen und *Run* drücken. Für eine Release-APK die Umgebungsvariablen `XENIOS_KEYSTORE`, `XENIOS_KEYSTORE_PASSWORD`, `XENIOS_KEY_ALIAS` und `XENIOS_KEY_PASSWORD` setzen und `gradle assembleRelease` ausführen.

## Installieren
1. APK auf das Handy laden (Artefakt-ZIP entpacken bzw. aus dem Release).
2. Öffnen und „Aus unbekannten Quellen installieren“ für den Browser bzw. Dateimanager erlauben. Neuere Android-Versionen geben das erst in den Entwickleroptionen frei, oft mit einem Fenster von 24 Stunden. Der Weg unterscheidet sich je nach Handy.
3. App starten und eine der beiden Arten wählen.
   - **Mit Server:** Adresse und App-Passwort. Die Oberfläche kommt vom Server. Nach einem Server-Update reicht die vorhandene App, siehe [Linux, Aktualisieren](Installation-Linux-Docker.md#8-aktualisieren-und-sichern).
   - **Direkt im Heimnetz:** **Neue Xenia** oder **Alte Xenia**, dazu die IP der Maschine und optional die Mühle. Diese Wahl und die Oberfläche dafür liegen in der APK. Ab Release 2.2.0 ist die alte Xenia im Direkt-Modus enthalten.
4. Widgets: Startbildschirm lange drücken → *Widgets* → *Xenios*. Kachel: Schnelleinstellungen bearbeiten → *Xenios* hineinziehen.

## Test mit der Simulation
```bash
cd server
npm run mock
npm run dev
```
Im Emulator als Server-Adresse `http://10.0.2.2:<Port aus config.dev.json>` eingeben.
