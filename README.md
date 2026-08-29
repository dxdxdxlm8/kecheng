# 圆与直线位置关系 · 课堂智能教学平台

中职数学「圆与直线的位置关系」双 Agent 教学平台（教师端 + 学生端）。

## 技术栈
- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS v4 + shadcn/ui
- Supabase (PostgreSQL) + Drizzle ORM
- 自定义 Node 常驻进程（`src/server.ts`），LLM 接入层自建有 OpenAI 兼容接口

## 功能
- 台风建模讨论（学伴 Agent「小王」引导）
- 练习三道题（圆与直线位置关系），教师端实时判题与讲解
- 学生端「练习评价」卡片（分析错题、错误点、改进建议）
- 教师端：学情概览、答题正确率、对话记录、清空记录、系统设置

## 本地开发
```bash
pnpm install
cp .env.local.example .env.local   # 填入 Supabase 三项配置
pnpm dev
```
默认端口 5000。生产构建：`pnpm build` 后 `NODE_ENV=production node dist/server.js`。

## 目录说明
- `src/app` — 页面与 API 路由
- `src/storage` — 数据库 schema 与 Supabase 客户端
- `src/components` — UI 组件
- `scripts` — 构建/启动/迁移脚本
