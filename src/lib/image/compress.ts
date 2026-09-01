/**
 * 浏览器端图片压缩（上传前处理）。
 *
 * 为什么需要：
 * 1. 视觉模型限制输入尺寸 2048x2048，学生用平板/手机直接拍的原图常常是
 *    3120x4208 这类尺寸，送进判图会直接报
 *    "input size exceed limit 2048x2048, current input:3120,4208"
 * 2. Qwen 系列 VL 只认 jpg/jpeg/png，且要求 URL 以这些后缀结尾；
 *    原图可能是 webp/heic 或文件名无后缀，统一转 JPEG + 改成 .jpg 最稳
 * 3. 原图动辄 5-10MB，教室 WiFi 上传慢，压缩后几百 KB，判题整体快很多
 *
 * 缩放规则：短边压到 shortEdge（默认 1080），同时保证
 *   - 长边不超过 maxEdge（默认 2048，模型硬上限）
 *   - 不做放大（scale 上限 1）
 */

export interface CompressOptions {
  /** 短边目标边长，默认 1080 */
  shortEdge?: number;
  /** 长边硬上限，默认 2048（视觉模型要求） */
  maxEdge?: number;
  /** JPEG 编码质量 0~1，默认 0.9 */
  quality?: number;
}

const DEFAULT_SHORT_EDGE = 1080;
const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_QUALITY = 0.9;

/** 小于这个体积的原图就不再重编码，避免无谓的画质损失 */
const SKIP_REENCODE_BYTES = 300 * 1024;

/**
 * 压缩图片用于上传。返回新的 File（JPEG + .jpg 后缀）。
 * 任何异常都会兜底返回原文件，保证上传链路不会因为压缩失败而中断。
 */
export async function compressImageForUpload(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const {
    shortEdge = DEFAULT_SHORT_EDGE,
    maxEdge = DEFAULT_MAX_EDGE,
    quality = DEFAULT_QUALITY,
  } = options;

  if (!file.type.startsWith('image/')) return file;
  // GIF 可能是动图，压成静态 JPEG 会丢帧，保持原样
  if (file.type === 'image/gif') return file;

  try {
    const img = await loadImageElement(file);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return file;

    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);

    // 短边压到目标值，但长边不能超上限，且不放大
    const scale = Math.min(1, shortEdge / minDim, maxEdge / maxDim);
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    // 尺寸本来就合规且体积很小，直接沿用原图（仅规范文件名后缀）
    if (scale === 1 && file.size <= SKIP_REENCODE_BYTES && file.type === 'image/jpeg') {
      return renameToJpg(file);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // JPEG 没有透明通道，先铺白底，否则 PNG 透明区域会变成黑块
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await canvasToBlob(canvas, quality);
    if (!blob) return file;

    // 尺寸没变但压完反而更大（少见），用原图
    if (scale === 1 && blob.size >= file.size) return renameToJpg(file);

    console.log(
      `[image] 压缩 ${width}x${height} ${(file.size / 1024 / 1024).toFixed(2)}MB` +
        ` → ${targetW}x${targetH} ${(blob.size / 1024).toFixed(0)}KB`
    );

    return new File([blob], toJpgName(file.name), { type: 'image/jpeg' });
  } catch (error) {
    console.warn('[image] 图片压缩失败，改用原图上传', error);
    return file;
  }
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** 统一成 .jpg 后缀，并清掉中文/空格等可能干扰对象存储 key 的字符 */
function toJpgName(originalName: string): string {
  const base =
    originalName
      .replace(/\.[^.]*$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 60) || 'image';
  return `${base}.jpg`;
}

function renameToJpg(file: File): File {
  const nextName = toJpgName(file.name);
  if (nextName === file.name) return file;
  return new File([file], nextName, { type: file.type || 'image/jpeg' });
}
