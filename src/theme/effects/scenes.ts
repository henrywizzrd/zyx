// Cảnh nền vẽ sẵn (đứng yên) cho hai bộ màu mới, dựng thành chuỗi SVG theo đúng kích thước màn hình
// rồi Skia vẽ một lần (không tốn pin như phần chuyển động):
//  - Sakura: trời hồng, núi hồng xa xa, cây anh đào bên phải vươn cành ra góc trên, bãi cỏ + đường lát đá, bụi hoa ở dưới
//  - Meteor (mưa sao băng): trời đêm xanh đen, dải ngân hà tím mờ chạy chéo, rất nhiều sao nhỏ
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

function flower(x: number, y: number, r: number, rot: number, fill: string, center: string, opacity = 1) {
  let petals = '';
  for (let k = 0; k < 5; k++) {
    petals += `<path d="${PETAL_PATH}" transform="rotate(${k * 72}) translate(0 ${f(-r * 0.08)}) scale(${f(r * 0.62)} ${f(r)})" />`;
  }
  // Nhuỵ: vài nét mảnh toả ra từ giữa + chấm vàng ở đầu
  let stamens = '';
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const sx = Math.cos(a) * r * 0.36;
    const sy = Math.sin(a) * r * 0.36;
    stamens += `<line x1="0" y1="0" x2="${f(sx)}" y2="${f(sy)}" stroke="${center}" stroke-width="${f(Math.max(0.6, r * 0.04))}" /><circle cx="${f(sx)}" cy="${f(sy)}" r="${f(Math.max(0.7, r * 0.06))}" fill="#F2B544" />`;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" opacity="${opacity}"><g fill="${fill}">${petals}</g><circle r="${f(r * 0.16)}" fill="${center}" opacity="0.55" />${stamens}</g>`;
}

