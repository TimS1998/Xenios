#!/bin/sh
# Xenios auf einem Linux-Rechner einrichten (Debian, Ubuntu, Raspberry Pi OS 64-Bit).
# Raspberry Pi: Pi 4 (2 GB+) oder Pi 5, 64-Bit-System. Das Image gibt es für amd64 und arm64.
#
# Neu:
#   curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/install.sh | sh
#
# Schon da, oder aktualisieren:
#   sh ~/xenios/install.sh
#   sh ~/xenios/install.sh --update
#
# In der App: Einstellungen → Server & Sicherheit → Aktualisieren
# (dazu richtet dieses Skript einen systemd-Timer ein).
# apt und das Docker-Installationsskript lesen nicht von der Standardeingabe,
# damit `curl … | sh` den Rest dieses Skripts nicht verliert.
set -eu

REPO_URL=${XENIOS_REPO:-https://github.com/TimS1998/Xenios.git}
IMAGE=${XENIOS_IMAGE:-ghcr.io/tims1998/xenios:latest}

here=$(CDPATH= cd -- "$(dirname -- "$0" 2>/dev/null)" && pwd) 2>/dev/null || here=
owner=${SUDO_USER:-$(id -un)}
owner_home=$(getent passwd "$owner" 2>/dev/null | cut -d: -f6)
owner_home=${owner_home:-${HOME:-/root}}

if [ -n "${XENIOS_DIR:-}" ]; then
  DIR=$XENIOS_DIR
elif [ -n "$here" ] && [ -f "$here/docker/compose.yaml" ]; then
  DIR=$here
else
  DIR=$owner_home/xenios
fi

say() { printf '%s\n' "$*"; }
die() { say "Fehler: $*"; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Befehl fehlt: $1"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

docker_ok() {
  docker info >/dev/null 2>&1
}

run_docker() {
  if docker_ok; then
    docker "$@"
  else
    as_root docker "$@"
  fi
}

compose() {
  run_docker compose --project-directory "$DIR/docker" "$@"
}

lan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

write_status() {
  state=$1
  extra=${2:-}
  now=$(date +%s)000
  json=$(printf '{"state":"%s","at":%s%s}' "$state" "$now" "$extra")
  run_docker exec xenios sh -c "printf '%s\\n' '$json' > /data/update.json" 2>/dev/null || true
}

heartbeat() {
  now=$(date +%s)000
  host=$(uname -n 2>/dev/null || echo host)
  run_docker exec xenios sh -c "printf '%s\\n' '{\"at\":$now,\"host\":\"$host\"}' > /data/update-helper.json" 2>/dev/null || true
}

apply_tunnel_token() {
  run_docker exec xenios test -f /data/tunnel.token 2>/dev/null || return 0
  token=$(run_docker exec xenios cat /data/tunnel.token 2>/dev/null | tr -d ' \r\n') || true
  if [ -z "$token" ]; then
    return 0
  fi
  case "$token" in
    *[!A-Za-z0-9+/=_-]*)
      say "Tunnel-Token ungültig, nicht übernommen."
      run_docker exec xenios rm -f /data/tunnel.token 2>/dev/null || true
      return 0
      ;;
  esac
  envf=$DIR/docker/.env
  tmp=$(mktemp)
  if [ -f "$envf" ]; then
    awk '$0 !~ /^[#[:space:]]*(TUNNEL_TOKEN|COMPOSE_PROFILES)=/ { print }' "$envf" > "$tmp"
  fi
  printf 'TUNNEL_TOKEN=%s\nCOMPOSE_PROFILES=tunnel\n' "$token" >> "$tmp"
  mv "$tmp" "$envf"
  chmod 600 "$envf" 2>/dev/null || true
  run_docker exec xenios rm -f /data/tunnel.token 2>/dev/null || true
  say "Tunnel-Token übernommen, starte cloudflared."
  compose up -d || say "Starten von cloudflared fehlgeschlagen."
}

apply_requested() {
  [ -f "$DIR/docker/compose.yaml" ] || die "Kein Xenios unter $DIR (docker/compose.yaml fehlt)"
  heartbeat
  apply_tunnel_token
  if ! run_docker exec xenios test -f /data/update.request 2>/dev/null; then
    return 0
  fi
  say "Aktualisierung aus der App: $DIR"
  run_docker exec xenios rm -f /data/update.request 2>/dev/null || true
  write_status running
  if apply_update; then
    ver=$(run_docker exec xenios node -p "require('./package.json').version" 2>/dev/null || echo "")
    extra=
    [ -n "$ver" ] && extra=$(printf ',"version":"%s"' "$ver")
    write_status ok "$extra"
    heartbeat
    say "Fertig${ver:+ · Xenios $ver}."
  else
    write_status error ',"error":"Aktualisierung fehlgeschlagen (Protokoll auf dem Server)"}'
    die "Aktualisierung fehlgeschlagen"
  fi
}

apply_update() {
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" pull --ff-only || return 1
  fi
  compose pull || true
  compose up -d || return 1
  i=0
  while [ "$i" -lt 45 ]; do
    st=$(run_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' xenios 2>/dev/null || echo starting)
    if [ "$st" = "healthy" ] || [ "$st" = "running" ]; then
      run_docker image prune -f >/dev/null 2>&1 || true
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update -y </dev/null
    as_root apt-get install -y ca-certificates curl git </dev/null
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    say "Docker ist schon da."
    return 0
  fi
  say "Installiere Docker…"
  need_cmd curl
  tmp=$(mktemp)
  curl -fsSL https://get.docker.com -o "$tmp"
  as_root sh "$tmp" </dev/null
  rm -f "$tmp"
  if [ "$(id -u)" -ne 0 ]; then
    as_root usermod -aG docker "$owner"
  elif [ "$owner" != "root" ]; then
    as_root usermod -aG docker "$owner"
  fi
}

ensure_repo() {
  if [ -d "$DIR/.git" ]; then
    say "Aktualisiere $DIR …"
    git -C "$DIR" pull --ff-only || say "Hinweis: git pull nicht möglich – es bleibt der vorhandene Stand."
    return 0
  fi
  if [ -e "$DIR" ] && [ ! -d "$DIR/.git" ]; then
    die "Ordner $DIR existiert, ist aber kein Git-Repository"
  fi
  say "Lade Xenios nach $DIR …"
  need_cmd git
  git clone --depth 1 "$REPO_URL" "$DIR"
}

write_env() {
  envf=$DIR/docker/.env
  if [ -f "$envf" ]; then
    say "Bestehende $envf bleibt unverändert."
    return 0
  fi
  ip=$(lan_ip)
  tz=$(timedatectl show -p Timezone --value 2>/dev/null || echo Europe/Berlin)
  port=8443
  [ -n "$ip" ] && port="$ip:8443"
  cat > "$envf" <<EOF
# von install.sh angelegt; Token und Ports hier ändern
TZ=$tz
XENIOS_HTTPS_PORT=$port
XENIOS_IMAGE=$IMAGE
XENIOS_PULL=always
XENIOS_SECRET_KEY=
EOF
  if [ "$owner" != "$(id -un)" ]; then
    as_root chown "$owner:" "$envf" 2>/dev/null || true
  fi
  say "Neue $envf (HTTPS $port, Image $IMAGE)."
}

install_helper() {
  unit_dir=/etc/systemd/system
  if [ ! -d /run/systemd/system ]; then
    say "Kein systemd – Update-Button braucht einen Cronjob:"
    say "  * * * * * $DIR/install.sh --apply-requested"
    return 0
  fi
  service=$unit_dir/xenios-update.service
  timer=$unit_dir/xenios-update.timer
  as_root tee "$service" >/dev/null <<EOF
[Unit]
Description=Xenios aktualisieren (von der App angefordert)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
User=$owner
Group=$owner
SupplementaryGroups=docker
WorkingDirectory=$DIR
ExecStart=$DIR/install.sh --apply-requested
EOF
  as_root tee "$timer" >/dev/null <<EOF
[Unit]
Description=Xenios: auf Update-Anforderung aus der App prüfen

[Timer]
OnBootSec=20
OnUnitActiveSec=8
AccuracySec=2
Persistent=false
Unit=xenios-update.service

[Install]
WantedBy=timers.target
EOF
  as_root systemctl daemon-reload
  as_root systemctl enable --now xenios-update.timer
  say "Update-Dienst: xenios-update.timer (prüft alle paar Sekunden)."
}

print_done() {
  ip=$(lan_ip)
  url="https://${ip:-<IP-dieses-Rechners>}:8443"
  say ""
  say "────────────────────────────────────────"
  say "Xenios läuft."
  say "  Im Browser:  $url"
  say "  (Zertifikatswarnung einmal bestätigen)"
  say ""
  compose logs --tail 80 xenios 2>/dev/null | sed -n '/ERSTEINRICHTUNG/,/└/p' || true
  code=$(compose logs xenios 2>/dev/null | grep -o 'Einrichtungscode:  *[A-Z0-9-]\{9\}' | tail -n 1 || true)
  if [ -n "$code" ]; then
    say "$code"
  else
    say "Einrichtungscode:  compose logs xenios   (im Ordner $DIR/docker)"
  fi
  say "────────────────────────────────────────"
  if ! docker_ok; then
    say "Docker-Gruppe gilt in dieser Sitzung noch nicht. Neu anmelden, dann:"
    say "  docker compose -f $DIR/docker/compose.yaml ps"
  fi
}

cmd=${1:-}
case $cmd in
  --apply-requested)
    apply_requested
    exit 0
    ;;
  --update|update)
    [ -f "$DIR/docker/compose.yaml" ] || { ensure_repo; }
    apply_update
    heartbeat
    print_done
    exit 0
    ;;
  --help|-h)
    sed -n '2,14p' "$0"
    exit 0
    ;;
  ""|--install|install)
    ;;
  *)
    die "Unbekanntes Argument: $cmd  (erlaubt: --update, --apply-requested)"
    ;;
esac

say "Xenios einrichten in $DIR"
install_packages
install_docker
need_cmd git
ensure_repo
write_env
install_helper
say "Starte Xenios…"
compose up -d
heartbeat
print_done
