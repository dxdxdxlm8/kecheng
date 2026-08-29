-- 为学生端「练习评价」功能新增字段
-- 执行方式：登录 Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
ALTER TABLE learning_summaries
ADD COLUMN IF NOT EXISTS practice_evaluation TEXT;
