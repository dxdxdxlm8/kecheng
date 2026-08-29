import type { Metadata } from 'next';
import { SupabaseConfigProvider } from '@/lib/supabase-config-inject';
import './globals.css';

export const metadata: Metadata = {
  title: '课堂助手智能体',
  description: '教师与学生双端互动的课堂助手智能体系统',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <SupabaseConfigProvider>
          {children}
        </SupabaseConfigProvider>
      </body>
    </html>
  );
}
