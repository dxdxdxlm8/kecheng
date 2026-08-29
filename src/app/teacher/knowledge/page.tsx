'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Plus, Trash2, ImagePlus, X, LogOut, LayoutDashboard } from 'lucide-react';

interface KnowledgePoint {
  id: string;
  title: string;
  content: string;
  image_key: string | null;
  created_at: string;
  updated_at: string | null;
}

export default function KnowledgePage() {
  const router = useRouter();
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('teacher_token');
    if (!token) {
      router.push('/teacher/login');
      return;
    }
    fetchPoints();
  }, [router]);

  const fetchPoints = async () => {
    try {
      const res = await fetch('/api/knowledge-points');
      const data = await res.json();
      const pts: KnowledgePoint[] = data.data || [];
      setPoints(pts);

      // Load presigned URLs for images
      for (const p of pts) {
        if (p.image_key) {
          loadImageUrl(p.id, p.image_key);
        }
      }
    } catch (err) {
      console.error('Fetch knowledge points error:', err);
    }
  };

  const loadImageUrl = async (pointId: string, key: string) => {
    try {
      const res = await fetch(`/api/signed-url?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.url) {
        setImageUrls(prev => ({ ...prev, [pointId]: data.url }));
      }
    } catch (err) {
      console.error('Load image URL error:', err);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('仅支持 JPG、PNG、GIF、WebP 格式的图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('图片大小不能超过 10MB');
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      return data.key || null;
    } catch (err) {
      console.error('Upload image error:', err);
      return null;
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return;
    setLoading(true);
    try {
      let imageKey: string | null = null;
      if (selectedImage) {
        imageKey = await uploadImage(selectedImage);
      }

      const res = await fetch('/api/knowledge-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), image_key: imageKey }),
      });
      const data = await res.json();
      if (data.data) {
        setPoints(prev => [data.data, ...prev]);
        if (data.data.image_key) {
          loadImageUrl(data.data.id, data.data.image_key);
        }
      }
      setTitle('');
      setContent('');
      clearImage();
    } catch (err) {
      console.error('Create knowledge point error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该知识点？')) return;
    try {
      await fetch(`/api/knowledge-points?id=${id}`, { method: 'DELETE' });
      setPoints(prev => prev.filter(p => p.id !== id));
      setImageUrls(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error('Delete knowledge point error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-blue-50">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleImageSelect}
      />

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-blue-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">知识点管理</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/teacher/dashboard')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                <LayoutDashboard className="w-4 h-4" />
                仪表盘
              </button>
              <button
                onClick={() => { localStorage.removeItem('teacher_token'); router.push('/teacher/login'); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Create form */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">添加知识点</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                placeholder="输入知识点标题"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm"
                placeholder="输入知识点内容"
                rows={4}
              />
            </div>

            {/* Image upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">配图（可选）</label>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="预览" className="max-h-40 rounded-lg border border-gray-200" />
                  <button
                    onClick={clearImage}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition shadow"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-400 transition"
                >
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-sm">点击上传图片</span>
                </button>
              )}
            </div>

            <button
              onClick={handleCreate}
              disabled={loading || !title.trim() || !content.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              添加
            </button>
          </div>
        </div>

        {/* List */}
        <div className="space-y-4">
          {points.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无知识点，请添加</p>
            </div>
          ) : (
            points.map((point) => (
              <div key={point.id} className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{point.title}</h3>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{point.content}</p>
                    {imageUrls[point.id] && (
                      <div className="mt-3">
                        <img
                          src={imageUrls[point.id]}
                          alt={point.title}
                          className="max-h-48 rounded-lg border border-gray-100"
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">
                      创建于 {new Date(point.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(point.id)}
                    className="text-gray-400 hover:text-red-500 transition ml-4"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
