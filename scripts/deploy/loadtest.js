#!/usr/bin/env node
/**
 * ============================================================
 * kecheng 并发压测生成器（零依赖，只用 Node 内置模块）
 *
 * 设计要点：
 *   1) 用固定并发「虚拟用户」循环打页面，而不是无脑刷单接口 ——
 *      真实课堂是一个学生打开一个页面，页面里带 12 个 _next 静态 chunk。
 *   2) ASSETS=1 时会解析 HTML，把页面引用的全部 /_next/static/* 拉一遍，
 *      模拟浏览器完整加载。这是最接近真实的开销（本项目的 nginx 没给
 *      静态资源开直出，chunk 也走 Node，所以必须算进来）。
 *   3) 走 keepAlive Agent（浏览器就是长连接），maxSockets = 并发数。
 *   4) 支持 WARMUP 预热（默认 3s，这期间请求不计入统计，避开 JIT/缓存冷启动）。
 *   5) 输出机器可读的 JSON 到 stdout，人读摘要到 stderr，方便编排脚本解析。
 *
 * 用法：
 *   TARGET_HOST=103.115.56.210 TARGET_PORT=80 CONC=30 DURATION=30 \
 *     ASSETS=1 PATHS=/student/login node loadtest.js
 *
 * 环境变量：
 *   TARGET_HOST  目标主机（默认 127.0.0.1）
 *   TARGET_PORT  目标端口（默认 80）
 *   CONC         并发虚拟用户数（默认 30）
 *   DURATION     统计时长秒（默认 30，不含 WARMUP）
 *   WARMUP       预热秒（默认 3，不计入统计）
 *   RAMP         并发爬坡秒（默认 0 = 瞬间打满；设 10 则 10 秒内逐步起满）
 *   PATHS        逗号分隔的页面路径（默认 /student/login）
 *   ASSETS       1 = 同时拉取页面引用的静态资源（默认 0）
 *   REQ_TIMEOUT  单请求超时毫秒（默认 20000）
 *
 * ⚠️ 本机若设了 http_proxy，Node 内置 http 不走代理，无需特判；
 *    但若是用 fetch/undici 需要显式设 no_proxy。
 *
 * ⚠️⚠️ 重要实测经验（2026-09-10）：想要「服务器能扛多少」的权威数字，
 *     必须把本脚本放到服务器本机上跑（TARGET_HOST=127.0.0.1）。
 *     从开发机跨公网跑，读数会被 ①本机出口带宽 ②本机可能存在的透明代理
 *     污染 —— 实测同一台服务器，跨网跑 CPU 显示 40-60%、连接数正常，
 *     放本机跑却只有 8-13%、连接数归 0，两者客户端 rps 却几乎一样。
 *     用服务器本机跑 + nginx access.log 行数差值交叉验证，才是可信口径。
 * ============================================================
 */
'use strict';

const http = require('http');
const zlib = require('zlib');

const HOST = process.env.TARGET_HOST || '127.0.0.1';
const PORT = Number(process.env.TARGET_PORT || 80);
const CONC = Number(process.env.CONC || 30);
const DURATION = Number(process.env.DURATION || 30);
const WARMUP = Number(process.env.WARMUP || 3);
const RAMP = Number(process.env.RAMP || 0);
const PATHS = (process.env.PATHS || '/student/login')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ASSETS = process.env.ASSETS === '1';
const REQ_TIMEOUT = Number(process.env.REQ_TIMEOUT || 20000);

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONC,
  keepAliveMsecs: 15000,
});

/** 统计桶：html = 页面请求，asset = 静态资源请求 */
function bucket() { return { n: 0, ok: 0, bad: 0, err: 0, lat: [] }; }
const stats = { html: bucket(), asset: bucket(), bytes: 0, encGzip: 0, encNone: 0 };

function get(path, wantBody) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    let settled = false;
    const finish = (o) => {
      if (settled) return;
      settled = true;
      o.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      resolve(o);
    };

    const req = http.request({
      host: HOST, port: PORT, path, method: 'GET', agent,
      headers: {
        Host: HOST,
        'User-Agent': 'Mozilla/5.0 (compatible; kecheng-loadtest/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Connection: 'keep-alive',
      },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (d) => { bytes += d.length; if (wantBody) chunks.push(d); });
      res.on('end', () => {
        let body = null;
        const ce = String(res.headers['content-encoding'] || '').toLowerCase();
        if (wantBody) {
          let buf = Buffer.concat(chunks);
          try {
            if (ce === 'gzip') buf = zlib.gunzipSync(buf);
            else if (ce === 'deflate') buf = zlib.inflateSync(buf);
            else if (ce === 'br') buf = zlib.brotliDecompressSync(buf);
          } catch (_) { /* 解码失败就用原始字节，不影响状态码统计 */ }
          body = buf.toString('utf8');
        }
        finish({ status: res.statusCode, bytes, body, ce });
      });
      res.on('error', () => finish({ status: 0, bytes, err: true }));
    });

    req.setTimeout(REQ_TIMEOUT, () => req.destroy(new Error('req-timeout')));
    req.on('error', () => finish({ status: 0, bytes: 0, err: true }));
    req.end();
  });
}

