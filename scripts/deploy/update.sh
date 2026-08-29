#!/usr/bin/env bash
# 更新部署：拉最新代码 -> 重新构建 -> 重启服务（保留 .env.local）
# 用法（服务器上 root 执行）：bash scripts/deploy/update.sh
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/kecheng}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-kecheng}"
PORT="${PORT:-5000}"

cd "$APP_DIR"

echo "==> 1/4 拉取最新代码"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> 2/4 安装依赖"
pnpm install --frozen-lockfile

echo "==> 3/4 重新构建"
pnpm build

echo "==> 4/4 重启服务"
pm2 restart "$APP_NAME" --update-env
pm2 save

echo ""
echo "更新完成。查看日志：pm2 logs $APP_NAME"
