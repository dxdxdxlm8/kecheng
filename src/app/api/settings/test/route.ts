import { NextRequest, NextResponse } from 'next/server';
import { getSystemSettings } from '@/lib/settings';
import { invokeChat, isLlmConfigured, listModels, resolveChatCompletionsUrl } from '@/lib/llm/client';
import type { LlmConfig } from '@/lib/llm/types';
import { isStorageConfigured, testStorageConnection, type StorageConfig } from '@/lib/storage/object-storage';

const MASK_CHAR = '•';

function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

interface TestRequestBody {
  scope?: 'llm' | 'storage';
  /** 传入时使用表单值测试（先测后存），否则使用已保存配置 */
  settings?: { llm?: Partial<LlmConfig>; storage?: Partial<StorageConfig> };
}

/**
 * 连通性自检。
 * body: { scope: 'llm' | 'storage', settings?: {...} }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TestRequestBody;

    const scope = body.scope === 'storage' ? 'storage' : 'llm';
    const stored = await getSystemSettings();
    const patch = body.settings ?? {};

    if (scope === 'llm') {
      const patched: Partial<LlmConfig> = patch.llm ?? {};
      const config: LlmConfig = {
        baseUrl: (patched.baseUrl ?? stored.llm.baseUrl ?? '').trim(),
        apiKey: isMasked(patched.apiKey)
          ? (stored.llm.apiKey ?? '')
          : ((patched.apiKey ?? stored.llm.apiKey ?? '') as string).trim(),
        model: (patched.model ?? stored.llm.model ?? '').trim(),
        visionModel: (patched.visionModel ?? stored.llm.visionModel ?? '').trim(),
        temperature: patched.temperature ?? stored.llm.temperature ?? null,
        maxTokens: patched.maxTokens ?? stored.llm.maxTokens ?? null,
        timeoutMs: patched.timeoutMs ?? stored.llm.timeoutMs ?? null,
        extraHeaders: patched.extraHeaders ?? stored.llm.extraHeaders ?? null,
      };

      if (!isLlmConfigured(config)) {
        return NextResponse.json(
          { ok: false, error: '请先填写接口地址（Base URL）和模型名称（Model）' },
          { status: 400 }
        );
      }

      const startedAt = Date.now();
      const content = await invokeChat(
        [
          { role: 'system', content: '你是一个连通性测试助手。' },
          { role: 'user', content: '请只回复两个字：正常' },
        ],
        config,
        { maxTokens: 16, temperature: 0, timeoutMs: 30_000 }
      );
      const latencyMs = Date.now() - startedAt;

      const models = await listModels(config);

      return NextResponse.json({
        ok: true,
        resolvedUrl: resolveChatCompletionsUrl(config.baseUrl),
        model: config.model,
        latencyMs,
        sample: content.trim().slice(0, 100),
        availableModels: models && models.length > 0 ? models.slice(0, 50) : null,
      });
    }

    const patched: Partial<StorageConfig> = patch.storage ?? {};
    const config: StorageConfig = {
      endpoint: (patched.endpoint ?? stored.storage.endpoint ?? '').trim(),
      region: (patched.region ?? stored.storage.region ?? '').trim(),
      bucket: (patched.bucket ?? stored.storage.bucket ?? '').trim(),
      accessKey: isMasked(patched.accessKey)
        ? (stored.storage.accessKey ?? '')
        : ((patched.accessKey ?? stored.storage.accessKey ?? '') as string).trim(),
      secretKey: isMasked(patched.secretKey)
        ? (stored.storage.secretKey ?? '')
        : ((patched.secretKey ?? stored.storage.secretKey ?? '') as string).trim(),
      publicBaseUrl: (patched.publicBaseUrl ?? stored.storage.publicBaseUrl ?? '').trim(),
      forcePathStyle: patched.forcePathStyle ?? stored.storage.forcePathStyle ?? true,
    };

    if (!isStorageConfigured(config)) {
      return NextResponse.json(
        { ok: false, error: '请先填写对象存储的 Endpoint 和 Bucket' },
        { status: 400 }
      );
    }

    const result = await testStorageConnection(config);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Test settings error:', error);
    const message = error instanceof Error ? error.message : '连通性测试失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
