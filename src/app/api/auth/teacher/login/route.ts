import { NextRequest, NextResponse } from 'next/server';
import { issueTeacherToken, setTeacherCookie } from '@/lib/auth/teacher';

/**
 * 教师登录。
 * - 账号密码从环境变量 TEACHER_USERNAME / TEACHER_PASSWORD 读取（部署时配置），
 *   未配置时回退默认账号，保证开箱可用。
 * - 登录成功签发 HMAC 签名 token（替代原先可伪造的 base64 明文 token），
 *   同时写入 HttpOnly Cookie，供后续教师接口校验。
 */
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: '请输入用户名和密码' }, { status: 400 });
    }

    const expectedUsername = process.env.TEACHER_USERNAME || 'admin';
    const expectedPassword = process.env.TEACHER_PASSWORD || 'admin123';

    if (username !== expectedUsername || password !== expectedPassword) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const token = issueTeacherToken(username);
    const response = NextResponse.json({
      success: true,
      user: { username, name: '管理员', role: 'teacher' },
      token,
    });
    setTeacherCookie(response, token);
    return response;
  } catch (error) {
    console.error('Teacher login error:', error);
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
