/**
 * 视图宫格的画幅换算。
 *
 * 宫格是**等比等分**（横竖都切），所以每格比例 == 整图比例：
 *   2×2 + 16:9 → 每格也是 16:9；2×2 + 1:1 → 每格 1:1。
 * 但每格的**像素**会随行列数变小，这个函数就是算给用户看的
 * （"每格 ≈ 1920×1080"，放在生成按钮的 hover 里）。
 *
 * ⚠️ 公式必须与后端 server/internal/engine/executor.go 的
 * calculateSizeFromResolutionAndRatio 完全一致，三步都不能少：
 *   ① 按"像素总量 + 比例开方"算 ② 向下取整 ③ **取整到 8 的倍数**（roundTo8）
 * 第 ③ 步最初漏掉了：4K 4:3 会算成 3325×2494，而后端实际请求的是 3328×2496，
 * hover 里给用户的数字就是错的。后端那份有 Go 测试守着（TestCalculateSizeTable
 * 里钉了同一张表），这边用同一张表在探针里比对，改公式要两边一起改。
 */

/** 分辨率 → 像素总量（与后端 totalPixels 表一致） */
const TOTAL_PIXELS: Record<string, number> = {
  '1K': 1280 * 720,
  '2K': 1920 * 1080,
  '4K': 3840 * 2160,
};

/**
 * 可选画幅。1:1 最中性（方形格子不逼模型做裁切决策）；
 * 场景类（平面图/立面图/透视）是横幅内容，4:3 或 16:9 更贴合；
 * 横排人物视图用 16:9 时每格会变成竖长条，正好接近站姿剪影。
 */
export const SHEET_RATIOS = ['1:1', '4:3', '3:2', '16:9'] as const;

/** 横排（1×N）默认宽幅、网格（2×N）默认方形 —— 与既有行为一致 */
export function defaultSheetRatio(rows: number): string {
  return rows === 1 ? '16:9' : '1:1';
}

/** 取整到 8 的倍数（后端 roundTo8：((n+4)/8)*8，图片 API 普遍要求 8 的倍数） */
function roundTo8(n: number): number {
  return Math.floor((n + 4) / 8) * 8;
}

/** 整图像素尺寸；分辨率不认识时按 1K，比例解析失败按 16:9（与后端一致） */
export function sheetSize(ratio: string, resolution: string): { width: number; height: number } {
  const total = TOTAL_PIXELS[resolution] ?? TOTAL_PIXELS['1K'];
  const parts = ratio === 'adaptive' || ratio === 'free' || !ratio ? ['16', '9'] : ratio.split(':');
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  const rw = parts.length === 2 && Number.isFinite(w) && w > 0 ? w : 16;
  const rh = parts.length === 2 && Number.isFinite(h) && h > 0 ? h : 9;
  const r = rw / rh;
  return { width: roundTo8(Math.floor(Math.sqrt(total * r))), height: roundTo8(Math.floor(Math.sqrt(total / r))) };
}

/** 每格像素尺寸（宫格等比等分） */
export function sheetCellSize(
  ratio: string,
  resolution: string,
  rows: number,
  cols: number,
): { width: number; height: number } {
  const size = sheetSize(ratio, resolution);
  return { width: Math.floor(size.width / cols), height: Math.floor(size.height / rows) };
}

/** 给 hover 用的一行：`每格 ≈ 1920×1080（16:9 · 2×2 · 4K）` */
export function sheetCellHint(ratio: string, resolution: string, rows: number, cols: number): string {
  const cell = sheetCellSize(ratio, resolution, rows, cols);
  return `每格 ≈ ${cell.width}×${cell.height}（${ratio} · ${rows}×${cols} · ${resolution}）`;
}
