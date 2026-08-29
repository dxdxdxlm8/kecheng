import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSystemSettings } from '@/lib/settings';
import { isLlmConfigured, streamChat, invokeChat } from '@/lib/llm/client';
import type { ChatMessage, MessageContent } from '@/lib/llm/types';
import { generatePresignedUrl, isStorageConfigured } from '@/lib/storage/object-storage';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** 以 SSE 形式返回一条错误提示，保证前端流式逻辑不崩 */
function sseError(message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

// 角色归一化（兼容旧数据）
function normalizeRole(role: string): 'student' | 'teacher' | 'companion' {
  if (role === 'user') return 'student';
  if (role === 'assistant') return 'teacher';
  if (role === 'student' || role === 'teacher' || role === 'companion') return role as 'student' | 'teacher' | 'companion';
  return 'student';
}

interface SessionState {
  phase: string;
  question_index: number;
  total_questions: number;
  correct_count: number;
  current_question_text: string | null;
  current_answer: string | null;
  current_knowledge_point_id: string | null;
  current_difficulty: string;
}

// 固定建模题（课堂开场）
const MODELING_PROBLEM = `某航空公司接到气象部门预警：受台风影响，东海海域上空形成半径达 40 千米的圆形危险区（假设台风中心稳定）。已知台风中心位于机场 A 正东方向 30 千米处，机场 B 位于台风中心正北方向 40 千米处，A、B 两机场之间为直线航线。

请和小王一起讨论这道题的建模思路，试判断航线 A、B 是否会受到台风影响，想想怎么把实际问题转化为圆与直线位置关系的数学问题。讨论完后，输入"练习"开始做课堂练习题。`;

// 固定三道练习题（练习6.5 P107）
const FIXED_EXERCISES = [
  {
    question_text: `【练习6.5 第1题】判断直线与圆的位置关系：
直线 x + y = 2，圆 x² + y² = 2`,
    answer: `圆心(0,0)到直线x+y=2的距离d=|0+0-2|/√2=2/√2=√2，圆的半径r=√2。因为d=r=√2，所以直线与圆相切。`,
    question_type: 'essay',
  },
  {
    question_text: `【练习6.5 第2题】判断直线与圆的位置关系：
直线 y = 3，圆 (x-2)² + y² = 4`,
    answer: `圆心(2,0)到直线y=3的距离d=3，圆的半径r=2。因为d=3>r=2，所以直线与圆相离。`,
    question_type: 'essay',
  },
  {
    question_text: `【练习6.5 第3题】判断直线与圆的位置关系：
直线 2x - y + 3 = 0，圆 x² + y² - 2x + 6y - 3 = 0`,
    answer: `将圆方程化为标准式：(x-1)²+(y+3)²=13，圆心(1,-3)，半径r=√13。圆心到直线2x-y+3=0的距离d=|2×1-(-3)+3|/√5=8/√5。d²=64/5=12.8<r²=13，即d<r，所以直线与圆相交。`,
    question_type: 'essay',
  },
];

// 构造教师 Agent system prompt
function buildTeacherSystemPrompt(opts: {
  teacherPrompt: string;
  knowledgePoints: { title: string; content: string }[];
  state: SessionState | null;
  isJudging: boolean;
  studentAnswer?: string;
  isModelingPhase: boolean;
  exerciseIndex?: number;
  hasImage?: boolean;
}): string {
  const { teacherPrompt, knowledgePoints, state, isJudging, studentAnswer, isModelingPhase, exerciseIndex, hasImage } = opts;

  let prompt = `你是一位中职数学课堂教师，本节课主题是"圆与直线的位置关系"。

## 教师 Prompt（教学策略，必须遵循）
${teacherPrompt || '按照教学设计引导学生完成建模讨论和课堂练习。'}`;

  if (knowledgePoints.length > 0) {
    prompt += `\n\n## 可用知识点\n`;
    knowledgePoints.forEach((kp, i) => {
      prompt += `\n${i + 1}. ${kp.title}\n   ${kp.content}`;
    });
  }

  prompt += `\n\n## 当前教学状态
- 当前阶段: ${state?.phase || 'modeling'}
- 练习进度: ${state?.question_index || 0}/3
- 已答对: ${state?.correct_count || 0} 题`;

  if (isModelingPhase) {
    prompt += `

## 教学流程规则（建模讨论阶段 - 必须遵守）
1. 课堂开始时，你只需要推送台风建模题，不要做额外讲解
2. 建模题推送后，学生会和小王讨论建模思路，你不要参与讨论
3. 学生输入"练习"后，你开始推送第一道固定练习题
4. 在建模讨论阶段，不要判题、不要出题、不要打断学生和小王的讨论
5. 必须使用中文回答
6. 数学公式使用Unicode符号（²、√等），不要使用LaTeX格式`;
  } else {
    prompt += `

## 教学流程规则（练习阶段 - 必须遵守）
1. 学生输入"练习"后，推送第一道练习题（练习6.5第1题）
2. 每道题学生提交答案后，你判断对错并简要讲解，然后立即出下一道题
3. 三道固定练习题必须按顺序推送，题目内容固定如下：
   第1题：直线x+y=2，圆x²+y²=2（答案：相切）
   第2题：直线y=3，圆(x-2)²+y²=4（答案：相离）
   第3题：直线2x-y+3=0，圆x²+y²-2x+6y-3=0（答案：相交）
4. 判题时先自己安静算完再写讲解，不要输出犹豫或自我纠正的过程
6. 讲解和鼓励自然融合为一段话，新题目另起一段（用---分隔）
7. 必须使用中文回答
8. 数学公式使用Unicode符号（²、√等），不要使用LaTeX格式
9. 回复简洁自信，不要输出"不对不对""哦天呐"等慌乱内容

## 判题标准（以标准答案为准）
第1题：圆心(0,0)到直线x+y=2的距离d=|0+0-2|/√(1+1)=2/√2=√2=r，相切。
第2题：圆心(2,0)到直线y=3的距离d=|3|=3>r=2，相离。
第3题：圆心(1,-3)，r=√13，d=|2+3+3|/√5=8/√5，d²=64/5=12.8<13=r²，相交。`;
  }

  if (isJudging) {
    const isLastExercise = (exerciseIndex ?? 0) === 2;
    prompt += `

## 当前任务：判断学生答案
学生刚刚提交了答案：${hasImage ? "（见上方图片，请识别图片中的作答内容）" : `"${studentAnswer || ''}"`}
这是第${(exerciseIndex ?? 0) + 1}道练习题。请严格对照上面的判题标准判断对错。

【输出格式 - 必须严格遵守】
你的回复必须是一个 JSON 对象（且只输出这一个 JSON，前后不要有任何其他文字）：
${isLastExercise ? '{"review": "给学生的点评正文", "evaluation": "三道题练习评价正文", "judgement": true}' : '{"review": "给学生的点评正文", "judgement": true}'}
- review：教师的讲解正文（判断对错 + 完整解题步骤，口语化、自然，像一对一辅导）。review 只讲当前这道题，不要总结三道题。
${isLastExercise ? '- evaluation：三道练习题全部完成后，基于学生这三道题的答题情况，生成一段「练习评价」。要求：① 先总体说明三道题答对几题、整体表现如何；② 对每一道答错的题，分析主要错误点在哪里、错误原因是什么、后续如何具体改进；③ 语言亲切鼓励，结构清晰，不要出现"judgement"、"review"等字段名称。\n' : ''}- judgement：学生这题答对为 true，答错为 false（布尔值，不要加引号）。`;
  }

  return prompt;
}

/**
 * 解析判题 LLM 的 JSON 回复：{"review": "...", "judgement": true}
 * 容忍代码围栏、前后杂文、judgement 为字符串等常见变体；解析失败返回 null
 */
interface JudgeResult {
  review: string;
  evaluation: string;
  judgement: boolean;
}

function parseJudgeJson(raw: string): JudgeResult | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  // 剥 ```json 代码围栏
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // 截取第一个 { 到最后一个 } 之间的 JSON 主体
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const review = typeof obj.review === 'string' ? obj.review.trim() : '';
    const evaluation = typeof obj.evaluation === 'string' ? obj.evaluation.trim() : '';
    let judgement: boolean | null = null;
    if (typeof obj.judgement === 'boolean') judgement = obj.judgement;
    else if (obj.judgement === 'true' || obj.judgement === '正确') judgement = true;
    else if (obj.judgement === 'false' || obj.judgement === '错误') judgement = false;
    if (!review || judgement === null) return null;
    return { review, evaluation, judgement };
  } catch {
    return null;
  }
}

