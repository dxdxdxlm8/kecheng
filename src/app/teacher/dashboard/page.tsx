'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, FileText, MessageSquare, BarChart3, LogOut, Lightbulb, Users, Target, Cpu, Trash2 } from 'lucide-react';

interface TeacherUser {
  email: string;
  name: string;
  role: string;
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<TeacherUser | null>(null);
  const [stats, setStats] = useState({ students: 0, interactions: 0, summaries: 0 });

  useEffect(() => {
    const token = localStorage.getItem('teacher_token');
    const userData = localStorage.getItem('teacher_user');
    if (!token || !userData) {
      router.push('/teacher/login');
      return;
    }
    setUser(JSON.parse(userData));

    // Fetch stats
    Promise.all([
      fetch('/api/summaries').then(r => r.json()),
    ]).then(([summariesData]) => {
      const students = summariesData.data?.length || 0;
      const interactions = summariesData.data?.reduce((acc: number, s: { interaction_count: number }) => acc + s.interaction_count, 0) || 0;
      const summariesCount = summariesData.data?.filter((s: { latest_summary: unknown }) => s.latest_summary).length || 0;
      setStats({ students, interactions, summaries: summariesCount });
    }).catch(() => {});
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('teacher_token');
    localStorage.removeItem('teacher_user');
    router.push('/teacher/login');
  };

  // Tailwind 需要静态类名，不能用 bg-${color}-100 这类动态拼接
  const COLOR_CLASS: Record<string, { bg: string; fg: string }> = {
    cyan: { bg: 'bg-cyan-100', fg: 'text-cyan-600' },
    blue: { bg: 'bg-blue-100', fg: 'text-blue-600' },
    purple: { bg: 'bg-purple-100', fg: 'text-purple-600' },
    amber: { bg: 'bg-amber-100', fg: 'text-amber-600' },
    green: { bg: 'bg-green-100', fg: 'text-green-600' },
    rose: { bg: 'bg-rose-100', fg: 'text-rose-600' },
    indigo: { bg: 'bg-indigo-100', fg: 'text-indigo-600' },
    slate: { bg: 'bg-slate-200', fg: 'text-slate-700' },
    red: { bg: 'bg-red-100', fg: 'text-red-600' },
  };

  const menuItems = [
    { href: '/teacher/students', icon: Users, label: '学生管理', desc: '预设学生姓名，控制登录权限', color: 'cyan' },
    { href: '/teacher/knowledge', icon: BookOpen, label: '知识点管理', desc: '管理教学知识点内容', color: 'blue' },
    { href: '/teacher/guidance', icon: Lightbulb, label: '引导话术', desc: '管理教学引导话术', color: 'amber' },
    { href: '/teacher/interactions', icon: MessageSquare, label: '互动记录', desc: '查看学生互动记录', color: 'green' },
    { href: '/teacher/summaries', icon: BarChart3, label: '学情评价', desc: '查看全班学情汇总', color: 'rose' },
    { href: '/teacher/accuracy', icon: Target, label: '答题正确率', desc: '查看每位学生三道练习的正确率', color: 'indigo' },
    { href: '/teacher/settings', icon: Cpu, label: '系统设置', desc: '配置大模型接口地址、密钥与模型', color: 'slate' },
    { href: '/teacher/records', icon: Trash2, label: '清空记录', desc: '清空学生端对话记录、学习总结等数据', color: 'red' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">教师端</h1>
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
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">互动消息</p>
                <p className="text-2xl font-bold text-gray-900">{stats.interactions}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">学生数量</p>
                <p className="text-2xl font-bold text-gray-900">{stats.students}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">学习总结</p>
                <p className="text-2xl font-bold text-gray-900">{stats.summaries}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Menu Grid */}
        <h2 className="text-lg font-semibold text-gray-900 mb-4">功能菜单</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {menuItems.map((item) => {
            const colorClass = COLOR_CLASS[item.color] ?? COLOR_CLASS.blue;
            return (
            <Link
              key={item.href}
              href={item.href}
              className="bg-white rounded-xl p-6 border border-gray-100 shadow hover:shadow-md hover:border-gray-200 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClass.bg}`}>
                  <item.icon className={`w-5 h-5 ${colorClass.fg}`} />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 group-hover:text-gray-700">{item.label}</h3>
                  <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
