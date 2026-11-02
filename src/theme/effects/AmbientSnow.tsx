import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Picture, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useTheme } from '../ThemeProvider';
import { drawFlake, FLAKE_SVGS } from './snowflakes';

// Tuyết rơi nhẹ liên tục phía sau nội dung khi dùng bộ Snow (bật/tắt trong trang Giao diện).
// Không chạy (không tốn pin) khi: không phải bộ Snow, đã tắt, đang mở Player (paused), hoặc app đang ở nền.
export function AmbientSnow({ paused }: { paused?: boolean }) {
  const { theme } = useTheme();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  if (theme.preset !== 'snow' || !theme.effects.ambientSnow || paused || !active) return null;
  // Nền ảnh/video: tuyết trắng. Nền màu (gần trắng) của bộ Snow: tuyết xanh xám vừa đủ nhìn, không lấn chữ
  const onMedia = theme.background.type !== 'preset' && !!theme.background.uri;
  return <SnowCanvas color={onMedia ? '#FFFFFF' : '#7F9FC4'} />;
}

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function SnowCanvas({ color }: { color: string }) {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const flakeSvgs = FLAKE_SVGS;
  // Mỗi bông 8 số: x, y ban đầu, tốc độ rơi (px/giây), bán kính, độ lắc, tần số lắc, độ đậm, tốc độ xoay.
  // Bông to (gần) rơi nhanh và đậm hơn bông nhỏ (xa) → cảm giác có chiều sâu
  const flakes = useMemo(() => {
    const out: number[] = [];
    const count = Math.round(22 * Math.min(1.6, (width * height) / (390 * 844)));
    for (let i = 0; i < count; i++) {
      const depth = rnd(i, 3);
      out.push(
        rnd(i, 1), rnd(i, 2), 16 + depth * 26, 5.5 + depth * 6, 8 + rnd(i, 4) * 18, 0.2 + rnd(i, 5) * 0.35,
        0.45 + depth * 0.45, (rnd(i, 6) - 0.5) * 50
      );
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const shapes = flakeSvgs.map((d) => Skia.Path.MakeFromSVGString(d));
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setStyle(1); // vẽ nét
      paint.setStrokeCap(1);
      paint.setStrokeJoin(1);
      paint.setColor(Skia.Color(color));
      const H = height + 30;
      for (let i = 0, k = 0; i < flakes.length; i += 8, k++) {
        const shape = shapes[k % shapes.length];
        if (!shape) continue;
        const r = flakes[i + 3];
        const y = ((flakes[i + 1] * H + flakes[i + 2] * t) % H) - 15;
        const x = flakes[i] * width + Math.sin(t * flakes[i + 5] * 6.28 + i) * flakes[i + 4];
        paint.setAlphaf(flakes[i + 6]);
        drawFlake(canvas, paint, shape, x, y, r, k * 23 + t * flakes[i + 7], 1.2);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
