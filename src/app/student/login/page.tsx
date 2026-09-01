'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Download } from 'lucide-react';

export default function StudentLoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入姓名');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '登录失败');
        return;
      }

      localStorage.setItem('student_token', data.token);
      localStorage.setItem('student_user', JSON.stringify(data.user));
      router.push('/student/chat');
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-green-50 to-emerald-50 flex items-center justify-center p-4 relative">
      {/* 右上角：安卓客户端下载（nginx 直接托管 /var/www/html/1.apk，不经过 Node） */}
      <a
        href="/download/1.apk"
        download="课堂助手.apk"
        className="absolute top-4 right-4 inline-flex items-center gap-1.5 px-3 py-2 bg-white/90 border border-gray-200 rounded-xl text-sm text-gray-600 shadow-sm hover:text-green-600 hover:border-green-300 hover:bg-white transition"
        title="下载安卓客户端"
      >
        <Download className="w-4 h-4" />
        下载 App
      </a>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">学生端登录</h1>
          <p className="text-gray-500 mt-2">课堂助手智能体</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition"
                placeholder="请输入你的姓名"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? '进入中...' : '进入学习'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
