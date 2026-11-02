import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Fill, ImageShader, Picture, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { leafRevealShader, snowRevealShader } from './shaders';
import { drawFlake, FLAKE_SVGS } from './snowflakes';
import { drawLeaf, LEAF_COLORS, LEAF_SVGS, makeLeafPaths } from './leaves';

// Màu bông tuyết lúc chuyển theme: xanh xám vừa phải, thấy được trên cả nền tối lẫn nền trắng
const FLAKE_COLOR = '#7C9EC4';

export type ThemeEffect = 'snow' | 'leaves';

// Thời gian chạy của từng hiệu ứng (ms)
export const EFFECT_MS: Record<ThemeEffect, number> = { snow: 1500, leaves: 1400 };

type Props = {
  effect: ThemeEffect;
  image: SkImage; // ảnh chụp màn hình cũ
  origin: { x: number; y: number }; // chỗ bấm
  progress: SharedValue<number>; // 0 → 1
  width: number;
  height: number;
};

// Shader của hiệu ứng dựng được chưa (dựng lỗi thì chuyển theme kiểu mờ dần thay vì giật)
export const effectReady = (effect: ThemeEffect) => !!(effect === 'snow' ? snowRevealShader() : leafRevealShader());

// Số ngẫu nhiên cố định theo chỉ số (để mỗi lần vẽ, bông tuyết / chiếc lá thứ i luôn giống nhau)
const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// Lớp hiệu ứng chuyển theme, nằm trên cùng app:
//  1. Ảnh chụp màn hình cũ, bị shader "xoá" dần từ chỗ bấm ra ngoài
//  2. Các hạt bay phía trên (bông tuyết / lá), vẽ lại mỗi khung hình trên luồng UI
export function EffectOverlay({ effect, image, origin, progress, width, height }: Props) {
  const source = effect === 'snow' ? snowRevealShader() : leafRevealShader();
  const maxR = Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(width - origin.x, origin.y),
    Math.hypot(origin.x, height - origin.y),
    Math.hypot(width - origin.x, height - origin.y)
  );
  const ox = origin.x;
  const oy = origin.y;

  const uniforms = useDerivedValue(() => {
    const p = progress.value;
    // Chậm lúc đầu, nhanh ở giữa, chậm lại lúc cuối
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return { origin: [ox, oy], progress: e, maxR };
  });

  const particles = useMemo(
    () => (effect === 'snow' ? makeFlakes(width, height) : makeLeaves()),
    [effect, width, height]
  );
  // Chỉ chuyển chữ/số sang luồng UI; hình (SkPath) dựng ngay trong worklet cho chắc
  const leafSvgs = LEAF_SVGS;
  const leafColors = LEAF_COLORS;
  const flakeSvgs = FLAKE_SVGS;

  const picture = useDerivedValue(() => {
    const p = progress.value;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);

      if (effect === 'snow') {
        // Bông tuyết (hình icon 6 cánh) rơi từ trên xuống, lắc nhẹ và xoay chậm; mờ dần ở cuối hiệu ứng
        const shapes = flakeSvgs.map((d) => Skia.Path.MakeFromSVGString(d));
        paint.setStyle(1); // vẽ nét
        paint.setStrokeCap(1); // đầu nét tròn
        paint.setStrokeJoin(1);
        paint.setColor(Skia.Color(FLAKE_COLOR));
        const fadeOut = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
        const fadeIn = Math.min(1, p / 0.12);
        for (let i = 0; i < particles.length; i += 6) {
          const x0 = particles[i];
          const delay = particles[i + 1];
          const r = particles[i + 2];
          const amp = particles[i + 3];
          const phase = particles[i + 4];
          const alpha = particles[i + 5];
          const t = Math.max(0, p - delay) / (1 - delay);
          if (t <= 0) continue;
          const shape = shapes[(i / 6) % shapes.length];
          if (!shape) continue;
          const y = -14 + t * (height * 0.9 + 28);
          const x = x0 + Math.sin(t * 6.2 + phase) * amp;
          paint.setAlphaf(alpha * fadeIn * fadeOut);
          drawFlake(canvas, paint, shape, x, y, r, phase * 57.3 + t * 90, 1.4);
        }
      } else {
        // Lá (hình icon) bay ra từ chỗ bấm, bị gió thổi sang phải, vừa bay vừa xoay và lật
        const shapes = makeLeafPaths(Skia, leafSvgs);
        paint.setStyle(0); // tô đặc
        for (let i = 0, k = 0; i < particles.length; i += 7, k++) {
          const start = particles[i];
          const angle = particles[i + 1];
          const speed = particles[i + 2];
          const size = particles[i + 3];
          const spin = particles[i + 4];
          const ci = particles[i + 5];
          const wind = particles[i + 6];
          const shape = shapes[k % shapes.length];
          if (!shape) continue;
          const life = 0.6;
          const t = (p - start) / life;
          if (t <= 0 || t >= 1) continue;
          const x = ox + Math.cos(angle) * speed * t + wind * t * t;
          const y = oy + Math.sin(angle) * speed * t - 60 * t + 120 * t * t;
          const a = t < 0.12 ? t / 0.12 : t > 0.75 ? (1 - t) / 0.25 : 1;
          const r = size * (0.6 + 0.4 * Math.min(1, t * 4));
          paint.setColor(Skia.Color(leafColors[ci]));
          paint.setAlphaf(a);
          drawLeaf(canvas, paint, shape, x, y, r, spin * t * 360 + angle * 57.3 + 90, Math.cos(t * 9 + k));
        }
      }
    } catch (e) {
      // Lỗi khi vẽ hạt thì bỏ qua phần hạt, hiệu ứng "xoá" màn hình cũ vẫn chạy
    }
    return rec.finishRecordingAsPicture();
  });

  if (!source) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={source} uniforms={uniforms}>
            <ImageShader image={image} fit="fill" rect={{ x: 0, y: 0, width, height }} />
          </Shader>
        </Fill>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

// Mỗi bông tuyết 6 số: x, độ trễ, bán kính, độ lắc, pha, độ đậm
function makeFlakes(width: number, height: number) {
  const out: number[] = [];
  const count = Math.round(36 * Math.min(1.6, (width * height) / (390 * 844)));
  for (let i = 0; i < count; i++) {
    out.push(rnd(i, 1) * width, rnd(i, 2) * 0.45, 6 + rnd(i, 3) * 8, 6 + rnd(i, 4) * 16, rnd(i, 5) * 6.28, 0.55 + rnd(i, 6) * 0.45);
  }
  return out;
}

// Mỗi chiếc lá 7 số: lúc xuất hiện, hướng bay, tốc độ, kích thước, số vòng xoay, màu, sức gió
function makeLeaves() {
  const out: number[] = [];
  for (let i = 0; i < 34; i++) {
    const angle = -Math.PI / 2 + (rnd(i, 2) - 0.35) * Math.PI * 1.4; // phần lớn bay lên và sang phải
    out.push(rnd(i, 1) * 0.4, angle, 160 + rnd(i, 3) * 300, 11 + rnd(i, 4) * 10, (rnd(i, 5) - 0.5) * 2.4, Math.floor(rnd(i, 6) * 5), 120 + rnd(i, 7) * 260);
  }
  return out;
}
