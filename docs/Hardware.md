# Hardware: Raspberry Pi und Mini-PCs

Xenios ist ein kleiner Web-Server. Er schaltet keine Maschine lokal, er spricht im Heimnetz mit der Xenia und optional mit der Mahlkönig E64 WS. Dafür reicht ein Rechner, der dauerhaft an ist, 64-Bit-Linux bootet und die beiden Geräte per Netz erreicht.

Für einen neuen Aufbau: **Raspberry Pi 5 mit 4 GB**, offizielles 27-W-Netzteil, Gehäuse mit Lüfter, 32-GB-Karte (besser eine SSD) und ein Kabel zum Router. Ein gebrauchter Büro-Mini-PC mit SSD ist genauso passend, wenn Netzteil und Ethernet dabei sind. Die Geschwindigkeit eines Mini-PCs braucht Xenios nicht; SSD, Gehäuse und ein richtiges Netzteil sind der Vorteil.

Der Container darf 256 MB Speicher belegen. Dazu kommen Docker und das Betriebssystem. Eine Grafikkarte, ein Bildschirm im Dauerbetrieb und eine schnelle CPU ändern am Betrieb nichts. Der Browser läuft auf dem Handy oder einem anderen Rechner.

## Was der Rechner können muss

| | Zum Betrieb | Sinnvoll beim Neukauf |
|---|---|---|
| Prozessor | 64-Bit, **arm64** (Pi) oder **amd64** (üblicher PC) | zwei Kerne reichen |
| Arbeitsspeicher | 2 GB mit schlankem System | 4 GB beim Pi; Mini-PCs haben meist 8 GB |
| Speicherplatz | 16 GB | 32 GB microSD einer bekannten Marke, Klasse A2, oder eine SSD |
| Netz | dasselbe Heimnetz wie Xenia und Mühle | Kabel zum Router, Gigabit ist reichlich |
| System | Debian, Ubuntu oder Raspberry Pi OS, jeweils 64-Bit | aktuelle stabile Version, ohne Desktop |
| Strom | dauerhaft an, Uhr per Internet gestellt | Netzteil aus dem Zubehör des Geräts; nach Stromausfall selbst starten |
| Internet | ausgehend, für Installation und Updates | ein Cloudflare-Tunnel braucht ebenfalls nur ausgehendes Netz |

Im Router bekommt der Rechner eine feste Zuordnung (DHCP-Reservierung), damit die Adresse nach einem Neustart gleich bleibt. Eine Portfreigabe nach außen ist nicht nötig. Der Zugang von unterwegs läuft über einen ausgehenden Cloudflare-Tunnel, siehe die Installationsanleitungen.

Gastnetz, „WLAN-Geräte isolieren“ und ein zweites VLAN trennen Xenios von der Maschine. Dann schlägt der Verbindungstest fehl, obwohl beide online sind.

## Raspberry Pi

| Modell | Arbeitsspeicher | Einschätzung |
|---|---|---|
| **Pi 5** | 4 oder 8 GB | Passt am besten. Offizielles 27-W-USB-C-Netzteil, Gehäuse mit Lüfter. |
| Pi 5 | 2 GB | Reicht für Raspberry Pi OS Lite und Xenios. |
| **Pi 4 Model B** | 2, 4 oder 8 GB | Ebenfalls geeignet, gebraucht oft günstiger. Offizielles Netzteil 5 V / 3 A (USB-C). |
| Pi 4 Model B | 1 GB | Nur mit Lite-System. Beim Aktualisieren wird der Speicher knapp. |
| Pi 400 / Pi 500 | 4 GB | Läuft. Als Kiste, die immer an ist, unhandlich. |

![Pi 5 mit offiziellem Netzteil, Gehäuse, 32-GB-Karte und Netzwerkkabel](bilder/hardware/01-raspberry-pi-set.png)

*Bild 1. Ein passendes Pi-Set: Board, offizielles Netzteil, Gehäuse, Karte, Kabel.*

Dazu immer:

