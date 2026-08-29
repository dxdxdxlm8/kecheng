'use client';

import { useRef, useEffect, useCallback } from 'react';

interface GeometryCanvasProps {
  // 圆参数
  cx: number;
  cy: number;
  radius: number;
  // 直线参数 Ax + By + C = 0
  A: number;
  B: number;
  C: number;
  // 画布尺寸
  width?: number;
  height?: number;
  // 动画进度 (0~1)，用于动画演示
  animationProgress?: number;
  // 动画起始直线参数
  animStartLine?: { A: number; B: number; C: number };
  // 自由绘制的路径
  drawPaths?: { x: number; y: number }[][];
  // 是否显示网格
  showGrid?: boolean;
  // 是否显示距离线
  showDistance?: boolean;
}

// 颜色方案
const COLORS = {
  bg: '#FAFBFC',
  grid: '#E5E7EB',
  gridMajor: '#D1D5DB',
  axis: '#6B7280',
  axisLabel: '#9CA3AF',
  circle: '#2563EB',
  circleFill: 'rgba(37, 99, 235, 0.06)',
  lineIntersect: '#059669',
  lineTangent: '#D97706',
  lineSeparate: '#DC2626',
  distance: '#7C3AED',
  center: '#2563EB',
  intersection: '#059669',
  userDraw: '#EC4899',
};

