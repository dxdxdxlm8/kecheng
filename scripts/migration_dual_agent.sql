-- ============================================================
-- 双 Agent 协同教学改造迁移脚本
-- 在 Supabase Dashboard 的 SQL Editor 中执行
-- 幂等设计：使用 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- 1. students 表：新增 companion_level 字段（学伴水平）
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS companion_level varchar(20) NOT NULL DEFAULT 'normal';

COMMENT ON COLUMN students.companion_level IS '学伴水平：normal（普通，与学生水平相当）| advanced（高水平）';

-- 2. guidance_scripts 表：改造为"教师 Prompt"，新增 title / updated_at
ALTER TABLE guidance_scripts
  ADD COLUMN IF NOT EXISTS title varchar(255) NOT NULL DEFAULT '教师 Prompt';

ALTER TABLE guidance_scripts
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone;

COMMENT ON TABLE guidance_scripts IS '教师 Prompt（原引导话术改造，全局教学策略 Prompt）';

-- 将存量多段话术合并为一条全局 Prompt（按 step_order 排序拼接）
-- 仅当表中无 title 为"教师 Prompt"的记录时执行
DO $$
DECLARE
  existing_count integer;
  merged_content text;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM guidance_scripts WHERE title = '教师 Prompt';
  IF existing_count = 0 THEN
    SELECT string_agg(content, E'\n\n' ORDER BY step_order) INTO merged_content FROM guidance_scripts;
    IF merged_content IS NOT NULL AND length(merged_content) > 0 THEN
      -- 清空旧的多段话术，插入合并后的一条全局 Prompt
      DELETE FROM guidance_scripts;
      INSERT INTO guidance_scripts (title, content, step_order, updated_at)
      VALUES ('教师 Prompt', merged_content || E'\n\n（注：此为原有引导话术合并而来，请教师根据双 Agent 教学流程完善出题数量、分层规则等策略）', 1, now());
    END IF;
  END IF;
END $$;

-- 3. 新增 session_states 表（会话状态机）
CREATE TABLE IF NOT EXISTS session_states (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id varchar(64) NOT NULL,
  student_id varchar(36) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  phase varchar(30) NOT NULL DEFAULT 'teaching',
  question_index integer NOT NULL DEFAULT 0,
  total_questions integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  current_question_text text,
  current_answer text,
  current_knowledge_point_id varchar(36),
  current_difficulty varchar(20) NOT NULL DEFAULT 'basic',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_states_session_id_idx ON session_states(session_id);
CREATE INDEX IF NOT EXISTS session_states_student_id_idx ON session_states(student_id);

COMMENT ON COLUMN session_states.phase IS 'teaching: 教师引导/出题 | discussing: 学伴讨论 | answering: 学生答题 | judging: 教师判题 | summarizing: 生成总结 | finished: 已结束';

-- 4. interaction_records 表：role 字段注释更新（值扩展为 student/teacher/companion，兼容旧 user/assistant）
COMMENT ON COLUMN interaction_records.role IS 'student（学生）| teacher（教师 Agent）| companion（学伴 Agent）。旧数据 user/assistant 仍兼容';

-- 将旧数据 role 归一化：user -> student, assistant -> teacher
UPDATE interaction_records SET role = 'student' WHERE role = 'user';
UPDATE interaction_records SET role = 'teacher' WHERE role = 'assistant';

-- session_id 长度从 36 扩展到 64（兼容更长的会话 ID）
ALTER TABLE interaction_records ALTER COLUMN session_id TYPE varchar(64);
ALTER TABLE answer_records ALTER COLUMN session_id TYPE varchar(64);
ALTER TABLE learning_summaries ALTER COLUMN session_id TYPE varchar(64);

-- 5. learning_summaries 表：新增课堂表现结构化字段
ALTER TABLE learning_summaries
  ADD COLUMN IF NOT EXISTS question_total integer NOT NULL DEFAULT 0;

ALTER TABLE learning_summaries
  ADD COLUMN IF NOT EXISTS question_correct integer NOT NULL DEFAULT 0;

ALTER TABLE learning_summaries
  ADD COLUMN IF NOT EXISTS discussion_summary text;

ALTER TABLE learning_summaries
  ADD COLUMN IF NOT EXISTS overall_summary text;

COMMENT ON COLUMN learning_summaries.question_total IS '本次课堂答题总数';
COMMENT ON COLUMN learning_summaries.question_correct IS '本次课堂答对数';
COMMENT ON COLUMN learning_summaries.discussion_summary IS '学伴讨论情况摘要';
COMMENT ON COLUMN learning_summaries.overall_summary IS '教师 Agent 生成的完整课堂表现总结';

-- 兼容旧数据：strengths/weaknesses/suggestions 在新版允许默认空串
ALTER TABLE learning_summaries ALTER COLUMN strengths SET DEFAULT '';
ALTER TABLE learning_summaries ALTER COLUMN weaknesses SET DEFAULT '';
ALTER TABLE learning_summaries ALTER COLUMN suggestions SET DEFAULT '';

-- ============================================================
-- 迁移完成
-- ============================================================
