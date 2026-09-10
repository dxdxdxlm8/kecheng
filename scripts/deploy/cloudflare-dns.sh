#!/usr/bin/env bash
# ============================================================
# 用 Cloudflare API 把域名的 A 记录指向本机公网 IP
# （换服务器后不用登控制台，一条命令改完解析）
#
# 准备（只需一次）：
#   1) Cloudflare → My Profile → API Tokens → Create Token
#      权限：Zone - DNS - Edit，Zone Resources 选你的域名
#   2) 域名概览页右下角复制 Zone ID
#
# 用法：
#   CF_API_TOKEN=xxxx CF_ZONE_ID=xxxx bash scripts/deploy/cloudflare-dns.sh shuxueyst.dpdns.org
#   CF_API_TOKEN=xxxx CF_ZONE_ID=xxxx CF_PROXIED=false bash scripts/deploy/cloudflare-dns.sh shuxueyst.dpdns.org
#
# 说明：
#   - CF_PROXIED=true（默认）走 Cloudflare 代理（橙色云，隐藏源站 IP + CDN）
#   - 首次切换建议 CF_PROXIED=false（灰色云/仅 DNS），等 HTTPS 验通后再开代理
#   - 记录不存在会自动创建；已存在就更新
# ============================================================
set -Eeuo pipefail

RECORD="${1:-${DOMAIN:-}}"
TOKEN="${CF_API_TOKEN:-}"
ZONE="${CF_ZONE_ID:-}"
PROXIED="${CF_PROXIED:-true}"
TTL="${CF_TTL:-1}"   # 1 = automatic

c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_reset=$'\033[0m'
ok()   { printf "${c_green}[ok] %s${c_reset}\n" "$*"; }
warn() { printf "${c_yellow}[warn] %s${c_reset}\n" "$*"; }
die()  { printf "${c_red}[fail] %s${c_reset}\n" "$*" >&2; exit 1; }

[ -n "$RECORD" ] || die "用法: CF_API_TOKEN=xx CF_ZONE_ID=xx bash $0 <完整域名>"
[ -n "$TOKEN" ]  || die "缺少 CF_API_TOKEN"
[ -n "$ZONE" ]   || die "缺少 CF_ZONE_ID"
command -v curl >/dev/null 2>&1 || die "需要 curl"
command -v jq   >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -y -qq && apt-get install -y -qq jq; }

IP="$(curl -fsS -m 8 https://api.ipify.org 2>/dev/null || curl -fsS -m 8 https://ifconfig.me 2>/dev/null)"
[ -n "$IP" ] || die "取不到本机公网 IP"
ok "本机公网 IP: ${IP}"

API="https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records"

upsert() {
  local name="$1"
  local existing
  existing="$(curl -fsS -X GET "${API}?type=A&name=${name}" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" | jq -r '.result[0].id // empty')"

  if [ -n "$existing" ]; then
    curl -fsS -X PUT "${API}/${existing}" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      --data "{\"type\":\"A\",\"name\":\"${name}\",\"content\":\"${IP}\",\"ttl\":${TTL},\"proxied\":${PROXIED}}" \
      | jq -r '"   更新 " + .result.name + " -> " + .result.content + " (proxied=" + (.result.proxied|tostring) + ")"'
  else
    curl -fsS -X POST "$API" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
      --data "{\"type\":\"A\",\"name\":\"${name}\",\"content\":\"${IP}\",\"ttl\":${TTL},\"proxied\":${PROXIED}}" \
      | jq -r '"   新建 " + .result.name + " -> " + .result.content + " (proxied=" + (.result.proxied|tostring) + ")"'
  fi
}

echo "写入 A 记录："
upsert "$RECORD"
upsert "www.${RECORD}"

echo
ok "DNS 已提交（生效通常 1-10 分钟）"
echo "  校验：getent hosts ${RECORD}"
echo "  然后：bash scripts/deploy/enable-ssl.sh ${RECORD} you@example.com --wait"
echo
warn "若开了 Cloudflare 代理（橙色云），SSL/TLS 加密模式请设为 Full 或 Full (Strict)，"
warn "不要用 Flexible，否则源站与 Cloudflare 之间走明文，容易重定向循环。"