export function GeometryCanvas({
  cx, cy, radius,
  A, B, C,
  width = 560,
  height = 420,
  animationProgress,
  animStartLine,
  drawPaths = [],
  showGrid = true,
  showDistance = true,
}: GeometryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 计算视口：自动缩放以包含圆和直线
  const getViewport = useCallback(() => {
    const padding = 2;
    const points: { x: number; y: number }[] = [
      { x: cx - radius, y: cy - radius },
      { x: cx + radius, y: cy + radius },
      { x: cx, y: cy },
    ];

    // 计算直线上的几个点
    if (Math.abs(B) > 0.001) {
      points.push({ x: cx - radius - padding, y: -(A * (cx - radius - padding) + C) / B });
      points.push({ x: cx + radius + padding, y: -(A * (cx + radius + padding) + C) / B });
    }
    if (Math.abs(A) > 0.001) {
      points.push({ x: -(B * (cy - radius - padding) + C) / A, y: cy - radius - padding });
      points.push({ x: -(B * (cy + radius + padding) + C) / A, y: cy + radius + padding });
    }

    const minX = Math.min(...points.map(p => p.x)) - padding;
    const maxX = Math.max(...points.map(p => p.x)) + padding;
    const minY = Math.min(...points.map(p => p.y)) - padding;
    const maxY = Math.max(...points.map(p => p.y)) + padding;

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const range = Math.max(rangeX, rangeY, 4);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
      xMin: centerX - range / 2,
      xMax: centerX + range / 2,
      yMin: centerY - range / 2,
      yMax: centerY + range / 2,
    };
  }, [cx, cy, radius, A, B, C]);

  // 坐标转换：数学坐标 -> 画布像素
  const toCanvas = useCallback((x: number, y: number, vp: ReturnType<typeof getViewport>) => {
    const margin = 40;
    const plotW = width - margin * 2;
    const plotH = height - margin * 2;
    const scaleX = plotW / (vp.xMax - vp.xMin);
    const scaleY = plotH / (vp.yMax - vp.yMin);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = margin + (plotW - (vp.xMax - vp.xMin) * scale) / 2;
    const offsetY = margin + (plotH - (vp.yMax - vp.yMin) * scale) / 2;

    return {
      px: offsetX + (x - vp.xMin) * scale,
      py: offsetY + (vp.yMax - y) * scale, // y轴翻转
      scale,
    };
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 高清屏适配
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 当前直线参数（考虑动画）
    let curA = A, curB = B, curC = C;
    if (animationProgress !== undefined && animStartLine) {
      const t = animationProgress;
      curA = animStartLine.A + (A - animStartLine.A) * t;
      curB = animStartLine.B + (B - animStartLine.B) * t;
      curC = animStartLine.C + (C - animStartLine.C) * t;
    }

    // 计算距离和关系
    const dist = Math.abs(curA * cx + curB * cy + curC) / Math.sqrt(curA * curA + curB * curB);
    const diff = Math.abs(dist - radius);
    const relationship = diff < 0.01 ? 'tangent' : dist < radius ? 'intersect' : 'separate';

    const vp = getViewport();

    // 清空背景
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // 绘制网格
    if (showGrid) {
      const gridStep = getGridStep(vp);
      drawGrid(ctx, vp, gridStep);
    }

    // 绘制坐标轴
    drawAxes(ctx, vp);

    // 绘制圆
    drawCircle(ctx, vp);

    // 绘制直线
    drawLine(ctx, vp, relationship);

    // 绘制距离线
    if (showDistance) {
      drawDistanceLine(ctx, vp);
    }

    // 绘制交点
    if (relationship === 'intersect' || relationship === 'tangent') {
      drawIntersectionPoints(ctx, vp, relationship);
    }

    // 绘制用户路径
    drawUserPaths(ctx, vp);

    // 绘制标注
    drawLabels(ctx, vp, relationship, dist);

    function getGridStep(v: ReturnType<typeof getViewport>) {
      const range = v.xMax - v.xMin;
      if (range <= 6) return 1;
      if (range <= 15) return 2;
      if (range <= 30) return 5;
      return 10;
    }

    function drawGrid(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>, step: number) {
      c.strokeStyle = COLORS.grid;
      c.lineWidth = 0.5;

      const startX = Math.floor(v.xMin / step) * step;
      const endX = Math.ceil(v.xMax / step) * step;
      const startY = Math.floor(v.yMin / step) * step;
      const endY = Math.ceil(v.yMax / step) * step;

      for (let x = startX; x <= endX; x += step) {
        const { px } = toCanvas(x, 0, v);
        c.beginPath();
        c.moveTo(px, 0);
        c.lineTo(px, height);
        c.strokeStyle = Math.abs(x) < 0.001 ? COLORS.gridMajor : COLORS.grid;
        c.lineWidth = Math.abs(x) < 0.001 ? 1 : 0.5;
        c.stroke();
      }
      for (let y = startY; y <= endY; y += step) {
        const { py } = toCanvas(0, y, v);
        c.beginPath();
        c.moveTo(0, py);
        c.lineTo(width, py);
        c.strokeStyle = Math.abs(y) < 0.001 ? COLORS.gridMajor : COLORS.grid;
        c.lineWidth = Math.abs(y) < 0.001 ? 1 : 0.5;
        c.stroke();
      }
    }

    function drawAxes(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>) {
      c.strokeStyle = COLORS.axis;
      c.lineWidth = 1.5;

      // X 轴
      const { py: yAxisPy } = toCanvas(0, 0, v);
      if (yAxisPy >= 0 && yAxisPy <= height) {
        c.beginPath();
        c.moveTo(0, yAxisPy);
        c.lineTo(width, yAxisPy);
        c.stroke();
        // 箭头
        c.beginPath();
        c.moveTo(width - 8, yAxisPy - 4);
        c.lineTo(width, yAxisPy);
        c.lineTo(width - 8, yAxisPy + 4);
        c.stroke();
      }

      // Y 轴
      const { px: xAxisPx } = toCanvas(0, 0, v);
      if (xAxisPx >= 0 && xAxisPx <= width) {
        c.beginPath();
        c.moveTo(xAxisPx, 0);
        c.lineTo(xAxisPx, height);
        c.stroke();
        // 箭头
        c.beginPath();
        c.moveTo(xAxisPx - 4, 8);
        c.lineTo(xAxisPx, 0);
        c.lineTo(xAxisPx + 4, 8);
        c.stroke();
      }

      // 轴标签
      c.fillStyle = COLORS.axisLabel;
      c.font = '11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('x', width - 12, yAxisPy + 14);
      c.fillText('y', xAxisPx + 12, 14);

      // 刻度
      const step = getGridStep(v);
      const startX = Math.floor(v.xMin / step) * step;
      const endX = Math.ceil(v.xMax / step) * step;
      const startY = Math.floor(v.yMin / step) * step;
      const endY = Math.ceil(v.yMax / step) * step;

      c.font = '10px system-ui, sans-serif';
      c.fillStyle = COLORS.axisLabel;
      for (let x = startX; x <= endX; x += step) {
        if (Math.abs(x) < 0.001) continue;
        const { px } = toCanvas(x, 0, v);
        c.textAlign = 'center';
        c.fillText(String(x), px, yAxisPy + 14);
      }
      for (let y = startY; y <= endY; y += step) {
        if (Math.abs(y) < 0.001) continue;
        const { py } = toCanvas(0, y, v);
        c.textAlign = 'right';
        c.fillText(String(y), xAxisPx - 6, py + 4);
      }
    }

    function drawCircle(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>) {
      const { px: cpx, py: cpy, scale } = toCanvas(cx, cy, v);
      const rPx = radius * scale;

      // 填充
      c.fillStyle = COLORS.circleFill;
      c.beginPath();
      c.arc(cpx, cpy, rPx, 0, Math.PI * 2);
      c.fill();

      // 边框
      c.strokeStyle = COLORS.circle;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cpx, cpy, rPx, 0, Math.PI * 2);
      c.stroke();

      // 圆心
      c.fillStyle = COLORS.center;
      c.beginPath();
      c.arc(cpx, cpy, 4, 0, Math.PI * 2);
      c.fill();

      // 圆心标签
      c.fillStyle = COLORS.center;
      c.font = 'bold 12px system-ui, sans-serif';
      c.textAlign = 'left';
      c.fillText(`O(${cx},${cy})`, cpx + 8, cpy - 8);
    }

    function drawLine(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>, rel: string) {
      const lineColor = rel === 'intersect' ? COLORS.lineIntersect : rel === 'tangent' ? COLORS.lineTangent : COLORS.lineSeparate;

      // 计算直线两端点
      let x1: number, y1: number, x2: number, y2: number;
      if (Math.abs(curB) > 0.001) {
        x1 = v.xMin - 1;
        y1 = -(curA * x1 + curC) / curB;
        x2 = v.xMax + 1;
        y2 = -(curA * x2 + curC) / curB;
      } else {
        x1 = -curC / curA;
        y1 = v.yMin - 1;
        x2 = -curC / curA;
        y2 = v.yMax + 1;
      }

      const p1 = toCanvas(x1, y1, v);
      const p2 = toCanvas(x2, y2, v);

      c.strokeStyle = lineColor;
      c.lineWidth = 2;
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(p1.px, p1.py);
      c.lineTo(p2.px, p2.py);
      c.stroke();

      // 直线标签
      const midX = (p1.px + p2.px) / 2;
      const midY = (p1.py + p2.py) / 2;
      c.fillStyle = lineColor;
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'left';
      const labelA = curA === 1 ? '' : curA === -1 ? '-' : String(Math.round(curA * 100) / 100);
      const labelB = curB === 1 ? '' : curB === -1 ? '-' : String(Math.round(curB * 100) / 100);
      const labelC = curC === 0 ? '' : (curC > 0 ? `+${Math.round(curC * 100) / 100}` : String(Math.round(curC * 100) / 100));
      c.fillText(`${labelA}x${labelB}y${labelC}=0`, midX + 6, midY - 6);
    }

    function drawDistanceLine(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>) {
      // 从圆心到直线的垂足
      const denom = curA * curA + curB * curB;
      if (denom < 0.0001) return;
      const footX = (curB * (curB * cx - curA * cy) - curA * curC) / denom;
      const footY = (curA * (-curB * cx + curA * cy) - curB * curC) / denom;

      const p1 = toCanvas(cx, cy, v);
      const p2 = toCanvas(footX, footY, v);

      // 虚线
      c.strokeStyle = COLORS.distance;
      c.lineWidth = 1.5;
      c.setLineDash([5, 4]);
      c.beginPath();
      c.moveTo(p1.px, p1.py);
      c.lineTo(p2.px, p2.py);
      c.stroke();
      c.setLineDash([]);

      // 垂足小方块
      const angle = Math.atan2(p2.py - p1.py, p2.px - p1.px);
      const sqSize = 6;
      c.save();
      c.translate(p2.px, p2.py);
      c.rotate(angle);
      c.strokeStyle = COLORS.distance;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-sqSize, 0);
      c.lineTo(-sqSize, -sqSize);
      c.lineTo(0, -sqSize);
      c.stroke();
      c.restore();

      // 距离标签
      const midPx = (p1.px + p2.px) / 2;
      const midPy = (p1.py + p2.py) / 2;
      c.fillStyle = COLORS.distance;
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'center';
      const distDisplay = Math.round(dist * 100) / 100;
      c.fillText(`d=${distDisplay}`, midPx + 14, midPy);
    }

    function drawIntersectionPoints(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>, rel: string) {
      const points = getIntersectionPoints();
      points.forEach(p => {
        const { px, py } = toCanvas(p.x, p.y, v);
        c.fillStyle = COLORS.intersection;
        c.beginPath();
        c.arc(px, py, 5, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        c.stroke();
      });

      if (rel === 'tangent') {
        const { px, py } = toCanvas(points[0].x, points[0].y, v);
        c.fillStyle = COLORS.lineTangent;
        c.font = '11px system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText(`切点(${Math.round(points[0].x * 100) / 100},${Math.round(points[0].y * 100) / 100})`, px + 8, py - 8);
      }
    }

    function getIntersectionPoints(): { x: number; y: number }[] {
      // 圆心到直线的垂足
      const denom = curA * curA + curB * curB;
      if (denom < 0.0001) return [];
      const footX = (curB * (curB * cx - curA * cy) - curA * curC) / denom;
      const footY = (curA * (-curB * cx + curA * cy) - curB * curC) / denom;

      if (relationship === 'tangent') {
        return [{ x: footX, y: footY }];
      }

      if (relationship === 'intersect') {
        // 垂足到交点的距离
        const halfChord = Math.sqrt(radius * radius - dist * dist);
        // 直线方向向量
        const dirX = -curB / Math.sqrt(denom);
        const dirY = curA / Math.sqrt(denom);
        return [
          { x: footX + halfChord * dirX, y: footY + halfChord * dirY },
          { x: footX - halfChord * dirX, y: footY - halfChord * dirY },
        ];
      }

      return [];
    }

    function drawUserPaths(c: CanvasRenderingContext2D, v: ReturnType<typeof getViewport>) {
      if (drawPaths.length === 0) return;
      c.strokeStyle = COLORS.userDraw;
      c.lineWidth = 2;
      c.setLineDash([]);
      drawPaths.forEach(path => {
        if (path.length < 2) return;
        c.beginPath();
        const first = toCanvas(path[0].x, path[0].y, v);
        c.moveTo(first.px, first.py);
        for (let i = 1; i < path.length; i++) {
          const p = toCanvas(path[i].x, path[i].y, v);
          c.lineTo(p.px, p.py);
        }
        c.stroke();
      });
    }

    function drawLabels(c: CanvasRenderingContext2D, _v: ReturnType<typeof getViewport>, rel: string, d: number) {
      // 右上角关系标签
      const relLabel = rel === 'intersect' ? '相交 (d < r)' : rel === 'tangent' ? '相切 (d = r)' : '相离 (d > r)';
      const relColor = rel === 'intersect' ? COLORS.lineIntersect : rel === 'tangent' ? COLORS.lineTangent : COLORS.lineSeparate;

      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.strokeStyle = relColor;
      c.lineWidth = 1.5;
      const labelW = 130;
      const labelH = 50;
      const labelX = width - labelW - 10;
      const labelY = 10;

      // 圆角矩形
      const r = 8;
      c.beginPath();
      c.moveTo(labelX + r, labelY);
      c.lineTo(labelX + labelW - r, labelY);
      c.quadraticCurveTo(labelX + labelW, labelY, labelX + labelW, labelY + r);
      c.lineTo(labelX + labelW, labelY + labelH - r);
      c.quadraticCurveTo(labelX + labelW, labelY + labelH, labelX + labelW - r, labelY + labelH);
      c.lineTo(labelX + r, labelY + labelH);
      c.quadraticCurveTo(labelX, labelY + labelH, labelX, labelY + labelH - r);
      c.lineTo(labelX, labelY + r);
      c.quadraticCurveTo(labelX, labelY, labelX + r, labelY);
      c.closePath();
      c.fill();
      c.stroke();

      // 关系文字
      c.fillStyle = relColor;
      c.font = 'bold 13px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(relLabel, labelX + labelW / 2, labelY + 20);

      // 数据
      c.fillStyle = '#6B7280';
      c.font = '11px system-ui, sans-serif';
      const dRound = Math.round(d * 100) / 100;
      c.fillText(`d = ${dRound}，r = ${radius}`, labelX + labelW / 2, labelY + 38);
    }
  }, [cx, cy, radius, A, B, C, width, height, animationProgress, animStartLine, drawPaths, showGrid, showDistance, getViewport, toCanvas]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-xl border border-gray-200 shadow-sm"
    />
  );
}
