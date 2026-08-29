-- ============================================================
-- 去 coze 化改造：系统设置表（大模型 / 对象存储配置）
-- 在 Supabase Dashboard 的 SQL Editor 中执行
-- 幂等设计：可重复执行
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 大模型（OpenAI Chat Completions 兼容协议）
  llm_base_url text,
  llm_api_key text,
  llm_model text,
  llm_vision_model text,
  llm_temperature real,
  llm_max_tokens integer,
  llm_timeout_ms integer,
  llm_extra_headers text,

  -- 对象存储（S3 兼容，图片作答用；可留空）
  storage_endpoint text,
  storage_region text,
  storage_bucket text,
  storage_access_key text,
  storage_secret_key text,
  storage_public_base_url text,
  storage_force_path_style boolean DEFAULT true,

  updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE system_settings IS '系统设置：大模型与对象存储配置，由教师端「系统设置」页面维护';
COMMENT ON COLUMN system_settings.llm_base_url IS '接口地址，如 https://api.deepseek.com/v1';
COMMENT ON COLUMN system_settings.llm_api_key IS 'API Key / Token';
COMMENT ON COLUMN system_settings.llm_model IS '默认文本模型名称';
COMMENT ON COLUMN system_settings.llm_vision_model IS '视觉模型，识别图片作答时使用；留空则回退到 llm_model';
COMMENT ON COLUMN system_settings.llm_extra_headers IS '额外请求头，JSON 对象字符串';
COMMENT ON COLUMN system_settings.storage_force_path_style IS '是否使用 path-style（bucket 放路径中），自建/内网服务通常开启';

-- 历史库补列（表已存在但字段缺失时）
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_base_url text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_api_key text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_model text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_vision_model text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_temperature real;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_max_tokens integer;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_timeout_ms integer;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS llm_extra_headers text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_endpoint text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_region text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_access_key text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_secret_key text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_public_base_url text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS storage_force_path_style boolean DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- 若有部署环境之前遗留的 coze 环境变量配置，这里不做清理，
-- 教师端保存一次即可覆盖。

-- ============================================================
-- 迁移完成
-- ============================================================
