#!/bin/bash

# 订阅服务部署脚本

set -e

echo "🚀 开始部署订阅服务..."

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在项目根目录执行此脚本"
    exit 1
fi

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误：Docker未安装"
    exit 1
fi

# 检查生产环境配置文件
if [ ! -f ".env.production.bak" ]; then
    echo "❌ 错误：找不到 .env.production.bak 文件"
    echo "请先配置生产环境变量"
    exit 1
fi

# 构建Docker镜像
echo "📦 构建Docker镜像..."
docker build -t subscription-service:latest .

# 如果指定了registry，推送到远程仓库
if [ ! -z "$DOCKER_REGISTRY" ]; then
    echo "📤 推送镜像到 $DOCKER_REGISTRY..."
    docker tag subscription-service:latest $DOCKER_REGISTRY/subscription-service:latest
    docker push $DOCKER_REGISTRY/subscription-service:latest
    echo "✅ 镜像已推送到远程仓库"
fi

echo "✅ 构建完成！"
echo ""
echo "📋 部署说明："
echo "1. 将 .env.production.bak 复制到服务器并重命名为 .env"
echo "2. 修改 .env 中的实际配置值"
echo "3. 在服务器上运行："
echo "   docker run -d --name subscription-service \\"
echo "     --env-file .env \\"
echo "     -p 8088:8088 \\"
echo "     subscription-service:latest"
echo ""
echo "或使用 docker-compose："
echo "   docker-compose up -d"