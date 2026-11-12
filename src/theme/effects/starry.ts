// Bộ "Trời sao" (kiểu thiên văn): cả bầu trời vẽ bằng shader trên GPU, mỗi điểm ảnh tự tính màu của nó.
//  - nền: quầng chàm ở góc trên trái, tối dần xuống dưới
//  - tinh vân chàm–tím pha xanh ngọc + vệt bụi tối dọc dải ngân hà (nhiễu fbm)
//  - 3 lớp sao xa / vừa / gần: sao có lõi sáng + quầng mềm, đa số mờ, vài ngôi rất sáng có tia nhiễu xạ mảnh;
//    sao dày dần về phía dải ngân hà; lớp gần trôi nhanh hơn lớp xa (có chiều sâu)
// Trời trôi mà không lag: shader chỉ vẽ MỘT LẦN (nền + tinh vân + lớp sao xa). Hai lớp sao vừa / gần là các "sprite" vẽ bằng
// drawAtlas (một lệnh vẽ cho cả trăm ngôi), chỉ dịch vị trí mỗi khung → GPU gần như không tốn gì (xem StarryDrift trong Ambient.tsx)
// Bản xem trước trên web (WebGL) cùng thuật toán: artifact "ZYX – Theme Trời sao".
// Hai lỗi đã gặp khi làm bản web, giữ nguyên cách sửa ở đây:
//  1. smoothstep(a, b, x) phải có a < b (đảo ngược là "không xác định" trên GPU → sao bị cắt thành vệt). Cần đảo thì 1 - smoothstep
//  2. mật độ theo dải ngân hà tính ở TÂM Ô, không theo từng điểm ảnh (nếu không ngôi sao ở ô bên cạnh bị cắt ngang)
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