// 构造学伴 Agent system prompt
function buildCompanionSystemPrompt(opts: {
  level: 'normal' | 'advanced';
  questionText: string | null;
  answer: string | null;
  studentName: string;
  isModeling: boolean;
}): string {
  const { level, questionText, answer, studentName, isModeling } = opts;

  const persona = level === 'advanced'
    ? '你是一个学有余力的同学，思路清晰，清楚题目的内容和解法，但不直接告诉对方答案，而是通过提问和引导帮助ta自己想清楚。'
    : '你是一个和对方水平相当的同学，你完全清楚题目的内容（题目就在你的上下文里），知道答案和解题方向，但你不直接报答案，而是以同学讨论的口吻和ta一起分析；你偶尔会假装不确定、会提问、会和ta互相验证思路，但绝对不要说"我没见过这道题""题目是什么"之类的话。';

  if (isModeling) {
    return `你是小王，一个正在和同学${studentName}一起讨论建模题目的学生。请始终保持"同学"的身份，不要以老师/助教的口吻说话。

## 你的人设
${persona}

## 当前讨论的建模题（题目原文）
某航空公司接到气象部门预警：受台风影响，东海海域上空形成半径达 40 千米的圆形危险区（假设台风中心稳定）。已知台风中心位于机场 A 正东方向 30 千米处，机场 B 位于台风中心正北方向 40 千米处，A、B 两机场之间为直线航线。试判断航线 A、B 是否会受到台风影响。

## 这道题的背景知识（你知道，但不要直接告诉学生）
- 建模思路：以台风中心为原点O(0,0)建立平面直角坐标系
- A机场在正东30千米处，坐标为 A(30, 0)
- B机场在正北40千米处，坐标为 B(0, 40)
- 航线AB的直线方程：4x + 3y = 120（两点式推导）
- 台风危险区域：圆心O(0,0)，半径r=40的圆，方程 x² + y² = 40² = 1600
- 判断方法：计算圆心O到直线AB的距离 d = |4×0 + 3×0 - 120| / √(4² + 3²) = 120/5 = 24
- 因为 d=24 < r=40，所以直线与圆相交，航线会受到台风影响
- 你知道答案是"会受影响"，但不要直接说出来，要引导学生自己算出来

## 讨论规则（建模讨论阶段）
1. 你是学生的"同学"小王，和ta一起讨论这道建模题
2. 学生先发言表达建模思路，你再回应
3. 绝对不要直接给出答案或完整解题过程
4. 引导学生思考：怎么建立坐标系？台风中心、A机场、B机场的坐标分别是什么？航线对应的直线方程是什么？危险区域对应的圆方程是什么？
5. 通过提问和思路碰撞帮助学生自己找到建模方法
6. 可以提出自己的想法（可能不完整或有误），让学生判断和补充
7. 如果学生思路正确，给予肯定并继续引导下一步；如果思路有偏差，用提问的方式提醒
8. 每次回复简洁（一般不超过150字），像同学间聊天
9. 数学公式使用Unicode符号书写，不要使用LaTeX格式
10. 必须使用中文回答，绝对不要使用英文回答
11. 【重要】你们讨论的内容必须始终围绕上面这道台风建模题，不要扯到其他题目、其他知识点或无关话题。如果学生说无关的话，礼貌地把话题拉回到这道建模题的建模思路上来
12. 【重要】只讨论这一道台风建模题，不存在其他题目，不要提到练习册、课本上的其他题
	13. 【最重要】你的上下文中已经给出了这道台风建模题的全部内容（题目、背景知识、答案），不要自己编造其他题目！如果学生提到的内容不是这道台风建模题（比如圆锥体积、函数极值、摩擦力等），你要说"我们讨论的是那道台风建模题吧"，然后拉回正题`;
  }

  return `你是小王，一个正在和同学${studentName}一起讨论题目的学生。请始终保持"同学"的身份，不要以老师/助教的口吻说话。

## 你的人设
${persona}

## 当前讨论的题目（你已经知道这道题，不要说没见过）
${questionText || '当前题目由教师发布，请结合上下文对话内容理解题目'}

## 标准答案（仅供你参考，绝对不要直接告诉学生答案）
${answer || '（答案未提供，但你应基于题目和学生的讨论参与思考）'}

## 讨论规则
1. 你是学生的"同学"小王，和ta一起讨论这道题，不是老师
2. 你清楚地知道上面这道题的内容，绝对不要说"我没见过这道题""题目是什么"之类的话
3. 绝对不要直接给出答案，要和ta一起分析思路
4. 表达想法时要像一个真实的${level === 'advanced' ? '学有余力' : '普通水平'}学生
5. ${level === 'advanced' ? '你的思路更清晰，但通过提问引导对方思考，不直接报答案' : '你偶尔会假装不确定、会提问、会和ta互相验证思路，但始终知道题目在讲什么'}
6. 每次回复简洁（一般不超过150字），像同学间聊天
7. 数学公式使用Unicode符号书写，不要使用LaTeX格式
8. 必须使用中文回答，绝对不要使用英文回答

## 当前任务
等学生先说话后再回应ta。如果学生还没有说话，不要主动开场。学生说话后，以小王（同学）的身份回应，和ta一起讨论这道题。`;
}

