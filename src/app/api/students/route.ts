import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('students')
      .select('id, name, companion_level, created_at')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`查询学生列表失败: ${error.message}`);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('Get students error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, companion_level } = await request.json();

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: '请输入学生姓名' }, { status: 400 });
    }

    const level = companion_level === 'advanced' ? 'advanced' : 'normal';

    const client = getSupabaseClient();

    // Check if student already exists
    const { data: existing } = await client
      .from('students')
      .select('id, name')
      .eq('name', name.trim());

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: '该学生姓名已存在' }, { status: 409 });
    }

    const { data, error } = await client
      .from('students')
      .insert({ name: name.trim(), companion_level: level })
      .select('id, name, companion_level, created_at')
      .single();

    if (error) throw new Error(`创建学生失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Create student error:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

// 更新学生信息（主要用于修改学伴水平）
export async function PUT(request: NextRequest) {
  try {
    const { id, name, companion_level } = await request.json();
    if (!id) {
      return NextResponse.json({ error: '缺少学生ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const updateData: Record<string, unknown> = {};
    if (name && name.trim()) updateData.name = name.trim();
    if (companion_level === 'normal' || companion_level === 'advanced') {
      updateData.companion_level = companion_level;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有需要更新的字段' }, { status: 400 });
    }

    const { data, error } = await client
      .from('students')
      .update(updateData)
      .eq('id', id)
      .select('id, name, companion_level, created_at')
      .single();

    if (error) throw new Error(`更新学生失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Update student error:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少学生ID' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // Delete related records first
    await client.from('answer_records').delete().eq('student_id', id);
    await client.from('interaction_records').delete().eq('student_id', id);
    await client.from('learning_summaries').delete().eq('student_id', id);
    await client.from('session_states').delete().eq('student_id', id);

    const { error } = await client
      .from('students')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`删除学生失败: ${error.message}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete student error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
