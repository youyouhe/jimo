#!/usr/bin/env bash
#
# dev.sh — LowCode Platform 开发环境启停脚本
#
# 用法:
#   ./scripts/dev.sh          # 启动全部 (backend + frontend)
#   ./scripts/dev.sh start    # 同上
#   ./scripts/dev.sh stop     # 停止全部
#   ./scripts/dev.sh restart  # 重启全部
#   ./scripts/dev.sh status   # 查看运行状态
#   ./scripts/dev.sh start backend   # 只启动后端
#   ./scripts/dev.sh start frontend  # 只启动前端
#
# 端口配置:
#   后端 NestJS: 8888  (环境变量 PORT 可覆盖)
#   前端 Umi Max: 8000 (环境变量 FRONT_PORT 可覆盖)
#

set -euo pipefail

# ── 项目路径 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_ROOT/apps/web"
SERVER_DIR="$PROJECT_ROOT/apps/server"
SHARED_DIR="$PROJECT_ROOT/packages/shared"
ENV_FILE="$PROJECT_ROOT/.env"
PID_DIR="$PROJECT_ROOT/.tmp/pids"
LOG_DIR="$PROJECT_ROOT/.tmp/logs"

# ── 端口 ──
BACKEND_PORT="${PORT:-8888}"
FRONTEND_PORT="${FRONT_PORT:-8000}"
FRONTEND_HOST="0.0.0.0"

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; }
info() { echo -e "${CYAN}[info]${NC} $*"; }

# ── 初始化 ──
mkdir -p "$PID_DIR" "$LOG_DIR"

backend_pid_file="$PID_DIR/backend.pid"
frontend_pid_file="$PID_DIR/frontend.pid"
worker_pid_file="$PID_DIR/worker.pid"
backend_log="$LOG_DIR/backend.log"
frontend_log="$LOG_DIR/frontend.log"
worker_log="$LOG_DIR/worker.log"
WORKER_SCRIPT="$PROJECT_ROOT/tools/cleanup-worker.mjs"

# ── 检查端口占用 ──
check_port() {
  local port=$1
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0
  elif command -v lsof &>/dev/null; then
    lsof -ti:"$port" &>/dev/null && return 0
  fi
  return 1
}

