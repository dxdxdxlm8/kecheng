/**
 * 学习总结共享生成器
 *
 * 职责：为指定学生的指定会话生成「完整学习总结」，供两处调用：
 * 1. 教师判题链路（chat/route.ts）：三道练习题全部答完时自动后台触发
 * 2. 学生总结页（/api/summary POST）：学生点开总结页时的幂等兜底触发
 *
 * 幂等设计（同一次对话只跑一次）：
 * - 完成标记：learning_summaries 该会话最新一行 discussion_summary 非空 → 已生成，不再重跑
 * - 进行中标记：内存 Map（本项目为单进程 Node 常驻服务，内存态可靠），防止判题触发与学生点开兜底触发并发重跑
 * - 新对话 = 新 session_id，三题答完会插入新占位行并触发生成，天然满足"重新答题后重新生成"
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSystemSettings } from '@/lib/settings';
import { isLlmConfigured, invokeChat } from '@/lib/llm/client';
import type { ChatMessage } from '@/lib/llm/types';

export interface LearningSummaryRow {
  id: string;
  student_id: string;
  session_id: string;
  strengths: string;
  weaknesses: string;
  suggestions: string;
  question_total: number;
  question_correct: number;
  discussion_summary: string | null;
  overall_summary: string | null;
  practice_evaluation: string | null;
  created_at: string;
}

/** 生成中任务表：key = `${student_id}:${session_id}` */
const generatingTasks = new Map<string, Promise<void>>();

function taskKey(studentId: string, sessionId: string): string {
  return `${studentId}:${sessionId}`;
}

// 将 role 归一化为可读标签（与 /api/summary 原 prompt 保持一致）
function roleLabel(role: string): string {
  switch (role) {
    case 'user':
    case 'student':
      return '学生';
    case 'assistant':
    case 'teacher':
      return '教师';
    case 'companion':
      return '小王';
    default:
      return role;
  }
}

/**
 * 查询某学生会话的最新学习总结行（可能为占位行：仅含末题点评与练习评价）
 */
export async function fetchSessionSummary(
  studentId: string,
  sessionId: string
): Promise<LearningSummaryRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('learning_summaries')
    .select('*')
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`查询学习总结失败: ${error.message}`);
  return (data?.[0] as LearningSummaryRow) || null;
}

/** 判断一行总结是否已包含「完整总结」（生成器成功写入的标记） */
export function isSummaryReady(row: LearningSummaryRow | null | undefined): boolean {
  if (!row) return false;
  // 占位行特征：五个正文字段全空；任一非空即视为已生成过完整总结
  return Boolean(
    (row.discussion_summary && row.discussion_summary.trim()) ||
      (row.strengths && row.strengths.trim())
  );
}

/**
 * 幂等触发后台生成学习总结，立即返回状态，不等待生成完成：
 * - 'ready'：该会话已有完整总结，无需再跑
 * - 'generating'：已有同会话任务在跑
 * - 'started'：已启动新的后台生成任务
 * - 'empty'：该会话没有可总结的互动记录（如刚开的新对话）
 */
export async function ensureSummaryGeneration(
  studentId: string,
  sessionId: string
): Promise<'ready' | 'generating' | 'started' | 'empty'> {
  const existing = await fetchSessionSummary(studentId, sessionId);
  if (isSummaryReady(existing)) return 'ready';

  const key = taskKey(studentId, sessionId);
  if (generatingTasks.has(key)) return 'generating';

  // 会话内没有任何互动记录时不启动生成（例如空新对话点总结）
  const supabase = getSupabaseClient();
  const { data: interactions } = await supabase
    .from('interaction_records')
    .select('id')
    .eq('session_id', sessionId)
    .limit(1);
  if (!interactions || interactions.length === 0) return 'empty';

  // 查询间隙可能有并发请求已启动任务，二次检查防止重复跑
  if (generatingTasks.has(key)) return 'generating';

  // 同步登记任务后再启动，杜绝同一事件循环内的并发窗口
  const task = runSummaryGeneration(studentId, sessionId).finally(() => {
    generatingTasks.delete(key);
  });
  generatingTasks.set(key, task);
  // 后台任务失败只记日志，不影响调用方（下次触发可重试）
  task.catch((err) => {
    console.error('[summary-generator] 生成学习总结失败:', err);
  });

  return 'started';
}

/**
 * 实际生成流程（内部）：查会话记录 → LLM 生成 JSON → upsert learning_summaries
 * 保留该行已有的 practice_evaluation（判题链路已写入的练习评价）
 */
