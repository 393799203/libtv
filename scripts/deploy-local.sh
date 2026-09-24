#!/bin/bash
# ============================================================
# libtv 本地一键部署：同步代码 → 触发服务器 deploy.sh（含活跃生成门禁）
#
# 用法：
#   ./scripts/deploy-local.sh              # 前端构建 + 同步 + 后端/前端部署
#   ./scripts/deploy-local.sh backend      # 只后端
#   ./scripts/deploy-local.sh frontend     # 只前端
#   ./scripts/deploy-local.sh config       # 只同步 configs 并重启后端（重载 yaml）
#   FORCE=1 ./scripts/deploy-local.sh backend
#
# 门禁在服务器侧执行：若有生成进行中，会跳过后端重启并提示，
# 前端不受影响；生成结束后重跑一次即可。
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$ROOT/.ssh-deploy/libtv_ecs"
HOST="root@60.188.49.208"
TARGET="${1:-all}"

[ -f "$KEY" ] || { echo "❌ 未找到 SSH 私钥: $KEY"; exit 1; }

SSH_OPTS="-i $KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"
SSH="ssh $SSH_OPTS"
RSYNC_RSH="ssh $SSH_OPTS"

sync_dir() { # $1=本地路径 $2=远端路径 [额外 rsync 参数...]
  local src="$1" dst="$2"
  shift 2
  rsync -az --timeout=300 --rsh="$RSYNC_RSH" "$@" "$src" "$HOST:$dst" 2>&1 | grep -E "total size|error" | tail -1
}

# 后端整体同步（排除构建产物/日志，避免上传几十 MB 无用文件）；
# 用整个 server/ 而非逐个子目录，避免新增目录（cmd、go.mod 等）被漏同步
sync_server() { sync_dir server/ /opt/libtv/server/ --exclude 'bin/' --exclude 'logs/'; }

cd "$ROOT" || exit 1

if [ "$TARGET" = "all" ] || [ "$TARGET" = "frontend" ]; then
  echo "▶ 本地构建前端…"
  ( cd web && npm run build ) || { echo "❌ 前端构建失败"; exit 1; }
fi

# 编排与配置文件：改了 redis/backend 等服务定义或配置项时必须一并同步，
# 否则线上 compose 与仓库不一致（例如 Redis 密码只改了远端）
sync_infra() {
  sync_dir docker-compose.yml /opt/libtv/docker-compose.yml
  sync_dir server/configs/ /opt/libtv/server/configs/
  sync_dir scripts/deploy.sh /opt/libtv/deploy.sh
}

echo "▶ 同步代码到服务器…"
case "$TARGET" in
  frontend)
    sync_dir web/dist/ /opt/libtv/web/dist/
    ;;
  config)
    sync_infra
    ;;
  backend)
    sync_server
    sync_infra
    ;;
  *)
    sync_server
    sync_infra
    [ -d web/dist ] && sync_dir web/dist/ /opt/libtv/web/dist/
    ;;
esac

echo "▶ 服务器执行 deploy.sh $TARGET"
FORCE_PREFIX=""
[ "${FORCE:-0}" = "1" ] && FORCE_PREFIX="FORCE=1 "
$SSH "$HOST" "cd /opt/libtv && chmod +x deploy.sh && ${FORCE_PREFIX}./deploy.sh $TARGET"
rc=$?
[ "$rc" = "2" ] && echo "⏭  后端未重启（有生成进行中）。生成结束后重跑：./scripts/deploy-local.sh backend"
exit $rc