# ── 获取 PID ──
read_pid() {
  local pid_file=$1
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

# ── 等待端口就绪 ──
wait_for_port() {
  local port=$1 name=$2 timeout=${3:-30}
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if check_port "$port"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ── 加载环境变量 ──
load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
    return 0
  else
    warn ".env 文件不存在 ($ENV_FILE)，后端可能因缺少 DATABASE_URL 等变量启动失败"
    warn "请执行: cp release/jimo/.env.example release/jimo/.env"
    return 1
  fi
}

# ── 确保 shared 包已编译 ──
ensure_shared() {
  if [ -f "$SHARED_DIR/dist/index.js" ]; then
    return 0
  fi
  log "shared 包未编译，正在构建..."
  cd "$SHARED_DIR" && pnpm run build
  if [ -f "$SHARED_DIR/dist/index.js" ]; then
    log "shared 包编译完成 ✓"
  else
    err "shared 包编译失败"
    return 1
  fi
}

# ── 启动后端 ──
start_backend() {
  local pid
  if pid=$(read_pid "$backend_pid_file"); then
    warn "后端已在运行 (PID: $pid, 端口: $BACKEND_PORT)"
    return 0
  fi

  if check_port "$BACKEND_PORT"; then
    # 端口被占用但 PID 文件不存在 → 僵尸进程,自动清理后继续
    local port_pid
    port_pid=$(fuser "$BACKEND_PORT/tcp" 2>/dev/null | tr -d ' ' || true)
    if [ -n "$port_pid" ]; then
      warn "端口 $BACKEND_PORT 被僵尸进程占用 (PID: $port_pid)，自动释放..."
      fuser -k "$BACKEND_PORT/tcp" 2>/dev/null || true
      sleep 1
      if check_port "$BACKEND_PORT"; then
        err "端口 $BACKEND_PORT 释放失败，请手动处理: kill -9 $port_pid"
        return 1
      fi
      log "端口 $BACKEND_PORT 已释放 ✓"
    else
      err "端口 $BACKEND_PORT 已被占用，请先释放或更改 PORT 环境变量"
      return 1
    fi
  fi

  load_env || return 1
  ensure_shared || return 1

  log "启动后端 (NestJS) → 端口 $BACKEND_PORT"
  cd "$SERVER_DIR"
  nohup npx nest start --watch > "$backend_log" 2>&1 &
  local bg_pid=$!
  echo "$bg_pid" > "$backend_pid_file"

  if wait_for_port "$BACKEND_PORT" "backend" 20; then
    log "后端就绪 ✓  (PID: $bg_pid)"
  else
    err "后端启动超时，查看日志: $backend_log"
    return 1
  fi
}

# ── 启动前端 ──
start_frontend() {
  local pid
  if pid=$(read_pid "$frontend_pid_file"); then
    warn "前端已在运行 (PID: $pid, 端口: $FRONTEND_PORT)"
    return 0
  fi

  if check_port "$FRONTEND_PORT"; then
    err "端口 $FRONTEND_PORT 已被占用，请先释放或更改 FRONT_PORT 环境变量"
    return 1
  fi

  log "启动前端 (Umi Max) → $FRONTEND_HOST:$FRONTEND_PORT"
  cd "$WEB_DIR"

  # 关键：必须从 apps/web/ 目录启动，否则 .umi 生成在错误位置
  nohup env HOST="$FRONTEND_HOST" PORT="$FRONTEND_PORT" npx max dev > "$frontend_log" 2>&1 &
  local bg_pid=$!
  echo "$bg_pid" > "$frontend_pid_file"

  if wait_for_port "$FRONTEND_PORT" "frontend" 60; then
    log "前端就绪 ✓  (PID: $bg_pid)"
    info "前端地址: http://localhost:$FRONTEND_PORT"
    info "局域网:   http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '<本机IP>'):$FRONTEND_PORT"
  else
    err "前端启动超时，查看日志: $frontend_log"
    return 1
  fi
}

# ── 清理僵尸进程 ──
# nest start --watch 会 fork 子进程，手动 kill 端口时父进程会变成孤儿。
# 此函数扫描所有与本项目相关的残留 node 进程并彻底清理，
# 但会排除当前 PID 文件中记录的活跃进程。
cleanup_zombies() {
  local cleaned=0

  # 收集当前活跃的 PID（不杀这些）
  # 核心策略：端口上正在监听的进程 + 其父进程树 都不杀
  local active_pids=""

  # 1. 从 PID 文件中收集
  local p
  if p=$(read_pid "$backend_pid_file");  then active_pids="$active_pids $p"; fi
  if p=$(read_pid "$frontend_pid_file"); then active_pids="$active_pids $p"; fi

  # 2. 从端口上收集实际监听的进程
  local port_pid
  port_pid=$(fuser "$BACKEND_PORT/tcp"  2>/dev/null | tr -d ' ' || true)
  [ -n "$port_pid" ] && active_pids="$active_pids $port_pid"
  port_pid=$(fuser "$FRONTEND_PORT/tcp" 2>/dev/null | tr -d ' ' || true)
  [ -n "$port_pid" ] && active_pids="$active_pids $port_pid"

  # 3. 收集活跃进程的所有祖先（nest --watch 的 PID 文件记录的是父进程，端口上是子进程）
  local all_protected=""
  for pid in $active_pids; do
    # 自身
    all_protected="$all_protected $pid"
    # 父进程链（向上遍历 ppid）
    local cur="$pid"
    local depth=0
    while [ "$depth" -lt 5 ]; do
      local ppid
      ppid=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ' || true)
      [ -z "$ppid" ] || [ "$ppid" = "1" ] && break
      all_protected="$all_protected $ppid"
      cur="$ppid"
      depth=$((depth + 1))
    done
    # 子进程
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    [ -n "$children" ] && all_protected="$all_protected $children"
  done

  # 构建 grep -v 排除模式
  local exclude_pattern=""
  for pid in $all_protected; do
    [ -z "$pid" ] && continue
    [ -n "$exclude_pattern" ] && exclude_pattern="$exclude_pattern\|"
    exclude_pattern="${exclude_pattern}^${pid}$"
  done

  # 过滤函数：排除活跃 PID
  _filter_zombies() {
    if [ -n "$exclude_pattern" ]; then
      grep -v "$exclude_pattern" || true
    else
      cat
    fi
  }

  # 1. 清理孤儿 nest watch 进程（本项目 apps/server 目录下的）
  local nest_pids
  nest_pids=$(ps aux 2>/dev/null \
    | grep -E "node.*nest.*start" \
    | grep -v grep \
    | grep "$SERVER_DIR" \
    | awk '{print $2}' \
    | _filter_zombies \
    || true)
  if [ -n "$nest_pids" ]; then
    local count
    count=$(echo "$nest_pids" | wc -l)
    warn "发现 $count 个残留 nest 进程，正在清理..."
    echo "$nest_pids" | xargs kill -9 2>/dev/null || true
    cleaned=1
  fi

  # 2. 清理孤儿 max dev / umi 进程（本项目 apps/web 目录下的）
  local umi_pids
  umi_pids=$(ps aux 2>/dev/null \
    | grep -E "node.*(max dev|umi|forkedDev)" \
    | grep -v grep \
    | grep "$WEB_DIR" \
    | awk '{print $2}' \
    | _filter_zombies \
    || true)
  if [ -n "$umi_pids" ]; then
    local count
    count=$(echo "$umi_pids" | wc -l)
    warn "发现 $count 个残留 umi 进程，正在清理..."
    echo "$umi_pids" | xargs kill -9 2>/dev/null || true
    cleaned=1
  fi


  # 3. 确保端口彻底释放（仅在 stop 场景下，start 前调用时端口应该已经被 stop 释放了）
  if [ "${1:-}" = "--with-ports" ]; then
    fuser -k "$BACKEND_PORT/tcp" 2>/dev/null || true
    fuser -k "$FRONTEND_PORT/tcp" 2>/dev/null || true
  fi

  if [ "$cleaned" -eq 1 ]; then
    sleep 1
    log "僵尸进程已清理 ✓"
  fi
}

# ── 停止服务 ──
stop_service() {
  local name=$1 pid_file=$2
  local pid
  if pid=$(read_pid "$pid_file"); then
    log "停止 $name (PID: $pid)..."
    # 优先杀整个进程组 (nest start --watch 会 fork 子进程)
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    # 等待进程退出
    local wait=0
    while kill -0 "$pid" 2>/dev/null && [ $wait -lt 10 ]; do
      sleep 1
      wait=$((wait + 1))
    done
    # 强杀残留
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
    log "$name 已停止 ✓"
  else
    info "$name 未在运行"
  fi
}

stop_backend()  { stop_service "后端" "$backend_pid_file"; }
stop_frontend() { stop_service "前端" "$frontend_pid_file"; }

# ── 启动 cleanup worker ──
start_worker() {
  local pid
  if pid=$(read_pid "$worker_pid_file"); then
    warn "cleanup-worker 已在运行 (PID: $pid)"
    return 0
  fi
  if [ ! -f "$WORKER_SCRIPT" ]; then
    warn "cleanup-worker 脚本不存在: $WORKER_SCRIPT，跳过启动"
    return 0
  fi
  load_env 2>/dev/null || true
  log "启动 cleanup-worker..."
  nohup node "$WORKER_SCRIPT" > "$worker_log" 2>&1 &
  local bg_pid=$!
  echo "$bg_pid" > "$worker_pid_file"
  # 等 1s 确认进程没有立即崩溃
  sleep 1
  if kill -0 "$bg_pid" 2>/dev/null; then
    log "cleanup-worker 已启动 ✓  (PID: $bg_pid)"
  else
    warn "cleanup-worker 启动后立即退出，查看日志: $worker_log"
    rm -f "$worker_pid_file"
  fi
}

# ── 停止 cleanup worker ──
stop_worker() { stop_service "cleanup-worker" "$worker_pid_file"; }

stop_all()      {
  stop_frontend
  stop_backend
  stop_worker
  # stop 完后彻底清理可能残留的僵尸进程并释放端口
  cleanup_zombies --with-ports
}

# ── 状态 ──
show_status() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║       LowCode Platform — 开发环境状态         ║"
  echo "╠══════════════════════════════════════════════╣"

  local pid
  if pid=$(read_pid "$backend_pid_file"); then
    printf "║  后端 (NestJS)  : ${GREEN}运行中${NC}  PID: %-8s  端口: %s\n" "$pid" "$BACKEND_PORT"
  else
    printf "║  后端 (NestJS)  : ${RED}未运行${NC}                          端口: %s\n" "$BACKEND_PORT"
  fi

  if pid=$(read_pid "$frontend_pid_file"); then
    printf "║  前端 (Umi Max) : ${GREEN}运行中${NC}  PID: %-8s  端口: %s\n" "$pid" "$FRONTEND_PORT"
  else
    printf "║  前端 (Umi Max) : ${RED}未运行${NC}                          端口: %s\n" "$FRONTEND_PORT"
  fi

  if pid=$(read_pid "$worker_pid_file"); then
    printf "║  cleanup-worker : ${GREEN}运行中${NC}  PID: %-8s\n" "$pid"
  else
    printf "║  cleanup-worker : ${YELLOW}未运行${NC}\n"
  fi

  echo "╚══════════════════════════════════════════════╝"
  echo ""
}

