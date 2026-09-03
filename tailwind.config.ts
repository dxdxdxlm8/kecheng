import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind v3 配置（从 v4 降级以兼容老浏览器内核，详见 2026-09-03 迁移记录）。
 * 颜色使用字面量值而非 CSS 变量，这样 /透明度 修饰符（bg-primary/90 等）在 v3 下可用。
 * 深色模式未启用（全项目无 dark: 类），如需启用需把颜色改为 hsl(var(--x) / <alpha-value>) 形式。
 */
const config: Config = {
  content: [
    './src/app/**/*{ts,tsx}',
    './src/components/**/*{ts,tsx}',
    './src/hooks/**/*{ts,tsx}',
    './src/lib/**/*{ts,tsx}',
  ],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
      'background': '#ffffff',
      'foreground': '#0a0a0a',
      'card': '#ffffff',
      'card-foreground': '#0a0a0a',
      'popover': '#ffffff',
      'popover-foreground': '#0a0a0a',
      'primary': '#171717',
      'primary-foreground': '#fafafa',
      'secondary': '#f5f5f5',
      'secondary-foreground': '#171717',
      'muted': '#f5f5f5',
      'muted-foreground': '#737373',
      'accent': '#f5f5f5',
      'accent-foreground': '#171717',
      'destructive': '#e7000b',
      'border': '#e5e5e5',
      'input': '#e5e5e5',
      'ring': '#a1a1a1',
      'chart-1': '#f54900',
      'chart-2': '#009689',
      'chart-3': '#104e64',
      'chart-4': '#ffb900',
      'chart-5': '#fe9a00',
      'sidebar': '#fafafa',
      'sidebar-foreground': '#0a0a0a',
      'sidebar-primary': '#171717',
      'sidebar-primary-foreground': '#fafafa',
      'sidebar-accent': '#f5f5f5',
      'sidebar-accent-foreground': '#171717',
      'sidebar-border': '#e5e5e5',
      'sidebar-ring': '#a1a1a1',
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        '3xl': 'calc(var(--radius) + 12px)',
        '4xl': 'calc(var(--radius) + 16px)',
      },
      fontFamily: {
        sans: [
          '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'ui-sans-serif',
          'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        mono: [
          'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas',
          '"Liberation Mono"', '"Courier New"', 'monospace',
        ],
        serif: [
          '"Noto Serif SC"', '"Songti SC"', 'SimSun', 'ui-serif', 'Georgia', 'Cambria',
          '"Times New Roman"', 'Times', 'serif',
        ],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%': { opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.2s ease-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
