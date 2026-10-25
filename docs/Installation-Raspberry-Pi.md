# Installation: Raspberry Pi

Von der leeren Karte bis zur eingerichteten Xenios-Seite. Welches Modell, welches Netzteil und warum 64-Bit: [Hardware](Hardware.md). Ein Mini-PC mit Debian oder Ubuntu folgt der [Linux-Anleitung](Installation-Linux-Docker.md). Ab [dem Skript](#4-xenios-mit-dem-skript) sind die Befehle dieselben: `install.sh` ist für Raspberry Pi OS 64-Bit geschrieben (Pi 4 mit 2 GB oder mehr, Pi 5) und genauso für Debian und Ubuntu. Das Image gibt es für arm64 und amd64.

Die Befehle ab Abschnitt 4 gehören in das Terminal **auf dem Pi** (per SSH). Etwa eine Stunde, das meiste davon ist Warten: Karte schreiben, erster Start, Docker und das Image.

## 1. Was bereitliegt

- Raspberry Pi 5 (4 GB ist die bequeme Wahl) oder Pi 4 mit 2 GB oder mehr. Offizielles Netzteil, Gehäuse, Ethernet-Kabel zum Router. Details und ungeeignete Modelle: [Hardware](Hardware.md).
- microSD, 32 GB, Klasse A2, von einer bekannten Marke. Ein Kartenleser am anderen Rechner.
- Ein anderer Rechner im selben Netz, mit Browser. Damit wird die Karte beschrieben und später Xenios eingerichtet.
- Adressen von Xenia und Mühle, falls schon bekannt. Sonst stehen sie in der Geräteliste des Routers. Die Xenia spricht HTTP (`http://192.168.x.x`), die Mühle HTTPS (`https://192.168.x.x`).
- Ein App-Passwort mit mindestens 10 Zeichen.
- Optional, erst wenn es im Heimnetz läuft: Cloudflare-Konto und eine Domain bei Cloudflare.

Der Pi steht im selben Netz wie die Maschinen. Gast-WLAN und „Geräte isolieren“ passen nicht.

## 2. Karte mit Raspberry Pi OS beschreiben

Auf dem anderen Rechner den [Raspberry Pi Imager](https://www.raspberrypi.com/software/) installieren und öffnen.

1. **Gerät:** den eigenen Pi (Pi 5 oder Pi 4).
2. **Betriebssystem:** *Raspberry Pi OS Lite (64-bit)*. Lite ist die richtige Wahl für einen Pi ohne Bildschirm. Die Variante mit Desktop steht als *Raspberry Pi OS (64-bit)* in der Hauptliste; sie braucht sinnvoll 4 GB RAM, die Befehle bleiben gleich. Ein Eintrag ohne den Zusatz **64-bit** ist das 32-Bit-System und startet das Docker-Image nicht.
3. **Speicher:** die microSD. Der Imager löscht das gewählte Laufwerk vollständig. Vor dem Schreiben prüfen, dass die Karte ausgewählt ist und nicht die Festplatte des PCs.

![Raspberry Pi Imager: Pi 5, Raspberry Pi OS Lite (64-bit), microSD](bilder/raspberry-pi/01-imager.png)

*Bild 1. Gerät, 64-Bit-Lite, Karte.*

4. Weiter, dann die Einstellungen zur Installation öffnen (Zahnrad oder die Frage nach der Anpassung). Vor dem Schreiben setzen:

   | Feld | Wert |
   |---|---|
   | Hostname | `xenios` |
   | Benutzer und Passwort | selbst wählen, Passwort merken |
   | WLAN | leer lassen, der Pi bekommt das Kabel |
   | Zeitzone | `Europe/Berlin` |
   | Tastatur | `de` |
   | SSH | an, Authentifizierung mit Passwort |

   WLAN nur eintragen, wenn wirklich kein Kabel möglich ist. Ein Server am WLAN schläft leichter weg.

![Imager-Einstellungen: Hostname xenios, Benutzer, SSH an, Zeitzone Europe/Berlin, WLAN leer](bilder/raspberry-pi/02-imager-einstellungen.png)

*Bild 2. Anpassung vor dem Schreiben.*

5. Schreiben, das Löschen bestätigen, warten, die Karte sicher entfernen.

## 3. Erster Start

Karte in den Pi, Netzwerkkabel zum Router, dann das offizielle Netzteil. Der erste Start vergrößert die Karte und kann zwei bis drei Minuten dauern, bevor SSH antwortet.

![Pi mit Karte, Ethernet-Kabel und offiziellem Netzteil, ohne Bildschirm](bilder/raspberry-pi/03-verkabelung.png)

*Bild 3. Karte, Kabel, offizielles Netzteil.*

Die Adresse steht in der Geräteliste des Routers (Name `xenios`). Vom anderen Rechner geht oft auch:

```bash
ping xenios.local
```

In Windows-PowerShell denselben Befehl. Anmelden, der Benutzername ist der aus dem Imager:

```bash
ssh dein-benutzer@192.168.178.32
```

Beim ersten Mal nach dem Fingerabdruck: `yes` eintippen und Enter. Danach das Passwort aus dem Imager. Es erscheint keine Rückmeldung, während das Passwort getippt wird.

![SSH-Anmeldung, die Eingabeaufforderung des Pi](bilder/raspberry-pi/04-ssh.png)

*Bild 4. Angemeldet per SSH.*

Antwortet SSH mit „Connection refused“ oder läuft der Versuch ins Leere: noch eine Minute warten. Bleibt es so, war SSH im Imager aus. Die Karte erneut beschreiben, diesmal mit SSH an. Eine leere Datei namens `ssh` auf der Boot-Partition ersetzt die Benutzeranlage im Imager nicht.

Im Router der gefundenen Adresse eine feste Zuordnung geben (DHCP-Reservierung). Dieselbe Adresse behalten.

![Router: der Pi mit fester Adresse](bilder/raspberry-pi/05-router-reservierung.png)

*Bild 5. Feste Adresse im Router.*

## 4. Xenios mit dem Skript

Ein Befehl installiert Docker, falls es fehlt, legt `~/xenios` an, schreibt die Umgebung, startet den Server und richtet den Update-Dienst ein. Der Benutzer aus dem Imager darf `sudo`. Das Passwort fragt das Skript ab.

Vorher die Uhr prüfen. `timedatectl` soll `Europe/Berlin` nennen und `System clock synchronized: yes` enthalten. Die Adresse aus `hostname -I` (Beginn `192.168.` oder `10.`) ist unten `192.168.178.32`.

```bash
hostname -I
timedatectl
sudo timedatectl set-timezone Europe/Berlin
sudo timedatectl set-ntp true
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y nano
```

Ein Hinweis auf neu zu startende Dienste mit Tab auf Ok und Enter schließen. Danach:

```bash
curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/install.sh | sh
```

Das dauert auf einem Pi einige Minuten (Docker, dann das Image für arm64). Am Ende steht die Adresse `https://192.168.178.32:8443` und der **Einrichtungscode** (`AB12-CD34`). Der Code gilt bis zur Einrichtung oder bis zum nächsten Neustart.

![Ende von install.sh: Adresse und Einrichtungscode](bilder/raspberry-pi/08-einrichtungscode.png)

*Bild 8. Ausgabe des Skripts. Im veröffentlichten Bild den Code abdecken.*

Das Skript legt `~/xenios/docker/.env` an und ändert eine vorhandene Datei nicht noch einmal. Darin stehen die Zeitzone des Pi, die Heimnetz-Adresse vor dem Port (`192.168.178.32:8443`, Docker öffnet Ports sonst an der Firewall vorbei), das Image `ghcr.io/tims1998/xenios:latest` und `XENIOS_PULL=always`.

```bash
cat ~/xenios/docker/.env
```

![Inhalt von docker/.env nach dem Skript](bilder/raspberry-pi/07-env.png)

*Bild 7. `.env` nach `install.sh`.*

Steht am Ende „Docker-Gruppe gilt in dieser Sitzung noch nicht“: `exit`, neu per SSH anmelden. Der Server läuft schon. Prüfen:

```bash
docker compose -f ~/xenios/docker/compose.yaml ps
systemctl is-enabled xenios-update.timer
```

STATUS nach etwa einer halben Minute: `healthy`. Der Timer steht auf `enabled`. Er lässt den Knopf *Aktualisieren* in der App das Image holen.

Dieselbe Ausgabe nennt den Zertifikats-Fingerabdruck, Zeile beginnend mit `HTTPS (Heimnetz, Zertifikat SHA-256`. Fehlt der Code:

```bash
docker compose -f ~/xenios/docker/compose.yaml logs xenios | grep Einrichtungscode
```

## 5. Im Browser einrichten

Auf dem anderen Gerät im selben Netz:

```text
https://192.168.178.32:8443
```

`http://` ohne s trifft diesen Port nicht. Die Warnung kommt vom selbst ausgestellten Zertifikat.

- Chrome und Edge: *Erweitert*, dann weiter zur Adresse.
- Firefox: *Erweitert*, dann Risiko akzeptieren und fortfahren.

![Browser-Warnung zum Zertifikat des Pi](bilder/raspberry-pi/09-zertifikatswarnung.png)

*Bild 9. Zertifikatswarnung.*

Assistent:

1. **Code.** Einrichtungscode aus dem Protokoll, *Weiter*.
2. **Passwort.** Mindestens 10 Zeichen, zweimal. Gilt für alle Geräte. Gespeichert wird nur ein Hash.
3. **Xenia.** Oben **Neue Xenia** (Brew-by-Sync, aktuelle Firmware) oder **Alte Xenia** (DBL, ältere offizielle API). Adresse `http://192.168.x.x`, ohne Pfad. *Verbindung testen*. Passt die Wahl nicht zur Maschine, steht unter dem Ergebnis: „Die Maschine antwortet wie die alte API – oben Alte Xenia wählen.“ oder der Satz für die neue API. Dann die andere Schaltfläche und noch einmal testen. Ist die Maschine aus, geht *Weiter* trotzdem; ändern später unter *Einstellungen → Server & Sicherheit*. Dieselbe Umschaltung hat die Android-App im Direkt-Modus ([Android-App](Android-App.md)).
4. **Mühle.** Ohne E64 WS den Schalter aus. Dann fehlen Menüpunkt Mühle, Mühlen-Kacheln und Grind-by-Sync; Dosis und Mahlgrad trägt man beim Bezug selbst ein. Mit Mühle: `https://192.168.x.x` und das **Owner-Passwort** (dieselbe Rolle Owner wie auf der Webseite der Mühle). *Verbindung testen*. Das Passwort wird verschlüsselt gespeichert. Grind-by-Sync gibt es nur zusammen mit der neuen Xenia.
5. **Unterwegs.** Aus lassen, bis [Abschnitt 7](#7-von-unterwegs-optional) dran ist.
6. **Fertig.** *Einrichtung abschließen*, danach mit dem App-Passwort anmelden.

![Assistent: Einrichtungscode](bilder/raspberry-pi/10-assistent-code.png)

*Bild 10. Schritt Code.*

![Assistent: Xenia, Test grün](bilder/raspberry-pi/11-assistent-xenia.png)

*Bild 11. Verbindungstest, dazu die Wahl Neue oder Alte Xenia.*

![Assistent: Mühle mit https, oder Schalter aus](bilder/raspberry-pi/12-assistent-muehle.png)

*Bild 12. Mühle.*

Bei der **alten Xenia** blendet Xenios Paddle, den Wochenplan der Maschine und „Uhr stellen“ aus. Ein, Aus, Eco, Dampf, Temperatur und die Skriptliste bleiben. Die Bezugszeit zählt Xenios selbst. Eco- und Ausschalt-Timer und die Schaltzeiten des Servers bleiben. Die Endpunkte stehen in [API der Xenia, alte API](API-Xenia.md#15-alte-xenia-dbl-offizielle-api).

Die Seite im Heimnetz ist benutzbar. Als App installieren und Mitteilungen gehen erst über die öffentliche HTTPS-Adresse aus [Abschnitt 7](#7-von-unterwegs-optional). Siehe [Android-App](Android-App.md).

## 6. Dauerbetrieb

Der Pi startet nach Stromausfall von selbst. Docker startet Xenios danach (`restart: unless-stopped`).

```bash
sudo reboot
```

Eine Minute warten, `https://192.168.178.32:8443` erneut öffnen.

Raspberry Pi OS Lite schläft nicht. Läuft WLAN statt Kabel, lässt sich der Sparmodus der Funkkarte bis zum nächsten Neustart abschalten (`iw dev` zeigt den Namen, oft `wlan0`):

```bash
sudo apt install -y iw
sudo iw dev wlan0 set power_save off
```

Nach einem Reboot ist er wieder an. Ein Pi, der immer erreichbar sein soll, hängt am Kabel.

Ein Blitzsymbol oder die Meldung `Undervoltage detected` im Protokoll (`dmesg | grep -i under`) heißt: Netzteil zu schwach. Das offizielle Netzteil einsetzen.

## 7. Von unterwegs (optional)

Im Heimnetz ist die Installation hier fertig. Handy außer Haus, installierbare Web-App und Mitteilungen brauchen eine öffentliche HTTPS-Adresse. Kostenloser Cloudflare-Tarif, keine Portfreigabe im Router.

Die Domain liegt bei Cloudflare und gilt dort als aktiv.

1. <https://one.dash.cloudflare.com> → *Networks* → *Tunnels* → **Create a tunnel** → *Cloudflared*. Name `xenios`.

![Cloudflare: Tunnel xenios anlegen](bilder/raspberry-pi/14-cloudflare-tunnel.png)

*Bild 14. Tunnel anlegen.*

2. Bei *Install and run a connector* die Zeile `sudo cloudflared service install …` kopieren. Den Befehl nicht ausführen.

![Cloudflare: Zeile sudo cloudflared service install, der Token dahinter](bilder/raspberry-pi/15-cloudflare-token.png)

*Bild 15. Die Installationszeile, nicht ausgeführt.*

3. Im Einrichten von Xenios, Schritt **Unterwegs**, die Zeile in *Befehl aus Cloudflare* einfügen und **Token übernehmen**. Xenios schreibt den Token und startet `cloudflared`. Nach ein paar Sekunden:

```bash
docker compose -f ~/xenios/docker/compose.yaml ps
```

`xenios` ist `healthy`, `cloudflared` läuft. Dasselbe Feld gibt es später unter *Einstellungen → Server & Sicherheit → Von unterwegs*.

4. Im Tunnel **Add route → Published Application**: Subdomain `xenios`, eigene Domain, Typ **HTTP**, URL:

```text
http://xenios:8080
```

`localhost` erreicht den Container nicht.

![Cloudflare: Add route, Published Application, URL http://xenios:8080](bilder/raspberry-pi/16-cloudflare-hostname.png)

*Bild 16. Published Application mit `http://xenios:8080`.*

5. In der App *Einstellungen → Server & Sicherheit → Von unterwegs*: `https://xenios.deine-domain.de` eintragen und **Testen**.

Weitere Härtung (Rate-Limit, Länderfilter): [Einrichtung, Cloudflare](Einrichtung.md#2-cloudflare-tunnel).

## 8. Aktualisieren und sichern

Unter *Einstellungen → Server & Sicherheit* steht die installierte Version. Gibt es auf GitHub ein neueres Release, heißt der Knopf **Auf x.y.z aktualisieren**, sonst **Aktualisieren**. Er prüft GitHub in beiden Fällen.

Nach `install.sh` läuft auf dem Pi der Dienst `xenios-update.timer`. Der Knopf holt dann Git und das Image und startet neu. Konfiguration, Sitzungen und Bezüge bleiben. Die Seite kommt danach von selbst zurück.

![Einstellungen, Block Aktualisierung, Knopf und Versionszeile](bilder/raspberry-pi/17-aktualisieren.png)

*Bild 17. Aktualisieren, mit erkennbarer neuer Version oder dem Hinweis, dass der Stand aktuell ist.*

Zeigt die Seite stattdessen den `curl`-Befehl, fehlt der Dienst. Einmal, auch auf einer Installation von Hand:

```bash
sh ~/xenios/install.sh
```

Eine vorhandene `docker/.env` bleibt. Nur holen und neu starten, ohne den Dienst neu zu schreiben:

```bash
sh ~/xenios/install.sh --update
```

Eine feste Version: in `~/xenios/docker/.env` zum Beispiel `XENIOS_IMAGE=ghcr.io/tims1998/xenios:2.1.0`, danach `sh ~/xenios/install.sh --update`. Der Knopf holt weiterhin das, was in der `.env` steht.

| Was | Befehl (im Ordner `~/xenios/docker`) |
|---|---|
| Läuft er? | `docker compose ps` |
| Protokoll | `docker compose logs -f --tail 100 xenios` (Strg+C beendet nur die Anzeige) |
| Neu starten | `docker compose restart xenios` |
| Stoppen / starten | `docker compose stop` / `docker compose up -d` |
| Container weg, Daten bleiben | `docker compose down` |
| Container und Daten weg | `docker compose down -v` |

In der App unter *Einstellungen → Server & Sicherheit* sichert **Sichern** Konfiguration und Bezüge als ZIP, **Einspielen** liest dieselbe Datei. Zusätzlich das ganze Volume (enthält `secret.key`; die Datei wie ein Passwort aufbewahren und vom Pi herunterkopieren, eine Karte geht irgendwann kaputt):

```bash
cd ~/xenios/docker
docker run --rm -v xenios_xenios-data:/d -v "$PWD":/b alpine tar czf /b/xenios-backup.tgz -C /d .
```

Von Windows-PowerShell:

```powershell
scp dein-benutzer@192.168.178.32:xenios/docker/xenios-backup.tgz .
```

Wiederherstellen auf einem frischen Pi, nachdem `install.sh` gelaufen ist und die Sicherungsdatei im Ordner `docker/` liegt. Liegt schon eine `.env` aus dem Skript, bleibt sie beim erneuten Lauf unverändert; die Sicherung ersetzt nur das Datenvolume:

```bash
cd ~/xenios/docker
docker compose create xenios
docker run --rm -v xenios_xenios-data:/d -v "$PWD":/b alpine sh -c "tar xzf /b/xenios-backup.tgz -C /d && chown -R 1000:1000 /d"
docker compose up -d
```

Dieselbe Sicherung läuft auf einem Mini-PC wieder ein. `1000` ist der Benutzer `node` im Container.

## 9. Wenn etwas nicht geht

Befehle mit `docker compose` im Ordner `~/xenios/docker`, oder mit `-f ~/xenios/docker/compose.yaml` von überall.

| Was passiert | Was tun |
|---|---|
| SSH kommt nicht | Zwei Minuten warten. Adresse im Router prüfen. SSH im Imager war aus: Karte neu beschreiben. |
| `permission denied` bei `docker` | Neu per SSH anmelden. `groups` enthält `docker`. Bis dahin geht `sudo docker`. |
| Skript bricht ab, 32-Bit | Imager-Eintrag ohne **64-bit**. Karte mit *Raspberry Pi OS Lite (64-bit)* neu beschreiben. |
| `port is already allocated` | In `.env` einen anderen Port, zum Beispiel `192.168.178.32:9443`, dann `docker compose up -d`. |
| `pull access denied` | In `.env` vor `XENIOS_IMAGE` und `XENIOS_PULL` eine `#` setzen, dann `docker compose up -d`. Der Pi baut das Image aus `~/xenios/server`. |
| `unhealthy` | `docker compose logs --tail 100 xenios`. Liegt es an der gebundenen Adresse, testweise `XENIOS_HTTPS_PORT=8443`. |
| Kein Einrichtungscode | Schon eingerichtet. Neues App-Passwort: `docker compose exec xenios node src/setup.js`, danach `docker compose restart xenios`. |
| Seite öffnet nicht | `https://` und die Adresse aus der `.env`. Browser im selben Netz. `docker compose ps` zeigt `healthy`. |
| Knopf Aktualisieren zeigt den curl-Befehl | `systemctl is-enabled xenios-update.timer`. Steht dort nicht `enabled`: `sh ~/xenios/install.sh` noch einmal. |
| Xenia nicht erreichbar | Auf dem Pi: `curl -m 5 http://192.168.x.x/api/v2/machine`. Ohne Antwort: Kabel, gleiches Netz, Gast-WLAN aus. |
| Verbindungstest will die andere Xenia | Im Assistenten oder unter *Server & Sicherheit* Neue bzw. Alte Xenia umschalten und erneut testen. |
| Pi wird heiß, startet neu, Blitzsymbol | Offizielles Netzteil, Gehäuse mit Lüfter beim Pi 5. |
| Karte voll oder schreibt nicht mehr | `df -h`. Sicherung aus Abschnitt 8 auf eine neue Karte oder eine SSD mitnehmen. |
| Timer zur falschen Zeit | `TZ` in `.env`, `sh ~/xenios/install.sh --update`. Bei der neuen Xenia zusätzlich *Timer → Uhr stellen*. |
