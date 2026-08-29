import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { student_id, question_id, session_id, student_answer, is_correct } = await request.json();
    if (!student_id || !session_id || !student_answer) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('answer_records')
      .insert({ student_id, question_id, session_id, student_answer, is_correct: is_correct || false })
      .select()
      .single();

    if (error) throw new Error(`保存答题记录失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Save answer error:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}
