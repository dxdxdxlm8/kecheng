import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: '请输入学生姓名' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // Check if student exists in preset list (only preset students can login)
    const { data: existingStudents, error: findError } = await client
      .from('students')
      .select('id, name')
      .eq('name', name.trim());

    if (findError) throw new Error(`查询学生失败: ${findError.message}`);

    if (!existingStudents || existingStudents.length === 0) {
      return NextResponse.json({ error: '该姓名未在预设名单中，请联系教师添加' }, { status: 403 });
    }

    const student = existingStudents[0];
    const token = Buffer.from(`student:${student.id}:${Date.now()}`).toString('base64');

    return NextResponse.json({
      success: true,
      user: { id: student.id, name: student.name, role: 'student' },
      token,
    });
  } catch (error) {
    console.error('Student login error:', error);
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
