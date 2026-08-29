import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 会话状态管理：驱动双 Agent 教学流程的状态机

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    const studentId = searchParams.get('student_id');

    if (!sessionId) {
      return NextResponse.json({ error: '缺少 session_id' }, { status: 400 });
    }

    const client = getSupabaseClient();
    let query = client
      .from('session_states')
      .select('*')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (studentId) {
      query = query.eq('student_id', studentId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`查询会话状态失败: ${error.message}`);

    return NextResponse.json({ data: data?.[0] || null });
  } catch (error) {
    console.error('Get session state error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

// 创建或更新会话状态
// body: { session_id, student_id, action?: 'init' | 'update', ...fields }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, student_id, action } = body;

    if (!session_id || !student_id) {
      return NextResponse.json({ error: '缺少 session_id 或 student_id' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询是否已有状态
    const { data: existing } = await client
      .from('session_states')
      .select('*')
      .eq('session_id', session_id)
      .eq('student_id', student_id)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (action === 'init') {
      // 初始化新会话状态（若已存在则重置）
      const initPayload = {
        session_id,
        student_id,
        phase: 'modeling',
        question_index: 0,
        total_questions: 0,
        correct_count: 0,
        current_question_text: null,
        current_answer: null,
        current_knowledge_point_id: null,
        current_difficulty: 'basic',
        updated_at: new Date().toISOString(),
      };

      if (existing && existing.length > 0) {
        const { data, error } = await client
          .from('session_states')
          .update(initPayload)
          .eq('id', existing[0].id)
          .select('*')
          .single();
        if (error) throw new Error(`重置会话状态失败: ${error.message}`);
        return NextResponse.json({ data });
      }

      const { data, error } = await client
        .from('session_states')
        .insert(initPayload)
        .select('*')
        .single();
      if (error) throw new Error(`初始化会话状态失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    // 通用更新
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const allowedFields = [
      'phase', 'question_index', 'total_questions', 'correct_count',
      'current_question_text', 'current_answer', 'current_knowledge_point_id',
      'current_difficulty',
    ];
    for (const f of allowedFields) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    if (existing && existing.length > 0) {
      const { data, error } = await client
        .from('session_states')
        .update(updateData)
        .eq('id', existing[0].id)
        .select('*')
        .single();
      if (error) throw new Error(`更新会话状态失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    // 不存在则按 update 字段创建（补默认值）
    const insertPayload = {
      session_id,
      student_id,
      phase: (updateData.phase as string) || 'teaching',
      question_index: (updateData.question_index as number) ?? 0,
      total_questions: (updateData.total_questions as number) ?? 0,
      correct_count: (updateData.correct_count as number) ?? 0,
      current_question_text: updateData.current_question_text ?? null,
      current_answer: updateData.current_answer ?? null,
      current_knowledge_point_id: updateData.current_knowledge_point_id ?? null,
      current_difficulty: (updateData.current_difficulty as string) || 'basic',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('session_states')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) throw new Error(`创建会话状态失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Save session state error:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}
