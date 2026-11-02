// Hình bông tuyết kiểu icon (6 cánh, có nhánh), vẽ bằng nét. Mỗi mẫu là một chuỗi SVG trong khung bán kính 1 quanh tâm (0,0).
// Chuỗi là chữ thường nên chuyển sang luồng UI (worklet) thoải mái; dựng thành SkPath ngay trong worklet.

type Branch = [at: number, len: number]; // vị trí trên cánh (0 = tâm, 1 = đầu cánh), độ dài nhánh

const f = (n: number) => n.toFixed(3);

function arm(angle: number, from: number, to: number, branches: Branch[], spread = 0.85) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let d = `M${f(dx * from)} ${f(dy * from)}L${f(dx * to)} ${f(dy * to)}`;
  for (const [at, len] of branches) {
    const px = dx * at;
    const py = dy * at;
    // Hai nhánh chĩa ra ngoài, lệch khoảng 50 độ so với cánh
    for (const s of [-1, 1]) {
      const a = angle + s * spread;
      d += `M${f(px)} ${f(py)}L${f(px + Math.cos(a) * len)} ${f(py + Math.sin(a) * len)}`;
    }
  }
  return d;
}

function hexagon(cx: number, cy: number, r: number, rot = 0) {
  let d = '';
  for (let k = 0; k <= 6; k++) {
    const a = rot + (k * Math.PI) / 3;
    d += `${k === 0 ? 'M' : 'L'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  }
  return d + 'Z';
}

function flake(opts: { from?: number; to?: number; branches: Branch[]; hex?: number; tipHex?: number }) {
  const { from = 0, to = 1, branches, hex, tipHex } = opts;
  let d = '';
  for (let k = 0; k < 6; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 3;
    d += arm(angle, from, to, branches);
    if (tipHex) d += hexagon(Math.cos(angle) * (to + tipHex), Math.sin(angle) * (to + tipHex), tipHex, angle);
  }
  if (hex) d += hexagon(0, 0, hex, Math.PI / 6);
  return d;
}

export const FLAKE_SVGS: string[] = [
  // Cổ điển: hai cặp nhánh
  flake({ branches: [[0.42, 0.3], [0.7, 0.22]] }),
  // Lõi lục giác, một cặp nhánh gần đầu cánh
  flake({ from: 0.28, branches: [[0.62, 0.26]], hex: 0.28 }),
  // Kiểu lá dương xỉ: nhiều nhánh nhỏ
  flake({ branches: [[0.3, 0.16], [0.48, 0.2], [0.66, 0.17], [0.82, 0.11]] }),
  // Đầu cánh có hạt lục giác nhỏ
  flake({ to: 0.8, branches: [[0.45, 0.26]], tipHex: 0.1 }),
];

// Vẽ một bông tuyết: path là mẫu (bán kính 1), r là bán kính thật (px), rot là góc xoay (độ)
export function drawFlake(
  canvas: import('@shopify/react-native-skia').SkCanvas,
  paint: import('@shopify/react-native-skia').SkPaint,
  path: import('@shopify/react-native-skia').SkPath,
  x: number,
  y: number,
  r: number,
  rot: number,
  stroke: number
) {
  'worklet';
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(rot, 0, 0);
  canvas.scale(r, r);
  paint.setStrokeWidth(stroke / r);
  canvas.drawPath(path, paint);
  canvas.restore();
}
