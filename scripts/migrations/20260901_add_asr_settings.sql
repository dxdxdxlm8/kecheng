-- 学生端语音输入功能：语音识别（ASR）配置字段
-- 执行方式：登录 Supabase Dashboard → SQL Editor → New query → 粘贴 → Run
--
-- 说明：不执行本脚本也能用，语音识别会回退到环境变量（ASR_BASE_URL / ASR_API_KEY / ASR_MODEL）
--       或内置默认值；但配置无法在系统设置页保存，刷新后会丢失。
ALTER TABLE system_settings
ADD COLUMN IF NOT EXISTS asr_base_url TEXT,
ADD COLUMN IF NOT EXISTS asr_api_key TEXT,
ADD COLUMN IF NOT EXISTS asr_model TEXT;
