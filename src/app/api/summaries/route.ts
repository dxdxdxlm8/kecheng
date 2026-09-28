import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();

    // ⚠️ 四个查询互不依赖，必须一次 Promise.all 全并行发。
    // 每次访问 Supabase 都要跨境一次 RTT（实测 ~150ms），串行 4 次 = 1.43s。
    // 注意：后三个查询不再用 `.in('student_id', studentIds)` 过滤，因为那要等学生表先返回
    // （= 多一轮 RTT）。三张表数据量都很小（互动 710 / 答题 190 / 总结 59 行），
    // 直接全量拉回、在内存里按 student_id 归并即可，最终只会输出 students 里存在的人。
    const [
      { data: students, error: studentsError },
      { data: interactions, error: interError },
      { data: answers, error: ansError },
      { data: summaries, error: sumError },
    ] = await Promise.all([
      // Get all students
      client
        .from('students')
        .select('id, name, created_at')
        .order('name', { ascending: true }),
      // Get interaction records (only need student_id to count per student)
      client
        .from('interaction_records')
        .select('student_id'),
      // Get answer records per student
      client
        .from('answer_records')
        .select('student_id, question_id, is_correct'),
      // Get learning summaries (含新字段)
      client
        .from('learning_summaries')
        .select('student_id, session_id, strengths, weaknesses, suggestions, question_total, question_correct, discussion_summary, overall_summary, created_at')
        .order('created_at', { ascending: false }),
    ]);

    if (studentsError) throw new Error(`查询学生失败: ${studentsError.message}`);
    if (interError) throw new Error(`查询互动记录失败: ${interError.message}`);
    if (ansError) throw new Error(`查询答题记录失败: ${ansError.message}`);
    if (sumError) throw new Error(`查询学习总结失败: ${sumError.message}`);

    if (!students || students.length === 0) {
      return NextResponse.json({ data: [] });
    }


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
