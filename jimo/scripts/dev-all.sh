#!/usr/bin/env bash
#
# dev-all.sh — bring up the FULL approval test stack in one command:
#   infra (docker: postgres/mysql/redis/minio) + BPM (Java) + NestJS backend + React frontend
#
# Usage (from release/ or release/jimo/):
#   bash jimo/scripts/dev-all.sh up        # start everything (builds shared + backend dist first)
#   bash jimo/scripts/dev-all.sh down      # stop everything (leaves docker infra running)
#   bash jimo/scripts/dev-all.sh status    # show ports + health
#   bash jimo/scripts/dev-all.sh logs bpm|backend|frontend|infra
#
# Env (optional):
#   APPROVAL_SECRET   HMAC shared secret (default: bpm-dev-shared-secret-2026) — MUST match both sides
#   APP_PORT / BPM_PORT / FRONT_PORT  (default 8888 / 8090 / 8000)
#
# Prereqs: a valid release/jimo/.env (DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, BPM_SERVICE_URL).
#
set -euo pipefail

# lives at release/jimo/scripts/ — ROOT is two levels up (release/)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JIMO="$ROOT/jimo"
BPM="$ROOT/bpm/bpm-service"
INFRA="$ROOT/infrastructure/docker-compose.dev.yml"

SECRET="${APPROVAL_SECRET:-bpm-dev-shared-secret-2026}"
NESTJS_PORT="${APP_PORT:-8888}"
BPM_PORT="${BPM_PORT:-8090}"
FRONT_PORT="${FRONT_PORT:-8000}"

LOG="$ROOT/.tmp/logs"; PID="$ROOT/.tmp/pids"
mkdir -p "$LOG" "$PID"

c()  { printf '\033[0;36m[dev-all]\033[0m %s\n' "$*"; }
ok() { printf '\033[0;32m[ok]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err() { printf '\033[0;31m[err]\033[0m %s\n' "$*" >&2; }

load_env() {
  if [ -f "$JIMO/.env" ]; then set -a; . "$JIMO/.env"; set +a; else
    err "jimo/.env not found at $JIMO/.env — copy from .env.example and fill DATABASE_URL/JWT_SECRET/etc."; return 1
  fi
}

port_up() { local p=$1; (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$p " ; }
wait_http() { local url=$1 name=$2 n=${3:-60}; for i in $(seq 1 "$n"); do curl -sf -o /dev/null "$url" 2>/dev/null && return 0; sleep 1; done; return 1; }

cmd_up() {
  load_env || exit 1

  c "[1/5] docker infra (postgres/mysql/redis/minio)..."
  docker compose -f "$INFRA" up -d postgres mysql redis minio
  c "  waiting for mysql..."
  for i in $(seq 1 45); do docker exec lowcode-mysql mysqladmin ping -uroot -p123456 2>/dev/null | grep -q "alive" && break; sleep 1; done
  ok "infra up"

  c "[2/5] build @jimo/shared + backend dist..."
  (cd "$JIMO/packages/shared" && pnpm run build) >/dev/null 2>&1 && ok "shared built" || warn "shared build failed (may already be built)"
  (cd "$JIMO/apps/server" && pnpm exec nest build) >/dev/null 2>&1 && ok "backend dist built" || warn "backend build reported errors (drizzle .d.ts warnings are normal; dist emits anyway)"

  c "[3/5] BPM (Java, port $BPM_PORT)..."
  if port_up "$BPM_PORT"; then warn "BPM port $BPM_PORT already in use, skipping"; else
    NESTJS_CALLBACK_SECRET="$SECRET" NESTJS_CALLBACK_URL="http://localhost:$NESTJS_PORT/api/v1/webhooks/bpm/approval" \
      nohup bash -c "cd '$BPM' && exec mvn -o spring-boot:run" > "$LOG/bpm.log" 2>&1 &
    echo $! > "$PID/bpm.pid"
    wait_http "http://localhost:$BPM_PORT/bpm/api/health" "bpm" 120 && ok "BPM ready" || err "BPM not ready — see $LOG/bpm.log"
  fi

  c "[4/5] NestJS backend (port $NESTJS_PORT)..."
  if port_up "$NESTJS_PORT"; then warn "backend port $NESTJS_PORT already in use, skipping"; else
    set -a; . "$JIMO/.env"; set +a
    BPM_CALLBACK_SECRET="$SECRET" nohup bash -c "cd '$JIMO/apps/server' && exec node dist/main" > "$LOG/backend.log" 2>&1 &
    echo $! > "$PID/backend.pid"
    wait_http "http://localhost:$NESTJS_PORT/api/v1/health" "backend" 60 && ok "backend ready" || err "backend not ready — see $LOG/backend.log"
  fi

  c "[5/5] frontend (Umi, port $FRONT_PORT)..."
  if port_up "$FRONT_PORT"; then warn "frontend port $FRONT_PORT already in use, skipping"; else
    nohup bash -c "cd '$JIMO/apps/web' && HOST=0.0.0.0 PORT=$FRONT_PORT exec npx max dev" > "$LOG/frontend.log" 2>&1 &
    echo $! > "$PID/frontend.pid"
    wait_http "http://localhost:$FRONT_PORT" "frontend" 90 && ok "frontend ready" || warn "frontend still starting (first build is slow) — check $LOG/frontend.log"
  fi

  echo
  ok "stack up:  frontend http://localhost:$FRONT_PORT  |  backend http://localhost:$NESTJS_PORT/api/docs  |  BPM http://localhost:$BPM_PORT/bpm/api/health"
  c "login: admin / admin123"
}

cmd_down() {
  c "stopping backend/BPM/frontend (infra left running)..."
  for f in backend bpm frontend; do
    if [ -f "$PID/$f.pid" ]; then
      pid=$(cat "$PID/$f.pid"); kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
      rm -f "$PID/$f.pid"; ok "stopped $f"
    fi
  done
  c "(to also stop docker infra: docker compose -f \"$INFRA\" down)"
}

cmd_status() {
  for pair in "frontend:$FRONT_PORT" "backend:$NESTJS_PORT" "BPM:$BPM_PORT"; do
    name=${pair%%:*}; port=${pair##*:}
    if port_up "$port"; then printf '  %-10s :%s  \033[0;32mUP\033[0m\n' "$name" "$port"; else printf '  %-10s :%s  \033[0;31mDOWN\033[0m\n' "$name" "$port"; fi
  done
  curl -sf -o /dev/null -w '  backend health: %{http_code}\n' "http://localhost:$NESTJS_PORT/api/v1/health" 2>/dev/null || true
  curl -sf -o /dev/null -w '  bpm health:     %{http_code}\n' "http://localhost:$BPM_PORT/bpm/api/health" 2>/dev/null || true
  docker ps --filter name=lowcode- --format '  docker: {{.Names}} {{.Status}}' 2>/dev/null || true
}

cmd_logs() {
  case "${1:-all}" in
    bpm) tail -f "$LOG/bpm.log";;
    backend|b) tail -f "$LOG/backend.log";;
    frontend|f) tail -f "$LOG/frontend.log";;
    infra) docker compose -f "$INFRA" logs -f;;
    *) tail -f "$LOG/backend.log" "$LOG/bpm.log" "$LOG/frontend.log";;
  esac
}

case "${1:-up}" in
  up) cmd_up;;
  down|stop) cmd_down;;
  status) cmd_status;;
  logs) shift; cmd_logs "$@";;
  *) err "unknown command: $1"; echo "usage: $0 up|down|status|logs [bpm|backend|frontend|infra]"; exit 1;;
esac
