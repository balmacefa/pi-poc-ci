#!/usr/bin/env bash
# Lifecycle manager for the pi-poc-ci Docker stack (service: dev).
# Interactive menu when run with no arguments, or direct:
#   scripts/manage.sh start     build if needed + start the dev container (project running)
#   scripts/manage.sh stop      stop the container (keeps image and volumes)
#   scripts/manage.sh delete    remove containers, network, volumes and the project image
#   scripts/manage.sh status    show container state
#   scripts/manage.sh shell     open a bash shell inside the running container
#   scripts/manage.sh pi  ...   run pi inside the container (e.g. manage.sh pi -p "...")
#   scripts/manage.sh bob ...   run the Bob agent inside the container (e.g. manage.sh bob run "...")
#   scripts/manage.sh poc       run ./run-poc.sh all (CI demo)
set -u
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

SERVICE=dev
DC="docker compose"

[ -f .env ] || echo "warn: no .env found; copy .env.example and fill in your keys." >&2

running() { [ -n "$($DC ps -q "$SERVICE" 2>/dev/null)" ]; }

ensure_up() {
  if ! running; then
    echo "-> starting $SERVICE ..."
    $DC up -d --build "$SERVICE"
  fi
}

cmd_start() {
  echo "== start =="
  $DC up -d --build "$SERVICE" && echo "project running (service: $SERVICE)."
  $DC ps
}

cmd_stop() {
  echo "== stop =="
  $DC stop && echo "stopped (image and volumes kept)."
}

cmd_delete() {
  echo "== delete =="
  $DC down -v --rmi local --remove-orphans && echo "removed containers, network, volumes and project image."
}

cmd_status() { echo "== status =="; $DC ps -a; }

cmd_shell() { ensure_up; $DC exec "$SERVICE" bash; }

cmd_pi()  { ensure_up; $DC exec "$SERVICE" /usr/local/bin/pi-entry "$@"; }
cmd_bob() { ensure_up; $DC exec "$SERVICE" bash scripts/bob.sh "$@"; }
cmd_poc() { ensure_up; $DC exec "$SERVICE" bash ./run-poc.sh all; }

menu() {
  while true; do
    cat <<'EOF'

==== pi-poc-ci ====
  1) start      5) shell
  2) stop       6) pi (interactive)
  3) delete     7) bob run "<prompt>"
  4) status     8) poc (CI demo)
  q) quit
EOF
    read -r -p "> " choice
    case "$choice" in
      1) cmd_start ;;
      2) cmd_stop ;;
      3) cmd_delete ;;
      4) cmd_status ;;
      5) cmd_shell ;;
      6) cmd_pi ;;
      7) read -r -p "prompt: " p; cmd_bob run "$p" ;;
      8) cmd_poc ;;
      q|Q) break ;;
      *) echo "invalid option" ;;
    esac
  done
}

action="${1:-menu}"
case "$action" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  delete) cmd_delete ;;
  status) cmd_status ;;
  shell)  cmd_shell ;;
  pi)     shift; cmd_pi "$@" ;;
  bob)    shift; cmd_bob "$@" ;;
  poc)    cmd_poc ;;
  menu)   menu ;;
  *) echo "usage: $0 {start|stop|delete|status|shell|pi ...|bob ...|poc|menu}" >&2; exit 64 ;;
esac
