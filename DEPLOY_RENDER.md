# 部署到 Render（免费 Web Service）

本项目是自定义 Node 常驻服务（Next.js + `src/server.ts`），Render 的 **Web Service**（常驻式，非 serverless）可以原生运行，无需改造。判题接口耗时 30-60s 也能撑（不像 Vercel/Cloudflare 有硬超时）。

## 一、准备（一次性）
1. 代码已推到 GitHub：`https://github.com/dxdxdxlm8/kecheng`
2. 注册 Render：https://dashboard.render.com （需绑定信用卡/借记卡做风控验证，免费档也要）
3. 确认本地 `.env.local` 里用的是什么大模型：
   - 用 **海外模型（OpenAI 等）** → Render 在美国节点可直连，无需代理 ✅
   - 用 **国内模型（硅基流动/通义/DeepSeek）** → 也可，配好 BASE_URL 即可

## 二、创建服务（两种方式）
### 方式 A：Blueprint（推荐，最快）
Render 控制台 → **New** → **Blueprint** → 连接 GitHub 仓库 `dxdxdxlm8/kecheng` → 选择仓库里的 `render.yaml` → 创建。

### 方式 B：手动 New → Web Service
- Runtime：**Node**
- Build Command：`pnpm install && pnpm build`
- Start Command：`node dist/server.js`
- Branch：`main`
- Instance Type：**Free**（512MB / 共享 CPU）

## 三、填写环境变量
在 Render 控制台 → 该服务 → **Environment**，逐项填入（与本地 `.env.local` 一致，**不要写进仓库**）：

| 变量名 | 说明 |
|---|---|
| `NODE_ENV` | `production`（已自动设置） |
| `SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_URL` | 同上（前端用） |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上（前端用） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role（服务端用） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_VISION_MODEL` / `LLM_EXTRA_HEADERS` | 大模型接入 |
| `STORAGE_ENDPOINT` / `REGION` / `BUCKET` / `ACCESS_KEY` / `SECRET_KEY` / `PUBLIC_BASE_URL` / `FORCE_PATH_STYLE` | 对象存储（如有用） |

保存后 Render 会自动重新部署。

## 四、验证
- 部署完成后 Render 给一个 `https://kecheng.onrender.com` 域名，直接打开即可访问。
- 学生端：`https://kecheng.onrender.com/student/login`
- 教师端：`https://kecheng.onrender.com/teacher/login`

## 注意事项（免费档的坑）
- **休眠**：免费实例空闲 15 分钟后会休眠，首次访问需 30s~1min 冷启动。上课前先点开一次「预热」。
- **内存**：512MB 跑 Next + Node，40 人并发偏紧，公开课建议开课前实际压测一下；不够就升级到 paid（$7/月 2GB）。
- **国内访问**：Render 节点在美国，中国学生访问比香港慢，但能用。
- **Supabase 迁移别忘了**：上线前要执行 `scripts/migrations/20260829_add_practice_evaluation.sql`（在 Supabase Dashboard → SQL Editor 跑 `ALTER TABLE learning_summaries ADD COLUMN practice_evaluation TEXT;`）。
