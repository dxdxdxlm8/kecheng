import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();

    // Get all students
    const { data: students, error: studentsError } = await client
      .from('students')
      .select('id, name, created_at')
      .order('name', { ascending: true });

    if (studentsError) throw new Error(`查询学生失败: ${studentsError.message}`);

    if (!students || students.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const studentIds = students.map((s: { id: string }) => s.id);

    // Get interaction counts per student
    const { data: interactions, error: interError } = await client
      .from('interaction_records')
      .select('student_id, id')
      .in('student_id', studentIds);

    if (interError) throw new Error(`查询互动记录失败: ${interError.message}`);

    // Get answer records per student
    const { data: answers, error: ansError } = await client
      .from('answer_records')
      .select('student_id, question_id, is_correct')
      .in('student_id', studentIds);

    if (ansError) throw new Error(`查询答题记录失败: ${ansError.message}`);

    // Get learning summaries (含新字段)
    const { data: summaries, error: sumError } = await client
      .from('learning_summaries')
      .select('student_id, session_id, strengths, weaknesses, suggestions, question_total, question_correct, discussion_summary, overall_summary, created_at')
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });

    if (sumError) throw new Error(`查询学习总结失败: ${sumError.message}`);

    // Aggregate data
    const interactionCounts: Record<string, number> = {};
    (interactions || []).forEach((i: { student_id: string }) => {
      interactionCounts[i.student_id] = (interactionCounts[i.student_id] || 0) + 1;
    });

    const answerStats: Record<string, { total: number; correct: number }> = {};
    // 班级每道题正确率（仅统计三道固定练习）
    const classPerQuestion: Record<string, { total: number; correct: number }> = {
      exercise_1: { total: 0, correct: 0 },
      exercise_2: { total: 0, correct: 0 },
      exercise_3: { total: 0, correct: 0 },
    };
    (answers || []).forEach((a: { student_id: string; question_id?: string; is_correct: boolean }) => {
      if (!answerStats[a.student_id]) {
        answerStats[a.student_id] = { total: 0, correct: 0 };
      }
      answerStats[a.student_id].total++;
      if (a.is_correct) answerStats[a.student_id].correct++;

      const qid = (a.question_id || '').toLowerCase();
      if (classPerQuestion[qid]) {
        classPerQuestion[qid].total++;
        if (a.is_correct) classPerQuestion[qid].correct++;
      }
    });

    // 班级每道题正确率结果
    const classPerQuestionStats = (Object.keys(classPerQuestion) as Array<'exercise_1' | 'exercise_2' | 'exercise_3'>)
      .map((qid) => {
        const s = classPerQuestion[qid];
        return {
          question_id: qid,
          label:
            qid === 'exercise_1' ? '练习1' :
            qid === 'exercise_2' ? '练习2' : '练习3',
          total: s.total,
          correct: s.correct,
          accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : null,
        };
      });

    interface SummaryRow {
      student_id: string;
      session_id: string;
      strengths: string;
      weaknesses: string;
      suggestions: string;
      question_total: number;
      question_correct: number;
      discussion_summary: string | null;
      overall_summary: string | null;
      created_at: string;
    }
    const summaryMap: Record<string, SummaryRow[]> = {};
    (summaries || []).forEach((s: SummaryRow) => {
      if (!summaryMap[s.student_id]) summaryMap[s.student_id] = [];
      summaryMap[s.student_id].push(s);
    });

    const result = students.map((student: { id: string; name: string; created_at: string }) => {
      const stats = answerStats[student.id] || { total: 0, correct: 0 };
      const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      const latest = summaryMap[student.id]?.[0] || null;

      return {
        id: student.id,
        name: student.name,
        interaction_count: interactionCounts[student.id] || 0,
        answer_total: stats.total,
        answer_correct: stats.correct,
        accuracy,
        // 最新一次课堂总结的结构化数据
        latest_summary: latest
          ? {
              session_id: latest.session_id,
              strengths: latest.strengths,
              weaknesses: latest.weaknesses,
              suggestions: latest.suggestions,
              question_total: latest.question_total,
              question_correct: latest.question_correct,
              discussion_summary: latest.discussion_summary,
              overall_summary: latest.overall_summary,
              created_at: latest.created_at,
            }
          : null,
        created_at: student.created_at,
      };
    });

    return NextResponse.json({ data: result, perQuestion: classPerQuestionStats });
  } catch (error) {
    console.error('Get summaries error:', error);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}