export async function POST(request: NextRequest) {
  const { student_id, session_id, message, mode, image_key, answer, trigger, action } = await request.json();

  const agentMode: 'teacher' | 'companion' = mode === 'companion' ? 'companion' : 'teacher';
  const isTrigger = trigger === true;

  const supabase = getSupabaseClient();

  // 1. 获取学生信息
  const { data: student } = await supabase
    .from('students')
    .select('id, name, companion_level')
    .eq('id', student_id)
    .maybeSingle();

  const companionLevel: 'normal' | 'advanced' = student?.companion_level === 'advanced' ? 'advanced' : 'normal';
  const studentName = student?.name || '同学';

  // 2. 获取或创建 session_state
  // 注意：并发请求可能为同一 session+student 插入多条状态记录（先查后插不是原子的），
  // 状态机会在不同行之间读取错乱（阶段横跳），必须先取全部行并去重
  const fetchStates = () => supabase
    .from('session_states')
    .select('*')
    .eq('session_id', session_id)
    .eq('student_id', student_id)
    .order('updated_at', { ascending: false });

  let { data: existingState } = await fetchStates();

  if (!existingState || existingState.length === 0) {
    await supabase.from('session_states').insert({
      session_id,
      student_id,
      phase: 'modeling',
      question_index: 0,
      total_questions: 3,
      correct_count: 0,
      current_question_text: null,
      current_answer: null,
      current_knowledge_point_id: null,
      current_difficulty: 'basic',
    });
    // 并发下可能同时插入了多条，重新拉取
    ({ data: existingState } = await fetchStates());
  }

  // 去重：保留进度最深的一条（question_index 最大，其次 updated_at 最新），删除其余
  if (existingState && existingState.length > 1) {
    const sorted = [...existingState].sort(
      (a: { question_index: number; updated_at: string; id: string }, b: { question_index: number; updated_at: string; id: string }) =>
        (b.question_index ?? 0) - (a.question_index ?? 0) ||
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    const dropIds = sorted.slice(1).map((r: { id: string }) => r.id);
    await supabase.from('session_states').delete().in('id', dropIds);
    existingState = [sorted[0]];
  }

  let state: SessionState | null = null;
  if (existingState && existingState.length > 0) {
    const s = existingState[0];
    state = {
      phase: s.phase,
      question_index: s.question_index,
      total_questions: s.total_questions,
      correct_count: s.correct_count,
      current_question_text: s.current_question_text,
      current_answer: s.current_answer,
      current_knowledge_point_id: s.current_knowledge_point_id,
      current_difficulty: s.current_difficulty,
    };
  }

  // 开始练习的触发：显式 action，或建模阶段学生直接输入"练习"/"开始练习"
  // （前端本地 phase 可能滞后没走 start_practice 按钮路径，后端必须兜底拦截，
  //   否则会落入 LLM 自由发挥、自己编题的路径）
  const isStartPractice = action === 'start_practice' ||
    (agentMode === 'teacher' && !isTrigger && state?.phase === 'modeling' &&
      typeof message === 'string' && /^(开始)?练习$/.test(message.trim()));

  // 判断是否为建模阶段
  const isModelingPhase = state?.phase === 'modeling';
  // 判题条件：教师模式且处于练习答题流程（已有当前题、非建模/非结束）
  const isJudging = agentMode === 'teacher' && !isTrigger && !isStartPractice && !!state && state.phase !== 'modeling' && state.phase !== 'finished' && !!state.current_question_text;

  // 3. 获取教师 Prompt
  const { data: promptRow } = await supabase
    .from('guidance_scripts')
    .select('content')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1);
  const teacherPrompt = promptRow?.[0]?.content || '';

  // 4. 获取知识点
  const { data: kpData } = await supabase
    .from('knowledge_points')
    .select('title, content')
    .order('created_at', { ascending: false })
    .limit(20);
  const knowledgePoints: { title: string; content: string }[] = (kpData || []).map((k: { title: string; content: string }) => ({ title: k.title, content: k.content }));

  // 5. 获取历史互动记录
  const { data: history } = await supabase
    .from('interaction_records')
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(40);

  // 6. 特殊逻辑处理

  // 6.1 开始练习：更新阶段，直接返回第一道题（不经过LLM）
  if (isStartPractice && agentMode === 'teacher') {
    const firstExercise = FIXED_EXERCISES[0];
    await supabase.from('session_states').update({
      phase: 'teaching',
      question_index: 1,
      total_questions: 3,
      current_question_text: firstExercise.question_text,
      current_answer: firstExercise.answer,
      updated_at: new Date().toISOString(),
    }).eq('session_id', session_id).eq('student_id', student_id);

    if (state) {
      state.phase = 'teaching';
      state.question_index = 1;
      state.current_question_text = firstExercise.question_text;
      state.current_answer = firstExercise.answer;
    }

    // 保存教师消息
    await supabase.from('interaction_records').insert({
      student_id,
      session_id,
      role: 'teacher',
      content: firstExercise.question_text,
    });

    const stateUpdate = {
      phase: 'teaching',
      question_index: 1,
      total_questions: 3,
      correct_count: state?.correct_count || 0,
      current_question_text: firstExercise.question_text,
      current_answer: firstExercise.answer,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: firstExercise.question_text })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ state: stateUpdate })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, agent: 'teacher' })}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  }

  // 6.1.1 建模讨论阶段：教师不参与讨论，一律固定话术回复（禁止走 LLM 自由发挥，
  // 否则教师会在建模人设下自己编造不存在的题目）
  if (agentMode === 'teacher' && isModelingPhase && !isTrigger) {
    const reply = '当前是建模讨论阶段，请先和小王一起讨论台风建模题的思路～讨论完成后，输入"练习"开始课堂练习。';

    // 保存学生消息与教师固定回复
    const studentContent = message || (image_key ? '[图片]' : '');
    if (studentContent) {
      await supabase.from('interaction_records').insert({
        student_id,
        session_id,
        role: 'student',
        content: studentContent,
      });
    }
    await supabase.from('interaction_records').insert({
      student_id,
      session_id,
      role: 'teacher',
      content: reply,
    });

    const encoder = new TextEncoder();
    const blockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: reply })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, agent: 'teacher' })}\n\n`));
        controller.close();
      },
    });
    return new Response(blockStream, { headers: SSE_HEADERS });
  }

  // 6.2 加载系统配置（大模型 / 对象存储）
  const settings = await getSystemSettings();
  if (!isLlmConfigured(settings.llm)) {
    return sseError('尚未配置大模型：请教师进入「系统设置」填写接口地址、密钥和模型名称');
  }
  const llmConfig = settings.llm;
  const storageConfig = settings.storage;

  // 6.3 判题后，如果还有下一道固定练习题，直接返回（不经过LLM出题）
  let nextExerciseText: string | null = null;
  if (isJudging && state && state.question_index < 3) {
    const nextIdx = state.question_index; // question_index is 1-based, so index 0 = first already answered
    if (nextIdx < FIXED_EXERCISES.length) {
      nextExerciseText = FIXED_EXERCISES[nextIdx].question_text;
    }
  }

  // 7. 构造 system prompt
  const systemPrompt = agentMode === 'teacher'
    ? buildTeacherSystemPrompt({
        teacherPrompt,
        knowledgePoints,
        state,
        isJudging,
        studentAnswer: answer,
        isModelingPhase,
        exerciseIndex: (state?.question_index || 1) - 1,
        hasImage: !!image_key,
      })
    : buildCompanionSystemPrompt({
        level: companionLevel,
        questionText: state?.current_question_text || null,
        answer: state?.current_answer || null,
        studentName,
        isModeling: isModelingPhase,
      });

  // 8. 保存学生消息（学伴开场触发时不保存）
  if (!isTrigger) {
    const studentContent = isJudging ? (answer || '') : (message || '[图片]');
    if (studentContent) {
      await supabase.from('interaction_records').insert({
        student_id,
        session_id,
        role: 'student',
        content: studentContent,
      });
    }
  }

  // 9. 构造 LLM messages
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // 建模阶段：在对话历史开头显式插入建模题上下文（确保LLM始终看到题目）
  // 历史记录映射到 LLM role
  if (history && history.length > 0) {
    history.forEach((h: { role: string; content: string }) => {
      const role = normalizeRole(h.role);
      if (role === 'student') {
        messages.push({ role: 'user', content: `[学生] ${h.content}` });
      } else if (role === 'teacher') {
        // 小王模式下不注入教师消息，避免污染上下文
        if (agentMode !== 'companion') {
          messages.push({ role: 'assistant', content: `[教师] ${h.content}` });
        }
      } else if (role === 'companion') {
        messages.push({ role: 'assistant', content: `[小王] ${h.content}` });
      }
    });
  }

  // 10. 构造当前 user message
  let userContent: MessageContent;
  let userText: string;
  if (isTrigger) {
    if (isModelingPhase) {
      userText = '（系统：建模讨论阶段，学生正在和小王讨论，你不需要回复，保持沉默即可。如果学生输入了"练习"，你才开始推送练习题。）';
    } else {
      userText = message || '请继续教学';
    }
  } else if (isJudging) {
    const qIdx = (state?.question_index || 1);
    const stdAnswer = state?.current_answer || '';
    const isLastExercise = !nextExerciseText;
    userText = `学生刚提交了第${qIdx}道练习题的作答${image_key ? "（答案已通过上方图片提交，请仔细识别图片中的解题过程与结果）" : `："${answer || '（空）'}"`}。\n题目：${state?.current_question_text || ''}\n标准答案：${stdAnswer}\n\n你是正在批改的教师，review 要像给真实学生讲解那样自然：\n1. 先明确告诉学生这道题答得对不对（答对了就肯定，答错了就温和指出）。\n2. 不管对错，都把这道题的完整解法步骤讲清楚，让学生真正学会；学生只写了序号/数字（如"1"、"2"、"3"）或与题目无关的作答时，视为未完成作答，应判错并提示"请写出完整的判断过程和结论"。\n3. 讲解要口语化、自然，就像一对一辅导对话，一步一步算给学生看，不要机械复述标准答案。若上传了图片，请结合图片中学生的过程针对性点评。\n4. review 只讲当前这道题，不要总结三道题；三道题的总结请写在 evaluation 字段中。\n5. review 里不要出下一道题（系统会自动推送），也不要出现"judgement"字样。\n\n最后严格按照系统指令的 JSON 格式输出（只输出一个 JSON 对象）。`;
    if (isLastExercise) {
      userText += `\n\n这是最后一道题。请同时返回 evaluation 字段，作为对学生的「练习评价」。`;
    }
  } else if (agentMode === 'companion' && isModelingPhase) {
    userText = `[正在讨论的建模题] ${MODELING_PROBLEM}\n\n[学生${studentName}说] ${message || '请继续'}`;
  } else {
    userText = message || '请继续';
  }

  if (image_key && isStorageConfigured(storageConfig)) {
    let imageUrl = '';
    try {
      imageUrl = await generatePresignedUrl({ key: image_key, expireTime: 3600 }, storageConfig);
    } catch (e) {
      console.error('Generate presigned URL error:', e);
    }
    if (imageUrl) {
      const imgNote = isJudging
        ? '\n\n【重要】学生本次用图片上传了作答过程，请仔细识别图片中的解题步骤与最终答案，据此判断对错。'
        : '';
      userContent = [
        { type: 'text', text: userText + imgNote },
        { type: 'image_url', image_url: { url: imageUrl } },
      ];
    } else {
      userContent = userText;
    }
  } else {
    if (image_key && !isStorageConfigured(storageConfig)) {
      console.warn('[chat] 收到图片作答，但未配置对象存储，已忽略图片');
    }
    userContent = userText;
  }

  messages.push({ role: 'user', content: userContent as MessageContent });

  // 11. 判题：非流式调用，等 LLM 完整返回 JSON（review + judgement），
  // 失败自动重试一次；前端对 review 做打字机"假流式"展示
  const encoder = new TextEncoder();

  if (isJudging) {
    let parsed: JudgeResult | null = null;
    let lastError = '';

    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        const raw = await invokeChat(messages, llmConfig, {
          temperature: 0.3,
          needsVision: !!image_key,
          disableThinking: true,
        });
        parsed = parseJudgeJson(raw);
        if (!parsed) {
          lastError = '判题回复不是有效的 JSON';
          console.warn(`[judge] 第 ${attempt} 次返回无法解析：`, raw.slice(0, 200));
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[judge] 第 ${attempt} 次调用失败：`, lastError);
      }
    }

    if (!parsed) {
      return sseError(`判题失败（已自动重试一次）：${lastError}`);
    }

    const isCorrect = parsed.judgement;
    // 学生看到的正文：点评 + 固定的下一道题（系统推送，LLM 不再出题）
    const displayContent = nextExerciseText
      ? `${parsed.review.trim()}\n\n---\n\n${nextExerciseText}`
      : parsed.review.trim();

    // 保存教师回复
    await supabase.from('interaction_records').insert({
      student_id,
      session_id,
      role: 'teacher',
      content: displayContent,
    });

    // 保存答题记录
    const newCorrectCount = (state?.correct_count || 0) + (isCorrect ? 1 : 0);
    await supabase.from('answer_records').insert({
      student_id,
      session_id,
      question_id: `exercise_${state?.question_index || 1}`,
      student_answer: answer || message || (image_key ? '[图片作答]' : ''),
      is_correct: isCorrect,
    }).select('id')
      .then(({ error }) => {
        if (error) console.error('[save answer_records]', error.message);
      });

    // 更新教学状态
    const updateFields: Record<string, unknown> = {
      correct_count: newCorrectCount,
      updated_at: new Date().toISOString(),
    };
    const nextIdx = (state?.question_index || 0) + 1;

    if (nextIdx <= 3 && nextExerciseText) {
      // 还有下一题
      updateFields.phase = 'teaching';
      updateFields.question_index = nextIdx;
      updateFields.total_questions = 3;
      updateFields.current_question_text = FIXED_EXERCISES[nextIdx - 1].question_text;
      updateFields.current_answer = FIXED_EXERCISES[nextIdx - 1].answer;
    } else {
      // 三道题全部答完
      updateFields.phase = 'finished';
      updateFields.question_index = 3;

      // 保存学习总结
      await supabase.from('learning_summaries').insert({
        student_id,
        session_id,
        strengths: '',
        weaknesses: '',
        suggestions: '',
        question_total: 3,
        question_correct: newCorrectCount,
        discussion_summary: '',
        overall_summary: parsed.review,
        practice_evaluation: parsed.evaluation || '',
      });
    }

    if (existingState && existingState.length > 0) {
      await supabase.from('session_states').update(updateFields).eq('id', existingState[0].id);
    }

    // SSE：review 全文一次性下发（前端打字机展示），附带判定与状态
    const judgeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ review: displayContent, judged: true, is_correct: isCorrect })}\n\n`));
        if (!nextExerciseText && parsed.evaluation) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ evaluation: parsed.evaluation })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ state: updateFields })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, agent: 'teacher' })}\n\n`));
        controller.close();
      },
    });
    return new Response(judgeStream, { headers: SSE_HEADERS });
  }

  // 12. 非判题：真流式生成（学伴对话 / 教师其他回复）
  const stream = streamChat(messages, llmConfig, {
    temperature: 0.3,
    needsVision: !!image_key,
    disableThinking: true,
  });

  const readableStream = new ReadableStream({
    async start(controller) {
      let fullResponse = '';
      try {
        for await (const text of stream) {
          fullResponse += text;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
        }

        // 保存 agent 回复
        const agentRole = agentMode === 'teacher' ? 'teacher' : 'companion';
        await supabase.from('interaction_records').insert({
          student_id,
          session_id,
          role: agentRole,
          content: fullResponse,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, agent: agentMode })}\n\n`));
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        const detail = error instanceof Error ? error.message.slice(0, 300) : '';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: `生成回复失败${detail ? `：${detail}` : ''}` })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readableStream, { headers: SSE_HEADERS });
}

export async function GET() {
  const settings = await getSystemSettings();
  return Response.json({
    llmConfigured: isLlmConfigured(settings.llm),
    storageConfigured: isStorageConfigured(settings.storage),
  });
}
