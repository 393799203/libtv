#!/bin/bash
# ============================================================
# libtv 部署脚本（带「活跃生成」安全门禁）
#
# 用法：
#   ./deploy.sh                 # 后端 + 前端
#   ./deploy.sh backend         # 只后端
#   ./deploy.sh frontend        # 只前端
#   ./deploy.sh config          # 只重载 configs（挂载卷，重启后端即可，不重建镜像）
#   ./deploy.sh clean-zombies   # 清理僵尸执行记录（含备份表）
#   FORCE=1 ./deploy.sh backend # 忽略门禁，强制重启后端
#
# 门禁规则：
#   存在 30 分钟内仍处于 running/pending 的执行 → 跳过后端重启。
#   原因：异步生成跑在后端进程的 goroutine 里，重启会把它杀掉，
#   执行记录会永远卡在 running（历史上 1133/1135 即由此产生）。
#   前端重启不影响后端任务，因此照常部署。
#   等生成结束后再执行一次 ./deploy.sh backend 即可补上。
#
# 可用环境变量：
#   FORCE=1              忽略门禁
#   FRESH_WINDOW=30      多久内视为「可能真在跑」（分钟）
# ============================================================
set -uo pipefail
cd /opt/libtv || { echo "❌ 未找到 /opt/libtv"; exit 1; }

TARGET="${1:-all}"
FORCE="${FORCE:-0}"
FRESH_WINDOW="${FRESH_WINDOW:-30}"
PUBLIC=http://localhost:8880

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# 静默查询，失败返回空串
psql_q() {
  docker compose exec -T db psql -U libtv -d libtv -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# 新鲜活跃数（真正可能在跑的）与陈旧僵尸数
active_fresh() {
  psql_q "SELECT count(*) FROM workflow_executions WHERE status IN ('running','pending') AND created_at > now() - interval '${FRESH_WINDOW} minutes';"
}
stale_zombie() {
  psql_q "SELECT count(*) FROM workflow_executions WHERE status IN ('running','pending') AND created_at <= now() - interval '${FRESH_WINDOW} minutes';"
}

# 门禁：可以重启后端返回 0，应跳过返回 1
gate() {
  local n stale
  n=$(active_fresh)
  stale=$(stale_zombie)
  if [ -z "$n" ]; then
    log "⚠️  数据库不可查询，门禁跳过（继续执行）"
    return 0
  fi
  if [ "$n" != "0" ]; then
    if [ "$FORCE" = "1" ]; then
      log "⚠️  FORCE=1：$n 个生成进行中，仍重启后端（可能中断生成）"
      return 0
    fi
    log "🛑 有 $n 个生成进行中 → 跳过后端重启（前端部署不受影响）"
    log "   镜像已构建；生成结束后执行：./deploy.sh backend"
    [ "$stale" != "0" ] && log "   另有 $stale 条陈旧 running 记录，可执行：./deploy.sh clean-zombies"
    return 1
  fi
  log "✅ 无进行中的生成，可安全重启后端"
  [ "$stale" != "0" ] && log "   提示：有 $stale 条陈旧 running 记录，可执行 ./deploy.sh clean-zombies 清理"
  return 0
}

build_backend() {
  log "构建后端镜像…"
  if docker compose build backend > /tmp/deploy-backend.log 2>&1; then
    tail -1 /tmp/deploy-backend.log
  else
    log "❌ 后端构建失败："; tail -6 /tmp/deploy-backend.log; return 1
  fi
}

build_frontend() {
  log "构建前端镜像…"
  if docker compose build frontend > /tmp/deploy-frontend.log 2>&1; then
    tail -1 /tmp/deploy-frontend.log
  else
    log "❌ 前端构建失败："; tail -6 /tmp/deploy-frontend.log; return 1
  fi
}

up_backend() {
  if gate; then
    # 镜像已重建，up -d 会替换容器（进程重启 → 重新加载 configs）
    docker compose up -d backend 2>&1 | tail -1
    sleep 6
    log "后端：$(docker compose ps backend --format '{{.Status}}' 2>/dev/null)"
  else
    return 2
  fi
}

# 仅重载配置：镜像没变时 `up -d` 是空操作（不会重启进程），
# 而 ModelManager 只在进程启动时读 models.yaml，所以必须用 restart 真重启
restart_backend() {
  if gate; then
    log "应用编排变更 + 重启后端进程以重新加载 configs…"
    # 先应用 docker-compose.yml 的变更（幂等：仅重建真正有变化的服务，
    # 例如改了 redis 的 --requirepass；无变化时不动任何容器）。
    # 再重启 backend 重载 config.yaml —— ModelManager 只在进程启动时读取配置文件。
    docker compose up -d >/dev/null 2>&1 || true
    docker compose restart backend 2>&1 | tail -1
    sleep 6
    log "后端：$(docker compose ps backend --format '{{.Status}}' 2>/dev/null)"
  else
    return 2
  fi
}

up_frontend() {
  docker compose up -d frontend 2>&1 | tail -1
  sleep 3
  log "线上资源：$(curl -s $PUBLIC/ | grep -oE 'assets/index-[a-zA-Z0-9_-]+\.js' | head -1)"
}

clean_zombies() {
  log "清理僵尸执行记录（先备份到 workflow_executions_zombie_backup）…"
  docker compose exec -T db psql -U libtv -d libtv <<'SQL'
DROP TABLE IF EXISTS workflow_executions_zombie_backup;
CREATE TABLE workflow_executions_zombie_backup AS
  SELECT * FROM workflow_executions WHERE status IN ('running','pending');
UPDATE workflow_executions
   SET status = 'failed',
       finished_at = COALESCE(finished_at, created_at),
       error_msg = COALESCE(error_msg, '服务中断，执行未完成（僵尸记录自动清理）')
 WHERE status IN ('running','pending');
SELECT '备份行数' AS item, count(*)::text AS value FROM workflow_executions_zombie_backup
UNION ALL
SELECT '清理后残留', count(*)::text FROM workflow_executions WHERE status IN ('running','pending');
SQL
}

case "$TARGET" in
  backend)
    build_backend || exit 1
    up_backend
    ;;
  frontend)
    build_frontend || exit 1
    up_frontend
    ;;
  config)
    log "仅重载配置（configs 为挂载卷，无需重建镜像）…"
    restart_backend
    ;;
  clean-zombies)
    clean_zombies
    ;;
  all | "")
    build_backend; bb=$?
    build_frontend || exit 1
    up_frontend
    [ "$bb" = "0" ] && up_backend
    ;;
  *)
    echo "用法: ./deploy.sh [all|backend|frontend|config|clean-zombies]"
    exit 1
    ;;
esac