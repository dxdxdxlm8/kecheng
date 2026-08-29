import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 将旧 role 值归一化为新双 Agent 体系
function normalizeRole(role: string): string {
  switch (role) {
    case 'user':
      return 'student';
    case 'assistant':
      return 'teacher';
    case 'student':
    case 'teacher':
    case 'companion':
      return role;
    default:
      return role;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('student_id');
    const sessionId = searchParams.get('session_id');

    const client = getSupabaseClient();
    let query = client
      .from('interaction_records')
      .select('*, students(name)')
      .order('created_at', { ascending: true });

    if (studentId) {
      query = query.eq('student_id', studentId);
    }
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`查询互动记录失败: ${error.message}`);

    const normalized = (data || []).map((item: { role: string; [k: string]: unknown }) => ({
      ...item,
      role: normalizeRole(item.role as string),
    }));

    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error('Get interactions error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { student_id, session_id, role, content } = await request.json();
    if (!student_id || !session_id || !role || !content) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('interaction_records')
      .insert({ student_id, session_id, role: normalizeRole(role), content })
      .select()
      .single();

    if (error) throw new Error(`保存互动记录失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Save interaction error:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    const studentId = searchParams.get('student_id');

    if (!sessionId || !studentId) {
      return NextResponse.json({ error: '缺少 session_id 或 student_id' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 删除该会话的互动记录
    const { error: interactionError } = await client
      .from('interaction_records')
      .delete()
      .eq('session_id', sessionId)
      .eq('student_id', studentId);

    if (interactionError) throw new Error(`删除互动记录失败: ${interactionError.message}`);

    // 删除该会话的答题记录
    const { error: answerError } = await client
      .from('answer_records')
      .delete()
      .eq('session_id', sessionId)
      .eq('student_id', studentId);

    if (answerError) throw new Error(`删除答题记录失败: ${answerError.message}`);

    // 删除该会话的学情评价
    const { error: summaryError } = await client
      .from('learning_summaries')
      .delete()
      .eq('session_id', sessionId)
      .eq('student_id', studentId);

    if (summaryError) throw new Error(`删除学情评价失败: ${summaryError.message}`);

    // 删除该会话的状态记录
    const { error: stateError } = await client
      .from('session_states')
      .delete()
      .eq('session_id', sessionId)
      .eq('student_id', studentId);

    if (stateError) throw new Error(`删除会话状态失败: ${stateError.message}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
