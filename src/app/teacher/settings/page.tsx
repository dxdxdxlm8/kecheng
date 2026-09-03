'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Save,
  Sparkles,
  Wand2,
  XCircle,
} from 'lucide-react';

interface LlmFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  temperature: string;
  maxTokens: string;
  timeoutMs: string;
  extraHeaders: string;
}

interface StorageFormState {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
}

const EMPTY_LLM: LlmFormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  visionModel: '',
  temperature: '',
  maxTokens: '',
  timeoutMs: '',
  extraHeaders: '',
};

const EMPTY_STORAGE: StorageFormState = {
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  accessKey: '',
  secretKey: '',
  publicBaseUrl: '',
  forcePathStyle: true,
};

/** 语音识别：学生端语音输入转文字用，独立于大模型服务商 */
interface AsrFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const EMPTY_ASR: AsrFormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
};

/** 常见 OpenAI 兼容服务的快捷填充 */
const PROVIDER_PRESETS = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
  },
  {
    name: '火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615',
    visionModel: 'doubao-1-5-vision-pro-32k',
  },
  {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.6',
    visionModel: 'glm-4v-plus',
  },
  {
    name: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-max-latest',
  },
  {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    visionModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
  },
  {
    name: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    visionModel: 'llava:latest',
  },
];

type TestResult = { ok: boolean; message: string; models?: string[] | null };

