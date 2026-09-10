#!/usr/bin/env bash
# ============================================================
# kecheng 一键部署脚本（新服务器 / 重装 / 迁移都能用）
#
# 在全新的 Ubuntu 22.04 上以 root 执行，一条命令搭到能跑：
#   curl -fsSL <raw-url>/bootstrap.sh -o /tmp/b.sh && bash /tmp/b.sh
#   或（仓库已存在时）：bash scripts/deploy/bootstrap.sh
#
# 支持两种用法：
#   1) 交互：直接跑，按提示填域名 / Supabase 三件套 / 证书邮箱
#   2) 非交互：用环境变量传参，适合脚本化
#        DOMAIN=shuxueyst.dpdns.org \
#        SUPABASE_URL=https://xxx.supabase.co \
#        SUPABASE_ANON_KEY=eyJ... \
#        SUPABASE_SERVICE_ROLE_KEY=eyJ... \
#        CERTBOT_EMAIL=you@example.com \
#        bash bootstrap.sh
#
# 迁移模式（从旧服务器搬家，自动拷 .env.local / 静态文件 / deploy key）：
#   OLD_HOST=1.2.3.4 OLD_PORT=2537 OLD_PASSWORD=xxx bash bootstrap.sh
#   （需要本机有 sshpass；没有就先 apt-get install -y sshpass）
#
# 另外可选：
#   WITH_SSL=auto|yes|no   auto=解析已指向本机才签证书（默认 auto）
#   BRANCH=main            APP_DIR=/opt/kecheng       PORT=5000
#   SYNC_STATIC=yes|no     是否从旧机同步 /var/www/html（默认：给了 OLD_HOST 就 yes）
#
# 脚本是幂等的，重复执行安全。
# ============================================================
set -Eeuo pipefail

# ---------- 默认参数 ----------
APP_DIR="${APP_DIR:-/opt/kecheng}"
BRANCH="${BRANCH:-main}"
# 默认用 https：新机器通常没有 GitHub Deploy Key，git@ 会 Host key verification failed
REPO="${REPO:-https://github.com/dxdxdxlm8/kecheng.git}"
PORT="${PORT:-5000}"
DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
OLD_HOST="${OLD_HOST:-}"
OLD_PORT="${OLD_PORT:-2537}"
OLD_PASSWORD="${OLD_PASSWORD:-}"
WITH_SSL="${WITH_SSL:-auto}"
SYNC_STATIC="${SYNC_STATIC:-}"