- **64-Bit-System.** Im Raspberry Pi Imager heißt es *Raspberry Pi OS (64-bit)* bzw. *Raspberry Pi OS Lite (64-bit)*. Das veröffentlichte Docker-Image gibt es für arm64 und amd64. Ein 32-Bit-System startet es nicht. Der Pi 5 bootet nur 64-Bit.
- **Offizielles Netzteil.** Ein Handy-Ladegerät liefert oft zu wenig Strom. Der Pi drosselt dann oder startet neu. Am Pi 5 das 27-W-Netzteil, am Pi 4 das 5-V/3-A-Netzteil.
- **Ethernet-Kabel** ins gleiche Netz wie die Maschine. WLAN funktioniert, schläft aber leichter ein und reißt weg.
- **Karte oder SSD.** Zum Start reicht eine Marken-microSD, 32 GB, Klasse A2. Für einen Betrieb über Jahre ist eine SSD besser: am USB-Anschluss, beim Pi 5 auch über einen NVMe-Aufsatz. Die Anleitung beschreibt die Karte. Die Xenios-Daten liegen in einem Docker-Volume und lassen sich auf eine spätere SSD mitnehmen ([Sicherung](Installation-Raspberry-Pi.md#9-aktualisieren-und-sichern)).

Wenig geeignet, weil Speicher, Netz oder System nicht reichen: Pi Zero, Pi Zero 2 W (512 MB, nur WLAN), Pi 3 und älter, jedes 32-Bit-Abbild.

Andere Einplatinenrechner (Orange Pi, Radxa, Odroid) sind brauchbar, sobald darauf ein aktuelles 64-Bit-Debian oder Ubuntu mit Ethernet läuft. Dafür gilt die [Linux-Anleitung](Installation-Linux-Docker.md). Ein eigenes Abbild dafür liegt hier nicht bei.

Weiter: [Installation auf dem Raspberry Pi](Installation-Raspberry-Pi.md).

## Mini-PCs

Ein Mini-PC mit SSD ist die ruhigere Wahl, wenn er schon vorhanden ist. Xenios nutzt davon einen kleinen Teil. Installiert wird Ubuntu Server oder Debian, danach die [Linux-Anleitung](Installation-Linux-Docker.md). Docker Desktop ist dort nicht nötig.

![Rückseite eines Mini-PCs: Ethernet-Buchse, Strombuchse, USB](bilder/hardware/02-mini-pc.png)

*Bild 2. Rückseite eines passenden Mini-PCs mit Ethernet und Netzteilanschluss.*

**Neu, klein, sparsam.** Ein Rechner mit Intel N100 oder N150, 8 GB RAM, SSD und Gigabit-Ethernet. Leerlauf liegt typisch bei 6–15 W. Beelink, Minisforum, Trigkey und ähnliche bauen solche Gehäuse. Das konkrete Modell ist egal, solange SSD, Ethernet und ein 64-Bit-System dabei sind. Zwei Netzwerkbuchsen sind ein Bonus, eine genügt.

**Gebraucht, sehr robust.** Bürorechner im Kleinstgehäuse, samt Netzteil:

- Lenovo ThinkCentre Tiny, etwa M720q, M70q, M75q
- Dell OptiPlex Micro, etwa 3060 und neuer
- HP EliteDesk Mini oder ProDesk Mini

Darauf achten: SSD (keine Festplatte), mindestens 8 GB RAM, Gigabit-Ethernet, Netzteil liegt bei. Ein Bildschirm wird nur für die Installation gebraucht, danach läuft der Rechner ohne.

Im BIOS „nach Stromausfall einschalten“ setzen (Formulierung je nach Hersteller *Power On*, *Always On* oder *Restore on AC Power Loss*). Linux selbst geht nach einem Stromausfall nur hoch, wenn das BIOS das Gerät einschaltet.

Wenig geeignet: Android-TV-Boxen, Router mit USB-Platte, 32-Bit-Atom-Rechner, Geräte ohne Ethernet.

## Strom und Aufstellung

| Gerät | Leistungsaufnahme, typisch, im Leerlauf |
|---|---|
| Pi 4, Lite, Ethernet | etwa 3–5 W |
| Pi 5, Lite, Ethernet | etwa 4–8 W |
| Mini-PC mit N100 | etwa 6–15 W |

Schneller muss keiner sein. Der Pi 4 liegt am unteren Ende, ein N100-Rechner hat dafür die SSD im Gehäuse.

Aufstellung:

- Derselbe Router und dasselbe Netz wie Xenia und Mühle.
- Kabel, nicht das Gast-WLAN.
- Feste Adresse im Router.
- Kein Ruhezustand. Raspberry Pi OS und Ubuntu Server schlafen von selbst nicht. Ein Desktop-Ubuntu schon; die Linux-Anleitung schaltet das ab.
- Nach Stromausfall von selbst booten. Der Pi tut das. Beim Mini-PC steht die Option im BIOS.

## Welche Anleitung

| Gerät | Anleitung |
|---|---|
| Raspberry Pi, leere Karte | [Installation-Raspberry-Pi.md](Installation-Raspberry-Pi.md) |
| Mini-PC, anderer Linux-Rechner, frisches Debian oder Ubuntu | [Installation-Linux-Docker.md](Installation-Linux-Docker.md) |
| Docker läuft schon | Kurzfassung in [Einrichtung, Abschnitt 4](Einrichtung.md#4-alternativ-linux-server-raspberry-pi-oder-nas-mit-docker) |
| Synology oder QNAP | [Git und Docker, Teil 3](Git-und-Docker.md#teil-3-docker) |
