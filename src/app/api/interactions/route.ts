import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSystemSettings } from '@/lib/settings';
import { generatePresignedUrl, isStorageConfigured } from '@/lib/storage/object-storage';

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

interface InteractionRow {
  role: string;
  image_key?: string | null;
  image_url?: string;
  [k: string]: unknown;
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

    const normalized = (data || []).map((item: InteractionRow) => ({
      ...item,
      role: normalizeRole(item.role),
    })) as InteractionRow[];

    // 学生消息携带图片时，生成可用的图片 URL 供历史记录回显。
    // 预签名 URL 有效期 1 小时，但历史每次打开都会重新请求本接口，现取现用不会过期。
    const hasImageRows = normalized.some((item) => item.image_key);
    if (hasImageRows) {
      try {
        const settings = await getSystemSettings();
        if (isStorageConfigured(settings.storage)) {
          await Promise.all(
            normalized.map(async (item) => {
              const key = item.image_key;
              if (!key) return;
              try {
                item.image_url = await generatePresignedUrl(
                  { key, expireTime: 3600 },
                  settings.storage
                );
              } catch (e) {
                console.error('[interactions] 生成图片 URL 失败:', key, e);
              }
            })
          );
        }
      } catch (e) {
        console.error('[interactions] 读取存储配置失败，跳过图片回显:', e);
      }
    }

    // 附带每个会话的「练习评价」：三道题全部做完后由判题链路生成，
    // 存在 learning_summaries.practice_evaluation 而非对话流水里，
    // 教师端互动记录页需要在会话末尾单独展示
    const sessionIds = Array.from(
      new Set(
        normalized
          .map((item) => item.session_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      )
    );
    const practiceEvaluations: Record<string, string> = {};
    if (sessionIds.length > 0) {
      let sumQuery = client
        .from('learning_summaries')
        .select('session_id, practice_evaluation')
        .in('session_id', sessionIds);
      if (studentId) sumQuery = sumQuery.eq('student_id', studentId);

      const { data: sumRows, error: sumError } = await sumQuery;
      if (sumError) {
        console.error('[interactions] 查询练习评价失败:', sumError.message);
      } else {
        (sumRows || []).forEach((row: { session_id: string; practice_evaluation: string | null }) => {
          const text = row.practice_evaluation;
          if (row.session_id && text && text.trim() && !practiceEvaluations[row.session_id]) {
            practiceEvaluations[row.session_id] = text;
          }
        });
      }
    }

    return NextResponse.json({ data: normalized, practiceEvaluations });
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
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids');
    const sessionId = searchParams.get('session_id');
    const studentId = searchParams.get('student_id');

    const client = getSupabaseClient();

    // 按 id 删除单条或多条互动记录（教师端逐条勾选后删除）
    const targetIds = (idsParam ? idsParam.split(',') : id ? [id] : [])
      .map((s) => s.trim())
      .filter(Boolean);

    if (targetIds.length > 0) {
      const { error } = await client
        .from('interaction_records')
        .delete()
        .in('id', targetIds);

      if (error) throw new Error(`删除互动记录失败: ${error.message}`);

      return NextResponse.json({ success: true, deleted: targetIds.length });
    }

    if (!sessionId || !studentId) {
      return NextResponse.json({ error: '缺少 id / ids，或 session_id + student_id' }, { status: 400 });
    }

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
