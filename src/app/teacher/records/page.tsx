'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, AlertTriangle, LogOut, ShieldAlert, CheckCircle2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';

interface ClearTarget {
  key: string;
  label: string;
  desc: string;
  dangerous?: boolean;
}

const TARGETS: ClearTarget[] = [
  { key: 'interactions', label: '对话记录', desc: '学生端全部聊天内容（学生 / 教师 Agent / 学伴 Agent）' },
  { key: 'answers', label: '答题记录', desc: '三道练习的作答内容与判题结果' },
  { key: 'summaries', label: '学习总结', desc: '学情评价：优点、不足、建议、课堂总览' },
  { key: 'sessions', label: '会话状态', desc: '教学流程状态机，清空后学生端从第一步重新开始' },
  { key: 'students', label: '学生名单', desc: '学生账号本身，会连带删除其名下的全部数据', dangerous: true },
];

const DEFAULT_SELECTED: Record<string, boolean> = {
  interactions: true,
  answers: true,
  summaries: true,
  sessions: true,
  students: false,
};

interface ClearResult {
  key: string;
  label: string;
  count: number;
}

export default function TeacherRecordsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>(DEFAULT_SELECTED);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ClearResult[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('teacher_token');
    const userData = localStorage.getItem('teacher_user');
    if (!token || !userData) {
      router.push('/teacher/login');
      return;
    }
    setUser(JSON.parse(userData));
    void loadCounts();
  }, [router]);

  const loadCounts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/records/clear');
      const data = await res.json();
      if (data.success) {
        setCounts(data.counts || {});
      } else {
        setError(data.error || '统计失败');
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

  const toggle = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
    setResult(null);
  };

  const selectedKeys = TARGETS.filter((t) => selected[t.key]).map((t) => t.key);
  const selectedTargets = TARGETS.filter((t) => selected[t.key]);

  const handleClear = async () => {
    setClearing(true);
    setError('');
    try {
      const res = await fetch('/api/records/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: selectedKeys }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.summary || []);
        setConfirmOpen(false);
        await loadCounts();
      } else {
        setError(data.error || '清空失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">清空记录</h1>
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          onClick={() => router.push('/teacher/dashboard')}
          className="mb-6 text-sm text-gray-500 hover:text-indigo-600 transition"
        >
          ← 返回
        </button>

        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-semibold mb-1">此操作不可恢复</p>
            <p className="text-red-700">
              清空后学生端的数据将永久删除，无法找回。建议在下课前或换班重上时使用。
              清空后学生需要刷新页面才能重新开始。
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-green-800 font-semibold text-sm mb-2">
              <CheckCircle2 className="w-4 h-4" />
              清空完成
            </div>
            <ul className="text-sm text-green-700 space-y-1">
              {result.map((r) => (
                <li key={r.key}>
                  {r.label}：已删除 {r.count} 条
                </li>
              ))}
            </ul>
            <p className="text-xs text-green-600 mt-2">学生端需刷新页面后重新开始。</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-red-50 to-white">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              选择要清空的数据
            </h2>
            <p className="text-sm text-gray-500 mt-1">勾选需要清空的数据类型，右侧为当前数据库中的记录数</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">加载中...</div>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {TARGETS.map((t) => {
                  const count = counts[t.key] ?? 0;
                  return (
                    <label
                      key={t.key}
                      className={`flex items-start gap-4 px-6 py-4 cursor-pointer hover:bg-gray-50 transition ${
                        t.dangerous ? 'bg-red-50/30' : ''
                      }`}
                    >
                      <Checkbox
                        checked={!!selected[t.key]}
                        onCheckedChange={() => toggle(t.key)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${t.dangerous ? 'text-red-700' : 'text-gray-900'}`}>
                            {t.label}
                          </span>
                          {t.dangerous && (
                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">危险</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-lg font-bold ${count > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                          {count}
                        </div>
                        <div className="text-xs text-gray-400">条</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="px-6 py-5 border-t border-gray-100 bg-gray-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  已选择 <span className="font-semibold text-gray-900">{selectedKeys.length}</span> 项
                  {selectedKeys.length > 0 && (
                    <span className="text-gray-500">：{selectedTargets.map((t) => t.label).join('、')}</span>
                  )}
                </p>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={selectedKeys.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Trash2 className="w-4 h-4" />
                  清空所选数据
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空以下数据？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">此操作不可恢复，将永久删除：</p>
                <ul className="space-y-1 text-sm">
                  {selectedTargets.map((t) => (
                    <li key={t.key} className="flex justify-between">
                      <span className={t.dangerous ? 'text-red-600 font-medium' : ''}>{t.label}</span>
                      <span className="text-gray-500">{counts[t.key] ?? 0} 条</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleClear();
              }}
              disabled={clearing}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {clearing ? '清空中...' : '确认清空'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
