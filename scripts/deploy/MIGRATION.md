# 换服务器迁移手册（kecheng）

> 适用范围：把现在跑在 `/opt/kecheng` 的这套课堂助手搬到一台新机器。
> 数据全在 Supabase 云上（Postgres + Storage），**服务器本身是无状态的**，这是迁移省事的根本原因。
> 本文不涉及 Supabase 项目本身的更换（那是另一件事，见文末「如果连 Supabase 也要换」）。

---

## 1G 机器实测结论（2026-09-10，香港 2核/1G/20G，Ubuntu 23.04）

**结论：1G 能跑，也能构建，但构建期几乎没有余量。**

| 指标 | 实测值 |
|---|---|
| 运行时（node `dist/server.js`） | 142–155 MB |
| 系统总占用 | used 401MB / total 880MB，**available 478MB** |
| 构建（默认配置） | ✅ 成功，**287 秒**，进程树峰值 776MB |
| 构建（关类型检查 + `cpus:1`） | ✅ 成功，**117 秒**（快 2.5 倍），峰值 712MB |
| 构建期可用内存最低值 | **27–35 MB**（几乎榨干，但 swap 用量 0，未 OOM） |
| 公网访问 | 80→302、`/student/login`→200 ✅ |

**所以 1G 的规矩是**：日常跑绰绰有余（余量 478MB）；**发版必须避开上课时段**——
构建时可用内存只剩 30MB 左右，此时若正好有学生在线，服务可能被挤慢甚至 OOM。
采用「关类型检查 + cpus:1」后构建只要 2 分钟，风险窗口小很多。

> ⚠️ **构建命令必须是 `pnpm build`（= scripts/build.sh），不是 `npx next build`。**
> 生产跑的是 `dist/server.js`（`src/server.ts` 用 tsup 打的自定义服务器），
> 只跑 `next build` 不会生成它，服务会 `Cannot find module '/opt/kecheng/dist/server.js'`。
> 本机实测踩过这个坑；旧服务器上因为早先留了 dist 包才一直没暴露。

---

## 快速通道（推荐，3 条命令）

新机是全新 Ubuntu 22.04、以 root 登录后：

```bash
# 1) 一键装好：系统依赖 / swap / Node20 / pnpm / pm2 / 拉代码 / 写 .env.local / 构建 / pm2 / nginx
DOMAIN=shuxueyst.dpdns.org \
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
CERTBOT_EMAIL=you@example.com \
OLD_HOST=旧服务器IP OLD_PORT=2537 OLD_PASSWORD=旧机root密码 \
bash scripts/deploy/bootstrap.sh

# 2) 改 DNS：把域名 A 记录指向新机（Cloudflare 可以脚本改，不用登控制台）
CF_API_TOKEN=xxx CF_ZONE_ID=xxx CF_PROXIED=false \
  bash scripts/deploy/cloudflare-dns.sh shuxueyst.dpdns.org

# 3) 解析生效后签证书（--wait 会自动等到生效）
bash scripts/deploy/enable-ssl.sh shuxueyst.dpdns.org you@example.com --wait
```

`OLD_HOST` 给了的话，脚本会自动把旧机的 `.env.local`、`/var/www/html/*`（含 46M 的 `1.apk`）
一起搬过来。没给就手工填、手工拷。

三个脚本都幂等，跑一半失败可以直接重跑。

---

## 快速通道 B：两机直连 rsync（2026-09-28 实操验证）

**适用场景**：新旧两台机器在同一内网（本项目实测 ping 延迟仅 3ms），且不想走本地中转。
**优点**：790M 的 node_modules 不用搬（新机重装），实际只搬约 75M（代码 8.8M + apk 46M + .next 21M），
全程 6 分钟搞定（install 2m18s + next build 1m18s + tsup 72ms）。

**前提**：先在新机生成一把临时迁移密钥，装到旧机（旧机需临时 `PubkeyAuthentication yes`）。

```bash
# === 新机侧，除最后两步外都在新机执行 ===

# 0) 打底：nginx + certbot + swap
apt-get update -qq && apt-get install -y -qq nginx certbot python3-certbot-nginx
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/kecheng /var/www/html

# 1) 建免密：新机生成迁移密钥 -> 公钥写进旧机 authorized_keys
ssh-keygen -t ed25519 -N '' -C 'migrate-tmp' -f /root/.ssh/id_migrate -q
#（旧机侧：临时 sed 's/^PubkeyAuthentication no/yes/' /etc/ssh/sshd_config && systemctl reload ssh）
cat >> /root/.ssh/config <<'EOF'
Host oldserver
    HostName <旧机IP>
    Port <旧机SSH端口>
    User root
    IdentityFile /root/.ssh/id_migrate
    IdentitiesOnly yes
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
chmod 600 /root/.ssh/config
ssh -o BatchMode=yes oldserver 'echo OK'   # 必须先通再往下

# 2) 搬 Node 运行时（注意：不能只搬 node！见坑 #10）
rsync -az oldserver:/usr/bin/node /usr/bin/node && chmod +x /usr/bin/node
mkdir -p /usr/lib/node_modules
rsync -az oldserver:/usr/lib/node_modules/{npm,corepack,pnpm,pm2} /usr/lib/node_modules/
ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm
ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/bin/npx
ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/bin/corepack
ln -sf ../lib/node_modules/pnpm/bin/pnpm.cjs /usr/bin/pnpm
ln -sf ../lib/node_modules/pm2/bin/pm2 /usr/bin/pm2
node -v && npm -v && npx -v && pnpm -v && pm2 -v   # 五个都要有输出

# 3) 搬代码（排除 node_modules/.next/dist）+ 静态资源 + 证书 + nginx + deploy key
rsync -az --delete --exclude=node_modules --exclude=.next --exclude=dist \
      oldserver:/opt/kecheng/ /opt/kecheng/
rsync -az oldserver:/var/www/html/ /var/www/html/
rsync -az oldserver:/etc/letsencrypt/ /etc/letsencrypt/
rsync -az oldserver:/etc/nginx/sites-available/kecheng /etc/nginx/sites-available/kecheng
ln -sf /etc/nginx/sites-available/kecheng /etc/nginx/sites-enabled/kecheng
rm -f /etc/nginx/sites-enabled/default
rsync -az oldserver:/root/.ssh/id_ed25519 oldserver:/root/.ssh/id_ed25519.pub /root/.ssh/
chmod 600 /root/.ssh/id_ed25519
nginx -t && systemctl reload nginx

# 4) 装依赖 + 构建（两步都不能少）
cd /opt/kecheng
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=1200 npx next build
npx tsup src/server.ts --format cjs --platform node --target node20 \
    --outDir dist --no-splitting --no-minify

# 5) 起服务 + 自启
PORT=5000 NODE_ENV=production pm2 start dist/server.js --name kecheng --cwd /opt/kecheng
pm2 save && pm2 startup systemd -u root --hp /root && systemctl enable pm2-root

# 6) 验证（用 IP + Host 头，DNS 还没切也能验）
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: shuxueyst.dpdns.org' http://127.0.0.1/
curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: shuxueyst.dpdns.org' https://127.0.0.1/student/login
curl -sk -X POST -H 'Host: shuxueyst.dpdns.org' -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}' https://127.0.0.1/api/auth/teacher/login
```

**收尾**（迁移完成后，把旧机的临时改动复原）：

```bash
# 旧机：恢复 sshd 配置
mv /etc/ssh/sshd_config.bak.migrate /etc/ssh/sshd_config && sshd -t && systemctl reload ssh
# 旧机 authorized_keys 里的 migrate 公钥可删可不删（留着当备用通道也行）
# 新机：id_migrate 密钥留着或删掉，都不影响生产
```

**旧机保持运行**，等 DNS 切完、观察 24 小时确认无异常后再 `pm2 stop kecheng`。

---

## 0. 现状快照（2026-09-28 采集）

