'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Target, CheckCircle2, XCircle, MinusCircle, LogOut, FileText } from 'lucide-react';

interface StudentAccuracy {
  name: string;
  exercise_1: boolean | null;
  exercise_2: boolean | null;
  exercise_3: boolean | null;
  answered: number;
  correct: number;
  accuracy: number;
}

interface PerQuestionAccuracy {
  question_id: string;
  label: string;
  total: number;
  correct: number;
  accuracy: number;
}

export default function TeacherAccuracyPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string } | null>(null);
  const [data, setData] = useState<StudentAccuracy[]>([]);
  const [classAverage, setClassAverage] = useState(0);
  const [perQuestion, setPerQuestion] = useState<PerQuestionAccuracy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('teacher_token');
    const userData = localStorage.getItem('teacher_user');
    if (!token || !userData) {
      router.push('/teacher/login');
      return;
    }
    setUser(JSON.parse(userData));
    void load();
  }, [router]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/answers/accuracy');
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setClassAverage(result.classAverage);
        setPerQuestion(result.perQuestion || []);
      } else {
        setError(result.error || '加载失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('teacher_token');
    localStorage.removeItem('teacher_user');
    router.push('/teacher/login');
  };

  const StatusIcon = ({ v }: { v: boolean | null }) => {
    if (v === true) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (v === false) return <XCircle className="w-5 h-5 text-red-500" />;
    return <MinusCircle className="w-5 h-5 text-gray-300" />;
  };

  const accuracyColor = (acc: number) => {
    if (acc >= 80) return 'text-green-600';
    if (acc >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                <FileText className="w-4 h-4 text-indigo-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">答题正确率</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.name || '管理员'}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition"
              >
                <LogOut className="w-4 h-4" />
                退出
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          onClick={() => router.push('/teacher/dashboard')}
          className="mb-6 text-sm text-gray-500 hover:text-indigo-600 transition"
        >
          ← 返回
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Target className="w-5 h-5 text-indigo-600" />
                三道练习答题正确率
              </h2>
              <p className="text-sm text-gray-500 mt-1">练习1：直线x+y=2与圆x²+y²=2 · 练习2：直线y=3与圆(x-2)²+y²=4 · 练习3：直线2x-y+3=0与圆x²+y²-2x+6y-3=0</p>
            </div>
            <div className="bg-indigo-600 text-white rounded-xl px-5 py-3 text-center">
              <p className="text-xs opacity-80">全班平均正确率</p>
              <p className="text-2xl font-bold">{classAverage}%</p>
            </div>
          </div>

          {error && (
            <div className="px-6 py-4 bg-red-50 text-red-600 text-sm">{error}</div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">学生</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">练习1</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">练习2</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">练习3</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">答对数</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">正确率</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {data.filter((d) => d.answered > 0).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-gray-400">
                        暂无学生完成练习
                      </td>
                    </tr>
                  )}
                  {data
                    .filter((d) => d.answered > 0)
                    .map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{s.name}</td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex">
                            <StatusIcon v={s.exercise_1} />
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex">
                            <StatusIcon v={s.exercise_2} />
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex">
                            <StatusIcon v={s.exercise_3} />
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-sm text-gray-700">
                          {s.correct} / {s.answered}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex items-center justify-center text-sm font-bold ${accuracyColor(s.accuracy)}`}>
                            {s.accuracy}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
                {perQuestion.some((pq) => pq.total > 0) && (
                  <tfoot className="bg-gray-50">
                    <tr className="border-t-2 border-gray-200">
                      <td className="px-6 py-4 text-sm font-semibold text-gray-700">每道题正确率</td>
                      {perQuestion.map((pq) => (
                        <td key={pq.question_id} className="px-6 py-4 text-center">
                          <div className={`text-sm font-bold ${accuracyColor(pq.accuracy)}`}>
                            {pq.total > 0 ? `${pq.accuracy}%` : '-'}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {pq.correct}/{pq.total} 人答对
                          </div>
                        </td>
                      ))}
                      <td className="px-6 py-4" />
                      <td className="px-6 py-4" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}