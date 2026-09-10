#!/usr/bin/env bash
# ============================================================
# DNS 生效后单独申请 / 续期 HTTPS 证书（可重复执行）
#
# 用法：
#   bash scripts/deploy/enable-ssl.sh shuxueyst.dpdns.org you@example.com
#   bash scripts/deploy/enable-ssl.sh shuxueyst.dpdns.org you@example.com --wait   # 阻塞等解析生效
#
# 说明：
#   - 只有域名已解析到「本机」时才签发；否则打印提示后退出（--wait 时每 30s 重试，最多 60 次）
#   - 证书路径 /etc/letsencrypt/live/<域名>/，自动续期任务在 /etc/cron.d/certbot
# ============================================================
set -Eeuo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${2:-${CERTBOT_EMAIL:-}}"
WAIT="${3:-}"
WWW_DOMAIN="www.${DOMAIN}"

c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_reset=$'\033[0m'
ok()   { printf "${c_green}[ok] %s${c_reset}\n" "$*"; }
warn() { printf "${c_yellow}[warn] %s${c_reset}\n" "$*"; }
die()  { printf "${c_red}[fail] %s${c_reset}\n" "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "用法: bash $0 <域名> [邮箱] [--wait]"
[ "$(id -u)" = 0 ] || die "请用 root 执行"

PUBIP="$(curl -fsS -m 8 https://api.ipify.org 2>/dev/null || curl -fsS -m 8 https://ifconfig.me 2>/dev/null || echo 未知)"
echo "本机公网 IP: ${PUBIP}"

if [ "$WAIT" = "--wait" ]; then
  echo "等待 ${DOMAIN} 解析到本机（每 30s 检查一次，最多 30 分钟）..."
  for i in $(seq 1 60); do
    R="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
    [ "$R" = "$PUBIP" ] && { ok "解析已生效"; break; }
    printf "  第 %s 次：当前解析=%s\n" "$i" "${R:-无}"
    sleep 30
  done
fi

RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ "$RESOLVED" != "$PUBIP" ]; then
  warn "${DOMAIN} 当前解析到 ${RESOLVED:-未解析}，不是本机 ${PUBIP}"
  warn "请到 DNS 服务商（如 Cloudflare）把 A 记录指向 ${PUBIP}，再重跑本脚本"
  exit 1
fi
ok "解析校验通过"

command -v certbot >/dev/null 2>&1 || {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y -qq && apt-get install -y -qq certbot python3-certbot-nginx
}

if certbot certificates 2>/dev/null | grep -q "Domains: ${DOMAIN}"; then
  ok "证书已存在，执行续期检查"
  certbot renew --quiet || true
else
  ok "开始签发证书"
  if [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  else
    certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  fi
fi

systemctl reload nginx
echo
echo "证书信息："
echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -subject -dates 2>/dev/null || true
echo
ok "完成：https://${DOMAIN}/"
echo "自动续期：certbot renew --dry-run （定时任务在 /etc/cron.d/certbot）"
