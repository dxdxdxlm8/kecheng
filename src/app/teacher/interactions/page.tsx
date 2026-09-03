'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare } from 'lucide-react';

interface Student {
  id: string;
  name: string;
}

interface Interaction {
  id: string;
  student_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  students?: { name: string };
}

type RoleStyle = {
  label: string;
  align: 'justify-start' | 'justify-end';
  bubble: string;
  labelColor: string;
};

const getRoleStyle = (role: string): RoleStyle => {
  switch (role) {
    case 'student':
      return {
        label: '学生',
        align: 'justify-start',
        bubble: 'bg-gray-100 text-gray-900 rounded-bl-md',
        labelColor: 'text-gray-500',
      };
    case 'teacher':
      return {
        label: '教师',
        align: 'justify-end',
        bubble: 'bg-green-100 text-green-900 rounded-br-md',
        labelColor: 'text-green-700',
      };
    case 'companion':
      return {
        label: '小王',
        align: 'justify-end',
        bubble: 'bg-purple-100 text-purple-900 rounded-br-md',
        labelColor: 'text-purple-700',
      };
    // Backward compatibility for legacy roles
    case 'user':
      return {
        label: '学生',
        align: 'justify-start',
        bubble: 'bg-gray-100 text-gray-900 rounded-bl-md',
        labelColor: 'text-gray-500',
      };
    default:
      return {
        label: role || '未知',
        align: 'justify-start',
        bubble: 'bg-gray-100 text-gray-900 rounded-bl-md',
        labelColor: 'text-gray-500',
      };
  }
};

export default function InteractionsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string>('');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('teacher_token')) {
      router.push('/teacher/login');
      return;
    }
    fetchStudents();
  }, [router]);

  const fetchStudents = async () => {
    try {
      const res = await fetch('/api/summaries');
      const data = await res.json();
      setStudents((data.data || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
    } catch (err) {
      console.error('Fetch error:', err);
    }
  };

  const fetchInteractions = async (studentId: string) => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/interactions?student_id=${studentId}`);
      const data = await res.json();
      setInteractions(data.data || []);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStudentChange = (studentId: string) => {
    setSelectedStudent(studentId);
    if (studentId) {
      fetchInteractions(studentId);
    } else {
      setInteractions([]);
    }
  };

  // Group interactions by session
  const sessions = interactions.reduce<Record<string, Interaction[]>>((acc, item) => {
    if (!acc[item.session_id]) acc[item.session_id] = [];
    acc[item.session_id].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/teacher/dashboard')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">互动记录</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Student Selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">选择学生</label>
          <select
            value={selectedStudent}
            onChange={(e) => handleStudentChange(e.target.value)}
            className="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          >
            <option value="">请选择学生</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Legend */}
        {selectedStudent && !loading && Object.keys(sessions).length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span className="font-medium text-gray-700">角色图例：</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-gray-300" />
              学生
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-300" />
              教师
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-purple-300" />
              小王
            </span>
          </div>
        )}

        {!selectedStudent ? (
          <div className="text-center py-12 text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>请选择一位学生查看互动记录</p>
          </div>
        ) : loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : Object.keys(sessions).length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无互动记录</div>
        ) : (
          <div className="space-y-6">
            {Object.entries(sessions).map(([sessionId, msgs]) => (
              <div key={sessionId} className="bg-white rounded-xl border border-gray-100 shadow overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <p className="text-sm text-gray-500">
                    会话: {sessionId.slice(0, 8)}... | {msgs.length} 条消息 | {new Date(msgs[0].created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="p-5 space-y-3">
                  {msgs.map((msg) => {
                    const style = getRoleStyle(msg.role);
                    return (
                      <div key={msg.id} className={`flex ${style.align}`}>
                        <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${style.bubble}`}>
                          <p className={`text-xs font-medium mb-1 ${style.labelColor}`}>
                            {style.label}
                          </p>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <p className="text-xs opacity-40 mt-1">
                            {new Date(msg.created_at).toLocaleTimeString('zh-CN')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
