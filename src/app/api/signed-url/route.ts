import { NextRequest, NextResponse } from 'next/server';
import { getSystemSettings } from '@/lib/settings';
import { generatePresignedUrl, isStorageConfigured } from '@/lib/storage/object-storage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: '缺少文件 key' }, { status: 400 });
    }

    const settings = await getSystemSettings();
    if (!isStorageConfigured(settings.storage)) {
      return NextResponse.json({ error: '尚未配置对象存储' }, { status: 400 });
    }

    const url = await generatePresignedUrl({ key, expireTime: 3600 }, settings.storage);

    return NextResponse.json({ url });
  } catch (error) {
    console.error('Get signed URL error:', error);
    return NextResponse.json({ error: '获取链接失败' }, { status: 500 });
  }
}
