#!/bin/sh
# Xenios OHNE Docker: Server als systemd-Dienst, Programm als Kopie von server/ (z. B. /opt/xenios).
# Installiert Xenios neu und richtet den Update-Dienst ein, damit in der App „Einstellungen → System →
# Aktualisieren“ auch ohne Docker funktioniert.
#
# Neu installieren (Raspberry Pi OS / Debian / Ubuntu mit systemd; holt Node.js 22 LTS, falls es fehlt oder älter
# als 20 ist; Benutzer „xenios“, Programm /opt/xenios, Daten /var/lib/xenios, Dienst „xenios“):
#   curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/native-update.sh | sudo sh -s -- --install
#
# Nur den Update-Dienst für eine vorhandene Installation einrichten (liest Programm-, Konfigurations- und
# Datenordner aus dem systemd-Dienst „xenios“):
#   curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/native-update.sh | sudo sh -s -- --setup
#   sudo sh native-update.sh --setup [--service <name>]
#
# Von Hand aktualisieren (neuestes Release bzw. ein Tag oder Branch):
#   sudo xenios-update            (nach --setup)
#   sudo xenios-update v2.5.2
#
# Die App legt <Datenordner>/update.request an; dieses Skript holt die Anforderung jede Minute ab (systemd-Timer),
# lädt das Release von GitHub, ersetzt den Programmordner (der alte bleibt als <Ordner>.alt), startet den Dienst neu
# und meldet den Stand in <Datenordner>/update.json. Startet der neue Stand nicht, kommt der alte zurück.
set -eu