export function sakuraSceneSvg(W: number, H: number): string {
  const rnd = seeded(7);
  const g = Math.min(W, H); // cỡ chuẩn để hoa / cây không quá to khi xoay ngang
  const ground = H * 0.8; // mép trên bãi cỏ
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs>
    <linearGradient id="ksky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9DCE6"/><stop offset="0.55" stop-color="#FCEFF3"/><stop offset="1" stop-color="#FDF3F6"/></linearGradient>
    <linearGradient id="km1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1BFD0"/><stop offset="1" stop-color="#F8DDE6"/></linearGradient>
    <linearGradient id="km2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBADC2"/><stop offset="1" stop-color="#F6D3DF"/></linearGradient>
    <linearGradient id="kgrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFE3B0"/><stop offset="1" stop-color="#8FCB86"/></linearGradient>
    <linearGradient id="kroad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9DCD3"/><stop offset="1" stop-color="#D8C6BA"/></linearGradient>
    <linearGradient id="ktrunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7A4A45"/><stop offset="1" stop-color="#5C3433"/></linearGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#ksky)"/>`;

  // Núi xa (hai lớp, lớp sau nhạt hơn)
  const mBase = ground + 6;
  s += `<path d="M0 ${f(mBase - H * 0.1)} C${f(W * 0.12)} ${f(mBase - H * 0.14)} ${f(W * 0.2)} ${f(mBase - H * 0.13)} ${f(W * 0.3)} ${f(mBase - H * 0.17)} C${f(W * 0.38)} ${f(mBase - H * 0.27)} ${f(W * 0.44)} ${f(mBase - H * 0.3)} ${f(W * 0.5)} ${f(mBase - H * 0.24)} C${f(W * 0.56)} ${f(mBase - H * 0.18)} ${f(W * 0.62)} ${f(mBase - H * 0.16)} ${f(W * 0.75)} ${f(mBase - H * 0.12)} C${f(W * 0.85)} ${f(mBase - H * 0.09)} ${f(W * 0.94)} ${f(mBase - H * 0.11)} ${W} ${f(mBase - H * 0.1)} L${W} ${f(mBase)} L0 ${f(mBase)}Z" fill="url(#km1)" opacity="0.9"/>`;
  s += `<path d="M0 ${f(mBase - H * 0.05)} C${f(W * 0.15)} ${f(mBase - H * 0.09)} ${f(W * 0.28)} ${f(mBase - H * 0.1)} ${f(W * 0.4)} ${f(mBase - H * 0.07)} C${f(W * 0.55)} ${f(mBase - H * 0.04)} ${f(W * 0.66)} ${f(mBase - H * 0.08)} ${f(W * 0.8)} ${f(mBase - H * 0.06)} C${f(W * 0.9)} ${f(mBase - H * 0.05)} ${f(W * 0.96)} ${f(mBase - H * 0.04)} ${W} ${f(mBase - H * 0.045)} L${W} ${f(mBase)} L0 ${f(mBase)}Z" fill="url(#km2)" opacity="0.85"/>`;

  // Bãi cỏ (mép trên gợn nhẹ)
  s += `<path d="M0 ${f(ground)} C${f(W * 0.25)} ${f(ground - 8)} ${f(W * 0.5)} ${f(ground + 6)} ${f(W * 0.75)} ${f(ground - 4)} C${f(W * 0.88)} ${f(ground - 8)} ${f(W * 0.95)} ${f(ground - 2)} ${W} ${f(ground - 4)} L${W} ${H} L0 ${H}Z" fill="url(#kgrass)"/>`;
  // Vài ngọn cỏ
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W;
    const y = ground + 6 + rnd() * (H - ground - 10);
    const h = 4 + rnd() * 6;
    const lean = (rnd() - 0.5) * 5;
    s += `<path d="M${f(x)} ${f(y)} q${f(lean * 0.3)} ${f(-h * 0.6)} ${f(lean)} ${f(-h)}" stroke="#78B86F" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.7"/>`;
  }

  // Đường lát đá: từ mép dưới (giữa) uốn lên về phía gốc cây bên phải
  const roadL = (t: number) => [W * (0.22 + 0.55 * t), H - (H - ground - 4) * t] as const; // mép trái
  const roadR = (t: number) => [W * (0.62 + 0.36 * t), H - (H - ground - 2) * t] as const; // mép phải
  let road = `M${f(roadL(0)[0])} ${H} `;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const [x, y] = roadL(t);
    road += `L${f(x + Math.sin(t * 3.1) * 10)} ${f(y)} `;
  }
  for (let i = 10; i >= 0; i--) {
    const t = i / 10;
    const [x, y] = roadR(t);
    road += `L${f(x + Math.sin(t * 3.1) * 10)} ${f(y)} `;
  }
  s += `<path d="${road}Z" fill="url(#kroad)"/>`;
  // Viên đá lát: hàng ngang, càng xa càng nhỏ
  for (let row = 0; row < 9; row++) {
    const t0 = row / 9;
    const t1 = (row + 1) / 9;
    const [lx, ly] = roadL((t0 + t1) / 2);
    const [rx] = roadR((t0 + t1) / 2);
    const off = Math.sin(((t0 + t1) / 2) * 3.1) * 10;
    const rowH = (H - ground) / 9;
    const n = Math.max(2, Math.round(5 - row * 0.35));
    const span = rx - lx;
    for (let k = 0; k < n; k++) {
      const w = (span / n) * (0.78 + rnd() * 0.12);
      const cx = lx + off + (span / n) * (k + 0.5) + (row % 2 ? span / n / 2 : 0) * 0.5;
      if (cx > rx + off - 4) continue;
      s += `<rect x="${f(cx - w / 2)}" y="${f(ly - rowH * 0.36)}" width="${f(w)}" height="${f(rowH * 0.72)}" rx="${f(Math.min(6, rowH * 0.3))}" fill="#F3EAE3" stroke="#CDB8AB" stroke-width="0.8" opacity="0.9"/>`;
    }
  }

  // Cây anh đào bên phải: gốc to ở cuối đường, thân hơi nghiêng sang trái rồi tách thành mấy cành lớn vươn ra góc trên
  const tx = W * 0.9;
  const ty = ground + 2;
  const k0 = g / 390; // tỉ lệ độ dày theo màn hình
  const fork = [W * 0.8, H * 0.4] as const; // chỗ thân tách cành
  s += `<path d="M${f(tx - 24 * k0)} ${f(ty)} C${f(tx - 14 * k0)} ${f(H * 0.62)} ${f(fork[0] - 8 * k0)} ${f(H * 0.5)} ${f(fork[0] - 11 * k0)} ${f(fork[1])} L${f(fork[0] + 11 * k0)} ${f(fork[1] + 4)} C${f(fork[0] + 18 * k0)} ${f(H * 0.52)} ${f(tx + 16 * k0)} ${f(H * 0.64)} ${f(tx + 26 * k0)} ${f(ty)}Z" fill="url(#ktrunk)"/>`;
  // Rễ loe ra ở gốc
  s += `<path d="M${f(tx - 40 * k0)} ${f(ty + 3)} Q${f(tx - 16 * k0)} ${f(ty - 12)} ${f(tx)} ${f(ty - 18)} Q${f(tx + 18 * k0)} ${f(ty - 10)} ${f(tx + 42 * k0)} ${f(ty + 3)}Z" fill="#5C3433"/>`;
  // Cành lớn (vẽ hai nét chồng: nét to ở gốc cành, nét nhỏ ra tới ngọn → cành thon dần)
  const limbs: [number, number, number, number, number][] = [
    // điểm uốn x, y, ngọn x, y (theo tỉ lệ màn hình), độ dày
    [0.66, 0.3, 0.46, 0.1, 14],
    [0.8, 0.22, 0.72, 0.03, 12],
    [0.92, 0.3, 1.04, 0.16, 11],
    [0.74, 0.34, 0.58, 0.24, 7],
    [0.9, 0.16, 0.98, 0.02, 7],
  ];
  for (const [mx, my, ex, ey, w] of limbs) {
    const d = `M${f(fork[0])} ${f(fork[1])} Q${f(mx * W)} ${f(my * H)} ${f(ex * W)} ${f(ey * H)}`;
    s += `<path d="${d}" stroke="#6A3E3C" stroke-width="${f(w * k0 * 0.45)}" stroke-linecap="round" fill="none"/>`;
    // nửa đầu dày hơn
    const hx = (fork[0] + mx * W) / 2;
    const hy = (fork[1] + my * H) / 2;
    s += `<path d="M${f(fork[0])} ${f(fork[1])} Q${f((fork[0] + hx) / 2)} ${f((fork[1] + hy) / 2)} ${f(hx)} ${f(hy)}" stroke="#6A3E3C" stroke-width="${f(w * k0)}" stroke-linecap="round" fill="none"/>`;
    // cành con
    s += `<path d="M${f((hx + ex * W) / 2)} ${f((hy + ey * H) / 2)} q${f(-14 * k0)} ${f(-6 * k0)} ${f(-24 * k0)} ${f(-20 * k0)}" stroke="#6A3E3C" stroke-width="${f(2 * k0)}" stroke-linecap="round" fill="none"/>`;
  }
  // Tán hoa: các đám hoa quanh ngọn cành
  const clouds: [number, number, number][] = [
    [0.47, 0.1, 0.12], [0.58, 0.06, 0.13], [0.72, 0.04, 0.15], [0.86, 0.07, 0.15], [1.0, 0.04, 0.14],
    [0.6, 0.2, 0.1], [0.74, 0.16, 0.12], [1.02, 0.17, 0.12], [0.9, 0.22, 0.1], [0.56, 0.25, 0.08],
  ];
  const tones = ['#F7C6D6', '#F4B4C9', '#F9D3DF', '#F1A9C1'];
  // Mỗi đám: nhiều chùm hoa nhỏ chồng lên nhau (lớp sau đậm, lớp trước nhạt), lấm tấm chấm trắng như hoa đang nở
  for (const [cx, cy, cr] of clouds) {
    const R = cr * g;
    for (let k = 0; k < 34; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * R * 0.85;
      const r = R * (0.16 + rnd() * 0.16);
      const front = k > 20;
      s += `<circle cx="${f(cx * W + Math.cos(a) * d)}" cy="${f(cy * H + Math.sin(a) * d * 0.72)}" r="${f(r)}" fill="${front ? tones[2] : tones[k % 2 ? 1 : 3]}" opacity="${front ? 0.8 : 0.9}"/>`;
    }
    for (let k = 0; k < 16; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * R * 0.85;
      s += `<circle cx="${f(cx * W + Math.cos(a) * d)}" cy="${f(cy * H + Math.sin(a) * d * 0.72)}" r="${f(1 + rnd() * 1.6)}" fill="#FFFFFF" opacity="0.75"/>`;
    }
  }
  for (let i = 0; i < 26; i++) {
    const c = clouds[i % clouds.length];
    const a = rnd() * Math.PI * 2;
    const d = (0.55 + rnd() * 0.5) * c[2] * g;
    const x = c[0] * W + Math.cos(a) * d;
    const y = c[1] * H + Math.sin(a) * d * 0.7;
    s += flower(x, y, g * (0.022 + rnd() * 0.014), rnd() * 72, rnd() > 0.5 ? '#FBE3EA' : '#F8CADA', '#E2799A', 0.95);
  }

  // Cánh hoa rụng phủ trên mặt đường và cỏ dưới gốc cây
  for (let i = 0; i < 120; i++) {
    const t = Math.pow(rnd(), 0.6);
    const [lx, ly] = roadL(t);
    const [rx] = roadR(t);
    const x = lx + (rx - lx) * (0.15 + rnd() * 0.95);
    const y = ly + (rnd() - 0.5) * 10;
    const sz = 2 + rnd() * 2.6 * (1 - t * 0.5);
    s += `<path d="${LOOSE_PETAL_PATH}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rnd() * 360)}) scale(${f(sz)} ${f(sz * 0.8)})" fill="${rnd() > 0.5 ? '#F6B9CC' : '#FBD7E2'}" opacity="0.9"/>`;
  }

  // Bụi hoa dọc mép dưới (dưới mặt đường): bụi xanh đậm điểm hoa hồng / trắng
  for (let i = 0; i < 9; i++) {
    const cx = (i / 8) * W + (rnd() - 0.5) * 20;
    const cy = H - 6 + rnd() * 8;
    const r = g * (0.07 + rnd() * 0.04);
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r * 1.3)}" ry="${f(r)}" fill="${i % 2 ? '#6FAE68' : '#7DBB72'}"/>`;
    for (let k = 0; k < 7; k++) {
      const a = Math.PI + rnd() * Math.PI;
      const d = rnd() * r * 0.9;
      s += flower(cx + Math.cos(a) * d * 1.2, cy + Math.sin(a) * d, g * (0.012 + rnd() * 0.008), rnd() * 72, rnd() > 0.4 ? '#F49AB7' : '#FFFFFF', '#D2557E');
    }
  }
  s += '</svg>';
  return s;
}

