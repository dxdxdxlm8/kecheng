import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = Buffer.from(`${ADMIN_USERNAME}:${Date.now()}`).toString('base64');
      return NextResponse.json({
        success: true,
        user: { username: ADMIN_USERNAME, name: '管理员', role: 'teacher' },
        token,
      });
    }

    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  } catch (error) {
    console.error('Teacher login error:', error);
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
