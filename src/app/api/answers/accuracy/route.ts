import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

const EXERCISE_LABELS: Record<string, string> = {
  exercise_1: '练习1',
  exercise_2: '练习2',
  exercise_3: '练习3',
};

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    // 获取所有学生的答题记录（仅限三道固定练习），按时间升序
    const { data: records, error } = await supabase
      .from('answer_records')
      .select('student_id, question_id, is_correct, created_at')
      .in('question_id', ['exercise_1', 'exercise_2', 'exercise_3'])
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 获取学生列表
    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('id, name')
      .order('name', { ascending: true });

    if (studentError) {
      return NextResponse.json({ error: studentError.message }, { status: 500 });
    }

    // 统计每位学生三道题的正确情况
    const result = (students || []).map((s: { id: string; name: string }) => {
      const studentRecords = (records || []).filter(
        (r: { student_id: string }) => r.student_id === s.id,
      );

      // 每道练习取该学生最新的一条记录
      const exerciseMap: Record<string, { correct_count: number; total: number }> = {
        exercise_1: { correct_count: 0, total: 0 },
        exercise_2: { correct_count: 0, total: 0 },
        exercise_3: { correct_count: 0, total: 0 },
      };

      for (const qid of ['exercise_1', 'exercise_2', 'exercise_3']) {
        const exRecords = studentRecords.filter(
          (r: { question_id: string }) => r.question_id === qid,
        );
        if (exRecords.length > 0) {
          const latest = exRecords[exRecords.length - 1];
          exerciseMap[qid] = {
            correct_count: latest.is_correct ? 1 : 0,
            total: 1,
          };
        }
      }

      const answered = Object.values(exerciseMap).filter((e) => e.total > 0);
      const correctAll = answered.reduce((sum, e) => sum + e.correct_count, 0);
      const totalAll = answered.length;
      const accuracy = totalAll > 0 ? Math.round((correctAll / totalAll) * 100) : 0;

      return {
        name: s.name,
        exercise_1: exerciseMap.exercise_1.total > 0 ? exerciseMap.exercise_1.correct_count === 1 : null,
        exercise_2: exerciseMap.exercise_2.total > 0 ? exerciseMap.exercise_2.correct_count === 1 : null,
        exercise_3: exerciseMap.exercise_3.total > 0 ? exerciseMap.exercise_3.correct_count === 1 : null,
        answered: totalAll,
        correct: correctAll,
        accuracy,
      };
    });

    const answeredStudents = result.filter((r) => r.answered > 0);
    const classAverage =
      answeredStudents.length > 0
        ? Math.round(
            (answeredStudents.reduce((s, r) => s + r.accuracy, 0) /
              answeredStudents.length) *
              100,
          ) / 100
        : 0;

    // 每道题汇总：以学生最新记录为准
    const perQuestion = (['exercise_1', 'exercise_2', 'exercise_3'] as const).map((qid) => {
      const answered = result.filter((r) => r[qid] !== null);
      const correct = answered.filter((r) => r[qid] === true).length;
      return {
        question_id: qid,
        label: EXERCISE_LABELS[qid],
        total: answered.length,
        correct,
        accuracy: answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
      classAverage,
      perQuestion,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 },
    );
  }
}