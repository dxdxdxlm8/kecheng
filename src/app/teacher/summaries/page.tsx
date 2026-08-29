'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Eye } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface LatestSummary {
  session_id: string;
  strengths: string;
  weaknesses: string;
  suggestions: string;
  question_total: number;
  question_correct: number;
  discussion_summary: string;
  overall_summary: string;
  created_at: string;
}

interface StudentSummary {
  id: string;
  name: string;
  interaction_count: number;
  answer_total: number;
  answer_correct: number;
  accuracy: number;
  latest_summary: LatestSummary | null;
  created_at: string;
}

export default function SummariesPage() {
  const router = useRouter();
  const [data, setData] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogStudent, setDialogStudent] = useState<StudentSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('teacher_token')) {
      router.push('/teacher/login');
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/summaries');
      const result = await res.json();
      setData(result.data || []);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    const headers = [
      '学生姓名',
      '讨论情况',
      '优点',
      '不足',
      '建议',
      '课堂总览',
    ];

    const rows = data.map((s) => {
      const ls = s.latest_summary;
      return [
        s.name,
        ls?.discussion_summary || '暂无',
        ls?.strengths || '暂无',
        ls?.weaknesses || '暂无',
        ls?.suggestions || '暂无',
        ls?.overall_summary || '暂无',
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `学情评价_${new Date().toLocaleDateString('zh-CN')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openOverview = (student: StudentSummary) => {
    setDialogStudent(student);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/teacher/dashboard')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-gray-900">全班学情评价</h1>
            </div>
            {data.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700 transition"
              >
                <Download className="w-4 h-4" />
                导出CSV
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无学情数据，学生需要先完成互动和学习</div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-sm font-medium text-gray-600">学生</th>
                    <th className="text-left px-5 py-3 text-sm font-medium text-gray-600">讨论情况</th>
                    <th className="text-left px-5 py-3 text-sm font-medium text-gray-600">优点</th>
                    <th className="text-left px-5 py-3 text-sm font-medium text-gray-600">不足</th>
                    <th className="text-left px-5 py-3 text-sm font-medium text-gray-600">建议</th>
                    <th className="text-center px-5 py-3 text-sm font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((student) => {
                    const ls = student.latest_summary;
                    const discussionText = ls?.discussion_summary || '';
                    const discussionPreview = discussionText.slice(0, 50);
                    return (
                      <tr key={student.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-4">
                          <div className="font-medium text-gray-900">{student.name}</div>
                          <div className="text-xs text-gray-400">{new Date(student.created_at).toLocaleDateString('zh-CN')}</div>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 max-w-[200px]" title={discussionText}>
                          <div className="line-clamp-2">
                            {discussionPreview || '-'}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 max-w-[200px]">
                          <div className="line-clamp-3">{ls?.strengths || '-'}</div>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 max-w-[200px]">
                          <div className="line-clamp-3">{ls?.weaknesses || '-'}</div>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600 max-w-[200px]">
                          <div className="line-clamp-3">{ls?.suggestions || '-'}</div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <button
                            onClick={() => openOverview(student)}
                            disabled={!ls?.overall_summary}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 rounded-md hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            查看总览
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogStudent?.name} - 课堂表现总览</DialogTitle>
            <DialogDescription>
              {dialogStudent?.latest_summary?.created_at
                ? `生成时间：${new Date(dialogStudent.latest_summary.created_at).toLocaleString('zh-CN')}`
                : '暂无总览数据'}
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {dialogStudent?.latest_summary?.overall_summary || '暂无总览内容'}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
