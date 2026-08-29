import type { ChatMessage, LlmConfig, LlmRequestOptions } from './types';

/** 默认超时：120 秒 */
export const DEFAULT_LLM_TIMEOUT_MS = 120_000;

/**
 * 把用户填写的 baseUrl 规整成完整的 chat/completions 地址。
 *
 * - 已以 /chat/completions 结尾 → 原样使用
 * - 路径中已含版本段（/v1、/api/v3、/v1beta 等）→ 补 /chat/completions
 * - 其余（如 https://api.deepseek.com）→ 补 /v1/chat/completions
 */
export function resolveChatCompletionsUrl(raw: string): string {
  let base = (raw ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\/chat\/completions$/i.test(base)) return base;
  if (!/\/v\d+[a-z0-9]*(\/|$)/i.test(base)) base = `${base}/v1`;
  return `${base}/chat/completions`;
}

export function isLlmConfigured(config: LlmConfig | null | undefined): boolean {
  return !!config && !!config.baseUrl?.trim() && !!config.model?.trim();
}

interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}

function buildRequest(
  messages: ChatMessage[],
  config: LlmConfig,
  options: LlmRequestOptions,
  stream: boolean
): BuiltRequest {
  const url = resolveChatCompletionsUrl(config.baseUrl);
  if (!url) {
    throw new Error('未配置大模型接口地址（Base URL）');
  }

  const useVisionModel = options.needsVision && !!config.visionModel?.trim();
  const model = options.model || (useVisionModel ? config.visionModel!.trim() : config.model.trim());
  if (!model) {
    throw new Error('未配置大模型名称（Model）');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = (config.apiKey ?? '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (config.extraHeaders && typeof config.extraHeaders === 'object') {
    for (const [key, value] of Object.entries(config.extraHeaders)) {
      if (key && value) headers[key] = String(value);
    }
  }

  const body: Record<string, unknown> = { model, messages, stream };
  const temperature = options.temperature ?? config.temperature;
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    body.temperature = temperature;
  }
  if (options.disableThinking) {
    // 关闭思考型模型（Qwen3 等）的思考模式（vLLM / ModelScope 风格参数，不支持的网关会忽略）
    body.chat_template_kwargs = { enable_thinking: false };
  }
  const maxTokens = options.maxTokens ?? config.maxTokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = maxTokens;
  }

  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return { url, headers, body, timeoutMs };
}

async function httpError(res: Response): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 800);
  } catch {
    // ignore
  }
  return Promise.reject(
    new Error(`大模型接口返回 HTTP ${res.status} ${res.statusText}${detail ? `：${detail}` : ''}`)
  );
}

/** 逐行解析 SSE，产出每条 data 载荷 */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        yield payload;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * 流式对话：逐段产出增量文本。
 * 只取 delta.content，自动忽略推理类模型的 reasoning_content。
 */
export async function* streamChat(
  messages: ChatMessage[],
  config: LlmConfig,
  options: LlmRequestOptions = {}
): AsyncGenerator<string> {
  const { url, headers, body, timeoutMs } = buildRequest(messages, config, options, true);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) await httpError(res);
    if (!res.body) throw new Error('大模型接口未返回数据流');

    for await (const payload of readSse(res.body)) {
      let json: {
        choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
        error?: { message?: string };
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      if (json.error?.message) {
        throw new Error(`大模型返回错误：${json.error.message}`);
      }

      const delta = json.choices?.[0]?.delta;
      if (delta && typeof delta.content === 'string' && delta.content) {
        yield delta.content;
      }

      if (json.choices?.[0]?.finish_reason) return;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`大模型请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** 非流式对话：一次性拿到完整文本 */
export async function invokeChat(
  messages: ChatMessage[],
  config: LlmConfig,
  options: LlmRequestOptions = {}
): Promise<string> {
  const { url, headers, body, timeoutMs } = buildRequest(messages, config, options, false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) await httpError(res);

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: { message?: string };
    };

    if (json.error?.message) {
      throw new Error(`大模型返回错误：${json.error.message}`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
        .join('');
    }
    return '';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`大模型请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** 列出模型（部分网关支持），失败时返回 null */
export async function listModels(config: LlmConfig): Promise<string[] | null> {
  const base = resolveChatCompletionsUrl(config.baseUrl);
  if (!base) return null;
  const modelsUrl = base.replace(/\/chat\/completions$/i, '/models');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = (config.apiKey ?? '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (config.extraHeaders && typeof config.extraHeaders === 'object') {
    for (const [key, value] of Object.entries(config.extraHeaders)) {
      if (key && value) headers[key] = String(value);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(modelsUrl, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!Array.isArray(json.data)) return null;
    return json.data.map((m) => m.id).filter((id): id is string => !!id);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
