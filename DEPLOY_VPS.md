# 部署到香港 VPS（当前线上方案）

本项目是自定义 Node 常驻服务（Next.js + `src/server.ts`），部署在 VPS 上最省事：无需改造代码，pm2 守护 + nginx 反代即可。

## 线上环境
- 系统：Ubuntu 22.04 LTS（2 核 2G，已加 2G swap）
- 应用目录：`/opt/kecheng`
- 服务端口：应用 `5000`，对外 `80`（nginx 反代）
- 进程管理：pm2（进程名 `kecheng`，已设置开机自启）
- 域名：`https://shuxueyst.dpdns.org`（DigitalPlat 免费域名 + Cloudflare DNS + Let's Encrypt）

## 入口分工
域名只有一个，三端靠路径区分（规则在 nginx 与 `next.config.ts` 两处）：

| 访问地址 | 落到哪 | 实现位置 |
| --- | --- | --- |
| `https://shuxueyst.dpdns.org/` | 302 → `/student/login`（学生端直达） | nginx `location = /` |
| `https://shuxueyst.dpdns.org/teacher` | 302 → `/teacher/login` | nginx `location = /teacher` |
| `https://shuxueyst.dpdns.org/adminlogin` | 原首页（学生端/教师端双入口导航页） | `next.config.ts` rewrite 到 `/` |

注意：应用**没有裸 `/teacher` 路由**（只有 `/teacher/login`、`/teacher/dashboard` 等），
nginx 那条 `/teacher` 跳转是为了避免教师输错 URL 直接 404，不要删。
nginx 配置以 `scripts/deploy/nginx-kecheng.conf` 为准，改完务必 `nginx -t` 再 `reload`。

## 一键部署（新机器）
```bash
# 1. 初始化环境（装 Node 20 / nginx / pnpm / pm2，拉代码并构建）
bash scripts/deploy/server-setup.sh

# 2. 在 /opt/kecheng 下放置 .env.local（Supabase 三项，见 README）

# 3. 配置 nginx 并启动服务
cp scripts/deploy/nginx-kecheng.conf /etc/nginx/sites-available/kecheng
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kecheng /etc/nginx/sites-enabled/kecheng
nginx -t && systemctl enable --now nginx
bash scripts/deploy/start.sh
```

## 日常更新（改完代码推 GitHub 后）
```bash
bash scripts/deploy/update.sh     # 拉最新代码 -> 重建 -> 重启
```

## 常用运维命令
```bash
pm2 status              # 查看进程状态
pm2 logs kecheng        # 实时日志
pm2 restart kecheng     # 重启
systemctl status nginx  # nginx 状态
```

## 关键配置说明
- **nginx 超时必须放宽**：判题接口 `invokeChat` 非流式等完整 JSON，耗时 30-60s，
  因此 `proxy_read_timeout` / `proxy_send_timeout` 设为 `300s`，否则会出现 504。
- **必须关掉 `proxy_buffering`**：聊天是 SSE 流式输出，缓冲会导致消息不实时。
- **必须加 swap**：2G 内存构建 Next.js 会 OOM，已配置 2G swap。
- **环境变量只需 Supabase 三项**：浏览器端配置由 `/api/supabase-config` 运行时下发，
  不需要 `NEXT_PUBLIC_*`，构建时也不用注入。

## ⚠️ 上线前必须执行的数据库迁移
「练习评价」依赖 `learning_summaries.practice_evaluation` 列，未执行会导致第三题保存失败。
在 Supabase Dashboard → SQL Editor 运行：
```sql
ALTER TABLE learning_summaries ADD COLUMN IF NOT EXISTS practice_evaluation TEXT;
```
（脚本位置：`scripts/migrations/20260829_add_practice_evaluation.sql`）
