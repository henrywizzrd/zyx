// Tính toán lưới cho danh sách kéo thả. File thuần (không import React Native)
// nên có thể test độc lập. Mọi ô được đặt tuyệt đối theo index, nên đổi thứ tự
// chỉ là đổi toạ độ đích, không bao giờ làm layout thật thay đổi.

export interface Geometry {
  columns: number; // 1 = dạng danh sách
  cellWidth: number;
  gapX: number;
  gapY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridResult {
  rects: Rect[]; // rects[i] là ô ở vị trí thứ i
  totalHeight: number;
}

// heights: chiều cao đã đo của từng ô. Ô chưa đo thì dùng fallbackH.
// Chiều cao của một hàng là chiều cao lớn nhất trong hàng đó, các ô canh theo mép trên.
export function computeSlots(
  ids: string[],
  heights: Record<string, number>,
  fallbackH: number,
  g: Geometry
): GridResult {
  const cols = Math.max(1, Math.floor(g.columns));
  const rowCount = Math.ceil(ids.length / cols);
  const rowH: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    let m = 0;
    for (let c = 0; c < cols; c++) {
      const id = ids[r * cols + c];
      if (id === undefined) break;
      m = Math.max(m, heights[id] ?? fallbackH);
    }
    rowH.push(m);
  }
  const rowTop: number[] = [];
  let y = 0;
  for (let r = 0; r < rowCount; r++) {
    rowTop.push(y);
    y += rowH[r] + g.gapY;
  }
  const rects = ids.map((_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      x: c * (g.cellWidth + g.gapX),
      y: rowTop[r],
      width: g.cellWidth,
      height: rowH[r],
    };
  });
  const totalHeight = rowCount === 0 ? 0 : y - g.gapY;
  return { rects, totalHeight };
}

// Vị trí (index) có tâm gần điểm (cx, cy) nhất. Trả -1 nếu không có ô nào.
export function slotIndexAt(rects: Rect[], cx: number, cy: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dx = cx - (r.x + r.width / 2);
    const dy = cy - (r.y + r.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Trả mảng mới, id được chuyển tới vị trí toIndex. Không sửa mảng gốc.
export function moveId(order: string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
  return next;
}
