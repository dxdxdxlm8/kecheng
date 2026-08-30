#!/usr/bin/env bash
# 绑定域名 + 申请免费 SSL（Let's Encrypt）
# 前置条件：域名已在 DNS 解析到本机 IP（Cloudflare 建议用 DNS Only / 灰色云）
# 用法：bash scripts/deploy/setup-domain.sh your.domain.tld [邮箱]
set -Eeuo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${2:-${EMAIL:-admin@${DOMAIN}}}"
SITE_CONF="/etc/nginx/sites-available/kecheng"

if [ -z "$DOMAIN" ]; then
  echo "用法: bash scripts/deploy/setup-domain.sh your.domain.tld [邮箱]"
  exit 1
fi

echo "==> 域名: $DOMAIN"

echo "==> 0/5 检查解析是否指向本机"
SERVER_IP="$(curl -s --max-time 10 ifconfig.me || echo '')"
RESOLVED_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo '')"
echo "    本机公网 IP: ${SERVER_IP:-未知}"
echo "    域名解析到:  ${RESOLVED_IP:-未解析}"
if [ -n "$RESOLVED_IP" ] && [ -n "$SERVER_IP" ] && [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
  echo "⚠️  域名未解析到本机（$RESOLVED_IP != $SERVER_IP），SSL 可能签发失败。"
  read -r -p "    仍要继续？[y/N] " ans
  [ "$ans" = "y" ] || exit 1
fi

echo "==> 1/5 更新 nginx server_name"
if [ -f "$SITE_CONF" ]; then
  sed -i "s/^\(\s*\)server_name .*;/\1server_name ${DOMAIN} www.${DOMAIN};/" "$SITE_CONF"
else
  echo "    未找到 $SITE_CONF，跳过（请确认 nginx 站点配置位置）"
fi
nginx -t
systemctl reload nginx

echo "==> 2/5 安装 certbot"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi

echo "==> 3/5 申请 SSL 证书"
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --keep-until-expiring \
  --email "$EMAIL" \
  -d "$DOMAIN" -d "www.$DOMAIN"

echo "==> 4/5 验证自动续期"
systemctl is-active certbot.timer 2>/dev/null || echo "    （certbot.timer 未运行，可手动续期：certbot renew）"
certbot renew --dry-run 2>&1 | tail -3

echo "==> 5/5 重启应用与 nginx"
systemctl reload nginx

echo ""
echo "完成！访问 https://$DOMAIN 验证"
echo "查看证书：certbot certificates"
