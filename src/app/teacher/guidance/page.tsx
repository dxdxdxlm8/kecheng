'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, X } from 'lucide-react';

interface TeacherPrompt {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export default function GuidancePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState<TeacherPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('教师 Prompt');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('teacher_token')) {
      router.push('/teacher/login');
      return;
    }
    fetchPrompt();
  }, [router]);

  const fetchPrompt = async () => {
    try {
      const res = await fetch('/api/guidance-scripts');
      const data = await res.json();
      setPrompt(data.data || null);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/guidance-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || '教师 Prompt', content }),
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setPrompt(data.data);
      }
      resetForm();
    } catch (err) {
      console.error('Submit error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    if (!prompt) return;
    setTitle(prompt.title || '教师 Prompt');
    setContent(prompt.content || '');
    setShowForm(true);
  };

  const handleCreate = () => {
    setTitle('教师 Prompt');
    setContent('');
    setShowForm(true);
  };

  const handleDelete = async () => {
    if (!prompt) return;
    if (!confirm('确定删除该教师 Prompt？删除后双 Agent 教学流程将缺少教学策略。')) return;
    try {
      await fetch(`/api/guidance-scripts?id=${prompt.id}`, { method: 'DELETE' });
      setPrompt(null);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setTitle('教师 Prompt');
    setContent('');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/teacher/dashboard')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">教师 Prompt 管理</h1>
            </div>
            {prompt ? (
              <button
                onClick={handleEdit}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition"
              >
                <Edit2 className="w-4 h-4" />
                编辑 Prompt
              </button>
            ) : (
              <button
                onClick={handleCreate}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition"
              >
                <Plus className="w-4 h-4" />
                创建教师 Prompt
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">{prompt ? '编辑教师 Prompt' : '创建教师 Prompt'}</h2>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                    placeholder="教师 Prompt"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prompt 内容</label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none resize-y text-sm leading-relaxed"
                    rows={14}
                    placeholder="输入教师教学策略 Prompt..."
                    required
                  />
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                    Prompt 中可设置：本节课教学目标、出题数量（如共出 4 道题）、分层教学规则（如前 3 道基础题后，根据答题情况决定第 4 题难度）、鼓励方式等。教师会严格遵循此 Prompt 进行教学。
                  </p>
                </div>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={resetForm} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                    {saving ? '保存中...' : (prompt ? '保存' : '创建')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : !prompt ? (
          <div className="bg-white rounded-xl p-10 border border-gray-100 shadow-sm text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
              <Plus className="w-7 h-7 text-amber-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-2">尚未设置教师 Prompt，请点击创建</h3>
            <p className="text-sm text-gray-500 mb-4">请点击右上角"创建教师 Prompt"，配置本节课的教学策略。</p>
            <div className="text-xs text-gray-500 leading-relaxed max-w-xl mx-auto bg-gray-50 rounded-lg p-4 text-left">
              <p className="font-medium text-gray-600 mb-1">Prompt 可包含：</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>本节课教学目标</li>
                <li>出题数量（如共出 4 道题）</li>
                <li>分层教学规则（如前 3 道基础题后，根据答题情况决定第 4 题难度）</li>
                <li>鼓励方式、互动节奏等</li>
              </ul>
              <p className="mt-2">教师会严格遵循此 Prompt 进行教学。</p>
            </div>
            <button
              onClick={handleCreate}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition"
            >
              <Plus className="w-4 h-4" />
              创建教师 Prompt
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    全局教师 Prompt
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">{prompt.title}</h2>
                <p className="text-xs text-gray-400">
                  更新时间：{new Date(prompt.updated_at || prompt.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <button onClick={handleEdit} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="编辑">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={handleDelete} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="删除">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{prompt.content}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
