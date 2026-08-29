import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

let envLoaded = false;

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

/**
 * 加载 .env.local / .env。
 * Next.js 自带 env 加载；通过 scripts/dev.sh 的自定义 server 启动时需要手动加载。
 */
function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    loadDotenv({ path: '.env.local' });
    loadDotenv({ path: '.env' });
  } catch {
    // dotenv 不可用时直接依赖宿主环境变量
  }
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = firstDefined(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const anonKey = firstDefined(
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!url) {
    throw new Error('未配置 Supabase 地址：请在 .env.local 中设置 SUPABASE_URL');
  }
  if (!anonKey) {
    throw new Error('未配置 Supabase anon key：请在 .env.local 中设置 SUPABASE_ANON_KEY');
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return firstDefined(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  const key = token ? anonKey : (getSupabaseServiceRoleKey() ?? anonKey);

  const globalOptions: Record<string, unknown> = {};
  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }

  return createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export { loadEnv, getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient };
