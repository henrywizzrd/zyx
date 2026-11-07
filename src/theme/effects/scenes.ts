// Cảnh nền vẽ sẵn (đứng yên) của bộ Mưa sao băng: trời đêm xanh đen rải rất nhiều sao nhỏ, dựng thành chuỗi SVG
// theo đúng kích thước màn hình rồi Skia vẽ một lần. Bộ Sakura chỉ có nền hồng + hoa rơi (không có cảnh).
// Phần chuyển động (cánh hoa rơi, sao lấp lánh, sao băng) vẽ riêng trong Ambient.tsx.

// Số ngẫu nhiên cố định theo hạt giống (mỗi lần vẽ ra cùng một cảnh)
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const f = (n: number) => n.toFixed(1);

// ---------- Hoa anh đào ----------
// Một cánh hoa (gốc ở 0,0, mũi hướng lên, dài 1), mũi có khía chữ V như cánh hoa anh đào thật
export const PETAL_PATH = 'M0 0C-0.5 -0.18 -0.62 -0.78 -0.26 -1L0 -0.84L0.26 -1C0.62 -0.78 0.5 -0.18 0 0Z';
// Cánh rơi lẻ (hình giọt hơi lệch, có khía nhỏ)
export const LOOSE_PETAL_PATH = 'M0 0.62C-0.48 0.46 -0.58 -0.2 -0.3 -0.62L0 -0.48L0.24 -0.66C0.6 -0.26 0.46 0.42 0 0.62Z';

// ---------- Trời sao ----------
export function meteorSkySvg(W: number, H: number): string {
  const rnd = seeded(11);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs>
    <linearGradient id="nsky" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#050816"/><stop offset="0.6" stop-color="#0A1028"/><stop offset="1" stop-color="#101536"/></linearGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#nsky)"/>`;
  // Sao rải khắp trời
  for (let i = 0; i < 230; i++) {
    const r = rnd() < 0.08 ? 1.2 + rnd() * 0.6 : 0.4 + rnd() * 0.7;
    const tint = rnd() < 0.15 ? '#CFD8FF' : rnd() < 0.1 ? '#FFE8C8' : '#FFFFFF';
    s += `<circle cx="${f(rnd() * W)}" cy="${f(rnd() * H)}" r="${f(r)}" fill="${tint}" opacity="${f(0.35 + rnd() * 0.55)}"/>`;
  }
  s += '</svg>';
  return s;
}
