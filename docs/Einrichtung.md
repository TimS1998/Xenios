# Einrichtung: Server, Cloudflare-Tunnel, Android-App

```
 Handy (App/PWA) ──HTTPS──► Cloudflare ──Tunnel (verschlüsselt, ausgehend)──► cloudflared ─► Xenios (127.0.0.1:8080)
                                                                                                   │  HTTP  ──► Xenia 192.168.178.55
 Handy im WLAN ─────────────HTTPS (selbstsigniert, Port 8443)─────────────────────────────► Bridge  │  HTTPS ──► Mühle 192.168.178.54
```

- Im Router wird **kein Port** freigegeben. Der Tunnel baut nur eine ausgehende Verbindung auf.
- Maschine und Mühle bleiben im Heimnetz. Nur der Server spricht mit ihnen.
- Ohne App-Passwort geht nichts (Login-Seite, Sitzungs-Cookie).

## 1. Server installieren (Windows-PC, läuft dauerhaft)

1. **Node.js 20 LTS oder neuer** installieren: `winget install OpenJS.NodeJS.LTS`
2. Repository herunterladen (z. B. nach `C:\Xenios`) und im Unterordner `server` ein Terminal öffnen.
3. Starten:
   ```powershell
   npm start
   ```
   Beim ersten Start erzeugt der Server Push-Schlüssel, ein TLS-Zertifikat und den Schlüssel für die Geheimnisse und zeigt einen **Einrichtungscode** an.
4. Im Browser einrichten: am PC <http://127.0.0.1:8080>, im WLAN `https://<IP-des-PCs>:8443` (Zertifikatswarnung einmal bestätigen; den Fingerprint zeigt das Konsolenfenster). Abgefragt werden:
   - der Einrichtungscode
   - das **App-Passwort** (mind. 10 Zeichen, nur als scrypt-Hash gespeichert)
   - die Adresse der Xenia, mit Verbindungstest
   - optional Adresse und **Owner-Passwort der Mühle**, mit Test der Anmeldung (verschlüsselt in `config.json`)

   Ohne Browser geht es auch im Terminal: `npm run setup`.
5. **Autostart** (als Administrator in PowerShell):
   ```powershell
   powershell -ExecutionPolicy Bypass -File server\deploy\windows\install-autostart.ps1
   ```
   Das legt die Aufgabe „Xenios“ an. Sie startet beim Hochfahren und bei Abstürzen neu. Das Log liegt in `server\data\server.log`.

> Tipp: Der PC darf nicht in den Ruhezustand gehen (Energieoptionen). Alternativ läuft der Server auch auf einem Raspberry Pi oder NAS, siehe unten.

## 2. Cloudflare-Tunnel

Voraussetzung: eine eigene Domain bei Cloudflare (kostenloser Tarif reicht).

Der Einrichtungs-Assistent (Schritt „Unterwegs“) und *Einstellungen → Server & Sicherheit → Von unterwegs* zeigen die Schritte passend zur Installation, mit der richtigen **Service URL** zum Kopieren: in Docker `http://xenios:8080`, sonst `http://127.0.0.1:8080`. Dort die öffentliche Adresse eintragen und **Testen**: Der Server ruft sich selbst über die Adresse auf und prüft, dass wirklich er antwortet. Mit gesetzter Adresse wird sie auch Kontakt für die Push-Dienste, solange dort noch der Platzhalter steht.