async function runSummaryGeneration(studentId: string, sessionId: string): Promise<void> {
  const settings = await getSystemSettings();
  if (!isLlmConfigured(settings.llm)) {
    throw new Error('尚未配置大模型，无法生成学习总结');
  }

  const supabase = getSupabaseClient();

  // 学生姓名
  const { data: student } = await supabase
    .from('students')
    .select('name')
    .eq('id', studentId)
    .maybeSingle();

  // 互动记录（学生 / 教师 / 小王 三方）
  const { data: interactions, error: interError } = await supabase
    .from('interaction_records')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (interError) throw new Error(`查询互动记录失败: ${interError.message}`);

  // 答题记录
  const { data: answers, error: ansError } = await supabase
    .from('answer_records')
    .select('student_answer, is_correct')
    .eq('session_id', sessionId);
  if (ansError) throw new Error(`查询答题记录失败: ${ansError.message}`);

  const answerTotal = answers?.length || 0;
  const answerCorrect = (answers || []).filter(
    (a: { is_correct: boolean }) => a.is_correct
  ).length;
  const accuracy = answerTotal > 0 ? Math.round((answerCorrect / answerTotal) * 100) : 0;

  const interactionSummary = (interactions || [])
    .map((i: { role: string; content: string }) => `${roleLabel(i.role)}: ${i.content}`)
    .join('\n');

  const answerSummary = (answers || [])
    .map(
      (a: { student_answer: string; is_correct: boolean }, idx: number) =>
        `第${idx + 1}题 - 学生答案: ${a.student_answer} | 是否正确: ${a.is_correct ? '是' : '否'}`
    )
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system' as const,
      content: `你是一位教育评估专家。请根据学生本堂课的完整互动记录（含学生、教师、小王 三方对话）和答题情况，从以下四个维度对学生进行多角度评价：

【评价维度和观察点】
1. 答题正确率：共答了几道题，答对几道，正确率如何，错题暴露了哪个知识点薄弱
2. 学习主动性：是否主动发言、主动表达想法、主动追问、不会按时是否主动求助
3. 问题提问：提问的质量如何，是否提出有价值的问题（如追问为什么、不懂的地方、想深入探索的点），是深度提问还是泛泛而问
4. 与小王沟通策略：和小王讨论时能否清晰表达思路、能否听进去并回应小王的引导、讨论中是否受益、是否能把话题推进下去

要求：
1. 必须基于该学生实际的对话内容和答题情况，不能泛泛而谈
2. strengths（优点）：结合四个维度，具体指出哪些方面表现好（如某题正确、主动提问、和小王讨论思路清晰）
3. weaknesses（不足）：结合四个维度，具体指出哪些方面需要改进（如某个知识点薄弱、提问较少、和小王讨论时被动）
4. suggestions（后续学习建议）：针对薄弱环节给出具体、可执行的后续学习建议
5. discussion_summary（与小王沟通情况）：描述学生与小王讨论的互动质量、是否积极、思路是否清晰、是否从讨论中获益
6. overall_summary（课堂表现总览）：用自然段落，从答题正确率、学习主动性、问题提问、与小王沟通策略四个维度依次点评，最后给出整体评价和后续学习建议
7. 不同学生的总结应该有明显差异，体现个性化
8. 数学公式必须使用Unicode符号书写，不要使用LaTeX格式
9. 用JSON格式返回，包含 strengths、weaknesses、suggestions、discussion_summary、overall_summary 五个字段`,
    },
    {
      role: 'user' as const,
      content: `请为学生"${student?.name || '未知'}"生成课堂学习总结。

## 课堂统计
- 答题总数: ${answerTotal}
- 答对数: ${answerCorrect}
- 正确率: ${accuracy}%

## 完整互动记录（学生 / 教师 / 小王）
${interactionSummary || '暂无互动记录'}

## 答题情况
${answerSummary || '暂无答题记录'}

请以JSON格式返回，请务必从以下四个维度评价学生：
- 答题正确率（答题数、答对数、正确率、错的题暴露什么薄弱点）
- 学习主动性（是否主动发言、主动表达、主动追问）
- 问题提问（提问的数量和质量，是否提出有价值的问题）
- 与小王沟通策略（和小王讨论时是否清晰表达、能否推进话题、是否从中获益）

返回：
{
  "strengths": "结合四个维度指出学生的优点表现...",
  "weaknesses": "结合四个维度指出需要改进的地方...",
  "suggestions": "针对薄弱环节给出的后续学习建议...",
  "discussion_summary": "与小王讨论情况的评价...",
  "overall_summary": "从四个维度依次点评的课堂表现完整总览，含整体评价和后续学习建议..."
}`,
    },
  ];

  // 非流式：后台任务无需流式展示，一次拿全量 JSON
  const raw = await invokeChat(messages, settings.llm, { temperature: 0.5 });

  // 解析 JSON（容忍 markdown 围栏 / 杂文），失败兜底为纯文本总览
  let summaryData: {
    strengths?: string;
    weaknesses?: string;
    suggestions?: string;
    discussion_summary?: string;
    overall_summary?: string;
  };
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      summaryData = JSON.parse(jsonMatch[0]);
    } catch {
      summaryData = { overall_summary: raw };
    }
  } else {
    summaryData = { overall_summary: raw };
  }

  if (!summaryData.overall_summary || !summaryData.overall_summary.trim()) {
    throw new Error('模型未返回有效的总结内容');
  }

  const payload = {
    strengths: summaryData.strengths || '',
    weaknesses: summaryData.weaknesses || '',
    suggestions: summaryData.suggestions || '',
    question_total: answerTotal,
    question_correct: answerCorrect,
    discussion_summary: summaryData.discussion_summary || '',
    overall_summary: summaryData.overall_summary,
  };

  // upsert：优先更新该会话已有行（通常是判题链路插入的占位行），保留 practice_evaluation
  const existing = await fetchSessionSummary(studentId, sessionId);
  if (existing) {
    const { error } = await supabase
      .from('learning_summaries')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw new Error(`更新学习总结失败: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('learning_summaries')
      .insert({ ...payload, student_id: studentId, session_id: sessionId });
    if (error) throw new Error(`保存学习总结失败: ${error.message}`);
  }
}
