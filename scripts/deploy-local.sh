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
# 用整个 server/ 而非逐个子目录，避免新增目录（cmd、go.mod 等）被漏同步。
# --delete：远端要和仓库**完全一致**，否则仓库里删掉的文件会永远留在远端被编进镜像。
# 2026-10-09 实测远端比仓库多了 6 个陈旧文件（cmd/dianxincheck/main.go、cmd/server/models.yaml、
# configs/config.yaml.bak，以及 internal/service/{billing,pricing,provider_task}_service.go
# —— 最后三个是重构前的旧实现，会被一起编译进后端镜像，属于「线上跑的代码 ≠ 仓库代码」）。
# --exclude 的 bin/ 与 logs/ 不会被 --delete 删掉（被排除的路径同时受保护），
# 所以远端构建产物与日志照旧保留。
# .DS_Store 只做「不再上传」，**不加 --delete-excluded**：--delete-excluded 会把所有被排除的
# 路径一并删掉，包括远端 logs/（实测有 server.log / restart.log）和 bin/。
# 远端已有的那两个 .DS_Store 在 2026-10-09 手工清掉了，之后由这条 exclude 保证不再回来。
sync_server() {
  sync_dir server/ /opt/libtv/server/ --delete --exclude 'bin/' --exclude 'logs/' --exclude '.DS_Store'
}

# 前端产物同步：**必须带 --delete**。
# web/dist 每次构建都换一整套带哈希的文件名，不带 --delete 的话远端只会越堆越多：
# 2026-10-09 实测远端 assets/ 里积了 4211 个文件、245MB（几十次部署的历史 chunk），
# 每次重建镜像都把它们整包 COPY 进镜像层 —— 又占磁盘又拖慢构建，翻日志还容易被旧文件误导。
# 删掉的只是「当前版本不再引用」的旧哈希文件，是安全的：
#   · index.html 是 no-cache/no-store（见 web/libtv-app.conf），每次都会指向当前 chunk；
#   · 只有「改版前就开着、且还没刷新」的标签页可能请求到已删除的旧 chunk，
#     刷新一下即可（这正是带哈希文件名 + 短缓存 index.html 的标准代价）。
# --exclude '.DS_Store' 顺手挡掉 macOS 垃圾文件（远端曾混进去一个）；
# 但 **--exclude 会让这个文件免于被删**，所以还要 --delete-excluded，远端的历史垃圾才会真被清掉。
sync_dist() { sync_dir web/dist/ /opt/libtv/web/dist/ --delete --delete-excluded --exclude '.DS_Store'; }

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
  sync_dir redis/ /opt/libtv/redis/
}

echo "▶ 同步代码到服务器…"
case "$TARGET" in
  frontend)
    sync_dist
    # nginx 配置随前端镜像一起重建：不在这里同步的话，线上会用旧配置重建镜像
    # （TLS/端口/代理改动会静默丢失）
    sync_dir web/nginx.conf /opt/libtv/web/nginx.conf
    sync_dir web/libtv-app.conf /opt/libtv/web/libtv-app.conf
    sync_dir web/libtv-acme.conf /opt/libtv/web/libtv-acme.conf
    # Dockerfile 也是构建上下文的一部分：漏同步会导致镜像缺文件、容器起不来
    # （曾漏同步 COPY libtv-app.conf 那一行，前端直接重启循环约 52 秒不可用）
    sync_dir web/Dockerfile /opt/libtv/web/Dockerfile
    # 端口映射、证书挂载都在 compose 里，必须一起同步
    sync_infra
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
    [ -d web/dist ] && sync_dist
    ;;
esac

echo "▶ 服务器执行 deploy.sh $TARGET"
FORCE_PREFIX=""
[ "${FORCE:-0}" = "1" ] && FORCE_PREFIX="FORCE=1 "
$SSH "$HOST" "cd /opt/libtv && chmod +x deploy.sh && ${FORCE_PREFIX}./deploy.sh $TARGET"
rc=$?
[ "$rc" = "2" ] && echo "⏭  后端未重启（有生成进行中）。生成结束后重跑：./scripts/deploy-local.sh backend"
exit $rc