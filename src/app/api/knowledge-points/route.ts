import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('knowledge_points')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询知识点失败: ${error.message}`);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('Get knowledge points error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { title, content, image_key } = await request.json();
    if (!title || !content) {
      return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('knowledge_points')
      .insert({ title, content, image_key: image_key || null, created_by: 'admin' })
      .select()
      .single();

    if (error) throw new Error(`创建知识点失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Create knowledge point error:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, title, content, image_key } = await request.json();
    if (!id) {
      return NextResponse.json({ error: '缺少知识点ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const updateData: Record<string, string | null> = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (image_key !== undefined) updateData.image_key = image_key;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await client
      .from('knowledge_points')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`更新知识点失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Update knowledge point error:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少知识点ID' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { error } = await client
      .from('knowledge_points')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`删除知识点失败: ${error.message}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete knowledge point error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