| 项目 | 值 |
|---|---|
| **当前主机** | **156.238.244.18**（SSH 端口 **2537**，root/密码登录）|
| 系统 | Ubuntu 22.04.5 LTS，x86_64，2G 内存 + 2G swap，29G 盘（用约 5.2G） |
| 运行时 | Node v20.20.2、pnpm 9.15.9、npm 10.8.2、nginx 1.18.0、pm2 7.0.4 |
| 应用目录 | `/opt/kecheng`（790M，含 node_modules 761M 与 .next 21M） |
| 进程 | pm2 进程名 `kecheng`，监听 `127.0.0.1:5000`；`pm2-root.service` 已 enable（开机自启） |
| 反代 | nginx 站点 `kecheng` → `proxy_pass http://127.0.0.1:5000`；已开 **HTTP/2** + **gzip**（见下） |
| 域名 | `shuxueyst.dpdns.org` + `www.shuxueyst.dpdns.org`（已生效） |
| HTTPS | Let's Encrypt（Certbot 签发，证书有效期至 2026-11-27），`certbot.timer` 自动续期 |
| 防火墙 | **ufw active**，放行 **80 / 443 / 2537**，默认 deny incoming |
| 入侵防护 | **fail2ban enabled**（`[sshd]` bantime 1d / findtime 10min / maxretry 5；`[recidive]` 1天封4次→30天；监控 port 2537） |
| SSH | 端口 **仅 2537**（22 已关闭）；`/root/.ssh/id_ed25519` 是 GitHub Deploy Key（已验证可 push） |
| 环境变量 | `/opt/kecheng/.env.local`（权限 **600**），**4 个键**：`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`TEACHER_TOKEN_SECRET`（2026-09-16 加的教师端会话签名密钥，**漏了会导致教师登录后立刻掉线**） |
| 静态文件 | `/var/www/html/`：`1.apk`（46M，安卓客户端，学生端「下载 App」指向它）、`245793a2da3419e1ab25ec847cf29acb.txt`（域名/CA 验证文件） |
| DNS | 域名 DNS 托管在 **Cloudflare**（换机器要改 A 记录指向新 IP，不是去 dpdns 改） |

> **历史记录**：旧机 `147.161.35.177:2537` 曾与当前主机并行运行以观察 DNS 切换，
> **已于 2026-09-28 彻底停用**（所有端口不可达）。相关凭据已从本项目清理，无需再保留。

### nginx 性能配置（2026-09-28 优化，换机后要一并搬）

`nginx.conf` 的 gzip 段（**`gzip_types` 必须显式列出，否则只压 text/html**）：
```nginx
gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 5; gzip_min_length 1024;
gzip_buffers 16 8k; gzip_http_version 1.1;
gzip_types text/plain text/css application/json application/javascript text/xml
           application/xml application/xml+rss text/javascript application/wasm
           image/svg+xml font/woff font/woff2;
```
`nginx.conf` http 层加（**`map` 不能写在 sites-enabled 里**）：
```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```
站点 `sites-available/kecheng`：
```nginx
listen 443 ssl http2;                    # HTTP/2
listen [::]:443 ssl http2 ipv6only=on;
proxy_set_header Connection $connection_upgrade;   # 条件化，别无条件 "upgrade"
location /_next/static/ { alias /opt/kecheng/.next/static/; expires 1y; }  # 静态直出
```

**关键结论**：`.env.local` 里没有 LLM 配置和对象存储配置——
LLM 配置存在数据库 `system_settings` 表（教师端「系统设置」页写入），
学生上传的图片存在 Supabase Storage。所以这两样**跟着 Supabase 走，不用搬**。

---

## 1. 迁移前要收集的 7 样东西

按顺序做，缺一样新机器就跑不起来（多数可以交给 `bootstrap.sh` 自动搬，见「快速通道」）：

| # | 要拿的东西 | 怎么拿 | 风险 |
|---|---|---|---|
| 1 | **`.env.local` 三个 Supabase 变量** | `cat /opt/kecheng/.env.local` 复制内容；丢了也能去 Supabase 控制台 Settings → API 重新取 | 拿不到就连不上库，应用直接白屏 |
| 2 | **GitHub Deploy Key 私钥** `/root/.ssh/id_ed25519` | 从旧机 `cat` 出来（**不要粘进任何提交到仓库的文件**）；或不搬，在新机重新 `ssh-keygen` 后把公钥加到仓库 Deploy keys | 不搬就不能在服务器上 commit+push（本地机器因为网络问题推不了 GitHub，推代码靠服务器） |
| 3 | **nginx 站点配置** | `/etc/nginx/sites-available/kecheng`（仓库里有同名副本 `scripts/deploy/nginx-kecheng.conf`，改过的话以服务器上的为准） | 丢了要手写反代 |
| 4 | **当前部署的 commit** | 旧机 `cd /opt/kecheng && git log --oneline -1` | 保证新机拉到同一版本 |
| 5 | **pm2 启动命令** | 旧机 `pm2 list` 看 script/path；本项目是 `npm start`（Next.js standalone 之外的普通 start） | 起错命令会 502 |
| 6 | **Cloudflare 账号（+ 可选 API Token / Zone ID）** | 控制台改 A 记录；或建一个 `Zone-DNS-Edit` 权限的 Token 给 `cloudflare-dns.sh` 用 | **IP 变了解析必须跟着改**，不改流量还在旧机 |
| 7 | **`/var/www/html` 静态文件** | `1.apk`（46M）+ 域名验证 txt，从旧机 scp/rsync | 不搬则学生端「下载 App」404 |

> 不需要搬：数据库、图片、LLM 配置、学情/答题记录——全在 Supabase。

---

## 2. 新服务器：从零到跑起来

全程 root，Ubuntu 22.04 全新机，约 15–20 分钟。

### 2.1 系统初始化

```bash
# 1) 装依赖
apt-get update -y && apt-get install -y git nginx curl ca-certificates