# ---------- 工具函数 ----------
c_reset=$'\033[0m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_blue=$'\033[36m'
step() { printf "\n${c_blue}==> %s${c_reset}\n" "$*"; }
ok()   { printf "${c_green}    [ok] %s${c_reset}\n" "$*"; }
warn() { printf "${c_yellow}    [warn] %s${c_reset}\n" "$*"; }
die()  { printf "${c_red}    [fail] %s${c_reset}\n" "$*" >&2; exit 1; }
ask()  { local var="$1" prompt="$2" default="${3:-}" val=""
         if [ -t 0 ]; then read -rp "    $prompt${default:+ [$default]}: " val || true; fi
         val="${val:-$default}"; printf -v "$var" '%s' "$val"; }

require_root() { [ "$(id -u)" = 0 ] || die "请用 root 执行：sudo bash $0"; }
detect_mem_mb() { awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo; }
detect_pubip()  { curl -fsS -m 8 https://api.ipify.org 2>/dev/null || curl -fsS -m 8 https://ifconfig.me 2>/dev/null || echo "未知"; }
detect_ssh_port() {
  local p
  p="$(grep -oP '^\s*Port\s+\K\d+' /etc/ssh/sshd_config 2>/dev/null | head -1 || true)"
  [ -n "$p" ] || p="$(ss -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | grep -oP ':\K\d+' | head -1 || true)"
  echo "${p:-22}"
}

# ---------- 0. 收集参数 ----------
step "0/10 检查环境与收集参数"
require_root
MEM_MB="$(detect_mem_mb)"
SSH_PORT="$(detect_ssh_port)"
PUBIP="$(detect_pubip)"
ok "系统: $(. /etc/os-release && echo "$PRETTY_NAME") | 内存 ${MEM_MB}MB | SSH 端口 ${SSH_PORT} | 公网 IP ${PUBIP}"

if [ -z "$DOMAIN" ]; then ask DOMAIN "域名（如 shuxueyst.dpdns.org）" "shuxueyst.dpdns.org"; fi
WWW_DOMAIN="www.${DOMAIN}"
[ -n "$DOMAIN" ] || die "域名不能为空"

# 迁移模式：先从旧机把 .env.local 拉过来（免手抄）
if [ -n "$OLD_HOST" ] && [ -z "$SUPABASE_URL" ]; then
  step "0.1/10 迁移模式：从旧服务器 ${OLD_HOST}:${OLD_PORT} 取 .env.local"
  if command -v sshpass >/dev/null 2>&1; then
    SSHP="sshpass -p ${OLD_PASSWORD}"
  else
    warn "本机没有 sshpass，尝试用密钥/免密登录（失败会跳过）"
    SSHP=""
  fi
  if $SSHP ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p "$OLD_PORT" "root@${OLD_HOST}" \
       "cat ${APP_DIR}/.env.local" > /tmp/env_from_old 2>/dev/null; then
    # shellcheck disable=SC1090
    set -a; . /tmp/env_from_old; set +a; rm -f /tmp/env_from_old
    ok "已从旧机读取 .env.local"
  else
    warn "读取失败，将改为手动填写"
  fi
fi

if [ -z "$SUPABASE_URL" ]; then ask SUPABASE_URL "SUPABASE_URL" ""; fi
if [ -z "$SUPABASE_ANON_KEY" ]; then ask SUPABASE_ANON_KEY "SUPABASE_ANON_KEY" ""; fi
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then ask SUPABASE_SERVICE_ROLE_KEY "SUPABASE_SERVICE_ROLE_KEY（可留空则回退 anon key）" ""; fi
[ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ] || die "SUPABASE_URL / SUPABASE_ANON_KEY 必填"

[ -n "$SYNC_STATIC" ] || { [ -n "$OLD_HOST" ] && SYNC_STATIC=yes || SYNC_STATIC=no; }

# ---------- 1. 系统依赖 ----------
step "1/10 安装系统依赖"
# 新机器首次启动常在跑 unattended-upgrades，会占住 dpkg 锁导致 apt 直接失败
systemctl disable --now unattended-upgrades >/dev/null 2>&1 || true
pkill -f unattended-upgrade >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  pgrep -f 'apt-get|apt |dpkg|unattended' >/dev/null 2>&1 || break
  [ "$i" = "1" ] && warn "dpkg 锁被占用（自动更新在跑），等待释放，最多 5 分钟..."
  sleep 5
done
# Ubuntu 非 LTS（23.04 等）停止支持后官方源会 404，自动切 old-releases
if ! apt-get update -qq >/dev/null 2>/tmp/apt-err.txt; then
  if grep -qi 'no longer has a release file\|404' /tmp/apt-err.txt 2>/dev/null; then
    warn "官方源已失效（EOL 版本），自动切到 old-releases"
    sed -i 's|archive.ubuntu.com|old-releases.ubuntu.com|g; s|security.ubuntu.com|old-releases.ubuntu.com|g' /etc/apt/sources.list 2>/dev/null || true
    for f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
      [ -f "$f" ] && sed -i 's|archive.ubuntu.com|old-releases.ubuntu.com|g; s|security.ubuntu.com|old-releases.ubuntu.com|g' "$f"
    done
  fi
fi
rm -f /tmp/apt-err.txt
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
ok "apt 源可用（建议正式环境用 22.04/24.04 LTS，非 LTS 版本已停止安全更新）"
apt-get install -y -qq git nginx curl ca-certificates jq ufw
ok "git / nginx / curl / jq / ufw 就绪"

# ---------- 2. swap（2G 内存不加 swap，next build 会 OOM） ----------
step "2/10 配置 swap"
if swapon --show | grep -q swapfile; then
  ok "swap 已存在，跳过"
else
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "已创建 2G swap"
fi

# ---------- 3. Node 20 ----------
step "3/10 安装 Node 20"
if command -v node >/dev/null 2>&1 && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 20 ]; then
  ok "node $(node -v) 已就绪"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  ok "已装 $(node -v)"
fi

# ---------- 4. pnpm / pm2 ----------
step "4/10 安装 pnpm 与 pm2"
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm >/dev/null
command -v pm2  >/dev/null 2>&1 || npm install -g pm2  >/dev/null
ok "pnpm $(pnpm -v) / pm2 $(pm2 -v)"

# ---------- 5. 代码 ----------
step "5/10 获取代码 -> ${APP_DIR}"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git fetch origin "$BRANCH" -q && git reset --hard "origin/$BRANCH" -q
  ok "已更新到 $(git log --oneline -1)"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR" -q
  cd "$APP_DIR"
  ok "已克隆 $(git log --oneline -1)"
fi

# ---------- 6. 环境变量 ----------
step "6/10 写入 ${APP_DIR}/.env.local"
cat > "$APP_DIR/.env.local" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
EOF
chmod 600 "$APP_DIR/.env.local"
ok "已写入（LLM 配置不用填，它在数据库 system_settings 表里，教师端「系统设置」页维护）"

# ---------- 7. 静态文件（APK / 域名验证文件） ----------
step "7/10 准备 /var/www/html 静态文件"
mkdir -p /var/www/html
if [ "$SYNC_STATIC" = "yes" ] && [ -n "$OLD_HOST" ]; then
  if command -v rsync >/dev/null 2>&1 || apt-get install -y -qq rsync; then
    $SSHP rsync -av -e "ssh -o StrictHostKeyChecking=no -p ${OLD_PORT}" \
      "root@${OLD_HOST}:/var/www/html/" /var/www/html/ >/dev/null 2>&1 \
      && ok "已从旧机同步 /var/www/html" || warn "同步失败，稍后手动拷 1.apk"
  fi
fi
if [ -f /var/www/html/1.apk ]; then
  ok "1.apk 就位（$(du -h /var/www/html/1.apk | cut -f1)）"
else
  warn "缺少 /var/www/html/1.apk —— 学生端「下载 App」会 404，稍后从旧机拷："
  warn "    scp -P ${OLD_PORT:-2537} root@${OLD_HOST:-旧IP}:/var/www/html/1.apk /var/www/html/"
fi

# ---------- 8. 依赖 + 构建 ----------
step "8/10 安装依赖并构建（2G 内存机约 1-3 分钟）"
cd "$APP_DIR"
# 必须用项目的 pnpm build（= scripts/build.sh：install + next build + tsup 打 dist/server.js）
# 只跑 npx next build 不会生成 dist/server.js，生产服务会起不来
if [ -f "$(dirname "$0")/bench-build.sh" ]; then
  bash "$(dirname "$0")/bench-build.sh"
else
  pnpm build
fi

# ---------- 9. 启动 + 自启 ----------
step "9/10 启动 pm2 并设置开机自启"
if pm2 describe kecheng >/dev/null 2>&1; then
  pm2 restart kecheng --update-env >/dev/null && ok "已重启 kecheng"
else
  pm2 start npm --name kecheng -- start >/dev/null && ok "已启动 kecheng"
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
systemctl enable pm2-root >/dev/null 2>&1 || true
sleep 3
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"
[ "$CODE" = "200" ] && ok "本地 ${PORT} 返回 200" || warn "本地 ${PORT} 返回 ${CODE}，稍后检查 pm2 logs kecheng"

# ---------- 10. nginx ----------
step "10/10 配置 nginx 反代"
cat > /etc/nginx/sites-available/kecheng <<EOF
# 由 scripts/deploy/bootstrap.sh 生成（HTTP 版，证书交给 certbot 升级）
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    client_max_body_size 25m;

    location = / { return 302 http://${DOMAIN}/student/login; }
    location = /teacher { return 302 http://${DOMAIN}/teacher/login; }

    # 安卓客户端 APK（nginx 直出，不经过 Node）
    location = /download/1.apk {
        alias /var/www/html/1.apk;
        default_type application/vnd.android.package-archive;
        add_header Content-Disposition 'attachment; filename="1.apk"';
        expires 7d;
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass \$http_upgrade;
        proxy_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/kecheng /etc/nginx/sites-enabled/kecheng
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx && ok "nginx 已生效"

ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow "${SSH_PORT}"/tcp >/dev/null 2>&1 || true
ok "防火墙已放行 80/443/${SSH_PORT}（ufw 未启用则忽略）"

# ---------- 证书（可选） ----------
step "证书：检查域名解析"
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ "$WITH_SSL" = "no" ]; then
  warn "WITH_SSL=no，跳过证书。DNS 生效后执行：bash scripts/deploy/enable-ssl.sh ${DOMAIN} ${CERTBOT_EMAIL}"
elif [ "$RESOLVED" = "$PUBIP" ]; then
  ok "${DOMAIN} 已解析到本机 (${RESOLVED})，开始签证书"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if [ -n "$CERTBOT_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect || warn "证书签发失败，稍后手动跑 enable-ssl.sh"
  else
    certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || warn "证书签发失败，稍后手动跑 enable-ssl.sh"
  fi
else
  warn "${DOMAIN} 当前解析到 ${RESOLVED:-未解析}，不是本机 ${PUBIP}"
  warn "请先把 DNS 指向本机，再执行：bash scripts/deploy/enable-ssl.sh ${DOMAIN}"
fi

# ---------- 报告 ----------
cat <<EOF

${c_green}================ 部署完成 ================${c_reset}

  应用目录   ${APP_DIR}
  进程       pm2 'kecheng'（已 save + 开机自启）
  本地自检   http://127.0.0.1:${PORT}/ -> ${CODE}

${c_yellow}接下来必须做的 1 件事（DNS）：${c_reset}
  到你的 DNS 服务商（Cloudflare 控制台）把 A 记录改到本机 IP：

    类型  名称                 内容             代理状态
    A     ${DOMAIN}      ${PUBIP}     建议先「仅 DNS」(灰色云)
    A     www                   ${PUBIP}     同上

  改完等生效（一般 1-10 分钟），然后：
    bash scripts/deploy/enable-ssl.sh ${DOMAIN} you@example.com
  想脚本自动改 DNS，就用（需 CF API Token）：
    CF_API_TOKEN=xxx CF_ZONE_ID=xxx bash scripts/deploy/cloudflare-dns.sh ${DOMAIN}

${c_yellow}验收：${c_reset}
    curl -I https://${DOMAIN}/                 期望 200/302
    pm2 list                                   期望 kecheng online
    教师端登录 admin/admin123 看学生名单        数据与旧机一致即为连库成功
    教师端「互动记录」打开一条带图记录          图片能显示 = Supabase Storage 通
    reboot 后 pm2 list                         自动拉起 = 开机自启 OK

EOF