// ---------- Trời sao ----------
export function meteorSkySvg(W: number, H: number): string {
  const rnd = seeded(11);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs>
    <linearGradient id="nsky" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#050816"/><stop offset="0.6" stop-color="#0A1028"/><stop offset="1" stop-color="#101536"/></linearGradient>
    <radialGradient id="nglow1"><stop offset="0" stop-color="#8E6BD8" stop-opacity="0.32"/><stop offset="1" stop-color="#8E6BD8" stop-opacity="0"/></radialGradient>
    <radialGradient id="nglow2"><stop offset="0" stop-color="#5E7FE0" stop-opacity="0.26"/><stop offset="1" stop-color="#5E7FE0" stop-opacity="0"/></radialGradient>
    <radialGradient id="nglow3"><stop offset="0" stop-color="#E3C6F2" stop-opacity="0.2"/><stop offset="1" stop-color="#E3C6F2" stop-opacity="0"/></radialGradient>
    <radialGradient id="ndark"><stop offset="0" stop-color="#050816" stop-opacity="0.55"/><stop offset="1" stop-color="#050816" stop-opacity="0"/></radialGradient>
  </defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#nsky)"/>`;
  // Dải ngân hà: chạy chéo từ dưới trái lên trên phải, ghép từ nhiều quầng sáng mờ
  const bandAt = (t: number) => [W * (-0.1 + 1.2 * t), H * (0.92 - 0.84 * t)] as const;
  const L = Math.hypot(W, H);
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const [x, y] = bandAt(t);
    const r = L * (0.1 + rnd() * 0.08);
    const id = i % 3 === 0 ? 'nglow1' : i % 3 === 1 ? 'nglow2' : 'nglow3';
    s += `<ellipse cx="${f(x + (rnd() - 0.5) * 30)}" cy="${f(y + (rnd() - 0.5) * 30)}" rx="${f(r * 1.4)}" ry="${f(r * 0.6)}" transform="rotate(${f(-Math.atan2(H * 0.84, W * 1.2) * 57.3)} ${f(x)} ${f(y)})" fill="url(#${id})"/>`;
  }
  // Vệt bụi tối giữa dải (như ảnh chụp ngân hà thật)
  for (let i = 0; i < 8; i++) {
    const [x, y] = bandAt(0.15 + i * 0.1 + rnd() * 0.05);
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(L * 0.06)}" ry="${f(L * 0.018)}" transform="rotate(${f(-Math.atan2(H * 0.84, W * 1.2) * 57.3 + (rnd() - 0.5) * 20)} ${f(x)} ${f(y)})" fill="url(#ndark)"/>`;
  }
  // Bụi sao dày trong dải ngân hà
  for (let i = 0; i < 260; i++) {
    const t = rnd();
    const [x, y] = bandAt(t);
    const spread = (rnd() + rnd() + rnd() - 1.5) * L * 0.09;
    const nx = -H * 0.84;
    const ny = -W * 1.2;
    const nl = Math.hypot(nx, ny);
    s += `<circle cx="${f(x + (nx / nl) * spread)}" cy="${f(y + (ny / nl) * spread)}" r="${f(0.35 + rnd() * 0.6)}" fill="#FFFFFF" opacity="${f(0.25 + rnd() * 0.5)}"/>`;
  }
  // Sao rải khắp trời
  for (let i = 0; i < 140; i++) {
    const r = rnd() < 0.08 ? 1.2 + rnd() * 0.6 : 0.4 + rnd() * 0.7;
    const tint = rnd() < 0.15 ? '#CFD8FF' : rnd() < 0.1 ? '#FFE8C8' : '#FFFFFF';
    s += `<circle cx="${f(rnd() * W)}" cy="${f(rnd() * H)}" r="${f(r)}" fill="${tint}" opacity="${f(0.35 + rnd() * 0.55)}"/>`;
  }
  s += '</svg>';
  return s;
}
