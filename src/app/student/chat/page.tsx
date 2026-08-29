'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, LogOut, FileText, Bot, User, Users, Plus, MessageCircle,
  History, ImagePlus, X, Trash2, GraduationCap, PenLine, Sparkles, CheckCircle2, Circle, AlertCircle,
  ClipboardList, Loader2,
} from 'lucide-react';
import { MathText } from '@/components/MathText';

type Role = 'student' | 'teacher' | 'companion';

interface Message {
  role: Role;
  content: string;
  imagePreview?: string;
  isStreaming?: boolean;
}

interface SessionInfo {
  session_id: string;
  last_message: string;
  last_time: string;
  message_count: number;
}

interface SessionState {
  phase: string;
  question_index: number;
  total_questions: number;
  correct_count: number;
  current_question_text: string | null;
  current_answer: string | null;
  current_difficulty: string;
}

interface StudentUser {
  id: string;
  name: string;
  role: string;
}

const PHASE_LABELS: Record<string, string> = {
  modeling: '建模讨论中',
  teaching: '课堂练习中',
  discussing: '讨论中',
  answering: '答题中',
  judging: '教师判题中',
  summarizing: '生成总结中',
  finished: '课堂已结束',
};

const PHASE_STYLES: Record<string, string> = {
  modeling: 'bg-amber-50 text-amber-700 border-amber-200',
  teaching: 'bg-blue-50 text-blue-700 border-blue-200',
  discussing: 'bg-purple-50 text-purple-700 border-purple-200',
  answering: 'bg-amber-50 text-amber-700 border-amber-200',
  judging: 'bg-amber-50 text-amber-700 border-amber-200',
  summarizing: 'bg-green-50 text-green-700 border-green-200',
  finished: 'bg-green-50 text-green-700 border-green-200',
};

