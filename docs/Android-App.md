# Android-App

Native App (Kotlin, ohne Fremd-Bibliotheken, ab Android 11) im Ordner [`app/`](../app). Sie zeigt die Web-App des eigenen Servers und ergänzt, was eine Web-App nicht kann:

| Funktion | Beschreibung |
|---|---|
| **App-Fenster** | Die komplette Web-App (Dashboard, Home, Skripte, Schalter, Paddle, Timer, Mühle, Einstellungen). Sie ist immer auf dem Stand des Servers, ohne App-Update. |
| **Dashboard (Tablet)** | Übersicht, hochkant und quer: Schalter (Ein/Eco/Aus, Dampf, „Ohne Dampf einschalten“), Status, Instrumente (Druck, Brühgruppe, Brühkessel, Dampf), Live-Druckkurve während eines Bezugs (erscheint dann ganz oben), letzter Bezug und Mahlvorgang, Bezüge pro Tag, Bezugszeiten, Mahlgewichte, Verlauf. Über das Regler-Symbol oben rechts lassen sich Kacheln ein-/ausblenden, verschieben und in Breite (1–3 Spalten oder ganze Breite) und Höhe (1–4 Zellen) einstellen; Kacheln einer Zeile sind gleich hoch. Die Auswahl gilt pro Gerät. Dort auch „Beim Start öffnen“ und „Bildschirm anlassen“ (für ein Tablet an der Wand). |
| **Widgets** | 12 Widgets, in der Auswahl in dieser Reihenfolge (siehe unten). Symbole wie die Kacheln auf Home; Farben, Formen, Schrift und Anzeigen folgen dem Design der App (Material oder Xenia, hell/dunkel). Titel „Xenios – Name“, wo Platz ist. |
| **Schnelleinstellungs-Kachel** | Im Benachrichtigungs-Schatten: zeigt Aus/Heizt auf/Bereit/Eco und schaltet Ein/Aus. Nach dem Tippen zeigt sie sofort „Schaltet ein/aus …“ und wartet auf die Bestätigung der Maschine; weitere Tipps werden so lange ignoriert. |
| **Wecker-Automatik** | Die App meldet dem Server den nächsten Wecker des Handys (Android stellt nur den nächsten bereit; die Uhr-App von Google und die meisten Wecker-Apps tragen ihn dort ein). Der Server schaltet die Maschine eine einstellbare Zeit vorher ein. Bei mehreren Handys zählt der früheste. Einstellungen: *Timer → Wecker* (an/aus, Vorlauf, Dampfkessel, frühester/spätester Wecker, Wochentage, welche Handys zählen). „Wecker prüfen“ meldet den Wecker des Handys, auf dem die App gerade offen ist, sofort; „Alle Wecker in der Uhr-App ansehen“ öffnet die Wecker-Liste. Eine vollständige Liste aller Wecker gibt Android anderen Apps nicht heraus. Einträge verschwinden von selbst, sobald die Anmeldung des Handys endet oder es einen Tag lang keinen künftigen Wecker gemeldet hat; abgewählte Handys bleiben stehen, solange ihre Anmeldung gilt. |
| **App-Shortcuts** | Langdruck auf das App-Symbol: Einschalten, Eco, Ausschalten (ohne die App zu öffnen), Timer und Dashboard. Manche Launcher zeigen nur vier davon, dann fehlt der letzte („Dashboard“). Für ein Tablet stattdessen im Dashboard „Beim Start öffnen“ einschalten. |

### Widgets

| Widget | Größe | Inhalt |
|---|---|---|
| **Ein/Aus** | 2×1 | Ein Tipp schaltet ein (aus Aus oder Eco) bzw. aus; „Ohne Dampf einschalten“ der App gilt. |
| **Ein ohne Dampf/Aus** | 2×1 | Ein Tipp schaltet ohne Dampfkessel ein bzw. aus, unabhängig von der Einstellung. |
| **Ein/Eco/Aus** | 4×1 | Wie das frühere schmale Widget: Zustand und Brühgruppe links, Ein, Eco und Aus rechts in einer Zeile. |
| **Espressomaschine groß** | 4×3 | Status (Brühgruppe, Dampf, nächstes geplantes Einschalten), Plaketten Tank, Dampf, Waage verbunden (alte Xenia), Bezüge heute; Ein/Eco/Aus, Dampfkessel, „Ohne Dampf einschalten“. |
| **Schalter** | 4×2 | Wie die Kachel „Schalter“: Ein/Eco/Aus, Dampfkessel, „Ohne Dampf einschalten“, Zustand oben rechts. |
| **Instrumente** | 4×2 (2×2 bei schmalem Widget) | Druck, Brühgruppe, Brühkessel, Dampfkessel mit Zielen – Manometer (Xenia) oder flache Anzeigen (Material). |
| **Verlauf (10 min)** | 4×2 | Temperaturen und Drücke der letzten 10 Minuten. |
| **Letzter Bezug** | 2×2 | Bezugszeit, Ausbeute, Verhältnis und Kurve. |
| **Bezüge** | 4×2 | Letzter Bezug und Bezüge pro Tag. |
| **Bezüge groß** | 4×3 | Letzter Bezug, Bezüge pro Tag und Bezugszeiten. |
| **Sollwerte** | 2×2 | Brühgruppe, Brühkessel und Dampfdruck mit −/+. |
| **Pflege** | 2×1 | Wann der nächste Backflush fällig ist. |

