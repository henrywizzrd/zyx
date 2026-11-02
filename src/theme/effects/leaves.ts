// Hình lá kiểu icon (lá đặc, gân lá khoét rỗng), giống bộ icon lá cậu gửi.
// Mỗi mẫu là chuỗi SVG trong khung cao 2 (đầu lá y = -1, cuống lá y ≈ 1), tô kiểu even-odd: gân nằm trong lá thành khe rỗng.
// Chuỗi chuyển sang luồng UI được; SkPath dựng trong worklet (xem makeLeafPaths).

const f = (n: number) => n.toFixed(3);

// Khe gân giữa: hơi cong, to ở gốc, nhọn dần lên đầu lá
const midrib = (bend: number, top = -0.72, base = 0.86, w = 0.045) =>
  `M${f(-w)} ${f(base)}Q${f(bend - w)} 0 ${f(bend * 0.4)} ${f(top)}Q${f(bend + w * 0.6)} 0 ${f(w)} ${f(base)}Z`;

// Khe gân phụ: từ cạnh gân giữa chĩa chéo lên ra mép lá
function sideVeins(ys: number[], len: number, bend = 0) {
  let d = '';
  for (const y of ys) {
    for (const s of [-1, 1]) {
      const x0 = s * 0.075 + bend * (1 - (y + 1) / 2) * 0.4;
      const x1 = x0 + s * len;
      const y1 = y - len * 0.75;
      d += `M${f(x0)} ${f(y)}L${f(x1)} ${f(y1)}L${f(x1 - s * 0.03)} ${f(y1 - 0.07)}L${f(x0)} ${f(y - 0.08)}Z`;
    }
  }
  return d;
}

// Thân lá hình hạnh nhân, đầu nhọn hơi lệch (lean) cho tự nhiên
const almond = (lean: number, wide = 0.72) =>
  `M0 1C${f(-wide)} 0.55 ${f(-wide + 0.05)} -0.45 ${f(lean)} -1C${f(wide)} -0.5 ${f(wide + 0.02)} 0.5 0 1Z`;

// Lá tròn bầu, có cuống
const round = `M0 0.92C-0.85 0.75 -0.8 -0.55 0.05 -1C0.85 -0.55 0.82 0.75 0 0.92Z M-0.035 0.98L0.035 0.98L0.05 1.3L-0.05 1.3Z`;

// Lá có răng cưa ở mép: mép lá gồm các răng nhọn chĩa lên phía đầu lá
function serrated() {
  const n = 6; // số răng mỗi bên
  const width = (t: number) => Math.pow(Math.sin(Math.PI * t), 0.85) * 0.62; // t: 0 = cuống, 1 = đầu lá
  const left: string[] = [];
  const right: string[] = [];
  for (let k = 0; k < n; k++) {
    const t0 = 0.08 + (k / n) * 0.88;
    const t1 = 0.08 + ((k + 0.7) / n) * 0.88;
    // điểm lõm và mũi răng (mũi răng nhô ra ngoài và cao hơn một chút)
    left.push(`${f(-width(t0))} ${f(1 - t0 * 2)}`, `${f(-width(t1) - 0.11)} ${f(1 - t1 * 2 - 0.06)}`);
    right.push(`${f(width(t0))} ${f(1 - t0 * 2)}`, `${f(width(t1) + 0.11)} ${f(1 - t1 * 2 - 0.06)}`);
  }
  return `M0 1L${left.join('L')}L0 -1L${right.reverse().join('L')}Z`;
}

export const LEAF_SVGS: string[] = [
  // Lá hạnh nhân, khe gân giữa cong
  almond(0.12) + midrib(0.1),
  // Lá hạnh nhân, gân giữa + gân phụ
  almond(0.08, 0.7) + midrib(0.06) + sideVeins([0.5, 0.12, -0.24], 0.3, 0.06),
  // Lá tròn có cuống, gân giữa thẳng
  round + midrib(0, -0.7, 0.8, 0.04),
  // Lá răng cưa, khe gân giữa
  serrated() + midrib(0.04, -0.75, 0.88, 0.04),
];

// Màu lá: xanh lá tươi như icon, vài sắc đậm nhạt khác nhau
export const LEAF_COLORS = ['#6CC24A', '#5BB33B', '#7ACD57', '#4FA233', '#88D266'];

// Vẽ một chiếc lá: r = nửa chiều cao lá (px), rot = góc xoay (độ), flip = -1..1 (lật như lá đang lộn vòng trong gió)
export function drawLeaf(
  canvas: import('@shopify/react-native-skia').SkCanvas,
  paint: import('@shopify/react-native-skia').SkPaint,
  path: import('@shopify/react-native-skia').SkPath,
  x: number,
  y: number,
  r: number,
  rot: number,
  flip: number
) {
  'worklet';
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(rot, 0, 0);
  // Không cho bẹp hẳn về 0 (lá biến mất) mà giữ tối thiểu 15% bề ngang
  const sx = Math.sign(flip || 1) * Math.max(0.15, Math.abs(flip));
  canvas.scale(r * sx, r);
  canvas.drawPath(path, paint);
  canvas.restore();
}

// Dựng các mẫu lá thành SkPath (gọi trong worklet)
export function makeLeafPaths(Skia: typeof import('@shopify/react-native-skia').Skia, svgs: string[]) {
  'worklet';
  return svgs.map((d) => {
    const p = Skia.Path.MakeFromSVGString(d);
    if (!p) return null;
    // even-odd: gân nằm trong lá thành khe rỗng
    return Skia.PathBuilder.MakeFromPath(p).setFillType(1).build();
  });
}
