import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Picture, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useTheme } from '../ThemeProvider';

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
  // Nền ảnh/video: tuyết trắng. Nền màu (gần trắng) của bộ Snow: tuyết xanh nhạt cho thấy được
  const onMedia = theme.background.type !== 'preset' && !!theme.background.uri;
  return <SnowCanvas color={onMedia ? '#FFFFFF' : '#A9C2DD'} />;
}

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function SnowCanvas({ color }: { color: string }) {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const skColor = useMemo(() => Skia.Color(color), [color]);
  // Mỗi bông 7 số: x, y ban đầu, tốc độ rơi (px/giây), bán kính, độ lắc, tần số lắc, độ đậm.
  // Bông to rơi nhanh hơn bông nhỏ → cảm giác có chiều sâu
  const flakes = useMemo(() => {
    const out: number[] = [];
    const count = Math.round(34 * Math.min(1.6, (width * height) / (390 * 844)));
    for (let i = 0; i < count; i++) {
      const depth = rnd(i, 3);
      out.push(rnd(i, 1), rnd(i, 2), 14 + depth * 30, 1.1 + depth * 2.6, 6 + rnd(i, 4) * 18, 0.25 + rnd(i, 5) * 0.5, 0.35 + depth * 0.5);
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(skColor);
    const H = height + 20;
    for (let i = 0; i < flakes.length; i += 7) {
      const y = ((flakes[i + 1] * H + flakes[i + 2] * t) % H) - 10;
      const x = flakes[i] * width + Math.sin(t * flakes[i + 5] * 6.28 + i) * flakes[i + 4];
      paint.setAlphaf(flakes[i + 6]);
      canvas.drawCircle(x, y, flakes[i + 3], paint);
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
