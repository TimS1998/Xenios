# Git und Docker: Schritt für Schritt

Wo was liegt, wenn alles eingerichtet ist:

| Auf GitHub | Inhalt | Entsteht durch |
|---|---|---|
| **Code** | dieses Repository | `git push` |
| **Actions** | Tests, Probelauf des Docker-Images, Bau der APK | jeder Push (Workflows in `.github/workflows/`) |
| **Releases** | die Android-App als `Xenios-<nr>.apk` | ein Tag `v…` |
| **Packages** | das Docker-Image `ghcr.io/tims1998/xenios` (amd64 + arm64) | derselbe Tag |

Die Befehle sind für PowerShell (Windows) geschrieben; unter Linux/macOS sind sie gleich, außer wo „Linux“ steht.

---

## Teil 1: Git

### 1.1 Einmalig: Werkzeuge
```powershell
winget install Git.Git
winget install GitHub.cli
git config --global user.name  "Dein Name"
git config --global user.email "du@example.com"
gh auth login                     # GitHub.com → HTTPS → im Browser anmelden
```

### 1.2 Erster Upload
Im Ordner des Projekts:
```powershell
cd <Pfad-zum-Repository>\Xenios
git status                        # Liste prüfen (siehe unten), dann:
git add .
git commit -m "Xenios: Server, Web-App, Android-App, Docker"
gh repo create xenios --private --source . --push
```
Vor dem ersten `git add .` in der Liste von `git status` nachsehen, dass **nichts davon** auftaucht: `config.json`, `data/`, `secret.key`, `.env`, `*.jks`/`*.keystore`, `*.apk`. Die `.gitignore` schließt sie aus; falls doch etwas dabei ist, nicht committen, sondern die `.gitignore` ergänzen.

**Privat oder öffentlich?** Beides geht. Bei einem privaten Repository sind auch das Docker-Image und die Releases privat; der Server braucht dann einen Login für das Image (siehe 2.4). Die kostenlosen Actions-Minuten reichen für privat locker (ein Release braucht etwa 10 Minuten).

### 1.3 Alltag
| Was | Befehl |
|---|---|
| Was hat sich geändert? | `git status`, Details: `git diff` |
| Änderungen speichern | `git add .` und `git commit -m "Kurz, was und warum"` |
| Hochladen | `git push` |
| Stand von GitHub holen (z. B. auf dem Server) | `git pull` |
| Verlauf ansehen | `git log --oneline -20` |
| Laufen die Prüfungen? | `gh run list`, live: `gh run watch` |

### 1.4 Größere Änderungen ausprobieren (optional)
```powershell
git switch -c dashboard-tablet    # eigener Zweig
# … ändern, committen …
git push -u origin dashboard-tablet
gh pr create --fill               # Pull Request: die Prüfungen laufen, main bleibt unberührt
gh pr merge --squash --delete-branch
git switch main; git pull
```

### 1.5 Rückgängig machen
| Situation | Befehl |
|---|---|
| Datei kaputt geändert, noch nicht committet | `git restore <datei>` |
| Datei versehentlich mit `git add` vorgemerkt | `git restore --staged <datei>` |
| Letzten Commit (noch nicht gepusht) ändern | `git commit --amend` |
| Gepushten Commit zurücknehmen | `git revert <commit>` und `git push` (erzeugt einen Gegen-Commit, nichts geht verloren) |

`git push --force` auf `main` vermeiden: Das überschreibt den Verlauf auf GitHub.

**Geheimnis aus Versehen gepusht?** Löschen allein reicht nicht, es steht im Verlauf. Das Geheimnis sofort ändern: App-Passwort in der App neu setzen, Mühlen-Passwort an der Mühle ändern, bei `secret.key` danach das Mühlen-Passwort neu eintragen, bei einem Cloudflare-Token den Tunnel-Token im Dashboard neu erzeugen.

---

## Teil 2: Releases (APK und Docker-Image)

### 2.1 Einmalig: Signaturschlüssel für die APK
Android installiert ein Update nur, wenn es mit **demselben Schlüssel** signiert ist wie die installierte App. Ohne Schlüssel baut der Workflow mit einem Debug-Schlüssel, der bei jedem Lauf anders sein kann; dann muss man die App vor jedem Update deinstallieren.

