'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Circle, Minus, Play, Pause, RotateCcw, Pencil, MousePointer,
  ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { GeometryCanvas } from '@/components/GeometryCanvas';

interface StudentUser {
  id: string;
  name: string;
  role: string;
}

// 预设动画场景
const PRESETS = [
  { name: '相离 → 相切 → 相交', desc: '直线逐渐靠近圆', line: { A: 0, B: 1, startC: 8, endC: -2 }, circle: { cx: 0, cy: 0, r: 3 } },
  { name: '相交 → 相切 → 相离', desc: '直线逐渐远离圆', line: { A: 0, B: 1, startC: -2, endC: 8 }, circle: { cx: 0, cy: 0, r: 3 } },
  { name: '水平线穿过圆', desc: '水平线上下移动', line: { A: 1, B: 0, startC: -5, endC: 5 }, circle: { cx: 0, cy: 0, r: 3 } },
  { name: '斜线切过圆', desc: '斜线从远到近', line: { A: 1, B: -1, startC: 8, endC: -2 }, circle: { cx: 0, cy: 0, r: 3 } },
];

export default function GeometryLabPage() {
  const router = useRouter();
  const [user, setUser] = useState<StudentUser | null>(null);

  // 圆参数
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [radius, setRadius] = useState(3);

  // 直线参数
  const [A, setA] = useState(3);
  const [B, setB] = useState(-4);
  const [C, setC] = useState(5);

  // 动画状态
  const [isAnimating, setIsAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [animStartLine, setAnimStartLine] = useState<{ A: number; B: number; C: number } | undefined>();
  const [activePreset, setActivePreset] = useState(-1);
  const animFrameRef = useRef<number>(0);

  // 绘制模式
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPaths, setDrawPaths] = useState<{ x: number; y: number }[][]>([]);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);

  // 展开/折叠面板
  const [showCirclePanel, setShowCirclePanel] = useState(true);
  const [showLinePanel, setShowLinePanel] = useState(true);
  const [showAnimPanel, setShowAnimPanel] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('student_token');
    const userData = localStorage.getItem('student_user');
    if (!token || !userData) {
      router.push('/student/login');
      return;
    }
    setUser(JSON.parse(userData));
  }, [router]);

  // 计算距离和关系
  const dist = Math.abs(A * cx + B * cy + C) / Math.sqrt(A * A + B * B);
  const diff = Math.abs(dist - radius);
  const relationship = diff < 0.05 ? 'tangent' : dist < radius ? 'intersect' : 'separate';
  const relLabel = relationship === 'intersect' ? '相交' : relationship === 'tangent' ? '相切' : '相离';
  const relColor = relationship === 'intersect' ? 'text-green-600' : relationship === 'tangent' ? 'text-amber-600' : 'text-red-600';
  const relBg = relationship === 'intersect' ? 'bg-green-50 border-green-200' : relationship === 'tangent' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  // 动画控制
  const startAnimation = useCallback((presetIdx: number) => {
    const preset = PRESETS[presetIdx];
    setActivePreset(presetIdx);

    // 设置圆参数
    setCx(preset.circle.cx);
    setCy(preset.circle.cy);
    setRadius(preset.circle.r);

    // 设置直线起始参数
    setA(preset.line.A);
    setB(preset.line.B);
    setC(preset.line.startC);

    setAnimStartLine({ A: preset.line.A, B: preset.line.B, C: preset.line.startC });
    setAnimProgress(0);
    setIsAnimating(true);

    const startTime = performance.now();
    const duration = 3000; // 3秒动画

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeInOutCubic
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      setAnimProgress(eased);
      const currentC = preset.line.startC + (preset.line.endC - preset.line.startC) * eased;
      setC(currentC);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        setAnimProgress(0);
        setAnimStartLine(undefined);
      }
    };

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const stopAnimation = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setIsAnimating(false);
    setAnimProgress(0);
    setAnimStartLine(undefined);
  };

  // 重置参数
  const resetParams = () => {
    stopAnimation();
    setCx(0); setCy(0); setRadius(3);
    setA(3); setB(-4); setC(5);
    setDrawPaths([]);
    setActivePreset(-1);
  };

  // 绘制模式 - 将鼠标坐标转为数学坐标
  const canvasToMath = useCallback((e: React.MouseEvent<HTMLDivElement>, canvasW: number, canvasH: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // 简化：假设视口大约 [-8, 8] x [-6, 6]
    const mathX = (mouseX / canvasW) * 16 - 8;
    const mathY = -((mouseY / canvasH) * 12 - 6);
    return { x: Math.round(mathX * 10) / 10, y: Math.round(mathY * 10) / 10 };
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing) return;
    const point = canvasToMath(e, 560, 420);
    setCurrentPath([point]);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || currentPath.length === 0) return;
    const point = canvasToMath(e, 560, 420);
    setCurrentPath(prev => [...prev, point]);
  };

  const handleCanvasMouseUp = () => {
    if (currentPath.length > 1) {
      setDrawPaths(prev => [...prev, currentPath]);
    }
    setCurrentPath([]);
  };

  const clearDrawings = () => {
    setDrawPaths([]);
    setCurrentPath([]);
  };

  // 快捷设置常见场景
  const setScene = (scene: 'intersect' | 'tangent' | 'separate') => {
    stopAnimation();
    setCx(0); setCy(0); setRadius(3);
    setA(3); setB(-4);
    if (scene === 'intersect') setC(0);      // d = 0 < 3
    else if (scene === 'tangent') setC(15);   // d = 15/5 = 3 = r
    else setC(25);                             // d = 25/5 = 5 > 3
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/student/chat')} className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Circle className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">几何实验室</h1>
                <p className="text-xs text-gray-500">圆与直线的位置关系</p>
              </div>
            </div>
            <span className="text-sm text-gray-500">{user?.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* 左侧：画布 + 状态 */}
          <div className="flex-1 min-w-0">
            {/* 关系状态条 */}
            <div className={`mb-3 px-4 py-2.5 rounded-xl border ${relBg} flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${relationship === 'intersect' ? 'bg-green-500' : relationship === 'tangent' ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className={`font-semibold text-sm ${relColor}`}>{relLabel}</span>
                <span className="text-xs text-gray-500 ml-2">
                  d = {Math.round(dist * 100) / 100}，r = {radius}
                  {relationship === 'intersect' && `，d < r`}
                  {relationship === 'tangent' && `，d = r`}
                  {relationship === 'separate' && `，d > r`}
                </span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setScene('separate')} className="px-2 py-0.5 text-xs rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition">相离</button>
                <button onClick={() => setScene('tangent')} className="px-2 py-0.5 text-xs rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition">相切</button>
                <button onClick={() => setScene('intersect')} className="px-2 py-0.5 text-xs rounded-md bg-green-100 text-green-700 hover:bg-green-200 transition">相交</button>
              </div>
            </div>

            {/* 画布 */}
            <div
              className="relative cursor-crosshair"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            >
              <GeometryCanvas
                cx={cx} cy={cy} radius={radius}
                A={A} B={B} C={C}
                width={560} height={420}
                animationProgress={animProgress > 0 ? animProgress : undefined}
                animStartLine={animStartLine}
                drawPaths={[...drawPaths, currentPath]}
                showGrid={true}
                showDistance={true}
              />
            </div>

            {/* 绘图工具栏 */}
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setIsDrawing(!isDrawing)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  isDrawing ? 'bg-pink-100 text-pink-700 border border-pink-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isDrawing ? <MousePointer className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                {isDrawing ? '停止画笔' : '自由画笔'}
              </button>
              {drawPaths.length > 0 && (
                <button onClick={clearDrawings} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 transition">
                  清除笔迹
                </button>
              )}
              <div className="flex-1" />
              <button onClick={resetParams} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition">
                <RotateCcw className="w-3.5 h-3.5" />
                重置
              </button>
            </div>
          </div>

          {/* 右侧：控制面板 */}
          <div className="w-full lg:w-80 space-y-3">
            {/* 圆参数 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowCirclePanel(!showCirclePanel)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
                    <Circle className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">圆参数</span>
                </div>
                {showCirclePanel ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showCirclePanel && (
                <div className="px-4 pb-4 space-y-3">
                  <SliderControl label="圆心 x₀" value={cx} min={-8} max={8} step={0.5} onChange={setCx} color="blue" />
                  <SliderControl label="圆心 y₀" value={cy} min={-8} max={8} step={0.5} onChange={setCy} color="blue" />
                  <SliderControl label="半径 r" value={radius} min={0.5} max={8} step={0.5} onChange={setRadius} color="blue" />
                  <p className="text-xs text-gray-400 pt-1">
                    方程: (x{cx >= 0 ? '-' : '+'}{Math.abs(cx)})² + (y{cy >= 0 ? '-' : '+'}{Math.abs(cy)})² = {radius}²
                  </p>
                </div>
              )}
            </div>

            {/* 直线参数 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowLinePanel(!showLinePanel)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-green-100 rounded flex items-center justify-center">
                    <Minus className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">直线参数</span>
                </div>
                {showLinePanel ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showLinePanel && (
                <div className="px-4 pb-4 space-y-3">
                  <SliderControl label="系数 A" value={A} min={-5} max={5} step={0.5} onChange={setA} color="green" />
                  <SliderControl label="系数 B" value={B} min={-5} max={5} step={0.5} onChange={setB} color="green" />
                  <SliderControl label="系数 C" value={C} min={-15} max={15} step={0.5} onChange={setC} color="green" />
                  <p className="text-xs text-gray-400 pt-1">
                    方程: {A === 1 ? '' : A === -1 ? '-' : A}x{B >= 0 ? '+' : ''}{B === 1 ? '' : B === -1 ? '-' : B}y{C >= 0 ? '+' : ''}{C} = 0
                  </p>
                </div>
              )}
            </div>

            {/* 动画演示 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowAnimPanel(!showAnimPanel)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-purple-100 rounded flex items-center justify-center">
                    <Play className="w-3.5 h-3.5 text-purple-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">动画演示</span>
                </div>
                {showAnimPanel ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {showAnimPanel && (
                <div className="px-4 pb-4 space-y-2">
                  {PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => startAnimation(idx)}
                      disabled={isAnimating}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition text-sm ${
                        activePreset === idx
                          ? 'border-purple-300 bg-purple-50 text-purple-700'
                          : 'border-gray-100 hover:border-purple-200 hover:bg-purple-50 text-gray-700'
                      } disabled:opacity-50`}
                    >
                      <div className="font-medium">{preset.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{preset.desc}</div>
                    </button>
                  ))}
                  {isAnimating && (
                    <button onClick={stopAnimation} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition">
                      <Pause className="w-3.5 h-3.5" />
                      停止动画
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 知识点提示 */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-semibold text-gray-700">判定方法</span>
              </div>
              <div className="space-y-1.5 text-xs text-gray-600">
                <p>圆心到直线距离 <b className="text-purple-600">d = |Ax₀+By₀+C| / √(A²+B²)</b></p>
                <p className={relationship === 'intersect' ? 'text-green-600 font-medium' : ''}>
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />
                  相交: d &lt; r → 两个交点
                </p>
                <p className={relationship === 'tangent' ? 'text-amber-600 font-medium' : ''}>
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5" />
                  相切: d = r → 一个切点
                </p>
                <p className={relationship === 'separate' ? 'text-red-600 font-medium' : ''}>
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />
                  相离: d &gt; r → 没有交点
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// 滑块控件组件
function SliderControl({
  label, value, min, max, step, onChange, color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: 'blue' | 'green';
}) {
  const colorClasses = color === 'blue'
    ? 'accent-blue-600'
    : 'accent-green-600';

  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-gray-500 w-14 flex-shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`flex-1 h-1.5 ${colorClasses}`}
      />
      <span className="text-xs font-mono text-gray-700 w-8 text-right">{value}</span>
    </div>
  );
}