Alle Widgets lassen sich in der Größe ändern; gezeichnet wird für jede Größe ein eigenes, passendes Bild (nichts wird gestreckt). Die Klickflächen der Widgets erzeugt [`app/tools/widgets_gen.py`](../app/tools/widgets_gen.py) zusammen mit `WidgetSpecs.kt`.

**Schalten:** Nach einem Tipp zeigt das Widget sofort den erwarteten Zustand („Schaltet ein …“, der gedrückte Knopf ist hervorgehoben und pulsiert), bis die Maschine ihn meldet (jede Sekunde nachgesehen, höchstens 8 s). So lange werden weitere Tipps auf Schalter ignoriert. Sollwerte und „Ohne Dampf einschalten“ ändern sich ebenfalls sofort; schnelle Tipps auf −/+ addieren sich.

**Aktualisierung:** Bei eingeschaltetem Bildschirm alle 5 s (kürzer lässt Android für Wecker nicht zu), solange die App selbst nicht offen ist; ohne Verbindung nach 5, 10, 30 und dann alle 60 s. Bei ausgeschaltetem Bildschirm wird nichts abgefragt und das Handy nicht geweckt; beim Einschalten oder Entsperren aktualisieren sich die Widgets sofort. Für den 5-Sekunden-Takt braucht die App die Erlaubnis **„Wecker und Erinnerungen“** (`SCHEDULE_EXACT_ALARM`): bis Android 13 automatisch erteilt, ab Android 14 einmal zu erlauben. Liegt ein Widget auf dem Startbildschirm und fehlt die Erlaubnis, weist die App einmalig darauf hin; *Einstellungen → Widgets* zeigt den Stand und öffnet die Einstellung. Ohne Erlaubnis bündelt Android die Wecker und die Widgets aktualisieren sich langsamer. Klappt ein Update nicht, bleibt der letzte Stand stehen; erst nach mehreren Fehlschlägen zeigt das Widget den Fehler. „Offline“ heißt: Der Server erreicht die Maschine nicht (zweimal in Folge keine Antwort).

## Anmeldung und Sicherheit
- Beim ersten Start fragt die App nach der **Server-Adresse** (Cloudflare, z. B. `https://xenia.example.com`), optional einer **lokalen Adresse** (z. B. `http://192.168.178.32`) und dem **App-Passwort**. Mindestens eine Adresse ist nötig.
- Ist die lokale Adresse erreichbar (Handy im WLAN), nutzen App, Widgets und Kachel sie, sonst automatisch die Cloudflare-Adresse. Die Wahl wird alle 2 min und bei Verbindungsfehlern neu getroffen.
- Der Server legt dafür eine eigene Sitzung an (`POST /auth/device`). Sie erscheint unter *Einstellungen → Sicherheit → Angemeldete Geräte* als `Android-App: <Gerätename>` und lässt sich dort widerrufen.
- Das Token liegt nur im app-privaten Speicher und ist vom Backup ausgeschlossen. Die WebView nutzt es als Cookie, Widgets und Kachel als `Authorization: Bearer`.
- Die Cloudflare-Adresse braucht **HTTPS mit gültigem Zertifikat**. **http** (unverschlüsselt) erlaubt die App nur für Adressen im eigenen Netz: private IPs (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) und Namen wie `*.fritz.box`, `*.local`. Im WLAN sind Passwort und Token damit im Klartext unterwegs, deshalb nur im eigenen, verschlüsselten WLAN nutzen. Das selbstsignierte Zertifikat auf Port 8443 akzeptiert die App nicht.
- Damit der Server unter `http://<PC-IP>/` antwortet, in `config.json` setzen: `"lan": { "enabled": true, "host": "0.0.0.0", "port": 80 }` und den Server neu starten. Die Windows-Firewall muss Node.js im privaten Netz erlauben (Standard-Abfrage beim ersten Start).
- **Cloudflare Access** (zusätzliche Anmeldeseite vor dem Tunnel) verträgt sich nicht mit Widgets: deren Aufrufe würden umgeleitet. Für die App den Tunnel ohne Access betreiben. Der Schutz übernimmt das App-Passwort mit Sperre gegen Durchprobieren.
- „Abmelden“ in der App oder ein widerrufenes Token führt zurück zur Anmeldung der App.