export default function TeacherSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingAsr, setTestingAsr] = useState(false);
  const [testingStorage, setTestingStorage] = useState(false);
  const [llmTest, setLlmTest] = useState<TestResult | null>(null);
  const [asrTest, setAsrTest] = useState<TestResult | null>(null);
  const [storageTest, setStorageTest] = useState<TestResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [showAsr, setShowAsr] = useState(true);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [llm, setLlm] = useState<LlmFormState>(EMPTY_LLM);
  const [asr, setAsr] = useState<AsrFormState>(EMPTY_ASR);
  const [storage, setStorage] = useState<StorageFormState>(EMPTY_STORAGE);
  const [meta, setMeta] = useState<{
    resolvedUrl: string;
    apiKeySet: boolean;
    updatedAt: string | null;
  }>({ resolvedUrl: '', apiKeySet: false, updatedAt: null });

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '读取失败');
      const data = json.data;
      setLlm({
        baseUrl: data.llm.baseUrl ?? '',
        apiKey: data.llm.apiKey ?? '',
        model: data.llm.model ?? '',
        visionModel: data.llm.visionModel ?? '',
        temperature: data.llm.temperature === null ? '' : String(data.llm.temperature),
        maxTokens: data.llm.maxTokens === null ? '' : String(data.llm.maxTokens),
        timeoutMs: data.llm.timeoutMs === null ? '' : String(data.llm.timeoutMs),
        extraHeaders: data.llm.extraHeaders ? JSON.stringify(data.llm.extraHeaders, null, 2) : '',
      });
      setAsr({
        baseUrl: data.asr?.baseUrl ?? '',
        apiKey: data.asr?.apiKey ?? '',
        model: data.asr?.model ?? '',
      });
      setStorage({
        endpoint: data.storage.endpoint ?? '',
        region: data.storage.region ?? 'us-east-1',
        bucket: data.storage.bucket ?? '',
        accessKey: data.storage.accessKey ?? '',
        secretKey: data.storage.secretKey ?? '',
        publicBaseUrl: data.storage.publicBaseUrl ?? '',
        forcePathStyle: data.storage.forcePathStyle !== false,
      });
      setMeta({
        resolvedUrl: data.llm.resolvedUrl ?? '',
        apiKeySet: !!data.llm.apiKeySet,
        updatedAt: data.updatedAt ?? null,
      });
      setShowStorage(!!data.storage.endpoint);
    } catch (err) {
      console.error(err);
      notify('err', err instanceof Error ? err.message : '读取系统配置失败');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!localStorage.getItem('teacher_token')) {
      router.push('/teacher/login');
      return;
    }
    fetchSettings();
  }, [router, fetchSettings]);

  const parseNumber = (value: string): number | null => {
    if (value.trim() === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const buildPayload = () => {
    let extraHeaders: Record<string, string> | null = null;
    if (llm.extraHeaders.trim()) {
      try {
        const parsed = JSON.parse(llm.extraHeaders);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          extraHeaders = parsed as Record<string, string>;
        } else {
          throw new Error('请求头必须是 JSON 对象');
        }
      } catch {
        throw new Error('额外请求头不是合法的 JSON 对象');
      }
    }

    return {
      llm: {
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        visionModel: llm.visionModel,
        temperature: parseNumber(llm.temperature),
        maxTokens: parseNumber(llm.maxTokens),
        timeoutMs: parseNumber(llm.timeoutMs),
        extraHeaders,
      },
      asr: {
        baseUrl: asr.baseUrl,
        apiKey: asr.apiKey,
        model: asr.model,
      },
      storage: {
        endpoint: storage.endpoint,
        region: storage.region,
        bucket: storage.bucket,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        publicBaseUrl: storage.publicBaseUrl,
        forcePathStyle: storage.forcePathStyle,
      },
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '保存失败');
      notify('ok', '配置已保存，立即生效');
      await fetchSettings();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (scope: 'llm' | 'asr' | 'storage') => {
    const setRunning =
      scope === 'llm' ? setTestingLlm : scope === 'asr' ? setTestingAsr : setTestingStorage;
    const setResult =
      scope === 'llm' ? setLlmTest : scope === 'asr' ? setAsrTest : setStorageTest;
    setRunning(true);
    setResult(null);
    try {
      const payload = buildPayload();
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, settings: payload }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || '连通性测试失败');
      }
      const message =
        scope === 'llm'
          ? `连接成功 · 模型 ${json.model} · 耗时 ${json.latencyMs}ms${json.sample ? ` · 回复「${json.sample}」` : ''}`
          : scope === 'asr'
            ? `连接成功 · 模型 ${json.model} · 耗时 ${json.latencyMs}ms${json.note ? ` · ${json.note}` : ''}`
            : '存储可用，探针文件已写入并生成访问链接';
      setResult({ ok: true, message, models: json.availableModels ?? null });
      if (scope === 'llm' && Array.isArray(json.availableModels)) {
        setAvailableModels(json.availableModels);
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : '连通性测试失败' });
    } finally {
      setRunning(false);
    }
  };

  const applyPreset = (preset: (typeof PROVIDER_PRESETS)[number]) => {
    setLlm((prev) => ({
      ...prev,
      baseUrl: preset.baseUrl,
      model: prev.model || preset.model,
      visionModel: prev.visionModel || preset.visionModel,
    }));
  };

  const llmReady = !!llm.baseUrl.trim() && !!llm.model.trim();

  const inputClass =
    'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm ${
              toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {toast.text}
          </div>
        </div>
      )}

      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/teacher/dashboard')}
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-slate-600" />
                <h1 className="text-lg font-bold text-gray-900">系统设置</h1>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-900 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存配置
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="text-center py-16 text-gray-500 text-sm">加载中...</div>
        ) : (
          <>
            {/* 状态概览 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl p-4 border border-gray-100 shadow">
                <div className="flex items-center gap-2 mb-1">
                  {llmReady ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-amber-500" />
                  )}
                  <span className="text-sm font-medium text-gray-900">大模型</span>
                </div>
                <p className="text-xs text-gray-500">
                  {llmReady ? `已配置 ${llm.model}` : '未配置，学生端对话不可用'}
                </p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100 shadow">
                <div className="flex items-center gap-2 mb-1">
                  {storage.endpoint && storage.bucket ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-gray-400" />
                  )}
                  <span className="text-sm font-medium text-gray-900">对象存储</span>
                </div>
                <p className="text-xs text-gray-500">
                  {storage.endpoint && storage.bucket
                    ? '已配置，图片作答可用'
                    : '未配置，图片作答功能不可用'}
                </p>
              </div>
            </div>

            {/* 大模型配置 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-slate-600" />
                <h2 className="font-semibold text-gray-900">大模型配置</h2>
                <span className="text-xs text-gray-400 ml-auto">
                  {meta.updatedAt
                    ? `更新于 ${new Date(meta.updatedAt).toLocaleString('zh-CN')}`
                    : '尚未保存'}
                </span>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">快捷填充</label>
                  <div className="flex flex-wrap gap-2">
                    {PROVIDER_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border border-gray-200 text-gray-600 hover:border-slate-400 hover:text-slate-800 transition"
                      >
                        <Sparkles className="w-3 h-3" />
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    点击后自动填入接口地址与推荐模型，密钥仍需自行填写。系统对接标准 OpenAI Chat
                    Completions 协议，任何兼容该协议的模型服务均可使用。
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    接口地址（Base URL）<span className="text-red-500">*</span>
                  </label>
                  <input
                    value={llm.baseUrl}
                    onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
                    className={inputClass}
                    placeholder="https://api.deepseek.com/v1"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    实际请求：<span className="text-gray-600">{meta.resolvedUrl || '—'}</span>
                    （路径中不含版本号时会自动补 /v1）
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    API Key / Token
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={llm.apiKey}
                      onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
                      className={`${inputClass} pr-10`}
                      placeholder="sk-..."
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    {meta.apiKeySet
                      ? '密钥已保存（出于安全只显示掩码，不修改则保持原值）'
                      : '本地部署的无鉴权网关可留空'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      模型名称（Model）<span className="text-red-500">*</span>
                    </label>
                    <input
                      value={llm.model}
                      onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                      className={inputClass}
                      placeholder="deepseek-chat"
                      list="available-models"
                    />
                    {availableModels && availableModels.length > 0 && (
                      <datalist id="available-models">
                        {availableModels.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      视觉模型（可选）
                    </label>
                    <input
                      value={llm.visionModel}
                      onChange={(e) => setLlm({ ...llm, visionModel: e.target.value })}
                      className={inputClass}
                      placeholder="用于识别图片作答，留空则沿用主模型"
                      list="available-models"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
                >
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  />
                  高级参数
                </button>

                {showAdvanced && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        温度 Temperature
                      </label>
                      <input
                        value={llm.temperature}
                        onChange={(e) => setLlm({ ...llm, temperature: e.target.value })}
                        className={inputClass}
                        placeholder="0.3"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        最大 Token
                      </label>
                      <input
                        value={llm.maxTokens}
                        onChange={(e) => setLlm({ ...llm, maxTokens: e.target.value })}
                        className={inputClass}
                        placeholder="不限制"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        超时（毫秒）
                      </label>
                      <input
                        value={llm.timeoutMs}
                        onChange={(e) => setLlm({ ...llm, timeoutMs: e.target.value })}
                        className={inputClass}
                        placeholder="120000"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        额外请求头（JSON 对象，可选）
                      </label>
                      <textarea
                        value={llm.extraHeaders}
                        onChange={(e) => setLlm({ ...llm, extraHeaders: e.target.value })}
                        className={`${inputClass} font-mono`}
                        rows={3}
                        placeholder={'{\n  "X-Api-Key": "..."\n}'}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleTest('llm')}
                    disabled={testingLlm || !llmReady}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    {testingLlm ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    测试连接
                  </button>
                  <span className="text-xs text-gray-400">
                    将用当前表单值发送一条测试消息（不会覆盖已保存配置）
                  </span>
                </div>

                {llmTest && (
                  <div
                    className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                      llmTest.ok
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {llmTest.ok ? (
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    )}
                    <span className="break-all">{llmTest.message}</span>
                  </div>
                )}
              </div>
            </section>

            {/* 对象存储配置 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-slate-600" />
                  <h2 className="font-semibold text-gray-900">对象存储配置</h2>
                  <span className="text-xs text-gray-400">（可选，仅图片作答需要）</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStorage((v) => !v)}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  {showStorage ? '收起' : '展开配置'}
                </button>
              </div>

              {showStorage && (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Endpoint
                      </label>
                      <input
                        value={storage.endpoint}
                        onChange={(e) => setStorage({ ...storage, endpoint: e.target.value })}
                        className={inputClass}
                        placeholder="https://cos.ap-guangzhou.myqcloud.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                      <input
                        value={storage.region}
                        onChange={(e) => setStorage({ ...storage, region: e.target.value })}
                        className={inputClass}
                        placeholder="ap-guangzhou"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bucket</label>
                      <input
                        value={storage.bucket}
                        onChange={(e) => setStorage({ ...storage, bucket: e.target.value })}
                        className={inputClass}
                        placeholder="my-bucket-1234567890"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        公开访问域名（可选）
                      </label>
                      <input
                        value={storage.publicBaseUrl}
                        onChange={(e) => setStorage({ ...storage, publicBaseUrl: e.target.value })}
                        className={inputClass}
                        placeholder="https://cdn.example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Access Key
                      </label>
                      <input
                        value={storage.accessKey}
                        onChange={(e) => setStorage({ ...storage, accessKey: e.target.value })}
                        className={inputClass}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Secret Key
                      </label>
                      <input
                        type="password"
                        value={storage.secretKey}
                        onChange={(e) => setStorage({ ...storage, secretKey: e.target.value })}
                        className={inputClass}
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={storage.forcePathStyle}
                      onChange={(e) =>
                        setStorage({ ...storage, forcePathStyle: e.target.checked })
                      }
                      className="rounded border-gray-300"
                    />
                    使用 path-style（bucket 放在路径中，MinIO / 自建服务通常开启）
                  </label>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTest('storage')}
                      disabled={testingStorage || !storage.endpoint || !storage.bucket}
                      className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
                    >
                      {testingStorage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4" />
                      )}
                      测试存储
                    </button>
                  </div>

                  {storageTest && (
                    <div
                      className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                        storageTest.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {storageTest.ok ? (
                        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      )}
                      <span className="break-all">{storageTest.message}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 语音识别配置 */}
            <section className="bg-white rounded-xl border border-gray-100 shadow overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-slate-600" />
                  <h2 className="font-semibold text-gray-900">语音识别配置</h2>
                  <span className="text-xs text-gray-400">（学生端语音输入转文字）</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAsr((v) => !v)}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  {showAsr ? '收起' : '展开配置'}
                </button>
              </div>

              {showAsr && (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        接口地址
                      </label>
                      <input
                        value={asr.baseUrl}
                        onChange={(e) => setAsr({ ...asr, baseUrl: e.target.value })}
                        className={inputClass}
                        placeholder="https://api.siliconflow.cn/v1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        模型名称
                      </label>
                      <input
                        value={asr.model}
                        onChange={(e) => setAsr({ ...asr, model: e.target.value })}
                        className={inputClass}
                        placeholder="FunAudioLLM/SenseVoiceSmall"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                    <input
                      type="password"
                      value={asr.apiKey}
                      onChange={(e) => setAsr({ ...asr, apiKey: e.target.value })}
                      className={inputClass}
                      placeholder="sk-..."
                      autoComplete="off"
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      默认使用硅基流动 SenseVoiceSmall（国内直连，有免费额度）。未填写 Key
                      时学生端不显示语音按钮。
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleTest('asr')}
                      disabled={testingAsr || !asr.baseUrl.trim() || !asr.model.trim()}
                      className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
                    >
                      {testingAsr ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4" />
                      )}
                      测试语音识别
                    </button>
                    <span className="text-xs text-gray-400">
                      发送一段测试音验证接口与 Key（不含语音，返回空文本属正常）
                    </span>
                  </div>

                  {asrTest && (
                    <div
                      className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                        asrTest.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {asrTest.ok ? (
                        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      )}
                      <span className="break-all">{asrTest.message}</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            <p className="text-xs text-gray-400 leading-relaxed pb-4">
              说明：配置优先读取数据库中的「系统设置」，未配置时回退读取服务端环境变量（LLM_BASE_URL、
              LLM_API_KEY、LLM_MODEL、ASR_BASE_URL、ASR_API_KEY、ASR_MODEL 等）。数据库地址与密钥仍通过
              .env.local 中的 SUPABASE_URL / SUPABASE_ANON_KEY 提供，不在此处填写。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
