import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSystemSettings } from '@/lib/settings';
import { invokeChat, isLlmConfigured } from '@/lib/llm/client';
import type { ChatMessage } from '@/lib/llm/types';

export async function POST(request: NextRequest) {
  try {
    const { knowledge_point_id, count = 3, question_type = 'mixed' } = await request.json();

    const settings = await getSystemSettings();
    if (!isLlmConfigured(settings.llm)) {
      return NextResponse.json(
        { error: '尚未配置大模型：请教师进入「系统设置」填写接口地址、密钥和模型名称' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get knowledge point info
    let knowledgeContext = '';
    if (knowledge_point_id) {
      const { data: kp } = await supabase
        .from('knowledge_points')
        .select('title, content')
        .eq('id', knowledge_point_id)
        .single();
      if (kp) {
        knowledgeContext = '知识点：' + kp.title + '\n内容：' + kp.content;
      }
    } else {
      // Get all knowledge points
      const { data: allKps } = await supabase
        .from('knowledge_points')
        .select('title, content')
        .order('created_at', { ascending: false })
        .limit(5);
      if (allKps && allKps.length > 0) {
        knowledgeContext = allKps.map((kp: { title: string; content: string }, i: number) =>
          (i + 1) + '. ' + kp.title + ': ' + kp.content
        ).join('\n');
      }
    }

    if (!knowledgeContext) {
      return NextResponse.json({ error: '请先创建知识点再生成题目' }, { status: 400 });
    }

    const typeDesc = question_type === 'choice'
      ? '全部为选择题（4个选项）'
      : question_type === 'essay'
        ? '全部为解答题/场景题（需要多步推理，有实际应用背景）'
        : question_type === 'fill'
          ? '全部为填空题（直接填写答案）'
          : '混合题型：包含选择题、填空题和解答题，其中解答题至少1道（难度较高，有场景背景）';

    const prompt = '你是一位专业的教师，请根据以下知识点生成' + count + '道题目（' + typeDesc + '）。\n\n'
      + knowledgeContext + '\n\n'
      + '请严格按照以下JSON格式输出，不要输出其他内容：\n'
      + '[\n'
      + '  {\n'
      + '    "question_text": "题目内容（选择题需含选项A/B/C/D）",\n'
      + '    "answer": "正确答案（选择题填选项字母，填空题填具体答案，解答题填关键结论）",\n'
      + '    "question_type": "choice" 或 "fill" 或 "essay",\n'
      + '    "options": ["选项A", "选项B", "选项C", "选项D"]\n'
      + '  }\n'
      + ']\n\n'
      + '要求：\n'
      + '1. 选择题必须有4个选项，干扰项要有合理性\n'
      + '2. 填空题答案要简洁明确\n'
      + '3. 解答题/场景题要有实际应用背景，需要多步推理，难度高于其他题型\n'
      + '4. 答案必须准确完整，请仔细验算\n'
      + '5. 题目难度从基础到进阶递进\n'
      + '6. 数学公式必须使用Unicode符号书写，不要使用LaTeX格式。例如：用²表示平方，用√表示根号，用a/b代替分数。绝对不要使用反斜杠、^、_等LaTeX符号';

    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一位专业的教学题目生成助手，只输出JSON格式的题目数据，不要输出任何其他内容。' },
      { role: 'user', content: prompt },
    ];

    const content = await invokeChat(messages, settings.llm, { temperature: 0.7 });

    // Parse the JSON response
    let questions;
    try {
      const jsonMatch = content.trim().match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      questions = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Parse generated questions error:', parseError, content);
      return NextResponse.json({ error: 'AI 生成的题目格式有误，请重试' }, { status: 500 });
    }

    // Validate and insert questions
    const insertedQuestions = [];
    for (const q of questions) {
      if (!q.question_text || !q.answer) continue;

      const { data, error } = await supabase
        .from('questions')
        .insert({
          question_text: q.question_text,
          answer: q.answer,
          question_type: q.question_type || 'choice',
          options: q.options || null,
          knowledge_point_id: knowledge_point_id || null,
        })
        .select()
        .single();

      if (!error && data) {
        insertedQuestions.push(data);
      }
    }

    return NextResponse.json({ data: insertedQuestions, count: insertedQuestions.length });
  } catch (error) {
    console.error('Generate questions error:', error);
    return NextResponse.json({ error: '生成题目失败' }, { status: 500 });
  }
}