## Notbetrieb, wenn der Server ausfällt

Ist der Server nicht erreichbar, schaltet die App mit Server-Verbindung automatisch auf die Web-App aus der APK um und spricht die Maschine direkt an (wie im Direkt-Modus, nur im Heimnetz). Die IP der Maschine merkt sie sich vom Server. Widgets und Kachel schalten dann ebenfalls direkt. Ein Hinweis unten bietet „Server“ an, um es erneut über den Server zu versuchen. Zeitplan, Wecker-Automatik und das Bezugs-Protokoll des Servers gibt es im Notbetrieb nicht.

## Direkt-Modus (ohne Server, nur im Heimnetz)
Bei der Einrichtung „Direkt im Heimnetz“ wählen und dieselbe Umschaltung wie am Server: **Neue Xenia** (Brew-by-Sync) oder **Alte Xenia** (DBL / offizielle API). Die IP-Adressen von Maschine und optional der Mühle eintragen, dazu optional das Owner-Passwort der Mühle. Ohne Mühle bleiben Mühlen-Navigation, Kacheln und Grind-by-Sync aus; Dosis und Mahlgrad trägt man beim Bezug selbst ein. Bei der alten API blendet die App Paddle, den Wochenplan der Maschine und „Uhr stellen“ aus und zählt die Bezugszeit selbst. Die App bringt die Web-Oberfläche selbst mit und nutzt denselben Geräte-Code wie der Server (`public/shared/`). Sie spricht Maschine (http) und Mühle (https mit gemerktem Zertifikat) direkt an. Widgets, Kachel und Shortcuts funktionieren ebenfalls.

Ohne Server entfallen Push-Benachrichtigungen, die weiteren Schaltzeiten, das Einschalten vor dem Wecker und der Zugriff von unterwegs.

**IP-Adressen finden**
1. In der Einrichtung **„Im WLAN suchen“** tippen. Die App fragt alle Geräte im eigenen WLAN ab (x.x.x.1–254); ein Fortschrittsbalken zeigt, wie viele Adressen abgefragt und wie viele Geräte gefunden sind. Dieselbe Suche gibt es bei „Mit Server“ für den Xenios-Server (HTTPS Port 8443, HTTP 80/8080), jeweils mit Anleitung daneben.
2. Oder in der Fritz!Box: `fritz.box` → *Heimnetz → Netzwerk → Netzwerkverbindungen*. Die Maschine heißt meist **ESP32-…** bzw. **espressif**, die Mühle **hemro_hsg_…** (Hemro).
3. Bei beiden Geräten dort „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“ anhaken.
4. Prüfen: `http://<IP>/` zeigt die Xenia-Oberfläche. Für die Mühle `https://<IP>/` öffnen und die Zertifikatswarnung bestätigen.

## App-Update

