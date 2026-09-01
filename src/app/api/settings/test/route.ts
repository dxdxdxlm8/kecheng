import { NextRequest, NextResponse } from 'next/server';
import { getSystemSettings } from '@/lib/settings';
import {
  invokeChat,
  isAsrConfigured,
  isLlmConfigured,
  listModels,
  resolveAudioTranscriptionsUrl,
  resolveChatCompletionsUrl,
  transcribeAudio,
} from '@/lib/llm/client';
import type { AsrConfig, LlmConfig } from '@/lib/llm/types';
import { isStorageConfigured, testStorageConnection, type StorageConfig } from '@/lib/storage/object-storage';

const MASK_CHAR = '•';

function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

interface TestRequestBody {
  scope?: 'llm' | 'asr' | 'storage';
  /** 传入时使用表单值测试（先测后存），否则使用已保存配置 */
  settings?: { llm?: Partial<LlmConfig>; asr?: Partial<AsrConfig>; storage?: Partial<StorageConfig> };
}

/**
 * 生成一段极短的测试音（440Hz 正弦，16kHz 单声道 WAV）。
 * 只用来验证接口连通性与鉴权，不含语音内容，因此识别结果通常为空——这属于正常现象。
 */
function makeTestToneWav(seconds = 0.3, sampleRate = 16_000, freq = 440): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byteRate
  buf.writeUInt16LE(2, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // 位深
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const value = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    buf.writeInt16LE(Math.round(value * 8000), 44 + i * 2);
  }
  return buf;
}

/**
 * 连通性自检。
 * body: { scope: 'llm' | 'storage', settings?: {...} }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TestRequestBody;

    const requested = body.scope ?? 'llm';
    const scope = requested === 'storage' || requested === 'asr' ? requested : 'llm';
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

    if (scope === 'asr') {
      const patched: Partial<AsrConfig> = patch.asr ?? {};
      const config: AsrConfig = {
        baseUrl: (patched.baseUrl ?? stored.asr?.baseUrl ?? '').trim(),
        apiKey: isMasked(patched.apiKey)
          ? (stored.asr?.apiKey ?? '')
          : ((patched.apiKey ?? stored.asr?.apiKey ?? '') as string).trim(),
        model: (patched.model ?? stored.asr?.model ?? '').trim(),
      };

      if (!isAsrConfigured(config)) {
        return NextResponse.json(
          { ok: false, error: '请先填写语音识别的接口地址和模型名称' },
          { status: 400 }
        );
      }
      if (!config.apiKey.trim()) {
        return NextResponse.json(
          { ok: false, error: '请先填写语音识别的 API Key' },
          { status: 400 }
        );
      }

      const wav = makeTestToneWav();
      const startedAt = Date.now();
      const text = await transcribeAudio(
        {
          blob: new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
          filename: 'connectivity-test.wav',
        },
        config,
        { timeoutMs: 30_000 }
      );

      return NextResponse.json({
        ok: true,
        resolvedUrl: resolveAudioTranscriptionsUrl(config.baseUrl),
        model: config.model,
        latencyMs: Date.now() - startedAt,
        text,
        // 测试音不含语音，返回空文本是预期结果
        note: text ? undefined : '接口连通正常（测试音不含语音内容，返回空文本属预期）',
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