# 2) 加 swap（2G 内存机不加 swap，next build 必 OOM）
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 3) Node 20 + pnpm + pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2
node -v && pnpm -v && pm2 -v
```

也可以直接跑仓库里的 `bash scripts/deploy/server-setup.sh`（已包含上面 0–5 步的等价流程）。

### 2.2 拿代码

```bash
git clone --branch main git@github.com:dxdxdxlm8/kecheng.git /opt/kecheng
# 若用 https 且新机访问 GitHub 不畅，就从旧机打包：
#   旧机：tar czf /tmp/kecheng.tgz -C /opt/kecheng --exclude=node_modules --exclude=.next .
#   新机：mkdir -p /opt/kecheng && tar xzf kecheng.tgz -C /opt/kecheng
cd /opt/kecheng && git log --oneline -1   # 确认与旧机一致
```

### 2.3 放环境变量（最关键一步）

```bash
cat > /opt/kecheng/.env.local <<'EOF'
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
TEACHER_TOKEN_SECRET=<随机长串>
EOF
chmod 600 /opt/kecheng/.env.local
```

**四个键**。前三个连 Supabase；`TEACHER_TOKEN_SECRET` 是教师端登录 token 的签名密钥，
**必须与旧机一致**（否则已登录的教师会话失效）；换了机器想重新生成也行，但要通知教师重新登录。

> ⚠️ 2026-09-28 迁移时踩过：MIGRATION.md 早先只写了 3 个键，实际 `.env.local` 有 4 个。
> `TEACHER_TOKEN_SECRET` 是 2026-09-16 加的，漏搬会导致教师登录成功后立刻 401。
> 判断方法：`grep -c "=" /opt/kecheng/.env.local` 应为 4。

### 2.4 装依赖 + 构建

```bash
cd /opt/kecheng
pnpm install --frozen-lockfile
export NODE_OPTIONS=--max-old-space-size=1200   # 2G 内存必须限堆，1400 也行，别超 1500
npx next build
```

构建约 1–3 分钟。失败优先怀疑 OOM（调小堆或加 swap），其次才看代码。

### 2.5 起服务 + 开机自启

```bash
pm2 start npm --name kecheng -- start        # 或仓库里的 bash scripts/deploy/start.sh
pm2 save
pm2 startup                                   # 按输出提示再执行一次它给的命令
systemctl enable pm2-root
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/   # 应为 200
```

### 2.6 nginx + HTTPS

```bash
cp scripts/deploy/nginx-kecheng.conf /etc/nginx/sites-available/kecheng
ln -sf /etc/nginx/sites-available/kecheng /etc/nginx/sites-enabled/kecheng
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 证书：等域名解析切到新机后再签（HTTP-01 校验需要 80 端口公网可达）
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d shuxueyst.dpdns.org -d www.shuxueyst.dpdns.org
# 签完确认自动续期任务存在
ls /etc/cron.d/certbot && certbot renew --dry-run
```

### 2.7 防火墙 + 入侵防护（2026-09-28 加固，已实跑）

> ⚠️ **先设自动回滚保险再动手** —— 防火墙/SSH 端口配错会切断自身连接。
> 服务器没装 `at`，用 `systemd-run`：
> ```bash
> systemd-run --on-active=10min --unit=ufw-safety /usr/sbin/ufw disable
> ```
> 10 分钟内没确认成功会自动关掉 ufw，不会把自己锁死。
> 确认一切正常后 `systemctl stop ufw-safety.timer` 取消（若已到期会自动消失）。

```bash
# 1) 配 ufw 规则（先不启用，预览确认 SSH 在列）
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment "SSH-old"
ufw allow 2537/tcp comment "SSH"
ufw allow 80/tcp   comment "HTTP"
ufw allow 443/tcp  comment "HTTPS"
ufw show added          # 必须看到上面 4 条都在
ufw --force enable

