import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const knowledgePointId = searchParams.get('knowledge_point_id');

    const client = getSupabaseClient();
    let query = client.from('questions').select('*').order('created_at', { ascending: false });

    if (knowledgePointId) {
      query = query.eq('knowledge_point_id', knowledgePointId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`查询题目失败: ${error.message}`);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('Get questions error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { question_text, answer, question_type, options, knowledge_point_id } = await request.json();
    if (!question_text || !answer) {
      return NextResponse.json({ error: '题目和答案不能为空' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('questions')
      .insert({ question_text, answer, question_type: question_type || 'choice', options, knowledge_point_id })
      .select()
      .single();

    if (error) throw new Error(`创建题目失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Create question error:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, question_text, answer, question_type, options, knowledge_point_id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: '缺少题目ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const updateData: Record<string, unknown> = {};
    if (question_text) updateData.question_text = question_text;
    if (answer) updateData.answer = answer;
    if (question_type) updateData.question_type = question_type;
    if (options !== undefined) updateData.options = options;
    if (knowledge_point_id !== undefined) updateData.knowledge_point_id = knowledge_point_id;

    const { data, error } = await client
      .from('questions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`更新题目失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Update question error:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少题目ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { error } = await client
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`删除题目失败: ${error.message}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete question error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