export const STARRY_SKSL = `
uniform float2 res;   // kích thước vùng vẽ (điểm)
uniform float time;   // giây
uniform float tw;     // độ lấp lánh 0..1 (0 = đứng yên)
uniform float drift;  // tốc độ trời trôi
uniform float full;   // 1 = vẽ cả 3 lớp sao; 0 = chỉ lớp xa (2 lớp vừa / gần vẽ riêng để trôi được, xem StarryDrift)

float h21(float2 p) { p = fract(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + float2(1.0, 0.0)), u.x), mix(h21(i + float2(0.0, 1.0)), h21(i + float2(1.0, 1.0)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + float2(1.7, 9.2); a *= 0.5; }
  return v;
}
// Dải ngân hà: đường chéo qua màn hình (1 ở giữa dải, 0 ở xa)
float bandAt(float2 uv) {
  float2 c0 = float2(res.x / res.y * 0.5, 0.55);
  float dl = dot(uv - c0, normalize(float2(0.42, 1.0)));
  return exp(-dl * dl / 0.018);
}
// Một ngôi sao (nếu ô có sao) nhìn từ điểm f trong ô đang xét; o = ô lân cận
float3 star(float2 id, float2 o, float2 f, float scale, float sizeK, float prob, float bandK, float t, float seed, float edge) {
  float2 c = id + o + seed;
  float band = bandAt((id + o + 0.5) / scale) * bandK;
  float p = clamp(prob * (0.35 + 1.1 * band), 0.0, 1.0);
  if (h21(c * 1.31) > p) return float3(0.0);
  float2 pos = o + 0.15 + 0.7 * float2(h21(c), h21(c + 17.0));
  float2 d = f - pos;
  float b = pow(h21(c + 3.1), 5.0);
  float sz = (0.035 + 0.11 * b) * sizeK;
  float d2 = dot(d, d);
  float twk = 1.0 - tw * 0.6 * (0.5 + 0.5 * sin(t * (0.6 + 2.2 * h21(c + 7.0)) + 6.283 * h21(c + 9.0)));
  float3 tint = mix(float3(0.72, 0.8, 1.0), float3(1.0, 0.86, 0.72), step(0.82, h21(c + 11.0)));
  tint = mix(tint, float3(1.0), 0.45);
  float shape = exp(-d2 / (sz * sz)) + exp(-d2 / (sz * sz * 9.0)) * (0.1 + 0.3 * b);
  if (b > 0.55) {
    float sp = exp(-abs(d.x) / (sz * 0.12)) * exp(-abs(d.y) / (sz * 3.5)) + exp(-abs(d.y) / (sz * 0.12)) * exp(-abs(d.x) / (sz * 3.5));
    shape += sp * 0.35 * b;
  }
  // tắt dần trước mép vùng được xét → không bị cắt thành vệt
  shape *= 1.0 - smoothstep(edge * 0.55, edge, sqrt(d2));
  return tint * shape * (0.28 + 0.85 * b) * twk;
}
// Lớp có quầng to: xét cả 8 ô xung quanh
float3 layer9(float2 uv, float scale, float sizeK, float prob, float bandK, float t, float seed) {
  float2 g = uv * scale; float2 id = floor(g); float2 f = fract(g);
  float3 col = float3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      col += star(id, float2(float(x), float(y)), f, scale, sizeK, prob, bandK, t, seed, 1.0);
    }
  }
  return col;
}

half4 main(float2 pos) {
  float2 uv = float2(pos.x, res.y - pos.y) / res.y;   // y: 0 dưới → 1 trên
  float asp = res.x / res.y;
  float t = time;
  float band = bandAt(uv);
  float2 gp = uv - float2(asp * 0.2, 1.02);
  float glow = exp(-dot(gp, gp) * 2.2);
  float3 col = mix(float3(0.016, 0.024, 0.075), float3(0.09, 0.12, 0.36), glow);
  col = mix(col, float3(0.03, 0.03, 0.1), (1.0 - uv.y) * 0.35);

  float dr = t * drift * 0.006;
  // tinh vân + vệt bụi tối
  float2 q = uv * 2.4 + float2(dr * 0.5, 0.0);
  float n1 = fbm(q + t * 0.004);
  float n2 = fbm(q * 2.0 + n1 * 2.2);
  float3 nc = mix(float3(0.22, 0.2, 0.62), float3(0.58, 0.3, 0.72), n1);
  nc = mix(nc, float3(0.16, 0.42, 0.62), smoothstep(0.55, 0.8, n2) * 0.5);
  col += nc * smoothstep(0.35, 0.95, n2) * (0.25 + band) * 0.55;
  float dust = smoothstep(0.5, 0.78, fbm(uv * 7.0 + float2(dr, 3.0)));
  col *= 1.0 - dust * band * 0.55;
  col += float3(0.5, 0.45, 0.85) * band * 0.06;

  // 3 lớp sao. Lớp xa: sao rất nhỏ, chỉ xét chính ô của nó (đỡ 8/9 công tính)
  float2 g0 = (uv + float2(dr * 0.3, 0.0)) * 90.0;
  float3 s = star(floor(g0), float2(0.0), fract(g0), 90.0, 1.0, 0.47, 1.0, t, 0.0, 0.15) * 0.7;
  if (full > 0.5) {
    s += layer9(uv + float2(dr * 0.6, 0.0), 42.0, 0.9, 0.27, 1.0, t, 40.0);
    s += layer9(uv + float2(dr, 0.0), 16.0, 0.7, 0.14, 0.5, t, 80.0) * 1.15;
  }
  col += s;

  col = 1.0 - exp(-col * 1.15);                     // nén sáng mềm
  col += (h21(pos + fract(t)) - 0.5) / 255.0;       // chống vệt màu
  return half4(half3(col), 1.0);
}
`;

let cached: SkRuntimeEffect | null | undefined;
export function starryShader(): SkRuntimeEffect | null {
  if (cached === undefined) {
    const t0 = Date.now();
    cached = Skia.RuntimeEffect.Make(STARRY_SKSL);
    if (!cached) console.warn('[theme] shader compile failed: starry');
    // ghi lại thời gian biên dịch shader (chạy trên luồng JS, một lần) — để biết có phải nó gây khựng không
    const { log } = require('../../data/applog') as typeof import('../../data/applog');
    log('jank', `Trời sao: biên dịch shader ${Date.now() - t0}ms`);
  }
  return cached;
}

// Mật độ dải ngân hà tại một điểm (tính giống shader), để rải sao trôi dày hơn ở dải. x, y theo phần màn hình (y: 0 = trên)
export function starryBand(x: number, y: number, asp: number) {
  const ux = x * asp - asp * 0.5;
  const uy = 1 - y - 0.55;
  const n = Math.hypot(0.42, 1);
  const dl = (ux * 0.42 + uy) / n;
  return Math.exp((-dl * dl) / 0.018);
}
