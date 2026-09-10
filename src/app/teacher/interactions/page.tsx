'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, ClipboardList, Trash2 } from 'lucide-react';

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
  image_url?: string;
  students?: { name: string };
}

// 纯图片作答时落库的占位文本：有图可显示时不再重复展示
const IMAGE_PLACEHOLDER_TEXTS = ['[图片作答]', '[图片]'];

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
        label: '小航',
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
  // 每个会话的「练习评价」（三道题做完后的总结），key = session_id
  const [practiceEvaluations, setPracticeEvaluations] = useState<Record<string, string>>({});
  // 点击图片后的放大预览（教师查看学生手写过程需要看细节）
  const [previewImage, setPreviewImage] = useState<string>('');
  // 删除模式：勾选若干条互动记录后批量删除
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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
      setPracticeEvaluations(data.practiceEvaluations || {});
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStudentChange = (studentId: string) => {
    setSelectedStudent(studentId);
    exitSelectMode();
    if (studentId) {
      fetchInteractions(studentId);
    } else {
      setInteractions([]);
      setPracticeEvaluations({});
    }
  };

  // ---------- 删除互动记录：选择模式 ----------
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(interactions.map((i) => i.id)));
  };

  const handleConfirmDelete = async () => {
    if (selectedIds.size === 0 || deleting) return;
    const count = selectedIds.size;
    if (!window.confirm(`确定删除选中的 ${count} 条互动记录吗？\n\n删除后不可恢复，学生端的历史记录也会同步消失。`)) {
      return;
    }
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const res = await fetch(`/api/interactions?ids=${encodeURIComponent(ids)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '删除失败');
      await fetchInteractions(selectedStudent);
      exitSelectMode();
    } catch (err) {
      console.error('Delete error:', err);
      alert(`删除失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setDeleting(false);
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
            {selectedStudent && interactions.length > 0 && (
              <button
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition ${
                  selectMode
                    ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    : 'border-red-200 text-red-600 hover:bg-red-50'
                }`}
              >
                <Trash2 className="w-4 h-4" />
                {selectMode ? '退出选择' : '删除记录'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className={`max-w-5xl mx-auto px-4 sm:px-6 py-6 ${selectMode ? 'pb-28' : ''}`}>
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
              小航
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
                    // 纯图片作答落库的占位文本：有图时只展示图片
                    const isPlaceholder = IMAGE_PLACEHOLDER_TEXTS.includes(msg.content.trim());
                    const checked = selectedIds.has(msg.id);
                    const checkbox = (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(msg.id)}
                        aria-label="选择这条互动记录"
                        className="w-4 h-4 shrink-0 cursor-pointer rounded border-gray-300 accent-red-500"
                      />
                    );
                    return (
                      <div key={msg.id} className={`flex items-center gap-2 ${style.align}`}>
                        {selectMode && style.align === 'justify-start' && checkbox}
                        <div
                          onClick={selectMode ? () => toggleSelect(msg.id) : undefined}
                          className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${style.bubble} ${selectMode ? 'cursor-pointer' : ''} ${checked ? 'ring-2 ring-red-400' : ''}`}
                        >
                          <p className={`text-xs font-medium mb-1 ${style.labelColor}`}>
                            {style.label}
                          </p>
                          {msg.image_url ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPreviewImage(msg.image_url!); }}
                              className="block cursor-zoom-in"
                              title="点击放大查看"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.image_url}
                                alt="学生作答图片"
                                className="max-w-full max-h-64 rounded-lg border border-black/5 object-contain"
                              />
                            </button>
                          ) : isPlaceholder ? (
                            // 有图片记录但 URL 生成失败（如存储未配置）时的兜底展示
                            <p className="whitespace-pre-wrap italic opacity-60">[图片作答]</p>
                          ) : null}
                          {!(msg.image_url && isPlaceholder) && (
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          )}
                          <p className="text-xs opacity-40 mt-1">
                            {new Date(msg.created_at).toLocaleTimeString('zh-CN')}
                          </p>
                        </div>
                        {selectMode && style.align === 'justify-end' && checkbox}
                      </div>
                    );
                  })}

                  {/* 三道题做完后的练习评价（学生端可见，教师端在此一并展示） */}
                  {practiceEvaluations[sessionId] && (
                    <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                          <ClipboardList className="w-4 h-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium text-blue-900">练习评价</span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {practiceEvaluations[sessionId]}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 选择删除时的底部操作栏 */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              已选 <span className="font-medium text-red-600">{selectedIds.size}</span> 条
              <span className="text-gray-400 ml-2">共 {interactions.length} 条</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                disabled={selectedIds.size === interactions.length}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white"
              >
                全选
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white"
              >
                清空
              </button>
              <button
                onClick={exitSelectMode}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={selectedIds.size === 0 || deleting}
                className="px-4 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:hover:bg-red-500"
              >
                {deleting ? '删除中...' : `确认删除${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片放大预览层：点击任意处关闭 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setPreviewImage('')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImage}
            alt="学生作答图片（放大）"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
