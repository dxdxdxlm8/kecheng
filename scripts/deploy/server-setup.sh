#!/usr/bin/env bash
# 香港服务器初始化：安装 Node/pnpm/pm2/nginx，拉取代码并构建
# 用法（在服务器上以 root 执行）：bash scripts/deploy/server-setup.sh
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/kecheng}"
REPO="${REPO:-https://github.com/dxdxdxlm8/kecheng.git}"
BRANCH="${BRANCH:-main}"

echo "==> 0/5 添加 swap（2G 内存机器构建 Next.js 会 OOM，必须加）"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
free -m | head -3

echo "==> 1/5 安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git nginx curl ca-certificates

echo "==> 2/5 安装 Node 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> 3/5 安装 pnpm 与 pm2"
npm install -g pnpm pm2

echo "==> 4/5 获取代码"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  cd "$APP_DIR" && git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH"
fi

echo "==> 5/5 安装依赖并构建"
cd "$APP_DIR"
pnpm install --frozen-lockfile
pnpm build

echo ""
echo "构建完成。下一步："
echo "  1) 在 $APP_DIR 下放置 .env.local（Supabase / LLM / 对象存储配置）"
echo "  2) 执行 bash scripts/deploy/start.sh 启动服务"