// 清理教师 Agent 消息中的协议标记，呈现给学生友好的格式
function cleanTeacherContent(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // 移除答案块
  s = s.replace(/===答案===[\s\S]*?(?====[^=]|===结束===|$)/g, '');
  // 移除难度块
  s = s.replace(/===难度===[\s\S]*?(?====[^=]|===结束===|$)/g, '');
  // 移除结束标记
  s = s.replace(/===结束===/g, '');
  // 在题目块前插入分隔（使新题目独立成段）
  s = s.replace(/===题目===/g, '\n\n---\n');
  // 说明标记替换为友好标签
  s = s.replace(/===说明===/g, '\n考查知识点：');
  // 移除判断/讲解/鼓励标记（内容自然衔接，不显示标签）
  s = s.replace(/===判断===/g, '');
  s = s.replace(/===讲解===/g, '\n');
  s = s.replace(/===鼓励===/g, '\n');
  // 移除总结标记
  s = s.replace(/===总结===/g, '\n\n');
  // 兼容性兜底：剔除历史消息里残留的判定字段（新逻辑下正文不含这些，仅旧数据需要）
  s = s.replace(/@RESULT.{0,1}[:=].{0,1}(正确|错误)/g, '');
  s = s.replace(/判定(标签|字段)[：:]?/g, '');
  // 清理多余空行
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export default function StudentChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<StudentUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 教学流程状态
  const [phase, setPhase] = useState<string>('teaching');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [finished, setFinished] = useState(false);
  const [practiceEvaluation, setPracticeEvaluation] = useState('');
  // 最近一次判题结果（正确/错误），用于在学生端交互区展示
  const [judgeFeedback, setJudgeFeedback] = useState<'correct' | 'wrong' | null>(null);

  // 答题输入
  const [showAnswerInput, setShowAnswerInput] = useState(false);
  const [answerInput, setAnswerInput] = useState('');
  // 答题图片上传
  const [answerImage, setAnswerImage] = useState<File | null>(null);
  const [answerImagePreview, setAnswerImagePreview] = useState<string | null>(null);
  const [answerUploading, setAnswerUploading] = useState(false);
  const answerFileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  // 记录已自动触发学伴开场的题号，避免重复触发
  const autoTriggeredQuestionRef = useRef<number>(-1);
  // 防止并发触发
  const triggeringRef = useRef(false);
  // 判题后自动续接标记（防止死循环）
  const autoContinueRef = useRef(false);
  // 判题回复打字机（"假流式"：后端一次性下发全文，前端逐字展示）
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 组件卸载时清理打字机
  useEffect(() => () => {
    if (typewriterRef.current) clearInterval(typewriterRef.current);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const token = localStorage.getItem('student_token');
    const userData = localStorage.getItem('student_user');
    if (!token || !userData) {
      router.push('/student/login');
      return;
    }
    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);
    fetchSessions(parsedUser.id);
  }, [router]);

  const fetchSessions = async (studentId: string) => {
    try {
      const res = await fetch(`/api/interactions?student_id=${studentId}`);
      const data = await res.json();
      const records = data.data || [];

      const sessionMap = new Map<string, SessionInfo>();
      records.forEach((r: { session_id: string; role: string; content: string; created_at: string }) => {
        if (!sessionMap.has(r.session_id)) {
          sessionMap.set(r.session_id, {
            session_id: r.session_id,
            last_message: r.content.slice(0, 50),
            last_time: r.created_at,
            message_count: 1,
          });
        } else {
          const info = sessionMap.get(r.session_id)!;
          info.message_count++;
          if (r.created_at > info.last_time) {
            info.last_message = r.content.slice(0, 50);
            info.last_time = r.created_at;
          }
        }
      });

      const sorted = Array.from(sessionMap.values()).sort(
        (a, b) => new Date(b.last_time).getTime() - new Date(a.last_time).getTime()
      );
      setSessions(sorted);
    } catch (err) {
      console.error('Fetch sessions error:', err);
    }
  };

  const applyState = useCallback((state: Partial<SessionState> | null) => {
    if (!state) return;
    if (state.phase !== undefined) {
      setPhase(state.phase);
      if (state.phase === 'finished') {
        setFinished(true);
        setShowAnswerInput(false);
      } else if (state.phase === 'teaching') {
        // 练习阶段，有题目时显示答题输入框
        if ((state.question_index ?? 0) > 0) {
          setShowAnswerInput(true);
        }
      }
    }
    if (state.question_index !== undefined) setQuestionIndex(state.question_index);
    if (state.correct_count !== undefined) setCorrectCount(state.correct_count);
    if (state.total_questions !== undefined) setTotalQuestions(state.total_questions);
  }, []);

  const loadSession = async (sid: string) => {
    if (!user) return;
    // 停掉可能还在跑的打字机，避免污染切换后会话的消息
    if (typewriterRef.current) {
      clearInterval(typewriterRef.current);
      typewriterRef.current = null;
    }
    try {
      const [interRes, stateRes] = await Promise.all([
        fetch(`/api/interactions?session_id=${sid}`),
        fetch(`/api/session-state?session_id=${sid}&student_id=${user.id}`),
      ]);
      const interData = await interRes.json();
      const stateData = await stateRes.json();

      const records = interData.data || [];
      const loadedMessages: Message[] = records.map((r: { role: string; content: string }) => ({
        role: (r.role === 'user' ? 'student' : r.role === 'assistant' ? 'teacher' : r.role) as Role,
        content: r.content,
      }));

      setSessionId(sid);
      setMessages(loadedMessages);
      setShowHistory(false);
      setShowAnswerInput(false);
      setAnswerInput('');
      setJudgeFeedback(null);

      const st = stateData.data;
      if (st) {
        setPhase(st.phase || 'modeling');
        setQuestionIndex(st.question_index || 0);
        setCorrectCount(st.correct_count || 0);
        setTotalQuestions(st.total_questions || 0);
        setFinished(st.phase === 'finished');
        // 练习阶段且有题目时显示答题框
        if (st.phase === 'teaching' && (st.question_index || 0) > 0) {
          setShowAnswerInput(true);
        }
        autoTriggeredQuestionRef.current = st.question_index || 0;

        // 若已完成，读取练习评价（刷新页面时恢复）
        if (st.phase === 'finished' && user) {
          try {
            const summaryRes = await fetch(`/api/summary?student_id=${user.id}&session_id=${sid}`);
            const summaryData = await summaryRes.json();
            setPracticeEvaluation(summaryData.data?.practice_evaluation || '');
          } catch (e) {
            console.error('Fetch practice evaluation error:', e);
          }
        }
      } else {
        setPhase('modeling');
        setQuestionIndex(0);
        setCorrectCount(0);
        setTotalQuestions(3);
        setFinished(false);
        autoTriggeredQuestionRef.current = -1;
      }
    } catch (err) {
      console.error('Load session error:', err);
    }
  };

  const startNewSession = async () => {
    if (!user) return;
    // 停掉可能还在跑的打字机，避免污染新会话消息
    if (typewriterRef.current) {
      clearInterval(typewriterRef.current);
      typewriterRef.current = null;
    }
    const sid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setSessionId(sid);
    setMessages([]);
    setPhase('modeling');
    setQuestionIndex(0);
    setCorrectCount(0);
    setTotalQuestions(3);
    setFinished(false);
    setShowAnswerInput(false);
    setAnswerInput('');
    setJudgeFeedback(null);
    autoTriggeredQuestionRef.current = -1;
    setShowHistory(false);

    // 初始化会话状态
    try {
      await fetch('/api/session-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, student_id: user.id, action: 'init' }),
      });
    } catch (err) {
      console.error('Init session state error:', err);
    }

    // 不自动触发任何消息，学生先发言，小王随后参与讨论
  };

  // 通用流式调用 /api/chat
  const streamChat = async (
    body: Record<string, unknown>,
    agentRole: Role,
    onDone?: (state: Partial<SessionState> | null) => void
  ) => {
    if (!user) return;
    setLoading(true);
    // 添加 agent 占位消息
    setMessages(prev => [...prev, { role: agentRole, content: '', isStreaming: true }]);

    try {
      let imageKey: string | undefined;
      if (body.image_file) {
        setUploading(true);
        const formData = new FormData();
        formData.append('file', body.image_file as File);
        const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const upData = await upRes.json();
        if (upData.key) imageKey = upData.key;
        setUploading(false);
        delete body.image_file;
      }
      if (imageKey) body.image_key = imageKey;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: user.id, ...body }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let finalState: Partial<SessionState> | null = null;
      // 打字机协调：done 先到时等打字机跑完再 finalize
      let doneReceived = false;
      let typewriterDone = true;

      const finalizeMessage = (content: string) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: agentRole,
            content: content || '生成回复失败',
            isStreaming: false,
          };
          return updated;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: agentRole,
                    content: fullContent,
                    isStreaming: true,
                  };
                  return updated;
                });
              }
              if (typeof data.review === 'string' && data.review) {
                // 判题回复：后端一次性下发全文，前端打字机"假流式"逐字展示
                const target = data.review;
                let idx = 0;
                typewriterDone = false;
                if (typewriterRef.current) clearInterval(typewriterRef.current);
                typewriterRef.current = setInterval(() => {
                  idx = Math.min(target.length, idx + 3);
                  const slice = target.slice(0, idx);
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: agentRole,
                      content: slice,
                      isStreaming: idx < target.length,
                    };
                    return updated;
                  });
                  if (idx >= target.length) {
                    if (typewriterRef.current) clearInterval(typewriterRef.current);
                    typewriterRef.current = null;
                    typewriterDone = true;
                    if (doneReceived) finalizeMessage(target);
                  }
                }, 15);
              }
              if (data.state) {
                finalState = data.state;
                applyState(data.state);
              }
              if (data.judged === true) {
                // 教师判题回传：judgement=true/false，据此显示作答对错
                setJudgeFeedback(data.is_correct ? 'correct' : 'wrong');
              }
              if (typeof data.evaluation === 'string' && data.evaluation) {
                setPracticeEvaluation(data.evaluation);
              }
              if (data.done || data.error) {
                doneReceived = true;
                // 打字机还在跑时先不 finalize，等它跑完
                if (typewriterDone) {
                  finalizeMessage(fullContent || data.error || '生成回复失败');
                }
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      }

      onDone?.(finalState);
      fetchSessions(user.id);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: agentRole,
          content: '抱歉，网络出现问题，请重试。',
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  // 开始练习
  const startPractice = () => {
    if (!sessionId || loading) return;
    streamChat(
      {
        session_id: sessionId,
        mode: 'teacher',
        action: 'start_practice',
      },
      'teacher',
      (state) => {
        if (state) {
          setPhase(state.phase || 'teaching');
          setQuestionIndex(state.question_index || 1);
          setTotalQuestions(state.total_questions || 3);
          setShowAnswerInput(true);
        }
      }
    );
  };

  // 普通发送（建模讨论阶段走小王，练习阶段走教师）
  const handleSend = async () => {
    if ((!input.trim() && !selectedImage) || loading || !user || !sessionId || finished) return;

    const userMessage = input.trim();
    const currentImage = selectedImage;
    const currentPreview = imagePreview;

    setInput('');
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 显示学生消息
    setMessages(prev => [...prev, {
      role: 'student',
      content: userMessage || '[图片]',
      imagePreview: currentPreview || undefined,
    }]);

    // 建模阶段：学生输入"练习"触发练习
    if (phase === 'modeling' && userMessage === '练习') {
      startPractice();
      return;
    }

    // 建模讨论阶段走小王，练习阶段走教师
    const mode: 'teacher' | 'companion' = phase === 'modeling' ? 'companion' : 'teacher';
    const agentRole: Role = mode === 'companion' ? 'companion' : 'teacher';

    const body: Record<string, unknown> = {
      session_id: sessionId,
      message: userMessage || '请看这张图片',
      mode,
    };
    // 练习阶段（教师模式）把输入内容同时作为答案提交，确保答题记录落库
    if (mode === 'teacher') body.answer = userMessage;
    if (currentImage) body.image_file = currentImage;

    await streamChat(body, agentRole);
  };

  // 答题提交
  const handleAnswerSubmit = async () => {
    if ((!answerInput.trim() && !answerImage) || loading || !user || !sessionId) return;

    const answer = answerInput.trim();
    // 显示学生答案消息
    setMessages(prev => [...prev, {
      role: 'student',
      content: answerImage ? `【我的答案】${answer || '（已上传图片作答）'}` : `【我的答案】${answer}`,
      image: answerImagePreview || undefined,
    }]);
    setAnswerInput('');
    setShowAnswerInput(false);
    autoContinueRef.current = false;
    setJudgeFeedback(null);

    // 上传答题图片（如有）
    let answerImageKey: string | undefined;
    if (answerImage) {
      setAnswerUploading(true);
      try {
        const uploadForm = new FormData();
        uploadForm.append('file', answerImage);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          answerImageKey = uploadData.key;
        }
      } catch (e) {
        console.error('答题图片上传失败', e);
      } finally {
        setAnswerUploading(false);
      }
    }
    // 清空答题图片
    setAnswerImage(null);
    setAnswerImagePreview(null);

    const body: Record<string, unknown> = {
      session_id: sessionId,
      mode: 'teacher',
      answer,
      image_key: answerImageKey,
    };

    await streamChat(
      body,
      'teacher',
      (state) => {
        if (state) {
          if (state.phase === 'finished') {
            setFinished(true);
            setShowAnswerInput(false);
          } else if (state.phase === 'teaching' && (state.question_index ?? 0) > questionIndex) {
            // 出了新题，显示答题输入框
            setShowAnswerInput(true);
          }
        }
      }
    );
  };

  // 答题图片选择
  const handleAnswerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnswerImage(file);
    const reader = new FileReader();
    reader.onload = () => setAnswerImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('仅支持 JPG、PNG、GIF、WebP 格式的图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('图片大小不能超过 10MB');
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showAnswerInput) handleAnswerSubmit();
      else handleSend();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('student_token');
    localStorage.removeItem('student_user');
    router.push('/student/login');
  };

  const accuracy = questionIndex > 0 ? Math.round((correctCount / questionIndex) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleImageSelect}
      />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">课堂学习</h1>
                <p className="text-xs text-gray-500">{user?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition"
              >
                <History className="w-4 h-4" />
                历史
              </button>
              <button
                onClick={startNewSession}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                新对话
              </button>
              <button
                onClick={() => router.push('/student/summary?regenerate=true')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition"
              >
                <FileText className="w-4 h-4" />
                总结
              </button>
              <button
                onClick={() => router.push('/student/geometry')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                title="几何实验室 - 动态图形演示"
              >
                <Circle className="w-4 h-4" />
                实验
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 阶段指示器 + 进度 */}
      {sessionId && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${PHASE_STYLES[phase] || PHASE_STYLES.teaching}`}>
              {phase === 'modeling' && <Users className="w-3 h-3" />}
              {phase === 'teaching' && <GraduationCap className="w-3 h-3" />}
              {phase === 'discussing' && <Users className="w-3 h-3" />}
              {(phase === 'answering' || phase === 'judging') && <PenLine className="w-3 h-3" />}
              {(phase === 'summarizing' || phase === 'finished') && <Sparkles className="w-3 h-3" />}
              {PHASE_LABELS[phase] || '建模讨论中'}
            </span>
            {questionIndex > 0 && (
              <span className="text-xs text-gray-500">
                第 <b className="text-gray-800">{questionIndex}</b> 题 · 答对 <b className="text-green-600">{correctCount}</b> 题
                {totalQuestions > 0 && ` · 共 ${totalQuestions} 题`}
                {questionIndex > 0 && ` · 正确率 ${accuracy}%`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex relative overflow-hidden">
        {/* History sidebar */}
        {showHistory && (
          <div className="w-72 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">历史对话</h3>
            </div>
            {sessions.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">暂无历史对话</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {sessions.map((s) => (
                  <div key={s.session_id} className="flex items-center group">
                    <button
                      onClick={() => loadSession(s.session_id)}
                      className={`flex-1 text-left p-3 hover:bg-gray-50 transition ${
                        s.session_id === sessionId ? 'bg-green-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <MessageCircle className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs text-gray-400">
                          {new Date(s.last_time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-xs text-gray-400">({s.message_count}条)</span>
                      </div>
                      <p className="text-sm text-gray-700 truncate">{s.last_message}</p>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); /* deleteSession retained */ }}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                      title="删除对话"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
              {messages.length === 0 && !sessionId && (
                <div className="text-center text-gray-400 mt-20">
                  <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>点击「新对话」开始学习</p>
                  <p className="text-xs mt-2">先和小王讨论建模思路，输入「练习」开始做题</p>
                </div>
              )}
              {messages.length === 0 && sessionId && phase === 'modeling' && (
                <div className="max-w-2xl mx-auto mt-6">
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                      <h3 className="font-bold text-amber-800">课堂建模题</h3>
                    </div>
                    <p className="text-gray-700 leading-relaxed text-sm">
                      某航空公司接到气象部门预警：受台风影响，东海海域上空形成半径达 40 千米的圆形危险区（假设台风中心稳定）。已知台风中心位于机场 A 正东方向 30 千米处，机场 B 位于台风中心正北方向 40 千米处，A、B 两机场之间为直线航线。
                    </p>
                    <div className="mt-4 pt-3 border-t border-amber-200 text-sm text-amber-700">
                      💬 先说说你的建模思路，小王会和你一起讨论
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {messages.map((msg, index) => {
                  const isStudent = msg.role === 'student';
                  const isCompanion = msg.role === 'companion';
                  const isTeacher = msg.role === 'teacher';
                  const displayContent = isTeacher ? cleanTeacherContent(msg.content) : msg.content;
                  return (
                    <div
                      key={index}
                      className={`flex gap-3 ${isStudent ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isStudent ? 'bg-blue-100' : isCompanion ? 'bg-purple-100' : 'bg-green-100'
                      }`}>
                        {isStudent ? (
                          <User className="w-4 h-4 text-blue-600" />
                        ) : isCompanion ? (
                          <Users className="w-4 h-4 text-purple-600" />
                        ) : (
                          <GraduationCap className="w-4 h-4 text-green-600" />
                        )}
                      </div>
                      <div className={`max-w-[75%] ${isStudent ? '' : ''}`}>
                        {!isStudent && (
                          <p className={`text-xs mb-1 ml-1 ${
                            isCompanion ? 'text-purple-500' : 'text-green-600'
                          }`}>
                            {isCompanion ? '小王' : '教师'}
                          </p>
                        )}
                        <div className={`px-4 py-3 rounded-2xl text-sm ${
                          isStudent
                            ? 'bg-blue-600 text-white rounded-br-md'
                            : isCompanion
                            ? 'bg-purple-50 border border-purple-100 text-gray-900 rounded-bl-md'
                            : 'bg-white border border-green-100 text-gray-900 rounded-bl-md shadow-sm'
                        }`}>
                          {msg.imagePreview && (
                            <div className="mb-2">
                              <img
                                src={msg.imagePreview}
                                alt="上传的图片"
                                className="max-w-full max-h-48 rounded-lg object-contain"
                              />
                            </div>
                          )}
                          <MathText content={displayContent} />
                          {msg.isStreaming && (
                            <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* 最近一次判题结果 */}
              {judgeFeedback && (
                <div className="flex justify-center pt-1">
                  <span
                    className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border ${
                      judgeFeedback === 'correct'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}
                  >
                    {judgeFeedback === 'correct' ? '本题回答正确' : '本题回答错误'}
                  </span>
                </div>
              )}

              {/* 练习评价 */}
              {finished && (
                <div className="mt-6 bg-white border border-blue-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <ClipboardList className="w-4 h-4 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900">练习评价</h3>
                  </div>
                  {practiceEvaluation ? (
                    <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {practiceEvaluation}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 flex items-center gap-2 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在生成练习评价...
                    </div>
                  )}
                </div>
              )}

              {/* 课堂结束提示 */}
              {finished && (
                <div className="mt-6 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5 text-center">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                  <h3 className="text-base font-semibold text-gray-900 mb-1">本堂课已结束</h3>
                  <p className="text-sm text-gray-600 mb-3">教师已为你生成本堂课的学习总结</p>
                  <button
                    onClick={() => router.push('/student/summary?regenerate=true')}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
                  >
                    <FileText className="w-4 h-4" />
                    查看完整学习总结
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Input area */}
          {sessionId && !finished && (
            <div className="bg-white border-t border-gray-200 sticky bottom-0">
              <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3">
                {/* 建模阶段提示 */}
                {phase === 'modeling' && (
                  <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 text-center">
                    正在和小王讨论建模思路，输入「练习」开始做课堂练习题
                  </div>
                )}

                {/* 答题输入框 */}
                {showAnswerInput ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-amber-600 font-medium">答题模式：提交后教师将判断对错并讲解</p>
                      <button
                        onClick={() => { setShowAnswerInput(false); setAnswerInput(''); }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        取消答题
                      </button>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1 space-y-2">
                        <textarea
                          value={answerInput}
                          onChange={(e) => setAnswerInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-full px-4 py-2.5 border border-amber-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none resize-none text-sm"
                          placeholder="输入你的答案，按 Enter 提交"
                          rows={2}
                          disabled={loading}
                          autoFocus
                        />
                        {answerImagePreview && (
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <img src={answerImagePreview} alt="答题图片" className="w-20 h-20 rounded-lg object-contain border border-gray-200" />
                              <button
                                onClick={() => { setAnswerImage(null); setAnswerImagePreview(null); }}
                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                                title="移除图片"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => answerFileInputRef.current?.click()}
                          disabled={loading || answerUploading}
                          className="w-11 h-11 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition flex items-center justify-center text-gray-600"
                          title="上传作答图片"
                        >
                          {answerUploading ? (
                            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <ImagePlus className="w-5 h-5" />
                          )}
                        </button>
                        <input
                          ref={answerFileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAnswerFileChange}
                        />
                        <button
                          onClick={handleAnswerSubmit}
                          disabled={loading || (!answerInput.trim() && !answerImagePreview)}
                          className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                        >
                          {uploading ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          提交答案
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Image preview */}
                    {imagePreview && (
                      <div className="mb-3 relative inline-block">
                        <img
                          src={imagePreview}
                          alt="待发送图片"
                          className="max-h-32 rounded-lg border border-gray-200"
                        />
                        <button
                          onClick={clearImage}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition shadow"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                        className="px-3 py-2.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-xl transition disabled:opacity-50"
                        title="上传图片"
                      >
                        <ImagePlus className="w-5 h-5" />
                      </button>
                      <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none text-sm"
                        placeholder={
                          phase === 'modeling'
                            ? '和小王讨论建模思路，输入"练习"开始做题...'
                            : phase === 'teaching'
                            ? '和教师交流...'
                            : '和小王讨论...'
                        }
                        rows={1}
                        disabled={loading}
                      />
                      <button
                        onClick={handleSend}
                        disabled={loading || (!input.trim() && !selectedImage)}
                        className="px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                      >
                        {uploading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      按 Enter 发送，Shift+Enter 换行
                      {phase === 'discussing' && ' · 讨论完成后点「我要答题」提交答案'}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
