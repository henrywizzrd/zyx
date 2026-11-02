import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Canvas, Picture, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useTheme } from '../ThemeProvider';
import { drawFlake, FLAKE_SVGS } from './snowflakes';
import { drawLeaf, LEAF_COLORS, LEAF_SVGS, makeLeafPaths } from './leaves';
import { drawBubble, drawFish, FISH_BODY, FISH_COLORS, FISH_FIN, FISH_TAIL } from './ocean';

// Hiệu ứng rơi nhẹ liên tục phía sau nội dung (bật/tắt trong trang Giao diện):
//  - bộ Snow: bông tuyết
//  - bộ Green: lá cây
//  - bộ Ocean: bong bóng oxy như bể cá + vài chú cá bơi qua lại
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
  const on = theme.effects.ambient;
  if (theme.preset === 'snow' && on.snow) {
    // Nền ảnh/video: tuyết trắng. Nền màu (gần trắng) của bộ Snow: tuyết xanh xám vừa đủ nhìn, không lấn chữ
    return <SnowCanvas color={onMedia ? '#FFFFFF' : '#7F9FC4'} />;
  }
  if (theme.preset === 'green' && on.green) return <LeafCanvas />;
  if (theme.preset === 'ocean' && on.ocean) return <OceanCanvas onMedia={onMedia} />;
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

// Bộ Ocean: hai cột bong bóng oxy sủi lên từ hai bên đáy (như máy sục khí trong bể cá),
// vài bong bóng lẻ nổi chậm, và vài chú cá bơi ngang qua lại, vẫy đuôi, lên xuống nhẹ
function OceanCanvas({ onMedia }: { onMedia: boolean }) {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const bubbleColor = onMedia ? '#FFFFFF' : '#5B8FC9';
  const fishColors = FISH_COLORS;
  const svgs = [FISH_BODY, FISH_TAIL, FISH_FIN];
  // Bong bóng lẻ, mỗi bong bóng 5 số: x, y ban đầu, tốc độ nổi, bán kính, pha lắc
  const loose = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(8, width, height); i++) {
      out.push(rnd(i, 11), rnd(i, 12), 22 + rnd(i, 13) * 24, 2.5 + rnd(i, 14) * 3.5, rnd(i, 15) * 6.28);
    }
    return out;
  }, [width, height]);
  // Cá, mỗi con 6 số: làn bơi (độ cao), tốc độ, kích thước, màu, vị trí xuất phát, độ nhấp nhô
  const fish = useMemo(() => {
    const out: number[] = [];
    const n = Math.max(3, scaled(4, width, height));
    for (let i = 0; i < n; i++) {
      out.push(0.14 + ((i + rnd(i, 21) * 0.6) / n) * 0.72, 22 + rnd(i, 22) * 20, 11 + rnd(i, 23) * 9, i % 4, rnd(i, 24), 8 + rnd(i, 25) * 10);
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      const bc = Skia.Color(bubbleColor);
      const white = Skia.Color('#FFFFFF');

      // Cột bong bóng oxy: mỗi cột 9 bong bóng nối đuôi nhau, nổi lên hết màn hình mất khoảng 7 giây
      const streams = [width * 0.12, width * 0.88];
      const PER = 9;
      const CYCLE = 7;
      for (let s = 0; s < streams.length; s++) {
        for (let i = 0; i < PER; i++) {
          let ph = t / CYCLE + i / PER + s * 0.37;
          ph -= Math.floor(ph);
          const y = height + 12 - ph * (height + 40);
          const x = streams[s] + Math.sin(ph * 14 + i * 1.3) * (3 + 8 * ph);
          const r = 2.2 + ph * 3.2 + (i % 3) * 0.6;
          const a = 0.6 * (ph < 0.05 ? ph / 0.05 : 1) * (ph > 0.92 ? (1 - ph) / 0.08 : 1);
          drawBubble(canvas, paint, x, y, r, bc, white, a);
        }
      }
      // Bong bóng lẻ
      const LH = height + 30;
      for (let i = 0; i < loose.length; i += 5) {
        const y = LH - ((loose[i + 1] * LH + loose[i + 2] * t) % LH) - 15;
        const x = loose[i] * width + Math.sin(t * 0.8 + loose[i + 4]) * 10;
        drawBubble(canvas, paint, x, y, loose[i + 3], bc, white, 0.45);
      }

      // Cá: bơi hết một lượt qua màn hình rồi quay đầu (lúc đã khuất ngoài mép) bơi ngược lại
      const body = Skia.Path.MakeFromSVGString(svgs[0]);
      const tail = Skia.Path.MakeFromSVGString(svgs[1]);
      const fin = Skia.Path.MakeFromSVGString(svgs[2]);
      if (body && tail && fin) {
        for (let i = 0, k = 0; i < fish.length; i += 6, k++) {
          const size = fish[i + 2];
          const lap = width + size * 6;
          let s = (t * fish[i + 1] + fish[i + 4] * 2 * lap) % (2 * lap);
          const dir = s < lap ? 1 : -1;
          if (dir < 0) s -= lap;
          const x = dir > 0 ? -size * 3 + s : width + size * 3 - s;
          const w = 0.5 + k * 0.13;
          const y = fish[i] * height + Math.sin(t * w + k) * fish[i + 5];
          // Ngóc đầu lên khi đang bơi lên, chúi xuống khi bơi xuống (cùng công thức cho cả hai hướng vì hình đã lật)
          const tilt = Math.cos(t * w + k) * fish[i + 5] * w * 1.2;
          const wiggle = Math.sin(t * 7 + k * 2) * 18;
          drawFish(canvas, paint, body, tail, fin, x, y, size, dir, wiggle, tilt, Skia.Color(fishColors[fish[i + 3]]), white, 0.78);
        }
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}
