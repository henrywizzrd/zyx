import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Picture, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useTheme } from '../ThemeProvider';
import { drawFlake, FLAKE_SVGS } from './snowflakes';
import { drawLeaf, LEAF_COLORS, LEAF_SVGS, makeLeafPaths } from './leaves';

// Hiệu ứng rơi nhẹ liên tục phía sau nội dung (bật/tắt trong trang Giao diện):
//  - bộ Snow: bông tuyết
//  - bộ Green: lá cây
// Không chạy (không tốn pin) khi: bộ màu khác, đã tắt, đang mở Player (paused), hoặc app đang ở nền.
export function AmbientEffect({ paused }: { paused?: boolean }) {
  const { theme } = useTheme();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  if (paused || !active) return null;
  const onMedia = theme.background.type !== 'preset' && !!theme.background.uri;
  if (theme.preset === 'snow' && theme.effects.ambientSnow) {
    // Nền ảnh/video: tuyết trắng. Nền màu (gần trắng) của bộ Snow: tuyết xanh xám vừa đủ nhìn, không lấn chữ
    return <SnowCanvas color={onMedia ? '#FFFFFF' : '#7F9FC4'} />;
  }
  if (theme.preset === 'green' && theme.effects.ambientLeaves) return <LeafCanvas />;
  return null;
}

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
// Số hạt theo diện tích màn hình (iPad nhiều hơn điện thoại một chút)
const scaled = (n: number, w: number, h: number) => Math.round(n * Math.min(1.6, (w * h) / (390 * 844)));

function Layer({ picture }: { picture: ReturnType<typeof useDerivedValue<import('@shopify/react-native-skia').SkPicture>> }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

function SnowCanvas({ color }: { color: string }) {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const flakeSvgs = FLAKE_SVGS;
  // Mỗi bông 8 số: x, y ban đầu, tốc độ rơi (px/giây), bán kính, độ lắc, tần số lắc, độ đậm, tốc độ xoay.
  // Bông to (gần) rơi nhanh và đậm hơn bông nhỏ (xa) → cảm giác có chiều sâu
  const flakes = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(22, width, height); i++) {
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
        const y = ((flakes[i + 1] * H + flakes[i + 2] * t) % H) - 15;
        const x = flakes[i] * width + Math.sin(t * flakes[i + 5] * 6.28 + i) * flakes[i + 4];
        paint.setAlphaf(flakes[i + 6]);
        drawFlake(canvas, paint, shape, x, y, flakes[i + 3], k * 23 + t * flakes[i + 7], 1.2);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

function LeafCanvas() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const leafSvgs = LEAF_SVGS;
  const colors = LEAF_COLORS;
  // Mỗi lá 9 số: x, y ban đầu, tốc độ rơi, kích thước, độ đưa ngang, tần số đưa, độ đậm, tốc độ lật, màu.
  // Lá rơi chậm hơn tuyết, đưa qua lại rộng hơn và lật vòng như đang bay trong gió
  const leaves = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(12, width, height); i++) {
      const depth = rnd(i, 3);
      out.push(
        rnd(i, 1), rnd(i, 2), 22 + depth * 26, 8 + depth * 7, 18 + rnd(i, 4) * 30, 0.12 + rnd(i, 5) * 0.18,
        0.55 + depth * 0.4, 0.25 + rnd(i, 6) * 0.45, Math.floor(rnd(i, 7) * 5)
      );
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const shapes = makeLeafPaths(Skia, leafSvgs);
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      const H = height + 60;
      for (let i = 0, k = 0; i < leaves.length; i += 9, k++) {
        const shape = shapes[k % shapes.length];
        if (!shape) continue;
        const sway = Math.sin(t * leaves[i + 5] * 6.28 + k);
        const y = ((leaves[i + 1] * H + leaves[i + 2] * t) % H) - 30;
        const x = leaves[i] * width + sway * leaves[i + 4];
        // Lá nghiêng theo hướng đang đưa, và lật (bóp ngang) theo nhịp riêng
        const rot = 25 + sway * 35 + k * 40;
        const flip = Math.cos(t * leaves[i + 7] * 6.28 + k * 1.7);
        paint.setColor(Skia.Color(colors[leaves[i + 8]]));
        paint.setAlphaf(leaves[i + 6]);
        drawLeaf(canvas, paint, shape, x, y, leaves[i + 3], rot, flip);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}
