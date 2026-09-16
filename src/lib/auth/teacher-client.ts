/**
 * 教师端前端鉴权辅助。
 * 由于教师会话同时以 HttpOnly Cookie 保存，普通 fetch 会自动携带凭据，
 * 这里只处理登出（必须服务端清 Cookie，否则“登出”后接口仍然放行）。
 */

/** 登出：清前端标记 + 通知服务端清除会话 Cookie */
export async function logoutTeacher(): Promise<void> {
  try {
    localStorage.removeItem('teacher_token');
  } catch {
    /* localStorage 不可用时忽略 */
  }
  try {
    await fetch('/api/auth/teacher/logout', { method: 'POST' });
  } catch {
    /* 网络异常也不阻塞跳转，下次请求接口会因 Cookie 过期被拒 */
  }
}

/**
 * 教师端统一请求入口。
 * 与普通 fetch 的区别：遇到 401（会话缺失/过期）时清理本地登录标记并跳回登录页，
 * 避免接口被鉴权拦下后页面一直空白或停在"加载中"。
 * 其它错误状态原样返回，由调用方展示错误提示。
 */
export async function teacherFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    try {
      localStorage.removeItem('teacher_token');
      localStorage.removeItem('teacher_user');
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && !window.location.pathname.includes('/teacher/login')) {
      window.location.href = '/teacher/login';
    }
  }
  return res;
}
