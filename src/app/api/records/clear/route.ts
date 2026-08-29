import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

// 可清空的数据表。students 放最后：其他表都有外键指向它（onDelete cascade）
const TARGETS = {
  interactions: { table: 'interaction_records', label: '对话记录' },
  answers: { table: 'answer_records', label: '答题记录' },
  summaries: { table: 'learning_summaries', label: '学习总结' },
  sessions: { table: 'session_states', label: '会话状态' },
  students: { table: 'students', label: '学生名单' },
} as const;

type TargetKey = keyof typeof TARGETS;

const TARGET_KEYS = Object.keys(TARGETS) as TargetKey[];

function isTargetKey(v: unknown): v is TargetKey {
  return typeof v === 'string' && (TARGET_KEYS as string[]).includes(v);
}

// supabase-js 的 delete 必须带过滤条件，否则会拒绝执行
// 用 created_at 下界兜住所有行（所有相关表都有该字段且默认 now()）
const EARLIEST = '1970-01-01T00:00:00Z';

export async function GET() {
  try {
    const client = getSupabaseClient();
    const counts: Record<string, number> = {};

    for (const key of TARGET_KEYS) {
      const { count, error } = await client
        .from(TARGETS[key].table)
        .select('id', { count: 'exact', head: true });

      if (error) throw new Error(`统计${TARGETS[key].label}失败: ${error.message}`);
      counts[key] = count ?? 0;
    }

    return NextResponse.json({ success: true, counts });
  } catch (e) {
    console.error('Get record counts error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '统计失败' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const targets = Array.isArray(body?.targets) ? body.targets.filter(isTargetKey) : [];

    if (targets.length === 0) {
      return NextResponse.json({ error: '请至少选择一项要清空的数据' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 按固定顺序执行，students（主表）永远排最后
    const ordered = TARGET_KEYS.filter((k) => targets.includes(k));
    const deleted: Record<string, number> = {};

    for (const key of ordered) {
      const { data, error } = await client
        .from(TARGETS[key].table)
        .delete()
        .gte('created_at', EARLIEST)
        .select('id');

      if (error) throw new Error(`清空${TARGETS[key].label}失败: ${error.message}`);
      deleted[key] = data?.length ?? 0;
    }

    return NextResponse.json({
      success: true,
      deleted,
      summary: ordered.map((k) => ({
        key: k,
        label: TARGETS[k].label,
        count: deleted[k] ?? 0,
      })),
    });
  } catch (e) {
    console.error('Clear records error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '清空失败' },
      { status: 500 },
    );
  }
}
