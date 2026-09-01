import { DEFAULT_LLM_TIMEOUT_MS } from './llm/client';
import type { AsrConfig, LlmConfig } from './llm/types';
import type { StorageConfig } from './storage/object-storage';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/** 语音识别默认值：硅基流动 SenseVoiceSmall（国内直连，有免费额度） */
export const DEFAULT_ASR_BASE_URL = 'https://api.siliconflow.cn/v1';
export const DEFAULT_ASR_MODEL = 'FunAudioLLM/SenseVoiceSmall';

export interface SystemSettings {
  llm: LlmConfig;
  asr: AsrConfig;
  storage: StorageConfig;
  updatedAt: string | null;
  /** database: 来自 system_settings 表 | env: 来自环境变量 | empty: 未配置 */
  source: 'database' | 'env' | 'empty';
}

export const SETTINGS_TABLE = 'system_settings';

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return null;
}

function parseHeaders(value: unknown): Record<string, string> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, string>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.trim() === '' ? null : text;
}

function envNumber(name: string): number | null {
  return numOrNull(process.env[name]);
}

function settingsFromEnv(): SystemSettings {
  return {
    llm: {
      baseUrl: process.env.LLM_BASE_URL ?? '',
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? '',
      visionModel: process.env.LLM_VISION_MODEL ?? '',
      temperature: envNumber('LLM_TEMPERATURE'),
      maxTokens: envNumber('LLM_MAX_TOKENS'),
      timeoutMs: envNumber('LLM_TIMEOUT_MS') ?? DEFAULT_LLM_TIMEOUT_MS,
      extraHeaders: parseHeaders(process.env.LLM_EXTRA_HEADERS),
    },
    asr: {
      baseUrl: process.env.ASR_BASE_URL || DEFAULT_ASR_BASE_URL,
      apiKey: process.env.ASR_API_KEY ?? '',
      model: process.env.ASR_MODEL || DEFAULT_ASR_MODEL,
    },
    storage: {
      endpoint: process.env.STORAGE_ENDPOINT ?? '',
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      bucket: process.env.STORAGE_BUCKET ?? '',
      accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
      secretKey: process.env.STORAGE_SECRET_KEY ?? '',
      publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? '',
      forcePathStyle: boolOrNull(process.env.STORAGE_FORCE_PATH_STYLE) ?? true,
    },
    updatedAt: null,
    source: 'env',
  };
}

interface SettingsRow {
  llm_base_url?: string | null;
  llm_api_key?: string | null;
  llm_model?: string | null;
  llm_vision_model?: string | null;
  llm_temperature?: number | string | null;
  llm_max_tokens?: number | string | null;
  llm_timeout_ms?: number | string | null;
  llm_extra_headers?: string | Record<string, string> | null;
  asr_base_url?: string | null;
  asr_api_key?: string | null;
  asr_model?: string | null;
  storage_endpoint?: string | null;
  storage_region?: string | null;
  storage_bucket?: string | null;
  storage_access_key?: string | null;
  storage_secret_key?: string | null;
  storage_public_base_url?: string | null;
  storage_force_path_style?: boolean | null;
  updated_at?: string | null;
}

function mergeRow(row: SettingsRow, base: SystemSettings): SystemSettings {
  const merged: SystemSettings = {
    llm: {
      baseUrl: strOrNull(row.llm_base_url) ?? base.llm.baseUrl,
      apiKey: strOrNull(row.llm_api_key) ?? base.llm.apiKey,
      model: strOrNull(row.llm_model) ?? base.llm.model,
      visionModel: strOrNull(row.llm_vision_model) ?? base.llm.visionModel,
      temperature: numOrNull(row.llm_temperature) ?? base.llm.temperature,
      maxTokens: numOrNull(row.llm_max_tokens) ?? base.llm.maxTokens,
      timeoutMs: numOrNull(row.llm_timeout_ms) ?? base.llm.timeoutMs,
      extraHeaders: parseHeaders(row.llm_extra_headers) ?? base.llm.extraHeaders,
    },
    asr: {
      baseUrl: strOrNull(row.asr_base_url) ?? base.asr.baseUrl,
      apiKey: strOrNull(row.asr_api_key) ?? base.asr.apiKey,
      model: strOrNull(row.asr_model) ?? base.asr.model,
    },
    storage: {
      endpoint: strOrNull(row.storage_endpoint) ?? base.storage.endpoint,
      region: strOrNull(row.storage_region) ?? base.storage.region,
      bucket: strOrNull(row.storage_bucket) ?? base.storage.bucket,
      accessKey: strOrNull(row.storage_access_key) ?? base.storage.accessKey,
      secretKey: strOrNull(row.storage_secret_key) ?? base.storage.secretKey,
      publicBaseUrl: strOrNull(row.storage_public_base_url) ?? base.storage.publicBaseUrl,
      forcePathStyle: boolOrNull(row.storage_force_path_style) ?? base.storage.forcePathStyle,
    },
    updatedAt: row.updated_at ?? null,
    source: 'database',
  };

  if (!merged.llm.baseUrl && !merged.llm.model && !merged.storage.endpoint) {
    merged.source = 'empty';
  }

  return merged;
}

