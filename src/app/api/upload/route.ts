import { NextRequest, NextResponse } from 'next/server';
import { getSystemSettings } from '@/lib/settings';
import { generatePresignedUrl, isStorageConfigured, uploadFile } from '@/lib/storage/object-storage';

export async function POST(request: NextRequest) {
  try {
    const settings = await getSystemSettings();
    if (!isStorageConfigured(settings.storage)) {
      return NextResponse.json(
        { error: '尚未配置对象存储：请在教师端「系统设置」中填写存储配置，图片作答功能才可用' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: '仅支持 JPG、PNG、GIF、WebP 格式的图片' }, { status: 400 });
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: '图片大小不能超过 10MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const key = await uploadFile(
      { fileContent: buffer, fileName, contentType: file.type },
      settings.storage
    );

    // Generate a presigned URL for immediate use
    const url = await generatePresignedUrl({ key, expireTime: 3600 }, settings.storage);

    return NextResponse.json({ key, url });
  } catch (error) {
    console.error('Upload error:', error);
    const message = error instanceof Error ? error.message.slice(0, 300) : '';
    return NextResponse.json({ error: `上传失败${message ? `：${message}` : ''}` }, { status: 500 });
  }
}
