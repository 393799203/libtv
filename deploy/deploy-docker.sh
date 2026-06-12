#!/bin/bash
set -e

# ============================================================
# LibTV - Docker 容器化部署脚本
# 用法:
#   bash deploy-docker.sh              # 全量部署 (前端 + 后端)
#   bash deploy-docker.sh --frontend   # 仅部署前端
#   bash deploy-docker.sh --backend    # 仅部署后端
# ============================================================

SERVER_IP="192.168.110.115"
SERVER_USER="root"
PROJECT_DIR="/opt/libtv"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 解析参数
FRONTEND_ONLY=false
BACKEND_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --frontend|-f)
            FRONTEND_ONLY=true
            ;;
        --backend|-b)
            BACKEND_ONLY=true
            ;;
        --help|-h)
            echo "用法: bash deploy-docker.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --frontend, -f    仅部署前端"
            echo "  --backend, -b     仅部署后端"
            echo "  --help, -h        显示帮助信息"
            echo ""
            echo "默认行为: 全量部署 (前端 + 后端)"
            exit 0
            ;;
    esac
done

# 显示部署模式
echo "=========================================="
echo "LibTV - Docker容器化部署"
echo "目标服务器: ${SERVER_IP}"
echo "项目目录: ${PROJECT_DIR}"
if [ "$FRONTEND_ONLY" = true ]; then
    echo "部署模式: 仅前端"
elif [ "$BACKEND_ONLY" = true ]; then
    echo "部署模式: 仅后端"
else
    echo "部署模式: 全量 (前端 + 后端)"
fi
echo "=========================================="

# [1/6] 检查SSH连接
echo ""
echo "[1/6] 检查SSH连接..."
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} "echo 'SSH连接成功'"

# [2/6] 安装Docker (仅全量或后端部署时需要)
if [ "$FRONTEND_ONLY" = false ]; then
    echo ""
    echo "[2/6] 在服务器上安装Docker..."
    ssh ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
if ! command -v docker &> /dev/null; then
    echo "安装Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "Docker安装完成"
else
    echo "Docker已安装, 版本: $(docker --version)"
fi

if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose插件未检测到，尝试更新Docker..."
    curl -fsSL https://get.docker.com | sh
else
    echo "Docker Compose已就绪"
fi
ENDSSH
else
    echo ""
    echo "[2/6] 跳过Docker安装检查 (仅前端模式)"
fi

# [3/6] 同步项目文件到服务器
echo ""
echo "[3/6] 同步项目文件到服务器..."
ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p ${PROJECT_DIR}"

if [ "$FRONTEND_ONLY" = true ]; then
    # 仅同步前端和 docker-compose.yml
    rsync -avz --delete \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='.git' \
        ${LOCAL_DIR}/web/ ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/web/
    rsync -avz ${LOCAL_DIR}/docker-compose.yml ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/
elif [ "$BACKEND_ONLY" = true ]; then
    # 仅同步后端和 docker-compose.yml
    rsync -avz --delete \
        --exclude='.git' \
        --exclude='public' \
        --exclude='uploads' \
        ${LOCAL_DIR}/server/ ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/server/
    rsync -avz ${LOCAL_DIR}/docker-compose.yml ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/
else
    # 全量同步
    rsync -avz --delete \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='.git' \
        --exclude='public' \
        --exclude='uploads' \
        ${LOCAL_DIR}/web/ ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/web/
    rsync -avz --delete \
        --exclude='.git' \
        --exclude='public' \
        --exclude='uploads' \
        ${LOCAL_DIR}/server/ ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/server/
    rsync -avz ${LOCAL_DIR}/docker-compose.yml ${SERVER_USER}@${SERVER_IP}:${PROJECT_DIR}/
fi

# [4/6] 构建并启动Docker容器
echo ""
echo "[4/6] 构建并启动Docker容器..."
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
cd ${PROJECT_DIR}

echo "构建Docker镜像..."
if [ "$FRONTEND_ONLY" = true ]; then
    docker compose build --no-cache frontend
    echo "重建前端容器..."
    docker compose up -d --force-recreate frontend
elif [ "$BACKEND_ONLY" = true ]; then
    docker compose build --no-cache backend
    echo "重建后端容器..."
    docker compose up -d --force-recreate backend db redis
else
    docker compose build --no-cache
    echo "启动所有容器..."
    docker compose down
    docker compose up -d
fi

echo "等待服务启动..."
sleep 10

echo "容器状态:"
docker compose ps
ENDSSH

# [5/6] 验证部署
echo ""
echo "[5/6] 验证部署..."
sleep 3

# 检查前端
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://${SERVER_IP}/ --connect-timeout 10 || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "  前端服务: 正常 (HTTP $HTTP_CODE)"
else
    echo "  前端服务: 启动中... (HTTP $HTTP_CODE)"
fi

# 检查后端 (非仅前端模式)
if [ "$FRONTEND_ONLY" = false ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://${SERVER_IP}/api/auth/login --connect-timeout 10 || echo "000")
    if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "405" ] || [ "$HTTP_CODE" = "400" ]; then
        echo "  后端API: 正常 (HTTP $HTTP_CODE, 接口可达)"
    else
        echo "  后端API: 启动中... (HTTP $HTTP_CODE)"
    fi
fi

# [6/6] 完成
echo ""
echo "=========================================="
echo "部署完成！"
echo ""
echo "访问地址:"
echo "  前端页面: http://${SERVER_IP}"
echo "  后端API:  http://${SERVER_IP}/api"
echo ""
echo "常用命令:"
echo "  查看日志: ssh ${SERVER_USER}@${SERVER_IP} 'cd ${PROJECT_DIR} && docker compose logs -f'"
echo "  重启服务: ssh ${SERVER_USER}@${SERVER_IP} 'cd ${PROJECT_DIR} && docker compose restart'"
echo "  停止服务: ssh ${SERVER_USER}@${SERVER_IP} 'cd ${PROJECT_DIR} && docker compose down'"
echo "  查看状态: ssh ${SERVER_USER}@${SERVER_IP} 'cd ${PROJECT_DIR} && docker compose ps'"
echo ""
echo "单独部署:"
echo "  仅前端:   bash deploy/deploy-docker.sh --frontend"
echo "  仅后端:   bash deploy/deploy-docker.sh --backend"
echo "  全量部署: bash deploy/deploy-docker.sh"
echo "=========================================="