Mit Docker: siehe [Abschnitt 4](#4-alternativ-linux-server-raspberry-pi-oder-nas-mit-docker) (Token in `docker/.env`). Ohne Docker:

**Variante A – Dashboard (am einfachsten):**
1. <https://one.dash.cloudflare.com> → *Networks* → *Tunnels* → **Create a tunnel** → *Cloudflared* → Name `xenios`.
2. cloudflared auf dem PC installieren: `winget install --id Cloudflare.cloudflared`
3. Den angezeigten Befehl `cloudflared.exe service install <TOKEN>` als Administrator ausführen. Damit läuft der Tunnel als Windows-Dienst.
4. *Public Hostname* anlegen: Subdomain z. B. `xenios`, Domain `deine-domain.de`, **Service URL `http://127.0.0.1:8080`**.
5. In Cloudflare unter *SSL/TLS* → *Edge Certificates*: **Always Use HTTPS** einschalten und **Minimum TLS 1.2** setzen.

**Variante B – Konfigurationsdatei:** siehe [`server/deploy/cloudflared/config.yml`](../server/deploy/cloudflared/config.yml).

Danach ist die App unter `https://xenios.deine-domain.de` erreichbar.

### Empfohlene Härtung in Cloudflare (optional)
- **WAF → Rate limiting rule:** Pfad `/auth/login`, 10 Anfragen pro Minute pro IP → Block. Das ergänzt die Sperre im Server.
- **WAF → Custom rule:** nur Zugriffe aus Deutschland erlauben (`ip.geoip.country ne "DE"` → Block), falls ihr nur hier seid.
- **Cloudflare Access** (Zero Trust, z. B. E-Mail-Einmalcode) als zweite Hürde vor dem App-Passwort. Der Nachteil: Etwa einmal im Monat muss man den Code erneut eingeben. Push und App funktionieren weiter.

## 3. Android-App installieren

1. In **Chrome** `https://xenia.deine-domain.de` öffnen und mit dem App-Passwort anmelden (Haken „angemeldet bleiben“).
2. Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“. Danach läuft die App im Vollbild mit eigenem Symbol, ohne Signatur und ohne Play Store.
3. **Benachrichtigungen:** App → Einstellungen → Benachrichtigungen → einschalten und erlauben. Danach die gewünschten Themen wählen und „Test senden“ antippen.
4. **Shortcuts:** Lange auf das App-Symbol drücken. Angeboten werden Einschalten, Ausschalten, Eco und Timer (in der nativen Android-App zusätzlich Dashboard).

Hinweis: Installierbar ist die App nur über eine echte HTTPS-Adresse (Cloudflare). Über `https://<IP>:8443` mit selbstsigniertem Zertifikat lässt sie sich im WLAN zwar bedienen, aber Chrome bietet keine Installation und kein Push an.

## 4. Alternativ: Linux-Server, Raspberry Pi oder NAS mit Docker

Voraussetzung: Docker mit Compose-Plugin, der Server steht im selben Heimnetz wie Maschine und Mühle. Alle Befehle im Ordner `docker/`:

```bash
cd docker
docker compose up -d                 # baut das Image aus ../server und startet den Server
docker compose logs xenios           # Einrichtungscode ablesen
```
Dann `https://<IP-des-Servers>:8443` öffnen und der Einrichtung folgen (wie oben).

- **Fertiges Image statt selbst bauen:** Jedes Release veröffentlicht das Image in GitHub Packages (amd64 und arm64). In `docker/.env`: `XENIOS_IMAGE=ghcr.io/tims1998/xenios:latest` und `XENIOS_PULL=always`.
- **Daten** (Konfiguration, Schlüssel, Zertifikat, Sitzungen, Bezüge) liegen im Volume `xenios_xenios-data`. Sicherung: `docker run --rm -v xenios_xenios-data:/d -v "$PWD":/b alpine tar czf /b/xenios-backup.tgz -C /d .` (enthält `secret.key`, also sicher aufbewahren).
- **Zertifikat:** Im Container kennt der Server die LAN-IP des Rechners nicht. In der App unter *Server & Sicherheit → Weitere Namen/IPs fürs Zertifikat* die IP bzw. den Hostnamen eintragen; das Zertifikat wird sofort neu erzeugt.
- **Ports und Pfade** sind im Container fest (Umgebungsvariablen im `Dockerfile`) und in der App als gesperrt markiert. Den HTTPS-Port auf dem Rechner ändert `XENIOS_HTTPS_PORT` in `.env`. Unter Linux umgehen Docker-Ports `ufw`; mit `XENIOS_HTTPS_PORT=<LAN-IP>:8443` lauscht der Port nur im Heimnetz.
- **Cloudflare-Tunnel** im selben Compose: `cp .env.example .env`, `TUNNEL_TOKEN` und `COMPOSE_PROFILES=tunnel` eintragen, dann `docker compose up -d`. Im Dashboard den Public Hostname auf **`http://xenios:8080`** setzen (Container-Name statt localhost). Port 8080 ist bewusst nicht nach außen veröffentlicht.
- **Aktualisieren:** `git pull && docker compose up -d` (mit fertigem Image nur `docker compose up -d`).
- Härtung: schreibgeschütztes Dateisystem, eigener Benutzer statt root, keine Linux-Capabilities, Speicher- und Prozessgrenzen (siehe `compose.yaml`).

Oder ohne Docker mit systemd: [`server/deploy/linux/xenios.service`](../server/deploy/linux/xenios.service).

## 5. Einstellungen

Alles lässt sich in der App unter **Einstellungen → Server & Sicherheit** ändern. Die Werte landen in `config.json` und wirken sofort, auch Ports und Zertifikat (die Zugänge werden ohne Neustart neu gebunden).

| In der App | Schlüssel in `config.json` | Standard |
|---|---|---|
| Adresse der Xenia (mit Verbindungstest) | `machine.url` | `http://192.168.178.55` |
| Mühle an/aus, Adresse, Owner-Passwort | `grinder.enabled` / `grinder.url` / `grinder.password` (verschlüsselt) | an / `https://192.168.178.54` / – |
| Gemerktes Zertifikat der Mühle vergessen | `data/grinder-pin.json` | – |
| Datenbank-Download (enthält das WLAN-Passwort!) | `grinder.allowDatabaseDownload` | aus |
| Funktionen der App | `features.paddle` / `scriptEditor` / `settings` / `clockSync` | an |
| Zeitzone für Zeitplan und Wecker | `timezone` | System bzw. `TZ` |
| App-Passwort ändern (meldet andere Geräte ab) | `auth.passwordHash` | – |
| Anmeldedauer | `auth.sessionDays` | 90 |
| Angemeldete Geräte einzeln oder alle abmelden | `data/sessions.json` | – |
| HTTPS an/aus, Adresse, Port, weitere Namen/IPs, Zertifikat neu erzeugen | `https.*` | an, `0.0.0.0:8443` |
| Tunnel-Port für cloudflared | `http.*` | `127.0.0.1:8080` |
| Heimnetz-HTTP (unverschlüsselt) | `lan.*` | aus |
| Grind-by-Sync-Vermittler, IP der Mühle (siehe unten) | `gbs.enabled` / `gbs.host` / `gbs.port` / `gbs.grinderIp` | aus, `0.0.0.0:80` (Docker: 8082), IP aus `grinder.url` |
| Profil für den Drehknopf der Mühle (unter **Skripte**) | `data/gbs.json` | Original-Skript 9 |
| Proxy-Header vertrauen | `trustProxy` | `loopback` (Docker: `private`) |
| Push-Kontakt | `push.subject` | `mailto:xenia@example.com` |
| Protokoll-Stufe | `logLevel` | `info` |

**Umgebungsvariablen** (Präfix `XENIOS_`) überschreiben die Datei und sind dann in der App gesperrt: `XENIOS_MACHINE_URL`, `XENIOS_GRINDER_URL`, `XENIOS_GRINDER_PASSWORD`, `XENIOS_HTTP_HOST`, `XENIOS_HTTP_PORT`, `XENIOS_HTTPS_HOST`, `XENIOS_HTTPS_PORT`, `XENIOS_LAN_PORT`, `XENIOS_GBS_PORT`, `XENIOS_TRUST_PROXY`, `XENIOS_DATA_DIR`, `XENIOS_LOG_LEVEL`. Dazu `XENIOS_CONFIG` (Pfad der Konfiguration) und `XENIOS_SECRET_KEY` bzw. `XENIOS_SECRET_KEY_FILE` (Schlüssel für die Geheimnisse).

**Geheimnisse:** Mühlen-Passwort und privater Push-Schlüssel stehen mit AES-256-GCM verschlüsselt in `config.json` (`enc:v1:…`); Klartext aus älteren Versionen wird beim Start automatisch verschlüsselt. Der Schlüssel liegt in `data/secret.key`, außer er kommt per Umgebungsvariable. Liegt er neben der Konfiguration, schützt das vor dem Weitergeben oder Sichern von `config.json` allein, nicht vor jemandem mit Zugriff auf den ganzen Datenordner. Geht der Schlüssel verloren, Mühlen-Passwort neu eingeben (Push-Abos auf den Geräten neu einschalten).

## 6. Grind-by-Sync mit Druckprofilen (optional)

Normal startet der Drehknopf der E64 WS nach einem GbS-Mahlvorgang das fest eingebaute Skript 9 der Xenia. Mit dem Vermittler startet er stattdessen ein Druckprofil aus der App, und die Mühle lernt trotzdem weiter.

**So funktioniert es:** Die Mühle fragt Xenios statt der Xenia ab. Xenios reicht alle Abfragen unverändert an die Xenia weiter. Nur `scripts/execute {"ID":9}` (der Druck auf den Drehknopf) wird getauscht: Xenios schreibt das gewählte Profil als Skript **„Xenios GbS“** auf die Maschine. Vorn steht der Stopp beim Zielgewicht des Mühlenrezepts (Befehl 27, Wert aus `brewratio`, auf ganze Gramm gerundet), und die letzte Druckstufe wird um bis zu 30 s verlängert. So endet der Bezug wie beim Original am Gewicht, und die Mühle lernt aus der Bezugszeit. Das Skript wird nur neu geschrieben, wenn sich Profil oder Zielgewicht ändern. Geht etwas schief (Profil gelöscht, Maschine antwortet nicht), startet Xenios das Original-Skript 9.

**Einrichten:**
1. *Server & Sicherheit → Grind-by-Sync mit Druckprofilen*: Vermittler einschalten. Die IP der Mühle wird aus der Adresse der Mühle übernommen; steht dort ein Name, die IP eintragen (am besten im Router fest vergeben).
2. Am Display der Mühle (nicht in der Web-Oberfläche): unten links **Settings** → *Connectivity → Machine To Machine → Xenia* (eingeschaltet lassen) → *Configuration*. Die Suche findet Xenios nicht, also die IP des Xenios-Servers von Hand als Host eintragen.
3. Unter **Skripte → Grind-by-Sync** das Profil wählen. Dort steht auch, wann sich die Mühle zuletzt gemeldet hat und was beim letzten Drehknopf gestartet wurde.

**Sicherheit:** Die Mühle fragt immer unverschlüsselt und ohne Anmeldung Port 80 ab; anders geht es nicht. Xenios nimmt auf diesem Port deshalb nur Verbindungen von der IP der Mühle an und trennt alle anderen sofort. Weitergereicht werden nur die Abfragen, die die Mühle braucht (`machine`, `mako`, `info`, `status`, `overview`, `diagram/get`, `brewratio`, `scripts/execute` mit ID 9). Skripte löschen, Einstellungen oder WLAN erreicht man darüber nicht, auch nicht mit gefälschter Absender-IP.

**Ohne Docker:** Port 80 braucht unter Linux Rechte: `sudo setcap cap_net_bind_service=+ep "$(readlink -f "$(which node)")"`. Unter Windows die Firewall-Freigabe für Port 80 erlauben. Heimnetz-HTTP muss dann auf einem anderen Port als 80 laufen.

**Mit Docker:** In `docker/compose.yaml` die Zeile `- "80:8082"` aktivieren und `docker compose up -d`. Xenios muss die echte IP der Mühle sehen. Beim normalen Docker unter Linux ist das so, bei rootless Docker und Docker Desktop oft nicht. Wird die Mühle abgewiesen, steht die gesehene IP im Log und unter *Skripte → Grind-by-Sync*.

**Zurück:** In der Mühle wieder die IP der Xenia eintragen. Läuft Xenios nicht, findet die Mühle keine Xenia und Grind-by-Sync geht nicht.
