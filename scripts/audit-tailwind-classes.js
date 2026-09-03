/**
 * Tailwind 类覆盖率审计：
 * 1. 从源码提取所有疑似 Tailwind 类名
 * 2. 检查每个类是否在生成的 CSS 中有对应选择器
 * 3. 输出缺失清单（即 v3 不认识/没生成的类，需要人工处理）
 *
 * 用法：node scripts/audit-tailwind-classes.js <css文件...>
 */
const fs = require('fs');
const path = require('path');

const cssFiles = process.argv.slice(2);
if (!cssFiles.length) {
  console.error('用法: node scripts/audit-tailwind-classes.js <css文件...>');
  process.exit(1);
}

let css = '';
for (const f of cssFiles) css += fs.readFileSync(f, 'utf8');

// ---------- 1. 从源码提取类名 ----------
function extractFromDir(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('_')) continue;
      extractFromDir(p, out);
    } else if (/\.(tsx?|css)$/.test(e.name)) {
      const src = fs.readFileSync(p, 'utf8');
      // 抓取所有字符串（含模板串），再按空白切分
      const strings = src.match(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g) || [];
      for (const s of strings) {
        for (const tok of s.slice(1, -1).split(/\s+/)) {
          if (tok) out.add(tok);
        }
      }
    }
  }
}

const tokens = new Set();
extractFromDir(path.join(__dirname, '..', 'src'), tokens);

// ---------- 2. 过滤出疑似 Tailwind 类 ----------
function isTailwindLike(t) {
  if (/[\s{};]/.test(t)) return false;
  // 变体前缀（hover: md: data-[...]: [&...]: 等）或核心工具
  if (/^[a-z0-9-]+:/.test(t)) return true;
  if (/^(bg|text|border|ring|outline|from|to|via|fill|stroke|shadow|rounded|w|h|min-|max-|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space|grid|col|row|flex|items|justify|font|leading|tracking|size|top|bottom|left|right|inset|z|opacity|transition|animate|absolute|relative|fixed|sticky|static|block|inline|hidden|overflow|object|list|whitespace|break|content|self|place|cursor|select|resize|appearance|pointer-events|sr-only|not-sr-only|underline|truncate|antialiased|subpixel|aspect|columns|basis|grow|shrink|order|divide|scroll|snap|touch|will|contain|isolation|decoration|uppercase|lowercase|capitalize|italic|line-through|align|table|float|clear|first|last|odd|even|peer|group|dark|focus|active|disabled|hover|visited|target|required|invalid|checked|read-only|empty|indeterminate)/.test(t)) return true;
  return false;
}

const candidates = [...tokens].filter(isTailwindLike).sort();

// ---------- 3. 转义后在 CSS 中查找 ----------
function escapeForCss(t) {
  // Tailwind 生成选择器时对特殊字符加反斜杠
  return t.replace(/([.:\/\[\]%()#&>'"*,=~|+])/g, '\\$1');
}

const missing = [];
const found = [];
for (const t of candidates) {
  // 跳过含模板插值痕迹的 token
  if (t.includes('${') || t.includes('`')) continue;
  const esc = escapeForCss(t);
  if (css.includes('.' + esc)) found.push(t);
  else missing.push(t);
}

console.log(`候选类总数: ${candidates.length}`);
console.log(`命中: ${found.length}`);
console.log(`缺失: ${missing.length}`);
if (missing.length) {
  console.log('\n--- 缺失清单（v3 未生成对应 CSS，需人工确认）---');
  for (const m of missing) console.log('  ' + m);
}