REPO=${XENIOS_GITHUB:-TimS1998/Xenios}
CONF=${XENIOS_NATIVE_CONF:-/etc/xenios-native-update.conf}
LIB=${XENIOS_NATIVE_LIB:-/usr/local/lib/xenios}
STABLE=${XENIOS_STABLE_SECONDS:-15} # so lange muss der neue Stand ohne Neustart laufen
SELF=$LIB/native-update.sh
SYSTEMCTL=${XENIOS_SYSTEMCTL:-systemctl}
SERVICE=xenios
SCRIPT_URL=${XENIOS_SCRIPT_URL:-https://raw.githubusercontent.com/$REPO/main/native-update.sh}

say() { printf '%s\n' "$*"; }
die() { say "Fehler: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Befehl fehlt: $1"; }

# --- Erkennen: aus dem systemd-Dienst Programmordner, Konfiguration und Datenordner ermitteln ----------------------
prop() { "$SYSTEMCTL" show "$SERVICE" -p "$1" --value 2>/dev/null || true; }

# Wert einer Umgebungsvariablen des Dienstes (Environment= und EnvironmentFile=)
service_env() {
  name=$1
  val=$(prop Environment | tr ' ' '\n' | sed -n "s/^$name=//p" | tail -n 1)
  if [ -z "$val" ]; then
    for f in $(prop EnvironmentFiles | sed 's/ (ignore_errors=[a-z]*)//g'); do
      [ -r "$f" ] && val=$(sed -n "s/^[[:space:]]*$name=//p" "$f" | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//')
      [ -n "$val" ] && break
    done
  fi
  printf '%s' "$val"
}

detect() {
  need node
  [ "$("$SYSTEMCTL" show "$SERVICE" -p LoadState --value 2>/dev/null)" = loaded ] || die "systemd-Dienst „$SERVICE“ nicht gefunden (anderer Name: --service <name>)"
  wd=$(prop WorkingDirectory)
  argv=$(prop ExecStart | sed -n 's/.*argv\[\]=\([^;]*\);.*/\1/p' | head -n 1)
  [ -n "$argv" ] || die "ExecStart des Dienstes nicht lesbar"
  # Programmordner: der Ordner über src/index.js (relativ zum WorkingDirectory)
  script=$(printf '%s\n' $argv | grep -m1 'index\.js$' || true)
  [ -n "$script" ] || die "src/index.js nicht im ExecStart des Dienstes gefunden: $argv"
  case "$script" in /*) ;; *) script=${wd:-/}/$script ;; esac
  PROG=$(cd "$(dirname "$script")/.." && pwd)
  [ -f "$PROG/package.json" ] && [ -f "$PROG/src/index.js" ] || die "Kein Xenios-Programm unter $PROG"
  # Konfiguration: --config, sonst XENIOS_CONFIG, sonst <Programm>/config.json
  cfg=$(printf '%s\n' $argv | awk 'f { print; exit } $0 == "--config" { f = 1 }')
  [ -n "$cfg" ] || cfg=$(service_env XENIOS_CONFIG)
  [ -n "$cfg" ] || cfg=$PROG/config.json
  case "$cfg" in /*) ;; *) cfg=${wd:-$PROG}/$cfg ;; esac
  # Datenordner: XENIOS_DATA_DIR, sonst dataDir aus der Konfiguration (relativ zu ihrem Ordner), Standard „data“
  DATA=$(service_env XENIOS_DATA_DIR)
  if [ -z "$DATA" ]; then
    DATA=$(node -e '
      const fs = require("fs"), path = require("path"); const f = process.argv[1];
      let d = "data"; try { d = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")).dataDir || d; } catch {}
      console.log(path.resolve(path.dirname(f), d));' "$cfg")
  else
    case "$DATA" in /*) ;; *) DATA=${wd:-$PROG}/$DATA ;; esac
  fi
  [ -d "$DATA" ] || die "Datenordner $DATA nicht gefunden"
}

load_conf() {
  [ -r "$CONF" ] || die "Noch nicht eingerichtet: sudo sh native-update.sh --setup"
  # shellcheck disable=SC1090
  . "$CONF"
}

# --- Austausch mit der App (Dateien im Datenordner, gehören dem Benutzer des Dienstes) -----------------------------
put() { # put <Datei> <JSON>
  tmp=$1.tmp.$$
  printf '%s\n' "$2" > "$tmp" && chown --reference="$DATA" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$1"
}
now_ms() { printf '%s000' "$(date +%s)"; }
heartbeat() { put "$DATA/update-helper.json" "{\"at\":$(now_ms),\"host\":\"$(uname -n 2>/dev/null || echo host)\",\"mode\":\"native\"}"; }
status() { put "$DATA/update.json" "{\"state\":\"$1\",\"at\":$(now_ms)${2:-}}"; }
version_of() { node -p "require('$1/package.json').version" 2>/dev/null || true; }

# --- Aktualisieren --------------------------------------------------------------------------------------------------
latest_tag() {
  curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tag_name||"")}catch{}})'
}

# Läuft der Dienst nach dem Start stabil? (aktiv und $STABLE s lang kein Neustart; bis zu 60 s Anlauf)
healthy() {
  i=0
  while [ "$i" -lt 30 ]; do
    if "$SYSTEMCTL" is-active --quiet "$SERVICE"; then
      n1=$(prop NRestarts); sleep "$STABLE"; n2=$(prop NRestarts)
      "$SYSTEMCTL" is-active --quiet "$SERVICE" && [ "${n1:-0}" = "${n2:-0}" ] && return 0
      return 1
    fi
    i=$((i + 1)); sleep "${XENIOS_START_POLL:-2}"
  done
  return 1
}

# Release (Tag, sonst Branch) laden und entpacken; setzt $src (server/ im Archiv) und $new (Version)
fetch_release() { # fetch_release [<Tag oder Branch>]
  need curl; need tar; need node
  ref=${1:-}
  [ -n "$ref" ] || ref=$(latest_tag)
  [ -n "$ref" ] || { say "Kein Release gefunden, nehme main."; ref=main; }
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  say "Lade $REPO $ref …"
  case "$ref" in v[0-9]*) url=https://github.com/$REPO/archive/refs/tags/$ref.tar.gz ;; *) url=https://github.com/$REPO/archive/$ref.tar.gz ;; esac
  curl -fsSL "$url" | tar xz -C "$work" || return 1
  src=$(find "$work" -mindepth 2 -maxdepth 2 -type d -name server | head -n 1)
  [ -n "$src" ] && [ -f "$src/package.json" ] && [ -f "$src/src/index.js" ] || { say "Archiv enthält kein server/"; return 1; }
  new=$(version_of "$src")
}

update() { # update [<Tag oder Branch>]
  old=$(version_of "$PROG")
  fetch_release "${1:-}" || return 1
  # Lokale Dateien des alten Programmordners übernehmen, die das Release nicht mitbringt (config.json, data/, Zertifikate …)
  for f in "$PROG"/* "$PROG"/.[!.]*; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    [ -e "$src/$b" ] || cp -a "$f" "$src/$b"
  done
  chown -R --reference="$PROG" "$src" 2>/dev/null || true
  say "Xenios ${old:-?} → ${new:-?}: Dienst anhalten und austauschen"
  "$SYSTEMCTL" stop "$SERVICE" || true
  rm -rf "$PROG.alt"
  if ! mv "$PROG" "$PROG.alt"; then "$SYSTEMCTL" start "$SERVICE" || true; return 1; fi
  if ! cp -a "$src" "$PROG"; then
    rm -rf "$PROG"; mv "$PROG.alt" "$PROG"; "$SYSTEMCTL" start "$SERVICE" || true; return 1
  fi
  "$SYSTEMCTL" start "$SERVICE" || true
  if healthy; then
    # das Skript selbst aus dem Release übernehmen (Verbesserungen am Update-Dienst)
    sh_new=$(dirname "$src")/native-update.sh
    [ -f "$sh_new" ] && [ -d "$LIB" ] && cp "$sh_new" "$SELF" && chmod 755 "$SELF" || true
    UPDATED=$new
    return 0
  fi
  say "Neuer Stand startet nicht – alter Stand zurück"
  "$SYSTEMCTL" stop "$SERVICE" || true
  rm -rf "$PROG.neu"; mv "$PROG" "$PROG.neu"; mv "$PROG.alt" "$PROG"
  "$SYSTEMCTL" start "$SERVICE" || true
  return 1
}

apply_requested() {
  load_conf
  heartbeat
  [ -f "$DATA/update.request" ] || return 0
  rm -f "$DATA/update.request"
  say "Aktualisierung aus der App angefordert"
  status running
  if update; then
    status ok ",\"version\":\"${UPDATED:-}\""
    heartbeat
    say "Fertig: Xenios ${UPDATED:-}"
  else
    status error ',"error":"Aktualisierung fehlgeschlagen, alter Stand läuft weiter (journalctl -u xenios-update)"'
    exit 1
  fi
}

# --- Einrichten -----------------------------------------------------------------------------------------------------
setup() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen"
  [ -d /run/systemd/system ] || die "Kein systemd – dieser Update-Dienst braucht systemd"
  detect
  say "Gefunden: Dienst $SERVICE · Programm $PROG · Daten $DATA · Xenios $(version_of "$PROG")"
  mkdir -p "$LIB"
  if [ -f "$0" ] && [ "$(basename "$0")" = native-update.sh ]; then [ "$0" -ef "$SELF" ] || cp "$0" "$SELF"
  else curl -fsSL "$SCRIPT_URL" -o "$SELF" || die "Skript nicht ladbar: $SCRIPT_URL"; fi
  chmod 755 "$SELF"
  ln -sf "$SELF" /usr/local/bin/xenios-update
  printf 'SERVICE=%s\nPROG=%s\nDATA=%s\nREPO=%s\n' "$SERVICE" "$PROG" "$DATA" "$REPO" > "$CONF"
  cat > /etc/systemd/system/xenios-update.service <<EOF
[Unit]
Description=Xenios: Aktualisierung aus der App ausführen (ohne Docker)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh $SELF --apply-requested
EOF
  cat > /etc/systemd/system/xenios-update.timer <<EOF
[Unit]
Description=Xenios: jede Minute nach einer Aktualisierung aus der App sehen

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable --now xenios-update.timer
  heartbeat
  say "Eingerichtet. In der App: Einstellungen → System → Aktualisieren. Von Hand: sudo xenios-update"
}

# --- Neu installieren -----------------------------------------------------------------------------------------------
NODE_MIN=20
NODE_LTS=22
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge "$NODE_MIN" ]; }

# Offizielles Node.js LTS von nodejs.org nach /usr/local/lib/nodejs (Prüfsumme aus SHASUMS256.txt), keine Paketquelle
install_node() {
  case "$(uname -m)" in
    aarch64|arm64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    armv7l) arch=armv7l ;;
    *) die "Unbekannte Architektur $(uname -m) – Node.js $NODE_MIN+ bitte selbst installieren" ;;
  esac
  base=https://nodejs.org/dist/latest-v$NODE_LTS.x
  nwork=$(mktemp -d)
  curl -fsSL "$base/SHASUMS256.txt" -o "$nwork/sums" || die "nodejs.org nicht erreichbar"
  file=$(awk -v a="-linux-$arch.tar.gz" 'index($2, a) && substr($2, length($2) - length(a) + 1) == a { print $2; exit }' "$nwork/sums")
  [ -n "$file" ] || die "Kein Node.js $NODE_LTS für linux-$arch"
  say "Installiere $file …"
  curl -fsSL "$base/$file" -o "$nwork/$file" || die "Download von Node.js fehlgeschlagen"
  sum=$(awk -v f="$file" '$2 == f { print $1 }' "$nwork/sums")
  [ "$(sha256sum "$nwork/$file" | cut -d' ' -f1)" = "$sum" ] || die "Prüfsumme von Node.js stimmt nicht"
  rm -rf /usr/local/lib/nodejs && mkdir -p /usr/local/lib/nodejs
  tar xzf "$nwork/$file" -C /usr/local/lib/nodejs --strip-components=1
  ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  rm -rf "$nwork"
  hash -r 2>/dev/null || true
  node_ok || die "Node.js nach der Installation nicht nutzbar"
}

# Einrichtungscode aus dem Protokoll des Dienstes (bis zu 20 s warten)
setup_code() {
  i=0
  while [ "$i" -lt 20 ]; do
    c=$(journalctl -u "$SERVICE" --no-pager -o cat 2>/dev/null | grep 'Einrichtungscode' | grep -o '[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]' | tail -n 1 || true)
    [ -n "$c" ] && { printf '%s' "$c"; return 0; }
    i=$((i + 1)); sleep 1
  done
  return 1
}

install_xenios() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen"
  [ -d /run/systemd/system ] || die "Kein systemd – die Installation ohne Docker braucht systemd"
  if [ "$("$SYSTEMCTL" show "$SERVICE" -p LoadState --value 2>/dev/null)" = loaded ]; then
    die "Den Dienst „$SERVICE“ gibt es schon. Aktualisieren: sudo xenios-update · nur Update-Dienst: --setup"
  fi
  PROG=${XENIOS_PROG:-/opt/xenios}
  DATA=${XENIOS_DATA:-/var/lib/xenios}
  [ ! -e "$PROG" ] || die "$PROG gibt es schon – bitte zuerst wegräumen oder XENIOS_PROG=<Ordner> setzen"
  need curl; need tar; need sha256sum
  if ! node_ok; then
    if command -v node >/dev/null 2>&1; then say "Node.js $(node -v) ist zu alt (mindestens $NODE_MIN)."; else say "Node.js fehlt."; fi
    install_node
  fi
  say "Node.js $(node -v)"
  # Dienst-Benutzer ohne Anmeldung, Daten nur für ihn
  id xenios >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin xenios
  mkdir -p "$DATA" && chown xenios: "$DATA" && chmod 700 "$DATA"
  fetch_release "${ref:-}" || die "Release nicht ladbar"
  # Programm gehört root und ist für den Dienst nur lesbar (wie im Docker-Image)
  mkdir -p "$(dirname "$PROG")"
  cp -a "$src" "$PROG" && chown -R root: "$PROG" && chmod -R go-w,go+rX "$PROG"
  nodebin=$(command -v node)
  {
    printf '%s\n' '# Xenios ohne Docker (eingerichtet mit native-update.sh --install)' \
      '[Unit]' 'Description=Xenios (Espressomaschine + Mühle)' 'After=network-online.target' 'Wants=network-online.target' '' \
      '[Service]' 'Type=simple' 'User=xenios' "WorkingDirectory=$PROG" 'Environment=NODE_ENV=production' \
      "Environment=XENIOS_CONFIG=$DATA/config.json" "Environment=XENIOS_DATA_DIR=$DATA" "ExecStart=$nodebin src/index.js" \
      'Restart=always' 'RestartSec=5' 'NoNewPrivileges=true' 'ProtectSystem=strict' 'ProtectHome=true' "ReadWritePaths=$DATA" \
      'PrivateTmp=true' 'PrivateDevices=true' 'ProtectKernelTunables=true' 'ProtectKernelModules=true' 'ProtectControlGroups=true' \
      'RestrictSUIDSGID=true' 'LockPersonality=true' 'CapabilityBoundingSet=' 'UMask=0077' '' \
      '[Install]' 'WantedBy=multi-user.target'
  } > "/etc/systemd/system/$SERVICE.service"
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable --now "$SERVICE"
  say "Xenios $new gestartet."
  # Update-Dienst gleich mit einrichten
  setup
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')
  code=$(setup_code || true)
  say ""
  say "Fertig. Im Browser öffnen und einrichten (Zertifikatswarnung einmal bestätigen):"
  say "  https://${ip:-<IP-dieses-Rechners>}:8443"
  if [ -n "$code" ]; then say "Einrichtungscode: $code"; else say "Einrichtungscode: journalctl -u $SERVICE | grep Einrichtungscode"; fi
  say "Protokoll: journalctl -u $SERVICE -f · Aktualisieren: in der App oder sudo xenios-update"
}

# --- Aufruf ---------------------------------------------------------------------------------------------------------
cmd=update
ref=
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) cmd=setup ;;
    --install) cmd=install ;;
    --apply-requested) cmd=apply ;;
    --service) shift; SERVICE=${1:?Name fehlt} ;;
    --detect) cmd=detect ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) die "Unbekannte Option $1" ;;
    *) ref=$1 ;;
  esac
  shift
done

case "$cmd" in
  setup) setup ;;
  install) install_xenios ;;
  apply) apply_requested ;;
  detect) detect; say "Dienst $SERVICE · Programm $PROG · Daten $DATA · Xenios $(version_of "$PROG")" ;;
  update)
    [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen"
    load_conf
    update "$ref" || die "Aktualisierung fehlgeschlagen, alter Stand läuft weiter"
    say "Fertig: Xenios ${UPDATED:-}"
    ;;
esac