> **Schon eine App installiert?** Dann den vorhandenen Keystore weiterverwenden (aus dem alten Projekt, Ordner `android/keystore/`, Alias `xenia`) und nur die vier Secrets setzen. Mit einem neuen Schlüssel lässt sich die installierte App nicht aktualisieren, nur deinstallieren und neu installieren.

Neuen Schlüssel erzeugen (nur ohne vorhandene App):
```powershell
winget install EclipseAdoptium.Temurin.21.JDK      # bringt keytool mit (neues Terminal öffnen)
cd $HOME                                            # außerhalb des Repos!
keytool -genkeypair -v -keystore xenios.jks -alias xenios -keyalg RSA -keysize 4096 -validity 10000
```
keytool fragt nach einem Passwort und ein paar Angaben (Name genügt). Dann die vier Secrets im Repository hinterlegen:
```powershell
cd <Pfad-zum-Repository>\Xenios
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\xenios.jks")) | gh secret set XENIOS_KEYSTORE_BASE64
gh secret set XENIOS_KEY_ALIAS --body xenios
gh secret set XENIOS_KEYSTORE_PASSWORD     # fragt nach dem Passwort
gh secret set XENIOS_KEY_PASSWORD          # dasselbe Passwort, wenn keytool keins extra wollte
```
`xenios.jks` und das Passwort sicher aufbewahren (Passwort-Manager). Geht der Schlüssel verloren, lässt sich die App nur noch durch Deinstallieren und Neuinstallieren aktualisieren (Widgets und Anmeldung sind dann neu einzurichten).

### 2.2 Release veröffentlichen
```powershell
git pull                          # aktueller Stand
git tag v2.1.0                    # Version frei wählbar, muss mit v beginnen
git push origin v2.1.0
gh run watch                      # Tests → APK + Image → Release (ca. 10 min)
```
Danach:
- **Releases** (`gh release view --web`): `Xenios-<nr>.apk` zum Herunterladen. Auf dem Handy öffnen und installieren („Unbekannte Apps installieren“ für den Browser einmal erlauben).
- **Packages**: `ghcr.io/tims1998/xenios:2.1.0` und `:latest`.

Ein fehlgeschlagenes Release wiederholen: Fehler beheben und committen, dann das Tag verschieben:
```powershell
gh release delete v2.1.0 --yes 2>$null
git tag -d v2.1.0; git push origin :refs/tags/v2.1.0
git tag v2.1.0; git push origin v2.1.0
```

### 2.3 Nur die APK bauen, ohne Release
GitHub → *Actions* → *Android-App bauen* → *Run workflow*, oder `gh workflow run app.yml`. Die APK liegt dann 30 Tage als Artefakt am Lauf (`gh run download`).

### 2.4 Image aus einem privaten Repository laden
Entweder das Paket öffentlich machen (GitHub → Profil → *Packages* → `xenios` → *Package settings* → *Change visibility* → Public; der Code bleibt privat), oder auf dem Server einmal anmelden:
```bash
# Token: GitHub → Settings → Developer settings → Personal access tokens (classic) → nur „read:packages“
echo <TOKEN> | docker login ghcr.io -u TimS1998 --password-stdin
```

---

## Teil 3: Docker

### 3.1 Docker installieren
- **Linux / Raspberry Pi** (Raspberry Pi OS 64 Bit, Debian, Ubuntu):
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER     # danach ab- und wieder anmelden
  docker compose version            # prüft, ob das Compose-Plugin da ist
  ```
- **Windows / macOS:** Docker Desktop (`winget install Docker.DockerDesktop`). Für einen Dauerbetrieb ist ohne Docker der Windows-Autostart einfacher, siehe [Einrichtung](Einrichtung.md#1-server-installieren-windows-pc-läuft-dauerhaft).
- **Synology/QNAP:** Container Manager bzw. Container Station; dort ein „Projekt“ aus `docker/compose.yaml` anlegen.

### 3.2 Starten
```bash
git clone https://github.com/TimS1998/Xenios.git xenios
cd xenios/docker
cp .env.example .env              # Einstellungen, siehe unten
docker compose up -d
docker compose logs xenios        # zeigt den Einrichtungscode
```
Dann `https://<IP-des-Servers>:8443` öffnen, die Zertifikatswarnung einmal bestätigen, den Code eingeben und der Einrichtung folgen. Danach in der App unter *Server & Sicherheit → Weitere Namen/IPs fürs Zertifikat* die IP des Servers eintragen, damit das Zertifikat zu ihr passt.

