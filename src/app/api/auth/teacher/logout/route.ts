import { NextResponse } from 'next/server';
import { clearTeacherCookie } from '@/lib/auth/teacher';

/** 教师登出：清除 HttpOnly 会话 Cookie（否则登出后 Cookie 仍在，接口依然放行） */
export async function POST() {
  const response = NextResponse.json({ success: true });
  clearTeacherCookie(response);
  return response;
}
