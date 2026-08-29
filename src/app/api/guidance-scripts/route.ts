import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 全局教师 Prompt：全表只保留一份（最新一条），语义为"教师 Agent 教学策略 Prompt"
// 保留多行记录以兼容历史，应用层一律取最新一条

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('guidance_scripts')
      .select('id, title, content, created_at, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) throw new Error(`查询教师 Prompt 失败: ${error.message}`);
    return NextResponse.json({ data: data?.[0] || null });
  } catch (error) {
    console.error('Get teacher prompt error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

// 创建或更新全局教师 Prompt（upsert 语义：已有则更新第一条，无则创建）
export async function POST(request: NextRequest) {
  try {
    const { title, content } = await request.json();
    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Prompt 内容不能为空' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 查询是否已有记录
    const { data: existing } = await client
      .from('guidance_scripts')
      .select('id')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);

    const finalTitle = (title && title.trim()) ? title.trim() : '教师 Prompt';

    if (existing && existing.length > 0) {
      // 更新已有
      const { data, error } = await client
        .from('guidance_scripts')
        .update({ title: finalTitle, content: content.trim(), updated_at: new Date().toISOString() })
        .eq('id', existing[0].id)
        .select('id, title, content, created_at, updated_at')
        .single();

      if (error) throw new Error(`更新教师 Prompt 失败: ${error.message}`);
      return NextResponse.json({ data });
    }

    // 新建
    const { data, error } = await client
      .from('guidance_scripts')
      .insert({ title: finalTitle, content: content.trim(), step_order: 1, updated_at: new Date().toISOString() })
      .select('id, title, content, created_at, updated_at')
      .single();

    if (error) throw new Error(`创建教师 Prompt 失败: ${error.message}`);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Save teacher prompt error:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const client = getSupabaseClient();
    if (id) {
      const { error } = await client.from('guidance_scripts').delete().eq('id', id);
      if (error) throw new Error(`删除教师 Prompt 失败: ${error.message}`);
    } else {
      // 清空全部
      const { error } = await client.from('guidance_scripts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw new Error(`清空教师 Prompt 失败: ${error.message}`);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete teacher prompt error:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
