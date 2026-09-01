/**
 * 通用大模型接入层类型定义
 *
 * 项目已移除对 coze-coding-dev-sdk 的依赖，改为直接对接
 * 任意 OpenAI Chat Completions 兼容接口（DeepSeek / 火山方舟 / 通义 / 智谱 /
 * 硅基流动 / OpenAI / Ollama / 各类自建网关等）。
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImageUrlPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextPart | ImageUrlPart;

export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent;
}

export interface LlmConfig {
  /** 接口地址，可填到 /v1 或完整到 /chat/completions */
  baseUrl: string;
  /** API Key / Token */
  apiKey: string;
  /** 默认文本模型 */
  model: string;
  /** 视觉模型；留空时图片场景回退到 model */
  visionModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  /** 请求超时（毫秒） */
  timeoutMs?: number | null;
  /** 额外请求头，JSON 对象字符串 */
  extraHeaders?: Record<string, string> | null;
}

/**
 * 语音识别（ASR）配置。
 *
 * 与大模型解耦：ASR 走独立的服务商，默认硅基流动 SenseVoiceSmall。
 * 留空的字段会回退到大模型配置的 baseUrl / apiKey，减少重复填写。
 */
export interface AsrConfig {
  /** 接口地址，可填到 /v1 或完整到 /audio/transcriptions */
  baseUrl: string;
  /** API Key；留空时回退到大模型的 apiKey */
  apiKey: string;
  /** 语音识别模型，如 FunAudioLLM/SenseVoiceSmall */
  model: string;
}

export interface LlmRequestOptions {
  /** 覆盖模型 */
  model?: string;
  /** 本次请求是否包含图片，用于选择视觉模型 */
  needsVision?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 关闭思考型模型（Qwen3 等）的思考模式，加快响应并避免思考耗尽输出预算 */
  disableThinking?: boolean;
  /** 外部中断信号 */
  signal?: AbortSignal;
}
