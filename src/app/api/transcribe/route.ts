import { NextRequest, NextResponse } from 'next/server';
import { getSystemSettings } from '@/lib/settings';
import { isAsrConfigured, resolveAudioTranscriptionsUrl, transcribeAudio } from '@/lib/llm/client';
import type { AsrConfig } from '@/lib/llm/types';

/** 自定义 Node 服务，没有 Serverless 的超时/体积限制，这里只做合理防护 */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * 语音转文字：接收一段录音，转发到 ASR 服务（OpenAI 兼容 /audio/transcriptions）。
 * 入参：multipart/form-data，字段 file = 音频文件
 * 出参：{ text, latencyMs } 或 { error }
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '请求格式错误：缺少音频文件' }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get('file');

    // FormDataEntryValue = File | string，排掉 string 后即为文件
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: '录音内容为空，请重新录一次' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: '录音过长（上限 10MB），请分段录制' }, { status: 413 });
    }

    const settings = await getSystemSettings();
    const config: AsrConfig = {
      baseUrl: settings.asr?.baseUrl ?? '',
      apiKey: settings.asr?.apiKey ?? '',
      model: settings.asr?.model ?? '',
    };

    if (!isAsrConfigured(config)) {
      return NextResponse.json(
        { error: '未配置语音识别服务，请到「系统设置」填写接口地址和模型' },
        { status: 503 }
      );
    }
    if (!config.apiKey.trim()) {
      return NextResponse.json(
        { error: '未配置语音识别 API Key，请到「系统设置」填写' },
        { status: 503 }
      );
    }

    const startedAt = Date.now();
    const text = await transcribeAudio(
      { blob: file, filename: file.name || 'audio.webm' },
      config
    );

    return NextResponse.json({
      text,
      latencyMs: Date.now() - startedAt,
      resolvedUrl: resolveAudioTranscriptionsUrl(config.baseUrl),
      model: config.model,
    });
  } catch (error) {
    console.error('Transcribe error:', error);
    const message = error instanceof Error ? error.message : '语音识别失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
