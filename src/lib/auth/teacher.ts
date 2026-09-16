import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 教师端鉴权工具。
 *
 * 设计说明：
 * - token 采用「base64url(payload) + HMAC-SHA256 签名」结构，替代原先的
 *   base64(username:timestamp) 明文 token（那种可被任意伪造）。
 * - 登录成功后除了返回 token（前端仍存 localStorage 用于页面跳转判断），
 *   还会写入 HttpOnly Cookie：前端各处 fetch 会自动携带，
 *   无需修改 25+ 处调用点，也避免 token 被 XSS 读取。
 * - secure 固定为 false：公开课场景可能通过 http://IP:端口 直连访问，
 *   若开启 secure 则 HTTP 下 Cookie 不会发送，会导致登录后全部接口 401。
 *   仍保留 httpOnly + sameSite=lax 提供基本保护。
 */

export const TEACHER_COOKIE_NAME = 'teacher_session';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
export const TEACHER_TOKEN_TTL_SECONDS = TOKEN_TTL_MS / 1000;

/** 签名密钥：部署时通过环境变量 TEACHER_TOKEN_SECRET 覆盖默认值 */
const SECRET =
  process.env.TEACHER_TOKEN_SECRET || 'kecheng-teacher-default-secret-please-change';

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function sign(payload: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', SECRET).update(payload).digest());
}

/** 签发教师 token */
export function issueTeacherToken(username: string): string {
  const payload = base64UrlEncode(
    JSON.stringify({ username, issuedAt: Date.now() })
  );
  return `${payload}.${sign(payload)}`;
}

/** 校验教师 token：签名正确且未过期才返回 payload，否则返回 null */
export function verifyTeacherToken(
  token: string | null | undefined
): { username: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(base64UrlDecode(payload)) as {
      username?: string;
      issuedAt?: number;
    };
    if (!data?.username || typeof data.issuedAt !== 'number') return null;
    if (Date.now() - data.issuedAt > TOKEN_TTL_MS) return null;
    return { username: data.username };
  } catch {
    return null;
  }
}

/**
 * 教师专属接口的鉴权守卫。
 * 通过（Cookie 或 Authorization: Bearer）返回 null；未通过返回 401 响应。
 *
 * 用法：
 *   const authError = requireTeacherAuth(request);
 *   if (authError) return authError;
 */
export function requireTeacherAuth(request: NextRequest): NextResponse | null {
  const cookieToken = request.cookies.get(TEACHER_COOKIE_NAME)?.value;
  const headerToken = (request.headers.get('authorization') || '').replace(
    /^Bearer\s+/i,
    ''
  );
  const session = verifyTeacherToken(cookieToken || headerToken);
  if (!session) {
    return NextResponse.json(
      { error: '未登录或登录已过期，请重新登录' },
      { status: 401 }
    );
  }
  return null;
}

/** 把教师会话写入 Cookie（登录成功时调用） */
export function setTeacherCookie(response: NextResponse, token: string): void {
  response.cookies.set(TEACHER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TEACHER_TOKEN_TTL_SECONDS,
    secure: false, // 见文件头说明：需兼容 http://IP:端口 直连场景
  });
}

/** 清除教师会话 Cookie（登出时调用） */
export function clearTeacherCookie(response: NextResponse): void {
  response.cookies.set(TEACHER_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: false,
  });
}