# ── 查看日志 ──
show_logs() {
  local target=${1:-all}
  case "$target" in
    backend|b)   tail -f "$backend_log" ;;
    frontend|f)  tail -f "$frontend_log" ;;
    worker|w)    tail -f "$worker_log" ;;
    *)           tail -f "$backend_log" "$frontend_log" "$worker_log" ;;
  esac
}

# ── 帮助 ──
show_help() {
  echo ""
  echo "用法: $0 <命令> [目标]"
  echo ""
  echo "命令:"
  echo "  start [目标]    启动服务 (默认: all)"
  echo "  stop [目标]     停止服务 (默认: all)"
  echo "  restart [目标]  重启服务 (默认: all)"
  echo "  status          查看运行状态"
  echo "  clean           清理僵尸进程 (不停止运行中的服务)"
  echo "  logs [目标]     查看日志 (ctrl+c 退出)"
  echo ""
  echo "目标:"
  echo "  all | backend | frontend | worker"
  echo "  (简写: b = backend, f = frontend, w = worker)"
  echo ""
  echo "环境变量:"
  echo "  PORT=8888        后端端口"
  echo "  FRONT_PORT=8000  前端端口"
  echo ""
  echo "示例:"
  echo "  $0                    # 启动全部"
  echo "  $0 start backend      # 只启动后端"
  echo "  $0 stop               # 停止全部"
  echo "  $0 restart frontend   # 重启前端"
  echo "  $0 logs backend       # 查看后端日志"
  echo "  $0 status             # 查看状态"
  echo ""
  echo "日志文件:"
  echo "  $backend_log"
  echo "  $frontend_log"
  echo "  $worker_log"
  echo ""
}

