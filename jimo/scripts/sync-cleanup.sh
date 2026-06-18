#!/usr/bin/env bash
#
# sync-cleanup.sh — 清理编译产物与文件系统的不一致
#
# 场景:
#   - umirc.ts 路由指向不存在的页面目录
#   - app.module.ts 导入了不存在的模块
#   - db/schema/index.ts 导出了不存在的 schema 文件
#
# 用法:
#   bash scripts/sync-cleanup.sh           # dry-run(仅报告)
#   bash scripts/sync-cleanup.sh --fix     # 自动修复
#   bash scripts/sync-cleanup.sh --quiet   # 静默(配合启动脚本)
#
# 日志: .tmp/logs/sync-cleanup.log (持久化,保留最近 20 次运行记录)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$PROJECT_ROOT/apps/web"
SERVER_DIR="$PROJECT_ROOT/apps/server"
LOG_DIR="$PROJECT_ROOT/.tmp/logs"
LOG_FILE="$LOG_DIR/sync-cleanup.log"
MAX_LOG_SIZE=$((100 * 1024))  # 100KB

FIX_MODE=false
QUIET_MODE=false
for arg in "$@"; do
  case "$arg" in
    --fix)   FIX_MODE=true ;;
    --quiet) QUIET_MODE=true ;;
  esac
done

mkdir -p "$LOG_DIR"

# 日志轮转:超过 100KB 时截断保留后半段
if [ -f "$LOG_FILE" ]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$size" -gt "$MAX_LOG_SIZE" ]; then
    tail -c "$MAX_LOG_SIZE" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
fi

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 同时输出到终端(stdout)和日志文件(无 ANSI)
run_id="$(date '+%Y-%m-%d %H:%M:%S')"
echo "" >> "$LOG_FILE"
echo "══════════════════════════════════════════════" >> "$LOG_FILE"
echo "  sync-cleanup $run_id  $($FIX_MODE && echo '--fix')$($QUIET_MODE && echo ' --quiet')" >> "$LOG_FILE"
echo "══════════════════════════════════════════════" >> "$LOG_FILE"

log()    { local msg="[sync] $*"; $QUIET_MODE || echo -e "${GREEN}${msg}${NC}"; echo "$msg" >> "$LOG_FILE"; }
warn()   { local msg="[warn] $*"; $QUIET_MODE || echo -e "${YELLOW}${msg}${NC}"; echo "$msg" >> "$LOG_FILE"; }
err()    { local msg="[error] $*"; $QUIET_MODE || echo -e "${RED}${msg}${NC}" >&2; echo "$msg" >> "$LOG_FILE"; }

issues_found=0
issues_fixed=0