const CACHE_TTL_MS = 20_000;
let cache: { value: SystemSettings; expireAt: number } | null = null;

/** 清除配置缓存（保存设置后调用） */
export function invalidateSettingsCache(): void {
  cache = null;
}

/**
 * 读取系统配置：优先 system_settings 表，回退环境变量。
 * 表不存在或数据库不可用时静默回退，保证应用可用。
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();
  if (cache && cache.expireAt > now) return cache.value;

  const fallback = settingsFromEnv();

  let value: SystemSettings;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(SETTINGS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      // 42P01: 表不存在 —— 尚未执行迁移脚本
      if (error.code !== '42P01') {
        console.error('[settings] 读取系统配置失败:', error.message);
      }
      value = fallback;
    } else if (data && data.length > 0) {
      value = mergeRow(data[0] as SettingsRow, fallback);
    } else {
      value = fallback;
    }
  } catch (error) {
    console.error('[settings] 读取系统配置异常:', error);
    value = fallback;
  }

  cache = { value, expireAt: now + CACHE_TTL_MS };
  return value;
}

export interface SettingsPayload {
  llm: LlmConfig;
  asr: AsrConfig;
  storage: StorageConfig;
}

/** 写入系统配置（单条记录，存在则更新） */
export async function saveSystemSettings(payload: SettingsPayload): Promise<SystemSettings> {
  const supabase = getSupabaseClient();

  const row = {
    llm_base_url: payload.llm.baseUrl?.trim() || null,
    llm_api_key: payload.llm.apiKey?.trim() || null,
    llm_model: payload.llm.model?.trim() || null,
    llm_vision_model: payload.llm.visionModel?.trim() || null,
    llm_temperature: numOrNull(payload.llm.temperature),
    llm_max_tokens: numOrNull(payload.llm.maxTokens),
    llm_timeout_ms: numOrNull(payload.llm.timeoutMs),
    llm_extra_headers: payload.llm.extraHeaders
      ? JSON.stringify(payload.llm.extraHeaders)
      : null,
    storage_endpoint: payload.storage.endpoint?.trim() || null,
    storage_region: payload.storage.region?.trim() || null,
    storage_bucket: payload.storage.bucket?.trim() || null,
    storage_access_key: payload.storage.accessKey?.trim() || null,
    storage_secret_key: payload.storage.secretKey?.trim() || null,
    storage_public_base_url: payload.storage.publicBaseUrl?.trim() || null,
    storage_force_path_style: boolOrNull(payload.storage.forcePathStyle),
    updated_at: new Date().toISOString(),
  };

  // 语音识别字段：未执行 asr_* 迁移时单独降级，避免连累大模型/存储配置保存失败
  const withAsr = {
    ...row,
    asr_base_url: payload.asr?.baseUrl?.trim() || null,
    asr_api_key: payload.asr?.apiKey?.trim() || null,
    asr_model: payload.asr?.model?.trim() || null,
  };

  const { data: existing } = await supabase
    .from(SETTINGS_TABLE)
    .select('id')
    .limit(1);

  type PgError = { message: string; code?: string } | null;

  const runSave = async (target: Record<string, unknown>): Promise<PgError> => {
    if (existing && existing.length > 0) {
      const res = await supabase.from(SETTINGS_TABLE).update(target).eq('id', existing[0].id);
      return res.error as PgError;
    }
    const res = await supabase.from(SETTINGS_TABLE).insert(target);
    return res.error as PgError;
  };

  let error = await runSave(withAsr);

  // 42703: undefined_column —— 数据表还没有 asr_* 列，退回只保存原有字段
  if (error && error.code === '42703') {
    console.warn('[settings] system_settings 缺少 asr_* 字段，已跳过语音识别配置持久化');
    error = await runSave(row);
  }

  if (error) {
    throw new Error(`保存系统配置失败：${error.message}`);
  }

  invalidateSettingsCache();
  return getSystemSettings();
}