# 2) fail2ban
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
# ⚠️ 所有 SSH 端口都写上，否则换端口后规则失效
port    = 22,2537
backend = systemd
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd    # 看 banned IP 列表

# 3) 验证没错拦正常流量
grep "UFW BLOCK" /var/log/ufw.log
# 期望：全是扫描器（Telnet 23 / RabbitMQ 5672 / syslog 6514 / 挖矿 28080 等）
```

**为什么保留 22 端口**：项目实测新机开机 38 分钟就被扫了 383 次（361 次来自单个 IP）。
fail2ban 已能自动封禁，双端口则是网络层双保险 —— 万一某 ISP 封了 2537，22 还能用。
**不推荐直接把 22 改成 2537**，要用 `sed` 在 `Port 22` 后面**追加** `Port 2537` 同时监听，
实测新端口能登录后再决定是否移除旧端口。

### 2.8（可选）GitHub Deploy Key

如果还要在新机上 commit + push：

```bash
# 方案 A：搬旧私钥（把内容写到新机）
cat > /root/.ssh/id_ed25519 <<'EOF'
-----BEGIN OPENSSH PRIVATE KEY-----
...
EOF
chmod 600 /root/.ssh/id_ed25519

# 方案 B：新生成，公钥加到 GitHub 仓库 Settings → Deploy keys（勾选 Allow write access）
ssh-keygen -t ed25519 -C kecheng-deploy
cat /root/.ssh/id_ed25519.pub

# 验证
ssh -T git@github.com     # 应回 "Hi dxdxdxlm8/kecheng! ..."
```

### 2.9 顺手检查项

```bash
chmod 600 /opt/kecheng/.env.local          # 644 的话同机任何用户可读 service_role key
stat -c "%a %n" /root/.ssh/id_*            # 应为 600
crontab -l; ls /etc/cron.d/                # 有没有遗漏的定时任务
systemctl list-timers certbot.timer        # 证书续期
grep -c "=" /opt/kecheng/.env.local        # 应为 4（环境变量键数核对）
```

---

## 2.10 诊断：域名访问不了，是服务器还是本地？

**⚠️ 头号陷阱：开发机的 `https_proxy` 会伪造 502。**

2026-09-28 踩过：从开发机 `curl https://shuxueyst.dpdns.org/` 得到 **502 Bad Gateway**，
一度误判为服务器故障，实际是本机代理拦截：
```bash
env | grep -i proxy
# https_proxy=http://127.0.0.1:9024   ← 就是它
```
表现特征：curl -v 能看到 `CONNECT 域名:443` → `HTTP/1.1 502`；
加 `--resolve 域名:443:<新机IP>` 反而变成 `000`（代理不认强制解析）。

**正确诊断姿势：SSH 上服务器，让服务器自己去访问公网。**

```bash
ssh <新机>
curl -s -o /dev/null -w 'HTTPS: %{http_code}\n' https://shuxueyst.dpdns.org/student/login
curl -s -o /dev/null -w 'ssl_verify: %{ssl_verify_result}\n' https://shuxueyst.dpdns.org/   # 0 = 证书受信
curl -s -o /dev/null -w 'localhost:5000 -> %{http_code}\n' http://127.0.0.1:5000/
curl -sk -o /dev/null -w 'localhost:443 -> %{http_code}\n' -H 'Host: shuxueyst.dpdns.org' https://127.0.0.1/student/login
```

服务端 200 + 本地不通 = **本地网络/代理/DNS 缓存问题**。

**其他现象速查**：

| 现象 | 原因 |
|---|---|
| 纯 IP 访问 404 | `Host` 头不匹配任何 `server_name`，落到 `default_server` |
| 纯 IP HTTPS 证书告警 | 证书 SAN 不含 IP，正常现象，只能域名访问 |
| 改了 DNS 后还访问旧机 | 本地 DNS 缓存（`ipconfig /flushdns`）；或运营商 DNS 未跟上（对比 `nslookup 域名 8.8.8.8`） |
| 域名 301 后跳到打不开的地址 | nginx 硬编码了域名跳转，而该域名还指向旧机 |