# ─────────────────────────────────────────────
# 1. Frontend: .umirc.ts stale routes
# ─────────────────────────────────────────────
sync_umirc_routes() {
  local umirc="$WEB_DIR/.umirc.ts"
  if [ ! -f "$umirc" ]; then
    err ".umirc.ts 不存在: $umirc"
    return
  fi

  # 提取所有 component: './xxx/xxx' 的路由行
  # 格式: { path: '...', name: '...', component: './dir/file' }
  local tmpfile
  tmpfile=$(mktemp)
  cp "$umirc" "$tmpfile"

  local changed=false
  local line_nums_to_remove=()

  while IFS= read -r line; do
    # 提取 component 路径,如 './warehouses/index'
    local comp
    comp=$(echo "$line" | grep -oP "component:\s*'\./([^']+)'" | sed "s/component: *'\.\///" | sed "s/'//g" || true)
    if [ -z "$comp" ]; then
      continue
    fi

    # 页面目录 = dirname(component)
    local page_dir
    page_dir=$(dirname "$comp")
    if [ ! -d "$WEB_DIR/src/pages/$page_dir" ]; then
      warn "残留路由: component=./$comp → pages/$page_dir 目录不存在"
      issues_found=$((issues_found + 1))

      if $FIX_MODE; then
        # 找到这一行在文件中的行号,标记删除
        local lineno
        lineno=$(grep -nF "$line" "$umirc" | head -1 | cut -d: -f1)
        if [ -n "$lineno" ]; then
          line_nums_to_remove+=("$lineno")
          log "  将删除 L$lineno: $line"
        fi
      fi
    fi
  done < <(grep -n "component:" "$umirc" || true)

  # 执行删除(从后往前删,避免行号偏移)
  if $FIX_MODE && [ ${#line_nums_to_remove[@]} -gt 0 ]; then
    # 倒序排列
    IFS=$'\n' sorted=($(sort -nr <<<"${line_nums_to_remove[*]}"))
    unset IFS
    for lineno in "${sorted[@]}"; do
      sed -i "${lineno}d" "$umirc"
      issues_fixed=$((issues_fixed + 1))
      changed=true
    done
    # 清理空 routes 数组(包路由下无子路由的情况)
    sed -i '/routes: \[$/{ N; s/routes: \[\n\s*\]/routes: []/; }' "$umirc"
    # 删除空 routes: [] 的包级路由块(多行匹配)
    # 简化处理:删除紧邻的空行
    sed -i '/^[[:space:]]*$/{ N; /^\n[[:space:]]*$/D; }' "$umirc"
  fi

  if ! $FIX_MODE && [ "$issues_found" -eq 0 ]; then
    log "umirc 路由与页面目录一致 ✓"
  fi

  rm -f "$tmpfile"
}

# ─────────────────────────────────────────────
# 2. Backend: app.module.ts stale module imports
# ─────────────────────────────────────────────
sync_app_module() {
  local app_module="$SERVER_DIR/src/app.module.ts"
  if [ ! -f "$app_module" ]; then
    err "app.module.ts 不存在: $app_module"
    return
  fi

  # 提取所有 import { XxxModule } from './modules/xxx/xxx.module' 的行
  while IFS= read -r line; do
    local import_path
    import_path=$(echo "$line" | grep -oP "from\s+'\./(modules/[^']+)'" | sed "s/from *'\.\///" | sed "s/'//g" || true)
    if [ -z "$import_path" ]; then
      continue
    fi

    # 检查导入的模块文件是否存在(.ts 扩展名)
    if [ ! -f "$SERVER_DIR/src/${import_path}.ts" ]; then
      local module_name
      module_name=$(echo "$line" | grep -oP 'import\s+\{\s*\K\w+Module' || echo "?")
      warn "残留模块: import {$module_name} from './$import_path' → 文件不存在"
      issues_found=$((issues_found + 1))

      if $FIX_MODE; then
        # 精确删除这一行
        sed -i "\|import {.*} from '\./${import_path}';|d" "$app_module"
        # 从 imports 数组中删除该模块引用
        sed -i "s/[[:space:]]*${module_name},//g" "$app_module"
        sed -i "s/,[[:space:]]*${module_name}//g" "$app_module"
        log "  已删除 $module_name 的 import 和注册"
        issues_fixed=$((issues_fixed + 1))
      fi
    fi
  done < <(grep "import.*Module.*from.*modules" "$app_module" || true)

  if ! $FIX_MODE && [ "$issues_found" -eq 0 ]; then
    log "app.module.ts 模块导入一致 ✓"
  fi
}

# ─────────────────────────────────────────────
# 3. Backend: db/schema/index.ts stale exports
# ─────────────────────────────────────────────
sync_schema_index() {
  local schema_index="$SERVER_DIR/src/db/schema/index.ts"
  if [ ! -f "$schema_index" ]; then
    return  # schema/index.ts 不是必须的
  fi

  while IFS= read -r line; do
    local export_path
    export_path=$(echo "$line" | grep -oP "from\s+'\./([^']+)'" | sed "s/from *'\.\///" | sed "s/'//g" || true)
    if [ -z "$export_path" ]; then
      continue
    fi

    # 检查导出的 schema 文件是否存在(ESM .js 后缀 → .ts 实际文件)
    local ts_path="${export_path/%.js/.ts}"
    if [ ! -f "$SERVER_DIR/src/db/schema/${ts_path}" ]; then
      warn "残留 schema export: from './$export_path' → 文件不存在"
      issues_found=$((issues_found + 1))

      if $FIX_MODE; then
        # 删除这一行(匹配原始的 .js 后缀)
        sed -i "\|from '\./${export_path}';|d" "$schema_index"
        log "  已删除 export * from './$export_path'"
        issues_fixed=$((issues_fixed + 1))
      fi
    fi
  done < <(grep "export.*from" "$schema_index" 2>/dev/null || true)

  if ! $FIX_MODE && [ "$issues_found" -eq 0 ]; then
    log "schema/index.ts 导出一致 ✓"
  fi
}

# ─────────────────────────────────────────────
# 4. Backend: stale module directories (empty dirs)
# ─────────────────────────────────────────────
sync_empty_dirs() {
  local modules_dir="$SERVER_DIR/src/modules"
  if [ ! -d "$modules_dir" ]; then
    return
  fi

  for dir in "$modules_dir"/*/; do
    [ -d "$dir" ] || continue
    # 检查目录是否为空(无文件)
    local file_count
    file_count=$(find "$dir" -type f 2>/dev/null | wc -l)
    if [ "$file_count" -eq 0 ]; then
      local dirname
      dirname=$(basename "$dir")
      warn "空模块目录: modules/$dirname"
      issues_found=$((issues_found + 1))

      if $FIX_MODE; then
        rmdir "$dir" 2>/dev/null && log "  已删除空目录 modules/$dirname" && issues_fixed=$((issues_fixed + 1))
      fi
    fi
  done
}

# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

log "LowCode 一致性检查$($FIX_MODE && echo ' (自动修复模式)')"
echo ""

sync_umirc_routes
sync_app_module
sync_schema_index
sync_empty_dirs

echo ""
if [ "$issues_found" -eq 0 ]; then
  log "一切正常 ✓"
  echo "  结果: 0 issues" >> "$LOG_FILE"
else
  if $FIX_MODE; then
    log "已修复 $issues_fixed/$issues_found 个不一致"
    echo "  结果: fixed $issues_fixed/$issues_found issues" >> "$LOG_FILE"
  else
    warn "发现 $issues_found 个不一致,运行 --fix 自动修复:"
    warn "  bash scripts/sync-cleanup.sh --fix"
    echo "  结果: found $issues_found issues (dry-run)" >> "$LOG_FILE"
  fi
fi
echo "" >> "$LOG_FILE"
