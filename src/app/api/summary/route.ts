import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  ensureSummaryGeneration,
  fetchSessionSummary,
  isSummaryReady,
  type LearningSummaryRow,
} from '@/lib/summary/generator';

/**
 * POST /api/summary — 幂等触发学习总结生成
 *
 * 同一次对话只跑一次：
 * - 已有完整总结 → { status: 'ready', data } 直接返回
 * - 后台任务生成中 → { status: 'generating' }
 * - 新启动后台任务 → { status: 'started' }（不等待，前端轮询 GET）
 *
 * 完整总结由判题链路在三题答完时自动触发（chat/route.ts），
 * 本接口主要作为学生点开总结页时的兜底触发。
 */
export async function POST(request: NextRequest) {
  try {
    const { student_id, session_id } = await request.json();

    if (!student_id || !session_id) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const status = await ensureSummaryGeneration(student_id, session_id);

    if (status === 'empty') {
      return NextResponse.json(
        { error: '暂无互动记录，请先与智能体进行对话学习' },
        { status: 400 }
      );
    }

    if (status === 'ready') {
      const summary = await fetchSessionSummary(student_id, session_id);
      return NextResponse.json({ status, data: summary });
    }

    return NextResponse.json({ status });
  } catch (error) {
    console.error('Trigger summary error:', error);
    const message = error instanceof Error ? error.message : '触发学习总结生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/summary?student_id=&session_id= — 查询学习总结
 *
 * 返回 { data, status }：
 * - status='ready'：完整总结已生成，前端直接展示
 * - status='pending'：仅有占位行（末题点评/练习评价）或还没有记录，
 *   前端应继续轮询（后台任务由判题链路或 POST 触发）
 * 不带 session_id 时返回该学生最新一条总结（兼容旧调用）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('student_id');
    const sessionId = searchParams.get('session_id');

    if (!studentId) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    let summary: LearningSummaryRow | null = null;
    if (sessionId) {
      summary = await fetchSessionSummary(studentId, sessionId);
    } else {
      const { data, error } = await supabase
        .from('learning_summaries')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`查询学习总结失败: ${error.message}`);
      summary = (data?.[0] as LearningSummaryRow) || null;
    }

    const status = isSummaryReady(summary) ? 'ready' : 'pending';

    // 实时从 answer_records 统计答题情况，避免依赖历史落库快照
    if (summary) {
      let answerQuery = supabase.from('answer_records').select('is_correct');
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

    return NextResponse.json({ data: summary, status });
  } catch (error) {
    console.error('Get summary error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}
