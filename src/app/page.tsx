'use client';

import Link from 'next/link';
import { BookOpen, GraduationCap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            课堂助手智能体
          </h1>
          <p className="text-lg text-gray-600">
            教师与学生双端互动的智能教学平台
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Teacher Entry */}
          <Link
            href="/teacher/login"
            className="group block bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 p-8 border border-gray-100 hover:border-blue-200"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-blue-200 transition-colors">
                <BookOpen className="w-10 h-10 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">教师端</h2>
              <p className="text-gray-500 mb-4">
                管理知识点、题目和引导话术，查看学生互动记录，生成学情评价
              </p>
              <span className="inline-flex items-center text-blue-600 font-medium group-hover:text-blue-700">
                进入教师端
                <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Student Entry */}
          <Link
            href="/student/login"
            className="group block bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 p-8 border border-gray-100 hover:border-green-200"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-green-200 transition-colors">
                <GraduationCap className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">学生端</h2>
              <p className="text-gray-500 mb-4">
                与智能体互动学习，完成知识点测试，获取课后学习总结
              </p>
              <span className="inline-flex items-center text-green-600 font-medium group-hover:text-green-700">
                进入学生端
                <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>
        </div>

        <div className="mt-12 text-center text-sm text-gray-400">
          <p>教师默认账号: admin@classroom.com / admin123456</p>
        </div>
      </div>
    </div>
  );
}