Wichtige Werte in `docker/.env`:

| Variable | Wofür |
|---|---|
| `XENIOS_IMAGE=ghcr.io/tims1998/xenios:latest` und `XENIOS_PULL=always` | fertiges Image aus Packages laden statt selbst zu bauen (schneller, v. a. auf dem Raspberry Pi) |
| `XENIOS_HTTPS_PORT=192.168.178.32:8443` | Port nur im Heimnetz öffnen (unter Linux umgehen Docker-Ports die Firewall `ufw`) |
| `TUNNEL_TOKEN=…` und `COMPOSE_PROFILES=tunnel` | Cloudflare-Tunnel im selben Compose starten; im Cloudflare-Dashboard den Public Hostname auf `http://xenios:8080` setzen |
| `TZ=Europe/Berlin` | Zeitzone für Zeitplan und Wecker |

### 3.3 Alltag
| Was | Befehl (im Ordner `docker/`) |
|---|---|
| Läuft er? | `docker compose ps` (Spalte STATUS: `healthy`) |
| Log ansehen | `docker compose logs -f --tail 100 xenios` (Strg+C beendet nur die Anzeige) |
| Neu starten | `docker compose restart xenios` |
| Stoppen / wieder starten | `docker compose stop` / `docker compose up -d` |
| Container entfernen (Daten bleiben) | `docker compose down` |
| **Alles löschen, auch die Daten** | `docker compose down -v` (Vorsicht) |

### 3.4 Aktualisieren
```bash
cd xenios/docker
git pull                          # holt auch neue compose.yaml
docker compose up -d              # baut neu bzw. lädt das neue Image (je nach XENIOS_PULL)
docker image prune -f             # alte Images aufräumen
```
Einstellungen, Sitzungen und Bezüge bleiben erhalten; sie liegen im Volume, nicht im Image. Eine bestimmte Version festhalten: `XENIOS_IMAGE=ghcr.io/tims1998/xenios:2.1.0`.

### 3.5 Sichern und wiederherstellen
Sicherung (enthält `secret.key` und damit den Schlüssel zum Mühlen-Passwort, also sicher aufbewahren):
```bash
docker run --rm -v xenios_xenios-data:/d -v "$PWD":/b alpine tar czf /b/xenios-backup.tgz -C /d .
```
Wiederherstellen, z. B. auf einem neuen Rechner nach `git clone` und `cp .env.example .env`:
```bash
docker compose create xenios      # legt das Volume an, ohne zu starten
docker run --rm -v xenios_xenios-data:/d -v "$PWD":/b alpine sh -c "tar xzf /b/xenios-backup.tgz -C /d && chown -R 1000:1000 /d"
docker compose up -d
```
(`1000` ist der Benutzer `node`, unter dem der Server im Container läuft.)

### 3.6 Wenn etwas nicht geht
| Problem | Lösung |
|---|---|
| `port is already allocated` | Ein anderes Programm nutzt 8443. In `.env` `XENIOS_HTTPS_PORT=9443` setzen. |
| Status `unhealthy` oder Neustarts | `docker compose logs xenios` lesen; meist steht dort der Grund (z. B. kaputte `config.json`). |
| Kein Einrichtungscode im Log | Die Einrichtung ist schon erledigt. App-Passwort vergessen: `docker compose exec xenios node src/setup.js` (fragt ein neues ab), danach `docker compose restart xenios`. |
| Maschine „nicht erreichbar“ | Vom Server aus prüfen: `curl http://<IP-der-Xenia>/api/v2/machine`. Der Server muss im selben Netz wie die Maschine sein (kein Gast-WLAN). |
| Image lässt sich nicht laden (`denied`) | Paket ist privat, siehe 2.4. |
| Falsche Uhrzeit bei Timern | `TZ` in `.env` setzen; die Uhr der Xenia in der App unter *Timer → Uhr stellen*. |
