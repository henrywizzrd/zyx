import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

// Shader "xoá" ảnh chụp màn hình cũ, để lộ theme mới bên dưới.
// Chạy trên GPU cho từng điểm ảnh:
//  - d: khoảng cách từ điểm ảnh tới chỗ bấm (origin)
//  - n: nhiễu (noise) để mép loang không tròn trịa mà lởm chởm tự nhiên
//  - r: bán kính vùng đã lộ ra, lớn dần theo progress (0 → 1)
//  - edge > 0: điểm ảnh vẫn thuộc màn hình cũ; edge gần 0: đang ở mép → tô màu hiệu ứng (băng giá / lá)
const COMMON = `
uniform shader image;
uniform float2 origin;
uniform float progress;
uniform float maxR;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}
// Cộng nhiều lớp nhiễu (to → nhỏ, xoay lệch nhau) cho mép mềm và tự nhiên, không lộ ô vuông
float fbm(float2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int k = 0; k < 4; k++) {
    v += a * noise(p);
    p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + 17.0;
    a *= 0.5;
  }
  return v / 1.0;
}
`;

// Snow: băng giá lan ra từ thẻ vừa bấm. Mép là một dải trắng xanh lấp lánh (màn hình cũ "đóng băng" rồi vỡ ra)
const SNOW = `${COMMON}
half4 main(float2 p) {
  half4 c = image.eval(p);
  float d = distance(p, origin);
  float n = fbm(p * 0.018);
  float r = progress * (maxR + 185.0);
  float edge = d + n * 170.0 - r;
  float a = smoothstep(0.0, 5.0, edge);
  float band = 1.0 - smoothstep(0.0, 80.0, edge);
  half3 col = mix(c.rgb, half3(0.92, 0.96, 1.0), half(band * 0.88));
  float sparkle = step(0.994, hash(floor(p / 2.0))) * band * band;
  col = min(col + half3(half(sparkle)), half3(1.0));
  return half4(col * half(a), half(a));
}`;

// Green: màn hình cũ bị "ăn mòn" thành từng mảng như lá rụng, mép viền xanh lá
const LEAF = `${COMMON}
half4 main(float2 p) {
  half4 c = image.eval(p);
  float d = distance(p, origin);
  float n = fbm(p * 0.04);
  float r = progress * (maxR + 265.0);
  float edge = d + n * 250.0 - r;
  float a = smoothstep(0.0, 3.0, edge);
  float band = 1.0 - smoothstep(0.0, 22.0, edge);
  half3 col = mix(c.rgb, half3(0.30, 0.62, 0.32), half(band * 0.9));
  return half4(col * half(a), half(a));
}`;

// Ocean: sóng nước lan từ chỗ bấm. Màn hình cũ bị méo nhẹ ở đầu sóng (như nhìn qua mặt nước),
// phía sau đầu sóng còn vài vòng gợn sáng mờ dần trên theme mới
const RIPPLE = `${COMMON}
half4 main(float2 p) {
  float d = distance(p, origin);
  float2 dir = d > 0.5 ? (p - origin) / d : float2(0.0, 0.0);
  float r = progress * (maxR + 150.0);
  float edge = d + fbm(p * 0.012) * 40.0 - r;
  if (edge > 0.0) {
    float ring = exp(-edge * edge / 2500.0);
    float off = sin(edge * 0.18) * 14.0 * ring;
    half4 c = image.eval(p + dir * off);
    float a = smoothstep(0.0, 4.0, edge);
    float crest = ring * 0.35 * (0.5 + 0.5 * sin(edge * 0.18));
    half3 col = mix(c.rgb, half3(0.85, 0.93, 1.0), half(crest));
    return half4(col * half(a), half(a));
  }
  float behind = -edge;
  float wave = 0.5 + 0.5 * sin(behind * 0.09 - progress * 14.0);
  float al = wave * wave * exp(-behind / 160.0) * (1.0 - progress) * 0.22;
  return half4(half3(0.45, 0.66, 0.9) * half(al), half(al));
}`;

const cache: Record<string, SkRuntimeEffect | null> = {};
function make(name: string, src: string) {
  if (!(name in cache)) {
    cache[name] = Skia.RuntimeEffect.Make(src);
    if (!cache[name]) console.warn('[theme] shader compile failed:', name);
  }
  return cache[name];
}

export const snowRevealShader = () => make('snow', SNOW);
export const leafRevealShader = () => make('leaf', LEAF);
export const rippleRevealShader = () => make('ripple', RIPPLE);