# ── 主入口 ──
main() {
  local cmd=${1:-start}
  local target=${2:-all}

  case "$cmd" in
    start)
      # 启动前自动修复编译产物不一致(stale routes/modules/schemas)
      bash "$SCRIPT_DIR/sync-cleanup.sh" --fix --quiet 2>/dev/null || true
      # 启动前先清理可能阻塞端口的僵尸进程
      cleanup_zombies
      case "$target" in
        backend|b)   start_backend ;;
        frontend|f)  start_frontend ;;
        worker|w)    start_worker ;;
        all)         start_backend; start_worker; start_frontend ;;
        *)           err "未知目标: $target"; show_help; exit 1 ;;
      esac
      ;;
    stop)
      case "$target" in
        backend|b)   stop_backend ;;
        frontend|f)  stop_frontend ;;
        worker|w)    stop_worker ;;
        all)         stop_all ;;
        *)           err "未知目标: $target"; show_help; exit 1 ;;
      esac
      ;;
    restart)
      case "$target" in
        backend|b)   stop_backend;  start_backend ;;
        frontend|f)  stop_frontend; start_frontend ;;
        worker|w)    stop_worker;   start_worker ;;
        all)         stop_all; start_backend; start_worker; start_frontend ;;
        *)           err "未知目标: $target"; show_help; exit 1 ;;
      esac
      ;;
    status) show_status ;;
    clean)  cleanup_zombies ;;
    sync)   bash "$SCRIPT_DIR/sync-cleanup.sh" ${2:+$2} ;;
    logs)   show_logs "$target" ;;
    help|-h|--help) show_help ;;
    *)      err "未知命令: $cmd"; show_help; exit 1 ;;
  esac
}

main "$@"
