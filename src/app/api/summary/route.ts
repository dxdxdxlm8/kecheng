import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSystemSettings } from '@/lib/settings';
import { isLlmConfigured, streamChat } from '@/lib/llm/client';
import type { ChatMessage } from '@/lib/llm/types';

// 将 role 归一化为可读标签
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

export async function POST(request: NextRequest) {
  try {
    const { student_id, session_id } = await request.json();

    if (!student_id || !session_id) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const settings = await getSystemSettings();
    if (!isLlmConfigured(settings.llm)) {
      return NextResponse.json(
        { error: '尚未配置大模型：请教师进入「系统设置」填写接口地址、密钥和模型名称' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get student info
    const { data: student } = await supabase
      .from('students')
      .select('name')
      .eq('id', student_id)
      .maybeSingle();

    if (student === null) {
      // maybeSingle 返回 null 表示无数据，继续兼容
    }

    // Get interaction records
    const { data: interactions, error: interError } = await supabase
      .from('interaction_records')
      .select('role, content')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (interError) throw new Error(`查询互动记录失败: ${interError.message}`);

    // Get answer records
    const { data: answers, error: ansError } = await supabase
      .from('answer_records')
      .select('student_answer, is_correct')
      .eq('session_id', session_id);

    if (ansError) throw new Error(`查询答题记录失败: ${ansError.message}`);

    // Get session state
    const { data: stateRow } = await supabase
      .from('session_states')
      .select('*')
      .eq('session_id', session_id)
      .eq('student_id', student_id)
      .order('updated_at', { ascending: false })
      .limit(1);

    const state = stateRow?.[0];

    const answerTotal = answers?.length || 0;
    const answerCorrect = (answers || []).filter((a: { is_correct: boolean }) => a.is_correct).length;
    const accuracy = answerTotal > 0 ? Math.round((answerCorrect / answerTotal) * 100) : 0;

    // Build summary prompt
    const interactionSummary = (interactions || [])
      .map((i: { role: string; content: string }) => `${roleLabel(i.role)}: ${i.content}`)
      .join('\n');

    const answerSummary = (answers || [])
      .map((a: { student_answer: string; is_correct: boolean }, idx: number) => {
        return `第${idx + 1}题 - 学生答案: ${a.student_answer} | 是否正确: ${a.is_correct ? '是' : '否'}`;
      })
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
- 会话阶段: ${state?.phase || '未知'}

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

    // Use streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullContent = '';

        try {
          const llmStream = streamChat(messages, settings.llm, { temperature: 0.5 });

          for await (const text of llmStream) {
            fullContent += text;

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
            );
          }

          // Parse and save after streaming completes
          let summaryData: {
            strengths?: string;
            weaknesses?: string;
            suggestions?: string;
            discussion_summary?: string;
            overall_summary?: string;
          };
          try {
            const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              summaryData = JSON.parse(jsonMatch[0]);
            } else {
              summaryData = { overall_summary: fullContent };
            }
          } catch {
            summaryData = { overall_summary: fullContent };
          }

          // Save to database：优先更新同一 session 已有记录，保留 practice_evaluation
          const basePayload = {
            strengths: summaryData.strengths || '',
            weaknesses: summaryData.weaknesses || '',
            suggestions: summaryData.suggestions || '',
            question_total: answerTotal,
            question_correct: answerCorrect,
            discussion_summary: summaryData.discussion_summary || '',
            overall_summary: summaryData.overall_summary || '',
          };

          const { data: existingRows } = await supabase
            .from('learning_summaries')
            .select('id')
            .eq('student_id', student_id)
            .eq('session_id', session_id)
            .order('created_at', { ascending: false })
            .limit(1);

          let savedSummary = null;
          let saveError = null;

          if (existingRows && existingRows.length > 0) {
            const { data, error } = await supabase
              .from('learning_summaries')
              .update(basePayload)
              .eq('id', existingRows[0].id)
              .select('*')
              .single();
            savedSummary = data;
            saveError = error;
          } else {
            const { data, error } = await supabase
              .from('learning_summaries')
              .insert({ ...basePayload, student_id, session_id })
              .select('*')
              .single();
            savedSummary = data;
            saveError = error;
          }

          if (saveError) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: '保存失败' })}\n\n`)
            );
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ done: true, data: savedSummary })}\n\n`)
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: '生成失败' })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Generate summary error:', error);
    return NextResponse.json({ error: '生成学习总结失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('student_id');
    const sessionId = searchParams.get('session_id');

    const supabase = getSupabaseClient();
    let query = supabase
      .from('learning_summaries')
      .select('*')
      .order('created_at', { ascending: false });

    if (studentId) query = query.eq('student_id', studentId);
    if (sessionId) query = query.eq('session_id', sessionId);

    const { data, error } = await query.limit(1);
    if (error) throw new Error(`查询学习总结失败: ${error.message}`);

    const summary = data?.[0] || null;

    // 实时从 answer_records 统计答题情况，避免依赖历史落库快照
    if (summary) {
      let answerQuery = supabase.from('answer_records').select('is_correct');
      if (studentId) answerQuery = answerQuery.eq('student_id', studentId);
      if (sessionId) {
        answerQuery = answerQuery.eq('session_id', sessionId);
      } else if (summary.session_id) {
        answerQuery = answerQuery.eq('session_id', summary.session_id);
      }
      const { data: answerRows, error: answerErr } = await answerQuery;
      if (!answerErr && Array.isArray(answerRows)) {
        const qTotal = answerRows.length;
        const qCorrect = answerRows.filter((a) => a.is_correct).length;
        summary.question_total = qTotal;
        summary.question_correct = qCorrect;
      }
    }

    return NextResponse.json({ data: summary });
  } catch (error) {
    console.error('Get summary error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}
