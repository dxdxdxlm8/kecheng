-- ============================================================
-- 部署环境（product 库）数据重置脚本
-- 作用：1) 清空四类运行数据（互动消息/学习总结/答题记录/会话状态）
--       2) 将学生名单替换为当前开发环境的 20 名学生
-- 幂等：可重复执行。请在生产 Supabase SQL Editor 中执行。
-- ============================================================

BEGIN;

-- ============ 1) 清空四类运行数据 ============
DELETE FROM interaction_records;
DELETE FROM learning_summaries;
DELETE FROM answer_records;
DELETE FROM session_states;

-- ============ 2) 清空现有学生（含被清理的运行数据，故可安全删除） ============
DELETE FROM students;

-- ============ 3) 插入开发环境的 20 名学生 ============
INSERT INTO students (name, companion_level, created_at) VALUES
('贝稼敏','normal', now()),
('蔡紫嫣','normal', now() + interval '1 second'),
('冯乐心','normal', now() + interval '2 second'),
('胡思璇','normal', now() + interval '3 second'),
('金梦瑶','normal', now() + interval '4 second'),
('柯南屹','normal', now() + interval '5 second'),
('李艺萱','normal', now() + interval '6 second'),
('刘泽雅','normal', now() + interval '7 second'),
('鲁霖霖','normal', now() + interval '8 second'),
('陆馨玥','normal', now() + interval '9 second'),
('骆佳莹','normal', now() + interval '10 second'),
('商钰沁','normal', now() + interval '11 second'),
('沈彦妃','normal', now() + interval '12 second'),
('万想','normal', now() + interval '13 second'),
('吴梦辰','normal', now() + interval '14 second'),
('李元昊','normal', now() + interval '15 second'),
('刘恩临','normal', now() + interval '16 second'),
('彭浩卿','normal', now() + interval '17 second'),
('余胤杰','normal', now() + interval '18 second'),
('张梓歆','normal', now() + interval '19 second');

COMMIT;