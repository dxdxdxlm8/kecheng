'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Users, Loader2 } from 'lucide-react';

type CompanionLevel = 'normal' | 'advanced';

interface Student {
  id: string;
  name: string;
  companion_level: CompanionLevel;
  created_at: string;
}

export default function StudentsManagePage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [newName, setNewName] = useState('');
  const [newLevel, setNewLevel] = useState<CompanionLevel>('normal');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [batchInput, setBatchInput] = useState('');
  const [batchLevel, setBatchLevel] = useState<CompanionLevel>('normal');
  const [showBatch, setShowBatch] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('teacher_token');
    if (!token) {
      router.push('/teacher/login');
      return;
    }
    fetchStudents();
  }, [router]);

  const fetchStudents = async () => {
    try {
      const res = await fetch('/api/students');
      const data = await res.json();
      setStudents(data.data || []);
    } catch (err) {
      console.error('Fetch students error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setError('');

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), companion_level: newLevel }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '添加失败');
        return;
      }

      setStudents(prev => [...prev, data.data]);
      setNewName('');
    } catch {
      setError('网络错误');
    } finally {
      setAdding(false);
    }
  };

  const handleBatchAdd = async () => {
    if (!batchInput.trim()) return;
    setAdding(true);
    setError('');

    const names = batchInput
      .split(/[\n,，、]/)
      .map(n => n.trim())
      .filter(n => n.length > 0);

    let addedCount = 0;
    let errorMsg = '';

    for (const name of names) {
      try {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, companion_level: batchLevel }),
        });
        const data = await res.json();
        if (res.ok) {
          setStudents(prev => [...prev, data.data]);
          addedCount++;
        } else if (!errorMsg) {
          errorMsg = data.error;
        }
      } catch {
        // skip
      }
    }

    if (addedCount === 0 && errorMsg) {
      setError(errorMsg);
    }

    setBatchInput('');
    setShowBatch(false);
    setAdding(false);
  };

  const handleToggleLevel = async (student: Student) => {
    if (togglingId) return;
    const next: CompanionLevel = student.companion_level === 'normal' ? 'advanced' : 'normal';
    setTogglingId(student.id);
    try {
      const res = await fetch('/api/students', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: student.id, companion_level: next }),
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setStudents(prev => prev.map(s => (s.id === student.id ? data.data : s)));
      }
    } catch {
      // skip
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除学生"${name}"吗？该学生的所有互动记录和答题记录也将被删除。`)) return;

    try {
      const res = await fetch(`/api/students?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStudents(prev => prev.filter(s => s.id !== id));
      }
    } catch {
      // skip
    }
  };

  const levelBadgeClass = (level: CompanionLevel) =>
    level === 'advanced'
      ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
      : 'bg-blue-100 text-blue-700 hover:bg-blue-200';

  const levelLabel = (level: CompanionLevel) => (level === 'advanced' ? '高水平' : '普通水平');

  const renderLevelSelect = (value: CompanionLevel, onChange: (v: CompanionLevel) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CompanionLevel)}
      className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white"
    >
      <option value="normal">普通水平</option>
      <option value="advanced">高水平</option>
    </select>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/teacher/dashboard')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h1 className="text-lg font-bold text-gray-900">学生管理</h1>
              </div>
            </div>
            <button
              onClick={() => setShowBatch(!showBatch)}
              className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition"
            >
              {showBatch ? '单个添加' : '批量添加'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Add student */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm mb-6">
          {showBatch ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">批量添加学生姓名（每行一个，或用逗号分隔）</label>
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm"
                placeholder="张三&#10;李四&#10;王五"
                rows={5}
              />
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">批量小王水平：</label>
                {renderLevelSelect(batchLevel, setBatchLevel)}
                <span className="text-xs text-gray-400">所有学生将使用同一水平</span>
              </div>
              <button
                onClick={handleBatchAdd}
                disabled={adding || !batchInput.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {adding ? '添加中...' : '批量添加'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                placeholder="输入学生姓名"
              />
              {renderLevelSelect(newLevel, setNewLevel)}
              <button
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                添加
              </button>
            </div>
          )}
        </div>

        {/* Student list */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">已预设学生（{students.length}人）</h2>
            <p className="text-xs text-gray-400 mt-1">只有在此列表中的学生才能登录学生端</p>
            <p className="text-xs text-gray-500 mt-1">
              小王的水平决定讨论质量（普通水平的小王会和学生一起探索、可能出错；高水平的小王思路更清晰）
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">加载中...</div>
          ) : students.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>暂无学生，请添加学生姓名</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {students.map((student, index) => (
                <div key={student.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{student.name}</span>
                    <button
                      onClick={() => handleToggleLevel(student)}
                      disabled={togglingId === student.id}
                      title="点击切换小王水平"
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition cursor-pointer disabled:opacity-60 disabled:cursor-wait ${levelBadgeClass(student.companion_level)}`}
                    >
                      {togglingId === student.id && <Loader2 className="w-3 h-3 animate-spin" />}
                      {levelLabel(student.companion_level)}
                    </button>
                  </div>
                  <button
                    onClick={() => handleDelete(student.id, student.name)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6">
          <Link
            href="/teacher/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            返回仪表盘
          </Link>
        </div>
      </main>
    </div>
  );
}
