// Nền "khói màu" cho player Đĩa than: 4 màu tách từ ảnh bìa cuộn vào nhau như khói (nhiễu fbm uốn miền 2 lớp — domain warp).
// Chống lag (bài học theme Trời sao: đừng vẽ shader cả màn hình mỗi khung hình):
//  - vẽ trên một khung NHỎ bằng 1/5 màn hình rồi phóng to 5 lần (khói vốn mềm nên phóng to nhìn y hệt) → GPU tính ít hơn ~25 lần
//  - chỉ vẽ lại 30 lần / giây, và dừng hẳn khi player đang mở / đóng hoặc đang ẩn
// Đã thử bằng CanvasKit trên máy tính (4 khung hình cách nhau 4 giây) trước khi đưa vào app
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

export const SMOKE_SKSL = `
uniform float2 res;
uniform float time;
uniform float3 c0;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;

float h21(float2 p) { p = fract(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + float2(1.0, 0.0)), u.x), mix(h21(i + float2(0.0, 1.0)), h21(i + float2(1.0, 1.0)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + float2(1.7, 9.2); a *= 0.5; }
  return v;
}
half4 main(float2 pos) {
  float2 p = pos / res.y * 2.2;
  float t = time;
  float2 q = float2(fbm(p + float2(0.0, t * 0.11)), fbm(p + float2(5.2, 1.3) - t * 0.09));
  float2 r = float2(fbm(p + 3.6 * q + float2(1.7, 9.2) + t * 0.15), fbm(p + 3.6 * q + float2(8.3, 2.8) - t * 0.13));
  float f = fbm(p + 3.2 * r);
  float3 col = mix(c0, c1, smoothstep(0.25, 0.75, f));
  col = mix(col, c2, smoothstep(0.35, 0.95, length(q)) * 0.85);
  col = mix(col, c3, smoothstep(0.45, 0.85, r.y) * 0.75);
  col *= 0.6 + 0.65 * f * f + 0.25 * r.x;
  return half4(half3(col), 1.0);
}
`;

let cached: SkRuntimeEffect | null | undefined;
export function smokeShader(): SkRuntimeEffect | null {
  if (cached === undefined) {
    cached = Skia.RuntimeEffect.Make(SMOKE_SKSL);
    if (!cached) console.warn('[vinyl] shader compile failed: smoke');
  }
  return cached;
}