function record(kind, r) {
  const s = stats[kind];
  s.n++;
  stats.bytes += r.bytes || 0;
  if (r.ce === 'gzip') stats.encGzip++; else if (r.ce === '') stats.encNone++;
  if (r.err || !r.status) { s.err++; return; }
  // 200/302 都算正常（根路径 302 是设计行为）
  if (r.status >= 200 && r.status < 400) s.ok++; else s.bad++;
  s.lat.push(r.ms);
}

const ASSET_RE = /(?:src|href)="(\/_next\/static\/[^"\\]+)"/g;
function extractAssets(html) {
  const set = new Set();
  let m;
  ASSET_RE.lastIndex = 0;
  while ((m = ASSET_RE.exec(html))) set.add(m[1]);
  return [...set];
}

// ---------- 时间控制 ----------
const t0 = Date.now();
const stopAt = t0 + (WARMUP + DURATION) * 1000;
let recording = WARMUP <= 0;
if (!recording) {
  setTimeout(() => { recording = true; console.error(`[loadtest] 预热结束(${WARMUP}s)，开始统计`); }, WARMUP * 1000);
}
const timeLeft = () => stopAt - Date.now();

let htmlPages = 0;

async function worker(id) {
  // 爬坡：第 id 个虚拟用户延迟 id*(RAMP/CONC) 秒启动
  if (RAMP > 0 && CONC > 1) {
    await new Promise((r) => setTimeout(r, Math.round((id * RAMP * 1000) / CONC)));
  }
  while (timeLeft() > 0) {
    const path = PATHS[Math.floor(Math.random() * PATHS.length)];
    const r = await get(path, ASSETS);
    if (recording) { record('html', r); htmlPages++; }

    if (ASSETS && r.body) {
      const assets = extractAssets(r.body);
      for (const a of assets) {
        if (timeLeft() <= 0) break;
        const ar = await get(a, false);
        if (recording) record('asset', ar);
      }
    }
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)))];
}
function statLine(s, secs) {
  const rss = s.n / Math.max(1, secs);
  return {
    requests: s.n,
    ok: s.ok,
    non2xx_3xx: s.bad,
    errors: s.err,
    rps: Number(rss.toFixed(1)),
    err_rate_pct: Number(((s.err / Math.max(1, s.n)) * 100).toFixed(2)),
    latency_ms: {
      p50: Number(pct(s.lat, 50).toFixed(1)),
      p90: Number(pct(s.lat, 90).toFixed(1)),
      p95: Number(pct(s.lat, 95).toFixed(1)),
      p99: Number(pct(s.lat, 99).toFixed(1)),
      max: Number((s.lat.length ? Math.max(...s.lat) : 0).toFixed(1)),
    },
  };
}

async function main() {
  console.error(`[loadtest] 目标 http://${HOST}:${PORT}  并发 ${CONC}  时长 ${DURATION}s(+预热${WARMUP}s)  资源模式 ${ASSETS ? '全加载' : '仅页面'}  路径 ${PATHS.join(',')}`);

  const ticker = setInterval(() => {
    const el = Math.round((Date.now() - t0) / 1000);
    console.error(`[loadtest]   ${el}s  页面${stats.html.n}  资源${stats.asset.n}  错误${stats.html.err + stats.asset.err}`);
  }, 5000);

  const workers = [];
  for (let i = 0; i < CONC; i++) workers.push(worker(i));
  await Promise.all(workers);
  clearInterval(ticker);

  const secs = DURATION;
  const total = stats.html.n + stats.asset.n;
  const out = {
    config: { target: `${HOST}:${PORT}`, conc: CONC, duration_s: DURATION, warmup_s: WARMUP, assets: ASSETS, paths: PATHS },
    page_loads: htmlPages,
    page_loads_per_sec: Number((htmlPages / secs).toFixed(1)),
    total_requests: total,
    total_rps: Number((total / secs).toFixed(1)),
    downloaded_mb: Number((stats.bytes / 1048576).toFixed(1)),
    gzip_encoded_responses: stats.encGzip,
    identity_encoded_responses: stats.encNone,
    html: statLine(stats.html, secs),
    asset: statLine(stats.asset, secs),
  };

  console.error('\n================ 压测结果 ================');
  console.error(`页面加载完成   : ${htmlPages} 次 (${out.page_loads_per_sec}/s)`);
  console.error(`总请求         : ${total} (${out.total_rps}/s)   传输 ${out.downloaded_mb}MB`);
  console.error(`HTML  请求     : ${out.html.requests}  ok=${out.html.ok} err=${out.html.errors}  p95=${out.html.latency_ms.p95}ms  max=${out.html.latency_ms.max}ms`);
  console.error(`静态  请求     : ${out.asset.requests}  ok=${out.asset.ok} err=${out.asset.errors}  p95=${out.asset.latency_ms.p95}ms  max=${out.asset.latency_ms.max}ms`);
  console.error(`gzip 生效      : ${out.gzip_encoded_responses} 条压缩 / ${out.identity_encoded_responses} 条未压缩`);
  console.error('==========================================');

  process.stdout.write(JSON.stringify(out) + '\n');
  agent.destroy();
}

main().catch((e) => { console.error('[loadtest] 异常:', e); process.exit(1); });
