'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Sparkles,
  ThumbsUp,
  AlertCircle,
  Lightbulb,
  Loader2,
  Users,
  ClipboardList,
  CheckCircle2,
  PercentCircle,
  RefreshCw,
} from 'lucide-react';

interface Summary {
  id: string;
  session_id?: string;
  strengths: string;
  weaknesses: string;
  suggestions: string;
  question_total: number;
  question_correct: number;
  discussion_summary: string | null;
  overall_summary: string | null;
  practice_evaluation: string | null;
  created_at: string;
}

interface StudentUser {
  id: string;
  name: string;
  role: string;
}

type PageStatus = 'loading' | 'ready' | 'generating' | 'error';

// 轮询间隔与上限：3 秒一次，最多 80 次（4 分钟），
// 足以覆盖后台 LLM 生成（120s 超时上限）+ 落库的时间余量
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 80;

function StudentSummaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<StudentUser | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const activeRef = useRef(true);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // 组件卸载时停止轮询
  useEffect(() => () => {
    activeRef.current = false;
    stopPolling();
  }, []);

  /** 查询一次总结（sid 为空时由后端返回学生最新一条），返回是否已就绪及拿到的行 */
  const queryOnce = async (
    studentId: string,
    sid: string | null
  ): Promise<{ ready: boolean; row: Summary | null }> => {
    const params = new URLSearchParams({ student_id: studentId });
    if (sid) params.set('session_id', sid);
    const res = await fetch(`/api/summary?${params.toString()}`);
    if (!res.ok) throw new Error('查询学习总结失败');
    const json = await res.json();
    if (json.data) setSummary(json.data);
    return { ready: json.status === 'ready', row: json.data || null };
  };

  /**
   * 主流程：
   * 1. 先查一次，ready 直接展示（后台已跑完，秒开）
   * 2. 未就绪 → 幂等触发兜底生成（已生成/生成中会被后端去重）→ 每 3 秒轮询直到就绪
   */
  const openSummary = async () => {
    stopPolling();
    setError('');
    setStatus('loading');

    const userData = localStorage.getItem('student_user');
    if (!userData) return;
    const studentId = JSON.parse(userData).id;

    const sid = searchParams.get('session_id');
    let targetSid = sid;

    try {
      const first = await queryOnce(studentId, sid);
      if (first.ready) {
        setStatus('ready');
        return;
      }

      // 未带 session_id 且尚无总结行：从互动记录找最近一次会话
      if (!targetSid) {
        if (first.row?.session_id) {
          targetSid = first.row.session_id;
        } else {
          const interRes = await fetch(`/api/interactions?student_id=${studentId}`);
          const interData = await interRes.json();
          const records = interData.data || [];
          if (records.length === 0) {
            setError('暂无互动记录，请先与智能体进行对话学习');
            setStatus('error');
            return;
          }
          targetSid = records[records.length - 1].session_id;
          // 换会话后再确认一次，避免给旧会话重复触发
          const retry = await queryOnce(studentId, targetSid);
          if (retry.ready) {
            setStatus('ready');
            return;
          }
        }
      }

      // 幂等触发兜底生成
      const postRes = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, session_id: targetSid }),
      });
      const postData = await postRes.json();

      if (!postRes.ok) {
        setError(postData.error || '触发学习总结生成失败');
        setStatus('error');
        return;
      }

      if (postData.status === 'ready' && postData.data) {
        setSummary(postData.data);
        setStatus('ready');
        return;
      }

      // started / generating → 轮询
      pollCountRef.current = 0;
      setStatus('generating');
      pollTimerRef.current = setInterval(async () => {
        if (!activeRef.current || !targetSid) return;
        pollCountRef.current += 1;
        if (pollCountRef.current > MAX_POLLS) {
          stopPolling();
          setError('学习总结生成时间较长，请稍后重新打开本页查看');
          setStatus('error');
          return;
        }
        try {
          const done = await queryOnce(studentId, targetSid);
          if (done) {
            stopPolling();
            setStatus('ready');
          }
        } catch {
          // 网络抖动：保留轮询，下个周期再试
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      console.error('Open summary error:', err);
      setError('查询学习总结失败，请重试');
      setStatus('error');
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('student_token');
    const userData = localStorage.getItem('student_user');
    if (!token || !userData) {
      router.push('/student/login');
      return;
    }
    setUser(JSON.parse(userData));
    openSummary();
    // 仅在进入页面时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const qTotal = summary?.question_total ?? 0;
  const qCorrect = summary?.question_correct ?? 0;
  const accuracy = qTotal > 0 ? Math.round((qCorrect / qTotal) * 100) : null;
  const accuracyColor =
    accuracy === null
      ? 'text-gray-400'
      : accuracy >= 80
        ? 'text-green-600'
        : accuracy >= 60
          ? 'text-amber-600'
          : 'text-red-600';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/student/chat')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">学习总结</h1>
            </div>
            <span className="text-sm text-gray-500">{user?.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {status === 'loading' && (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        )}

        {status === 'error' && (
          <div className="text-center py-12">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {error.includes('暂无互动记录') ? '还没有学习记录' : '生成失败'}
            </h2>
            <p className="text-red-500 text-sm mb-4">{error}</p>
            <button
              onClick={openSummary}
              className="px-6 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              重新加载
            </button>
          </div>
        )}

        {status === 'generating' && (
          <div className="space-y-6">
            <div className="rounded-xl p-6 border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center gap-4">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">正在生成学习总结...</p>
                <p className="text-xs text-gray-500 mt-1">
                  教师正在根据你的课堂表现撰写完整总结，完成后将自动展示，无需刷新
                </p>
              </div>
            </div>

            {/* 完整总结未就绪时，先展示已落库的练习评价 */}
            {summary?.practice_evaluation && (
              <div className="bg-white rounded-xl p-6 border border-blue-100 shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">练习评价</h3>
                </div>
                <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {summary.practice_evaluation}
                </p>
              </div>
            )}
          </div>
        )}

        {status === 'ready' && summary && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                生成时间: {new Date(summary.created_at).toLocaleString('zh-CN')}
              </p>
            </div>

            {/* 课堂统计 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl p-4 border border-gray-100 shadow flex flex-col items-center justify-center">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-2">
                  <ClipboardList className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-bold text-gray-900">{qTotal}</div>
                <div className="text-xs text-gray-500 mt-0.5">答题总数</div>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100 shadow flex flex-col items-center justify-center">
                <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center mb-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <div className="text-2xl font-bold text-gray-900">{qCorrect}</div>
                <div className="text-xs text-gray-500 mt-0.5">答对数</div>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-100 shadow flex flex-col items-center justify-center">
                <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center mb-2">
                  <PercentCircle className="w-4 h-4 text-amber-600" />
                </div>
                <div className={`text-2xl font-bold ${accuracyColor}`}>
                  {accuracy === null ? '-' : `${accuracy}%`}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">正确率</div>
              </div>
            </div>

            {/* 课堂表现总览 - 突出显示 */}
            <div className="rounded-xl p-6 border border-green-200 shadow bg-gradient-to-br from-green-50 via-white to-emerald-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-gray-900">课堂表现总览</h3>
              </div>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {summary.overall_summary || ''}
              </p>
            </div>

            {/* 学习优点 */}
            <div className="bg-white rounded-xl p-6 border border-green-100 shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <ThumbsUp className="w-4 h-4 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900">学习优点</h3>
              </div>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {summary.strengths || ''}
              </p>
            </div>

            {/* 需要改进 */}
            <div className="bg-white rounded-xl p-6 border border-amber-100 shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                </div>
                <h3 className="font-semibold text-gray-900">需要改进</h3>
              </div>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {summary.weaknesses || ''}
              </p>
            </div>

            {/* 进步建议 */}
            <div className="bg-white rounded-xl p-6 border border-blue-100 shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Lightbulb className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">进步建议</h3>
              </div>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {summary.suggestions || ''}
              </p>
            </div>

            {/* 小王讨论情况 */}
            <div className="bg-white rounded-xl p-6 border border-purple-100 shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Users className="w-4 h-4 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900">小王讨论情况</h3>
              </div>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {summary.discussion_summary || ''}
              </p>
            </div>

            <div className="text-center">
              <button
                onClick={() => router.push('/student/chat')}
                className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition"
              >
                继续学习
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>}>
      <StudentSummaryContent />
    </Suspense>
  );
}