*Einstellungen → App auf diesem Gerät → App-Update* zeigt die installierte Version (z. B. `2.4.0 (380)`) und, falls es eine gibt, die neue. Der Knopf heißt dann **Installieren** (bzw. **Herunterladen**, siehe Varianten), sonst **Prüfen**. Apps ohne diese Funktion zeigen den Eintrag nicht; die erste Version mit App-Update einmal von Hand installieren (siehe [Installieren](#installieren)). Im Server-Modus braucht auch der Server mindestens Version 2.5.1, denn die Einstellungsseite kommt von ihm.

**Zwei Varianten.** Jedes Release enthält die App zweimal, mit gleicher Build-Nummer und gleichem Schlüssel:

| Datei | Updates |
|---|---|
| `Xenios-<Build>.apk` | **Mit Updater:** lädt und installiert neue Versionen selbst (Ablauf unten). Dafür braucht die App das Recht, APKs zu installieren (`REQUEST_INSTALL_PACKAGES`). Deshalb kann Google Play Protect beim Installieren warnen („App may be harmful“ / „Möglicherweise schädliche App“); über die Details der Warnung lässt sie sich trotzdem installieren. |
| `Xenios-<Build>-ohne-Updater.apk` | **Ohne Updater:** ohne dieses Recht und ohne Installations-Code, deshalb ohne diese Warnung. Die App prüft und meldet neue Versionen genauso; „Herunterladen“ öffnet die passende APK im Browser, installiert wird von Hand. |

Wechseln geht jederzeit: die andere Variante drüber installieren, Anmeldung und Einstellungen bleiben. Jede Variante sucht im Release nur ihre eigene Datei. Der Unterschied steckt in den Gradle-Flavors `updater` und `manuell` (`app/app/src/updater/`, `app/app/src/manuell/`).

**Im Server-Modus** kommt die Oberfläche vom Server und ist mit jedem Server-Update aktuell, auch ohne neue APK. Ein App-Update braucht es nur für die nativen Teile: Widgets, Schnelleinstellungs-Kachel, Wecker-Meldung, Shortcuts, Notbetrieb und den Direkt-Modus (dort steckt die ganze Oberfläche in der APK).

**Ablauf (mit Updater)**
1. **Prüfen:** Beim Öffnen der App höchstens einmal am Tag, dazu jederzeit über „Prüfen“. Die App fragt `https://api.github.com/repos/TimS1998/Xenios/releases/latest` ab, sucht das Asset ihrer Variante (`Xenios-<Build>.apk` bzw. `Xenios-<Build>-ohne-Updater.apk`) und vergleicht `<Build>` mit der eigenen Build-Nummer (`versionCode`, die Zahl der Commits). Mitgeschickt wird nur die Build-Nummer im User-Agent. Offline oder bei gebremstem Zugriff (GitHub erlaubt ohne Anmeldung 60 Anfragen pro Stunde) passiert beim automatischen Prüfen nichts, der nächste Versuch kommt frühestens nach einer Stunde. Auf Knopfdruck steht der Grund im Eintrag.
2. **Hinweis:** Gibt es eine neue Version, erscheint einmal ein Hinweis unten in der App („App-Update … verfügbar“, „Ansehen“ öffnet die Einstellungen). Eine Android-Benachrichtigung gibt es nicht.
3. **Laden:** „Installieren“ lädt die APK in den Cache der App. Geladen wird nur ein Asset aus einem Release dieses Repos (`https://github.com/TimS1998/Xenios/releases/download/…`). Größe und SHA-256 müssen zu den Angaben von GitHub passen. Danach prüft die App Paketname, Build-Nummer und Signaturschlüssel der APK.
4. **Installieren:** über den `PackageInstaller` von Android (Session). Android beendet die App dabei und ersetzt sie. Danach die App wieder öffnen; Anmeldung, Einstellungen und Widgets bleiben. Ob Play Protect auch hier warnt, ist auf echter Hardware noch nicht geprüft.

Ohne Updater enden Schritt 3 und 4 im Browser: Er lädt `Xenios-<Build>-ohne-Updater.apk`, installiert wird wie beim ersten Mal.

Die Adresse des Repos steht fest in [`AppUpdate.kt`](../app/app/src/main/java/app/xeniabridge/AppUpdate.kt). Ein Fork mit eigenen Releases muss sie dort ändern.

**Einmal nötig: „Unbekannte Apps installieren“ für Xenios.** Fehlt die Erlaubnis, öffnet „Installieren“ die passende Android-Einstellung (meist *Apps → Spezieller App-Zugriff → Unbekannte Apps installieren*). Wer sie erlaubt und innerhalb von 10 Minuten zur App zurückkehrt, muss nicht noch einmal tippen: Das Update läuft dann von selbst weiter.

**Ohne Rückfrage oder mit Dialog?** Ab Android 12 bittet die App darum, das Update ohne Rückfrage zu installieren (`setRequireUserAction(USER_ACTION_NOT_REQUIRED)` mit der Berechtigung `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, die Android ohne Abfrage erteilt). Laut [Android-Dokumentation](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)) gelingt das nur, wenn alles zutrifft:
- „Unbekannte Apps installieren“ ist für Xenios erlaubt.
- Es ist ein Update, und der Installer ist der bisherige Installer der App, ihr „Update-Owner“ oder die App selbst. Xenios aktualisiert sich selbst; dieser Fall steht ausdrücklich in der Liste. Ob die erste Installation über den Browser oder einen Dateimanager lief, spielt deshalb keine Rolle.
- Die neue APK zielt auf eine ausreichend neue Android-Version (`targetSdk`). Android 16 verlangt mindestens 34, die Version danach 35; Xenios hat 36. Hebt Android die Grenze weiter an, kommt wieder der Dialog, bis die App nachzieht.

Sonst zeigt Android den üblichen Bestätigungsdialog, und die App öffnet ihn selbst. Das ist der Fall:
- unter **Android 11**: Die Installation ohne Rückfrage gibt es dort noch nicht, also immer mit Dialog.
- wenn ein **App-Store** die App installiert und dabei die Update-Zuständigkeit für sich beansprucht hat (Android 14+). Dann fragt Android bei Updates aus anderer Quelle nach.
- bei der **Entwickler-Verifizierung** von Android für Apps außerhalb des Play Store: Ist sie nicht erreichbar oder schlägt sie fehl, fragt Android nach oder bricht die Installation ab. Für die Installation von Hand gilt dasselbe.

Ist die App beim Dialog nicht im Vordergrund, erscheint er beim nächsten Öffnen. Bricht man ihn ab, bleibt die geladene APK im Cache und „Installieren“ startet ohne neuen Download.

**Was Android immer verlangt:** Das Update muss mit **demselben Schlüssel** signiert sein wie die installierte App (siehe [APK bauen](#apk-bauen)). Eine Release-App lässt sich deshalb nicht per Knopf durch eine APK mit Debug-Schlüssel ersetzen und umgekehrt; die App meldet das vor der Installation. Ein älteres Build installiert Android nie über ein neueres.

## Noch nicht enthalten
- **Push-Benachrichtigungen** in der App. Die Web-App nutzt Web-Push, das in einer WebView nicht verfügbar ist. Native Push bräuchte Firebase Cloud Messaging. Bis dahin: Benachrichtigungen über die Web-App in Chrome.

## APK bauen

### Per GitHub Actions (empfohlen)
Der Workflow [`.github/workflows/app.yml`](../.github/workflows/app.yml) baut bei jeder Änderung in `app/` oder `server/web/` (oder manuell über *Actions → Android-App bauen → Run workflow*) die signierte APK in beiden Varianten (`Xenios-<Build>.apk` mit Updater, `Xenios-<Build>-ohne-Updater.apk` ohne). Sie liegen danach im Artefakt **Xenios-APK** am Lauf.

**Releases:** Ein Tag `v*` (z. B. `git tag v2.0.0 && git push origin v2.0.0`) startet [`release.yml`](../.github/workflows/release.yml). Das erzeugt ein GitHub-Release mit beiden APKs zum Herunterladen (die Release-Notizen erklären den Unterschied) und veröffentlicht das Docker-Image in GitHub Packages.

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
Ordner `app/` in Android Studio öffnen und *Run* drücken (Variante mit Updater; die andere unter *Build Variants* → `manuellDebug`). Für Release-APKs die Umgebungsvariablen `XENIOS_KEYSTORE`, `XENIOS_KEYSTORE_PASSWORD`, `XENIOS_KEY_ALIAS` und `XENIOS_KEY_PASSWORD` setzen und `gradle assembleRelease` ausführen (baut beide Varianten).

## Installieren
1. APK auf das Handy laden (Artefakt-ZIP entpacken bzw. aus dem Release). Welche der beiden Varianten, steht unter [App-Update](#app-update).
2. Öffnen und „Aus unbekannten Quellen installieren“ für den Browser bzw. Dateimanager erlauben. Neuere Android-Versionen geben das erst in den Entwickleroptionen frei, oft mit einem Fenster von 24 Stunden. Der Weg unterscheidet sich je nach Handy.
3. App starten und eine der beiden Arten wählen.
   - **Mit Server:** Adresse und App-Passwort. Die Oberfläche kommt vom Server. Nach einem Server-Update reicht die vorhandene App, siehe [Linux, Aktualisieren](Installation-Linux-Docker.md#8-aktualisieren-und-sichern).
   - **Direkt im Heimnetz:** **Neue Xenia** oder **Alte Xenia**, dazu die IP der Maschine und optional die Mühle. Diese Wahl und die Oberfläche dafür liegen in der APK. Ab Release 2.2.0 ist die alte Xenia im Direkt-Modus enthalten.
4. Widgets: Startbildschirm lange drücken → *Widgets* → *Xenios*. Kachel: Schnelleinstellungen bearbeiten → *Xenios* hineinziehen.

Spätere Versionen meldet *Einstellungen → App-Update*. Mit Updater installiert die App sie selbst, ohne Updater öffnet sie den Download (siehe [App-Update](#app-update)).

## Test mit der Simulation
```bash
cd server
npm run mock
npm run dev
```
Im Emulator als Server-Adresse `http://10.0.2.2:<Port aus config.dev.json>` eingeben.