**确认流量真的落到新机**（比看日志可靠）：

```bash
curl -s -o /dev/null "https://shuxueyst.dpdns.org/student/login?marker=UNIQUE123"
grep UNIQUE123 /var/log/nginx/access.log
```
⚠️ 别依赖 `pm2 logs` —— 静态页面由 nginx 直出，不经过 Node，pm2 日志里看不到。
另外 nginx 日志时区是 **+0800**（北京时间），与 pm2 日志的 UTC 不同。

---

## 3. 切换流量（重点：IP 变了，DNS 必须改）

新机 IP 和旧机不一样，**换服务器这一步最容易漏**。域名 DNS 托管在 Cloudflare，去那里改：

### 3.1 改 A 记录（二选一）

**A. 控制台改**（直观）：
Cloudflare → 选域名 → DNS → Records，把这两条的内容改成新机 IP：

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `shuxueyst.dpdns.org` | 新机公网 IP | **先设成「仅 DNS」（灰色云）** |
| A | `www` | 新机公网 IP | 同上 |

**B. 脚本改**（省得登控制台）：
```bash
CF_API_TOKEN=xxx CF_ZONE_ID=xxx CF_PROXIED=false \
  bash scripts/deploy/cloudflare-dns.sh shuxueyst.dpdns.org
```
Token 只需 `Zone - DNS - Edit` 权限；Zone ID 在域名概览页右下角。

### 3.2 为什么第一次要关掉橙色云

开着 Cloudflare 代理时：如果 SSL/TLS 加密模式是 **Flexible**，源站到 Cloudflare 之间是明文，
配合 nginx 的 301→HTTPS 会出现**重定向循环**，而且 certbot 的 HTTP-01 校验也可能被挡。
所以顺序是：

1. 先「仅 DNS」（灰色云）切过去 → 签证书 → 浏览器验证 HTTPS 正常；
2. 确认没问题后，再打开代理（橙色云），并把 SSL/TLS 加密模式设为 **Full** 或 **Full (Strict)**；
3. Cloudflare 生效很快（通常 1 分钟内），`getent hosts shuxueyst.dpdns.org` 可校验。

### 3.3 签证书 + 观察

```bash
bash scripts/deploy/enable-ssl.sh shuxueyst.dpdns.org you@example.com --wait
curl -I https://shuxueyst.dpdns.org/        # 期望 200/302
```

旧机**先别关**，观察 24 小时；确认无流量后再 `pm2 stop kecheng`。

---

## 4. 验收清单

| 检查项 | 命令 / 操作 | 期望 |
|---|---|---|
| 进程 | `pm2 list` | `kecheng` online |
| 本地端口 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/` | 200 |
| 域名 | `curl -s -o /dev/null -w '%{http_code}' https://shuxueyst.dpdns.org/` | 200 或 302 |
| 证书 | `echo \| openssl s_client -connect shuxueyst.dpdns.org:443 2>/dev/null \| openssl x509 -noout -dates` | 有效期 90 天 |
| 连库 | 教师端登录 admin/admin123，看学生名单是否还在 | 名单与旧机一致 |
| 图片 | 教师端「互动记录」点开一条带图记录 | 图片能显示（Supabase Storage 通） |
| LLM | 教师端「系统设置」看模型配置还在；学生端发一句话试 | 能正常回复 |
| 学情 | 教师端「学情评价」 | 历史数据还在 |
| 开机自启 | `reboot` 后 `pm2 list` | 自动拉起 |
| 推代码 | 服务器上 `git commit` + `git push` | 能推到 GitHub |

---

## 5. 不用搬的东西（因为它们不在服务器上）

| 数据 | 存在哪 |
|---|---|
| 学生名单、互动记录、答题记录、学情总结、会话状态 | Supabase Postgres |
| 学生上传的图片 | Supabase Storage |
| LLM 接口地址 / 密钥 / 模型名 | 数据库 `system_settings` 表（教师端「系统设置」写入） |
| 学伴小航、教师 Agent 的提示词 | 代码里（`src/app/api/chat/route.ts`）+ 数据库 `guidance_scripts` 表 |

