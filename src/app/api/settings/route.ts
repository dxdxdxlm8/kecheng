import { NextRequest, NextResponse } from 'next/server';
import {
  getSystemSettings,
  saveSystemSettings,
  type SettingsPayload,
  type SystemSettings,
} from '@/lib/settings';
import { resolveChatCompletionsUrl } from '@/lib/llm/client';
import { isStorageConfigured } from '@/lib/storage/object-storage';

const MASK_CHAR = '•';

function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return MASK_CHAR.repeat(8);
  return `${MASK_CHAR.repeat(8)}${value.slice(-4)}`;
}

function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

export interface SettingsResponse {
  data: {
    llm: {
      baseUrl: string;
      apiKey: string;
      model: string;
      visionModel: string;
      temperature: number | null;
      maxTokens: number | null;
      timeoutMs: number | null;
      extraHeaders: Record<string, string> | null;
      resolvedUrl: string;
      apiKeySet: boolean;
    };
    storage: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      publicBaseUrl: string;
      forcePathStyle: boolean;
      accessKeySet: boolean;
      secretKeySet: boolean;
      configured: boolean;
    };
    updatedAt: string | null;
    source: SystemSettings['source'];
  };
}

function toResponse(settings: SystemSettings): SettingsResponse {
  return {
    data: {
      llm: {
        baseUrl: settings.llm.baseUrl ?? '',
        apiKey: maskSecret(settings.llm.apiKey),
        model: settings.llm.model ?? '',
        visionModel: settings.llm.visionModel ?? '',
        temperature: settings.llm.temperature ?? null,
        maxTokens: settings.llm.maxTokens ?? null,
        timeoutMs: settings.llm.timeoutMs ?? null,
        extraHeaders: settings.llm.extraHeaders ?? null,
        resolvedUrl: resolveChatCompletionsUrl(settings.llm.baseUrl ?? ''),
        apiKeySet: !!settings.llm.apiKey,
      },
      storage: {
        endpoint: settings.storage.endpoint ?? '',
        region: settings.storage.region ?? '',
        bucket: settings.storage.bucket ?? '',
        accessKey: maskSecret(settings.storage.accessKey),
        secretKey: maskSecret(settings.storage.secretKey),
        publicBaseUrl: settings.storage.publicBaseUrl ?? '',
        forcePathStyle: settings.storage.forcePathStyle !== false,
        accessKeySet: !!settings.storage.accessKey,
        secretKeySet: !!settings.storage.secretKey,
        configured: isStorageConfigured(settings.storage),
      },
      updatedAt: settings.updatedAt,
      source: settings.source,
    },
  };
}

export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json(toResponse(settings));
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json({ error: '读取系统配置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<SettingsPayload>;
    const current = await getSystemSettings();

    const llm = body.llm ?? ({} as Partial<SettingsPayload['llm']>);
    const storage = body.storage ?? ({} as Partial<SettingsPayload['storage']>);

    let extraHeaders = current.llm.extraHeaders ?? null;
    if (llm.extraHeaders !== undefined) {
      extraHeaders =
        llm.extraHeaders && Object.keys(llm.extraHeaders).length > 0 ? llm.extraHeaders : null;
    }

    const payload: SettingsPayload = {
      llm: {
        baseUrl: (llm.baseUrl ?? current.llm.baseUrl ?? '').trim(),
        // 掩码值代表"保持不变"
        apiKey: isMasked(llm.apiKey)
          ? (current.llm.apiKey ?? '')
          : ((llm.apiKey ?? current.llm.apiKey ?? '') as string).trim(),
        model: (llm.model ?? current.llm.model ?? '').trim(),
        visionModel: (llm.visionModel ?? current.llm.visionModel ?? '').trim(),
        temperature: llm.temperature === undefined ? (current.llm.temperature ?? null) : llm.temperature,
        maxTokens: llm.maxTokens === undefined ? (current.llm.maxTokens ?? null) : llm.maxTokens,
        timeoutMs: llm.timeoutMs === undefined ? (current.llm.timeoutMs ?? null) : llm.timeoutMs,
        extraHeaders,
      },
      storage: {
        endpoint: (storage.endpoint ?? current.storage.endpoint ?? '').trim(),
        region: (storage.region ?? current.storage.region ?? '').trim(),
        bucket: (storage.bucket ?? current.storage.bucket ?? '').trim(),
        accessKey: isMasked(storage.accessKey)
          ? (current.storage.accessKey ?? '')
          : ((storage.accessKey ?? current.storage.accessKey ?? '') as string).trim(),
        secretKey: isMasked(storage.secretKey)
          ? (current.storage.secretKey ?? '')
          : ((storage.secretKey ?? current.storage.secretKey ?? '') as string).trim(),
        publicBaseUrl: (storage.publicBaseUrl ?? current.storage.publicBaseUrl ?? '').trim(),
        forcePathStyle:
          storage.forcePathStyle === undefined
            ? (current.storage.forcePathStyle ?? true)
            : storage.forcePathStyle,
      },
    };

    const saved = await saveSystemSettings(payload);
    return NextResponse.json(toResponse(saved));
  } catch (error) {
    console.error('Save settings error:', error);
    const message = error instanceof Error ? error.message : '保存系统配置失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
