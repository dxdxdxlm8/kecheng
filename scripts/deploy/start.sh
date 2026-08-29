#!/usr/bin/env bash
# 用 pm2 启动服务（常驻 + 开机自启）
# 用法（服务器上 root 执行）：bash scripts/deploy/start.sh
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/kecheng}"
PORT="${PORT:-5000}"
APP_NAME="${APP_NAME:-kecheng}"

cd "$APP_DIR"

echo "==> 重启服务 $APP_NAME (port $PORT)"
pm2 delete "$APP_NAME" 2>/dev/null || true
NODE_ENV=production PORT="$PORT" pm2 start dist/server.js --name "$APP_NAME"

echo "==> 保存进程列表并设置开机自启"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> 重载 nginx"
nginx -t && systemctl reload nginx

echo ""
echo "完成。查看状态：pm2 status / pm2 logs $APP_NAME"