---

## 6. 踩过的坑

1. **2G 内存必须加 swap + 限堆**：`next build` 默认能吃到 OOM，表现为进程被 kill、构建日志戛然而止。固定用 `NODE_OPTIONS=--max-old-space-size=1200`。
2. **CRLF**：本地工作区是 CRLF，上传服务器前要转 LF（`sed -i 's/\r$//'` 或在写文件时替换），否则偶发语法/编码问题。
3. **本地推不了 GitHub**：本机 https remote + 代理对 `github.com` 返回 502，**提交和推送都在服务器上做**（服务器是 ssh remote + Deploy Key）。
4. **发版后要硬刷新**：学生端 Ctrl+F5，否则旧 JS 报 `Failed to find Server Action`。
5. **不要只传单个文件**：本地仓库若比服务器新（比如多了 `src/lib/lesson` 之类的目录），单传 `route.ts` 会 `Module not found`。正确做法是先对齐 commit，再从线上拉实际改动过的文件。
6. **服务器时区是 UTC**：日志时间戳比北京时间晚 8 小时，判断"什么时候发生的"要 +8。
7. **certbot 必须在解析切过去之后签**：否则 HTTP-01 校验失败。
8. **换服务器 = 换 IP，DNS 一定跟着改**（本项目域名 DNS 在 Cloudflare，不是域名注册商那里）。
   忘了改的表现是：新机一切正常，但用户访问的还是旧机，且证书签发失败。
9. **Cloudflare 的 SSL/TLS 模式别用 Flexible**：配合 nginx 的 HTTP→HTTPS 跳转会重定向循环。
   用 Full / Full (Strict)，且源站要有 certbot 签的有效证书。
10. **搬 Node 运行时别只搬 `/usr/bin/node`**（2026-09-28 踩过）：这台机的 node 不是 apt 装的，
    而是散在 `/usr/bin/`（node/npm/npx/corepack/pnpm/pm2 全是 symlink）+ `/usr/lib/node_modules/`。
    只搬 node 会导致 `npx: command not found`，构建直接失败。
    **正确姿势**：`rsync -az old:/usr/bin/node /usr/bin/node` + `rsync -az old:/usr/lib/node_modules/{npm,corepack,pnpm,pm2} /usr/lib/node_modules/`，
    再手工建 symlink（`npm`→`npm/bin/npm-cli.js`，`npx`→`npm/bin/npx-cli.js`，`corepack`→`corepack/dist/corepack.js`）。
    验完 `node -v && npm -v && npx -v && pnpm -v && pm2 -v` 五个全有输出才算对。
11. **rsync 跨机免密要显式指定 IdentityFile**（2026-09-28 踩过）：把新机公钥写进旧机
    `authorized_keys` 后仍被拒，原因是旧机 `PubkeyAuthentication no`（要临时改成 yes），
    且新机 `~/.ssh/id_ed25519` 被 GitHub Deploy Key 覆盖导致密钥不匹配。
    建议**单独生成一把迁移专用密钥**（`ssh-keygen -f ~/.ssh/id_migrate`），在 `~/.ssh/config` 里
    给旧机建别名并写 `IdentitiesOnly yes`，用完把旧机 sshd 配置和 authorized_keys 复原。
12. **rsync 只搬符号链接不搬目标**（2026-09-28 踩过）：`/etc/nginx/sites-enabled/kecheng` 是
    指向 `sites-available/kecheng` 的软链，单独 rsync 这个路径只会得到一个坏链接。
    要连同 `sites-available/` 下的实际文件一起搬，并在新机确认没有 `sites-enabled/default` 抢占 80 端口。

---

## 附：如果连 Supabase 也要换

那是另一个量级的活，多出来的步骤：

1. 新 Supabase 项目建表：按 `scripts/migrations/*.sql` 顺序执行（注意执行顺序见各文件头注释）；
2. 迁数据：旧库 `pg_dump` 或用 Supabase Dashboard 导出 CSV，再导入新库；
3. 迁 Storage 图片：旧 bucket 整目录下载、新 bucket 上传，注意 `interaction_records.image_key` 要保持一致；
4. 换 `.env.local` 的三个变量；
5. 教师端「系统设置」里的 LLM 配置要重新填（它存在 `system_settings` 表里，随库走，若一起迁数据库则不用重填）。
