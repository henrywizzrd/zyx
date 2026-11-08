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

// ---------- Cực quang: trời đêm xanh đen ngả ngọc ở chân trời, sao thưa hơn trời sao băng ----------
export function auroraSkySvg(W: number, H: number): string {
  const rnd = seeded(29);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs><linearGradient id="asky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020812"/><stop offset="0.55" stop-color="#05131F"/><stop offset="1" stop-color="#082027"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#asky)"/>`;
  for (let i = 0; i < 150; i++) {
    const r = rnd() < 0.07 ? 1.1 + rnd() * 0.5 : 0.35 + rnd() * 0.6;
    const y = rnd() * H * 0.85;
    s += `<circle cx="${f(rnd() * W)}" cy="${f(y)}" r="${f(r)}" fill="#FFFFFF" opacity="${f((0.3 + rnd() * 0.55) * (1 - y / H / 1.4))}"/>`;
  }
  return s + '</svg>';
}

// ---------- Mưa trên kính: nền xám, rất nhiều giọt nước đọng lốm đốm (có viền sáng / tối như giọt thật) ----------
export function rainGlassSvg(W: number, H: number): string {
  const rnd = seeded(47);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs>
    <linearGradient id="rbg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#3A4048"/><stop offset="0.6" stop-color="#2C3137"/><stop offset="1" stop-color="#23272C"/></linearGradient>
    <radialGradient id="drop" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.26"/><stop offset="0.65" stop-color="#FFFFFF" stop-opacity="0.08"/><stop offset="1" stop-color="#000000" stop-opacity="0.32"/></radialGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#rbg)"/>`;
  const n = Math.round(460 * Math.min(1.6, (W * H) / (390 * 844)));
  for (let i = 0; i < n; i++) {
    const big = rnd() < 0.16;
    const r = big ? 3.5 + rnd() * 4.5 : 1 + rnd() * 2.2;
    const x = rnd() * W;
    const y = rnd() * H;
    const ry = r * (1 + rnd() * 0.25); // hơi dẹt theo chiều dọc
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(ry)}" fill="url(#drop)"/>`;
    if (r > 1.6) s += `<circle cx="${f(x - r * 0.35)}" cy="${f(y - ry * 0.4)}" r="${f(Math.max(0.5, r * 0.22))}" fill="#FFFFFF" opacity="0.6"/>`;
  }
  return s + '</svg>';
}

// ---------- Neon: trời tím đen, chân trời phát sáng hồng (lưới chuyển động vẽ riêng) ----------
export function neonSkySvg(W: number, H: number): string {
  const horizon = H * 0.62;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs>
    <linearGradient id="nbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07030F"/><stop offset="0.55" stop-color="#160A2B"/><stop offset="0.62" stop-color="#2A0D3D"/><stop offset="1" stop-color="#0A0514"/></linearGradient>
    <linearGradient id="nglow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF3DCB" stop-opacity="0"/><stop offset="1" stop-color="#FF3DCB" stop-opacity="0.35"/></linearGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#nbg)"/>`;
  s += `<rect x="0" y="${f(horizon - H * 0.16)}" width="${W}" height="${f(H * 0.16)}" fill="url(#nglow)"/>`;
  s += `<rect x="0" y="${f(horizon - 0.75)}" width="${W}" height="1.5" fill="#FF7AE0" opacity="0.85"/>`;
  return s + '</svg>';
}
