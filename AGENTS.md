# AGENTS.md

## 项目概览
课堂助手智能体 - 支持教师与学生双端互动的智能教学平台。教师端管理教学内容（知识点、题目、引导话术），学生端与 AI 智能体互动学习。

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **Database**: Supabase (PostgreSQL)
- **AI**: 自建 LLM 接入层（OpenAI Chat Completions 兼容协议，可对接 DeepSeek/火山方舟/通义/智谱/Ollama 等，教师端「系统设置」页面配置）
- **Auth**: 教师端用户名登录(admin/admin123)，学生端姓名登录（仅限教师预设的学生）

## 目录结构
```
src/
├── app/
│   ├── page.tsx                           # 首页（角色选择）
│   ├── layout.tsx                         # 根布局 + Supabase 配置注入
│   ├── globals.css                        # 全局样式
│   ├── api/
│   │   ├── auth/teacher/login/route.ts    # 教师登录
│   │   ├── auth/student/login/route.ts    # 学生登录
│   │   ├── knowledge-points/route.ts      # 知识点 CRUD
│   │   ├── questions/route.ts             # 题目 CRUD
│   │   ├── guidance-scripts/route.ts      # 引导话术 CRUD
│   │   ├── interactions/route.ts          # 互动记录查询
│   │   ├── students/route.ts            # 学生管理 CRUD
│   │   ├── answers/route.ts              # 答题记录
│   │   ├── chat/route.ts                 # AI 对话（SSE 流式）
│   │   └── summary/route.ts              # 学习总结生成
│   ├── teacher/
│   │   ├── login/page.tsx                 # 教师登录页
│   │   ├── dashboard/page.tsx             # 教师仪表盘
│   │   ├── knowledge/page.tsx            # 知识点管理
│   │   ├── questions/page.tsx            # 题目管理
│   │   ├── guidance/page.tsx             # 引导话术管理
│   │   ├── students/page.tsx            # 学生姓名预设管理
│   │   ├── interactions/page.tsx         # 互动记录查看
│   │   └── summaries/page.tsx            # 学情评价
│   └── student/
│       ├── login/page.tsx                # 学生登录页
│       ├── chat/page.tsx                 # AI 对话页
│       └── summary/page.tsx             # 学习总结页
├── lib/
│   ├── utils.ts                           # 工具函数
│   ├── supabase-config-inject.tsx         # Supabase 配置注入 Provider
│   └── supabase-browser.ts               # 浏览器端 Supabase 客户端
└── storage/database/
    ├── supabase-client.ts                 # 服务端 Supabase 客户端
    └── shared/schema.ts                   # Drizzle ORM Schema
```

## 数据库表
- **students**: 学生信息 (id, name, created_at)
- **knowledge_points**: 知识点 (id, title, content, created_by, created_at, updated_at)
- **questions**: 题目 (id, question_text, answer, question_type, options, knowledge_point_id, created_at)
- **guidance_scripts**: 引导话术 (id, content, step_order, knowledge_point_id, created_at)
- **interaction_records**: 互动记录 (id, student_id, session_id, role, content, created_at)
- **answer_records**: 答题记录 (id, student_id, question_id, session_id, student_answer, is_correct, created_at)
- **learning_summaries**: 学习总结 (id, student_id, session_id, strengths, weaknesses, suggestions, created_at)

## 开发命令
- 安装依赖: `pnpm install`
- 开发: `pnpm run dev`
- 构建: `pnpm run build`
- 类型检查: `pnpm ts-check`
- Lint: `pnpm lint`

## API 接口清单
1. `POST /api/auth/teacher/login` - 教师登录 (username, password)
2. `POST /api/auth/student/login` - 学生登录 (name，仅限预设学生)
3. `GET/POST /api/students` - 学生列表/创建
4. `DELETE /api/students?id=xxx` - 删除学生
5. `GET/POST /api/knowledge-points` - 知识点列表/创建
6. `GET/POST /api/questions` - 题目列表/创建
7. `GET/POST /api/guidance-scripts` - 引导话术列表/创建
8. `GET /api/interactions?session_id=xxx&student_id=xxx` - 互动记录查询
9. `GET/POST /api/answers` - 答题记录
10. `POST /api/chat` - AI 对话 (SSE 流式, student_id, session_id, message)
11. `POST /api/summary` - 学习总结生成 (student_id, session_id)
12. `GET /api/summaries?student_id=xxx` - 学情评价查询

## 关键实现
- AI 对话使用 SSE 流式输出，前端通过 fetch + getReader() 实现打字机效果
- 教师登录使用用户名密码验证，默认账户: admin / admin123
- 学生登录仅限教师预设的学生姓名，未预设学生无法登录
- 学生端支持历史对话查看，可切换不同会话或开始新对话
- 学情评价使用 LLM 基于互动记录和答题情况生成结构化 JSON 总结
