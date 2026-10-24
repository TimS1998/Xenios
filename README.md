# Xenios ☕

Sicherer Web-Server, installierbare Web-App (PWA) und native Android-App mit Widgets für die **Xenia-Espressomaschine** und die **Mahlkönig E64 WS**. Mit Passwort geschützt, im Heimnetz per HTTPS und von unterwegs verschlüsselt über einen Cloudflare-Tunnel erreichbar.

| Dashboard | Home | Skripte | Steuerung | Timer | Mühle |
|---|---|---|---|---|---|
| Anpassbare Übersicht zum Ansehen (auch fürs Tablet): Instrumente, Live-Druckkurve beim Bezug, letzter Bezug und Mahlvorgang, Verläufe | Druck- und Temperatur-Instrumente, Live-Diagramm, Ein/Aus/Eco/Dampf, Zieltemperatur | Schnellstart (einfach/doppelt/Dauerbezug), Skript-Editor, Export/Import | Tastenbelegung, Bezugsgewichte, Paddle | Wochenplan, Schaltzeiten über den Server, Einschalten vor dem ersten Wecker | Rezepte, Mahlvorgänge, Grind-by-Sync, Meldungen |

**Android-App** ([Anleitung](docs/Android-App.md)): Widgets, Schnelleinstellungs-Kachel, App-Shortcuts, Direkt-Modus ohne Server.

## Aufbau

| Ordner | Inhalt |
|---|---|
| [`server/`](server) | Node.js-Server ohne npm-Abhängigkeiten (`src/`), die Web-App (`web/`), Simulation der Geräte (`mock/`), Tests (`test/`), Start ohne Docker (`deploy/`: Windows, systemd, cloudflared) |
| [`app/`](app) | Android-App (Kotlin); packt `server/web` für den Direkt-Modus mit ein |
| [`docker/`](docker) | `Dockerfile`, `compose.yaml`, `.env.example` |
| [`docs/`](docs) | Einrichtung, Git- und Docker-Anleitung, APIs von Maschine, Mühle und Server |

## Schnellstart

**Docker** (Linux-Server, Raspberry Pi, NAS):
```bash
git clone https://github.com/TimS1998/Xenios.git xenios && cd xenios/docker
docker compose up -d
docker compose logs xenios       # zeigt den Einrichtungscode
```
**Ohne Docker** (Windows/Linux, Node.js ≥ 20):
```bash
cd server
npm start                        # zeigt den Einrichtungscode
```
Dann `https://<IP-des-Rechners>:8443` öffnen (Zertifikatswarnung einmal bestätigen), den Code eingeben und der Einrichtung folgen: App-Passwort, Adresse der Xenia, optional die Mühle, jeweils mit Verbindungstest. Alles Weitere unter **Einstellungen → Server & Sicherheit**, ohne Neustart.

Ausführlich: [Einrichtung](docs/Einrichtung.md) (Docker, Windows-Autostart, Cloudflare-Tunnel, Android) und [Git und Docker Schritt für Schritt](docs/Git-und-Docker.md) (erster Upload, Releases mit signierter APK, Docker-Betrieb, Sicherung).

## Releases

Ein Tag `v*` erzeugt automatisch ein **GitHub-Release mit der Android-App (APK)** und veröffentlicht das **Docker-Image in GitHub Packages** (`ghcr.io/tims1998/xenios`, amd64 und arm64):
```bash
git tag v2.0.0
git push origin v2.0.0
```
Bei jedem Push prüfen die Workflows die Server-Tests, einen Probelauf des Docker-Images und den Bau der APK. Damit App-Updates sich installieren lassen, einmal einen Signaturschlüssel als Secret hinterlegen ([Anleitung](docs/Git-und-Docker.md#21-einmalig-signaturschlüssel-für-die-apk)).

## Sicherheit in Kürze
- Maschine und Mühle bleiben im Heimnetz. Nach außen geht nur der Server, über einen **ausgehenden** Cloudflare-Tunnel ohne Portfreigabe.
- Login per **App-Passwort** (scrypt), HttpOnly-/Secure-Cookie, Schutz gegen Durchprobieren, CSRF-Schutz, strenge CSP.
- Ersteinrichtung im Browser nur mit dem **Einrichtungscode** aus dem Server-Log; danach ist dieser Weg gesperrt.
- **Geheimnisse verschlüsselt** in `config.json` (AES-256-GCM): Mühlen-Passwort und privater Push-Schlüssel.
- Gefährliche Geräte-Funktionen (alle Skripte löschen, WLAN vergessen, Firmware, Waagen-Kalibrierung, PID) sind im Server **gesperrt**.
- Die Mühle wird per HTTPS mit **Zertifikats-Pinning** angesprochen; geprüft wird, bevor Cookie oder Passwort gesendet werden.
- Docker: schreibgeschütztes Dateisystem, ohne Root und ohne Linux-Capabilities; der unverschlüsselte Tunnel-Port ist nicht veröffentlicht.

## Wissenswertes über die Geräte
1. **Die Xenia-API hat keine Anmeldung**: Jeder im WLAN kann die Maschine steuern. Sie gehört deshalb nie direkt ins Internet; der Zugriff von außen läuft nur über diesen Server.
2. **Die Uhr der Xenia** kann falsch gehen; dann schalten die Wochen-Timer zur falschen Zeit. Abhilfe: App → Timer → „Uhr stellen“.
3. **Mühle**: `/wifi.php` zeigt das WLAN-Passwort im HTML-Quelltext, und die Datenbank-Sicherung enthält es ebenfalls. Der DB-Download ist im Server daher standardmäßig aus.
4. Einige **GET**-Aufrufe der Xenia ändern etwas (z. B. `scripts/alldelete`, `network/forget`, `loadcell/tara`). Das ist in der API-Doku markiert.

## Entwicklung
```bash
cd server
npm run mock      # simulierte Xenia (:8091) und Mühle (:8092, Owner-Passwort "mockpass")
npm run dev       # Server auf http://127.0.0.1:8180 gegen die Simulation (Einrichtungscode im Terminal)
npm test          # Einheit + Ende-zu-Ende gegen die Simulation
```

## Lizenz
[Apache License 2.0](LICENSE). Icons: Material Icons (Apache-2.0). Xenia, Mahlkönig und Hemro sind Marken ihrer Inhaber; dieses Projekt ist nicht mit ihnen verbunden und gewährt keine Rechte an diesen Marken.
