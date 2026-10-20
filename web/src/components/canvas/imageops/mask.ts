import type { ElementRegion } from './opsStore';

/**
 * 把元素编辑的选区渲染成蒙版 PNG（黑底 + 白色选区）。
 *
 * 两个关键点（与原来的涂抹蒙版完全一致，换成矩形/椭圆是因为选区现在是框选/点选）：
 * 1. 选区存的是 0~1 相对坐标，这里按**原图尺寸**还原 —— 所以用户在画布上不管缩放多少、
 *    节点显示多大，蒙版的精度都由原图决定，不受缩略图影响；
 * 2. 只写新 canvas，**不读源图像素** —— 因此不依赖 CDN 的 CORS（生产 CDN 只回显
 *    特定 origin 的 Access-Control-Allow-Origin，读源图像素会被污染）。
 *
 * 白 = 允许改（后端按亮度当 alpha 用，边缘羽化由后端做，见 service.CompositeThroughMask），
 * 黑 = 必须保持原样。
 */
/**
 * 选区 → 蒙版上的图形（像素坐标）。抽成纯函数是为了能单测：
 * 这条映射错了（比例算反、用错宽高）在界面上完全看不出来 ——
 * 生成照样成功、图照样变，只是**变的位置不对**，是最难查的一类 bug。
 */
export function maskShapes(
  regions: ElementRegion[],
  width: number,
  height: number,
): { ellipse: boolean; x: number; y: number; w: number; h: number }[] {
  return regions.map((r) => ({
    // 点选 = 内切椭圆：宽高都按各自轴换算，所以在原图上一定是**正圆**
    // （相对坐标下 w/h 数值不同，这是有意的：让两种工具共用一套结构）
    ellipse: r.tool === 'point',
    x: r.x * width,
    y: r.y * height,
    w: r.w * width,
    h: r.h * height,
  }));
}

export async function renderElementMaskBlob(
  regions: ElementRegion[],
  width: number,
  height: number,
  /**
   * 额外的矩形区域（相对 0~1），也标成"允许改"。
   * 移动模式用：改动区域是**两块** —— 原位置补背景 + 新位置画上物体，
   * 落点不标进蒙版的话，模型搬过去的内容会被贴回步骤丢掉（等于没搬）。
   */
  extraRects: ElementRegion[] = [],
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';

  for (const s of maskShapes([...regions, ...extraRects], canvas.width, canvas.height)) {
    if (s.ellipse) {
      // 点选：外接矩形的内切椭圆
      ctx.beginPath();
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // 负宽高（反向拖出来的框）由 canvas 自己规范化
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('蒙版导出失败'));
    }, 'image/png');
  });
}