import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, ImageSVG, Picture, Skia } from '@shopify/react-native-skia';
import { makeMutable, useDerivedValue, useFrameCallback } from 'react-native-reanimated';

// Đồng hồ chung cho mọi lớp hiệu ứng: hạt rơi / sao băng tính hoàn toàn theo thời gian t, nên hai lớp cùng một t
// vẽ ra y hệt nhau. Nhờ vậy bản sao nền trong trang đang vuốt quay lại khớp đúng với nền chung phía sau
// (trước đây mỗi lớp có đồng hồ riêng tính từ lúc nó xuất hiện → sao băng lệch nhau)
const sharedClock = makeMutable(0);
const clockBase = makeMutable(-1);
function useAmbientClock() {
  useFrameCallback((f) => {
    'worklet';
    if (clockBase.value < 0) clockBase.value = f.timestamp;
    sharedClock.value = f.timestamp - clockBase.value;
  });
  return sharedClock;
}
import { useTheme } from '../ThemeProvider';
import { drawFlake, FLAKE_SVGS } from './snowflakes';
import { drawLeaf, LEAF_COLORS, LEAF_SVGS, makeLeafPaths } from './leaves';
import { BEAN_COLORS, BEAN_SVG } from './beans';
import { drawBubble, drawFish, FISH_BODY, FISH_COLORS, FISH_FIN, FISH_TAIL } from './ocean';
import { useScreenSize } from '../../components/ScreenSize';
import { auroraSkySvg, LOOSE_PETAL_PATH, meteorSkySvg, neonSkySvg, PETAL_PATH, rainGlassSvg } from './scenes';

// Hiệu ứng rơi nhẹ liên tục phía sau nội dung (bật/tắt trong trang Giao diện):
//  - bộ Snow: bông tuyết
//  - bộ Green: lá cây
//  - bộ Ocean: bong bóng oxy như bể cá + vài chú cá bơi qua lại
//  - bộ Latte: hạt cà phê trôi lững lờ khắp màn hình
// Không chạy (không tốn pin) khi: bộ màu khác, đã tắt, đang mở Player (paused), hoặc app đang ở nền.
export function AmbientEffect({ paused }: { paused?: boolean }) {
  const { theme } = useTheme();
  // Chỉ dừng khi app thật sự chạy nền. Kéo thanh thông báo / Trung tâm điều khiển chỉ làm app "tạm mất tập trung"
  // (inactive): trước đây cũng tắt hẳn hiệu ứng nên hạt biến mất rồi hiện lại từ đầu → giờ vẫn chạy tiếp
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'));
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
  if (theme.preset === 'latte' && on.latte) return <CoffeeBeans />;
  if (theme.preset === 'sakura' && on.sakura) return <SakuraPetals />;
  if (theme.preset === 'meteor' && on.meteor) return <MeteorShower />;
  if (theme.preset === 'aurora' && on.aurora) return <AuroraRibbons />;
  if (theme.preset === 'rain' && on.rain) return <RainOnGlass />;
  if (theme.preset === 'neon' && on.neon) return <NeonGrid />;
  return null;
}

// Cảnh nền đứng yên của bộ Mưa sao băng (trời sao) (vẽ một lần, không chạy liên tục nên luôn hiện, kể cả khi tắt hiệu ứng).
// Người dùng đặt ảnh / video làm nền thì không vẽ cảnh (để thấy ảnh của họ)
export function ThemeScene() {
  const { theme } = useTheme();
  const { width, height } = useScreenSize();
  const p = theme.preset;
  const kind = theme.background.type === 'preset' && (p === 'meteor' || p === 'aurora' || p === 'rain' || p === 'neon') ? p : null;
  const svg = useMemo(() => {
    if (!kind || width < 1 || height < 1) return null;
    try {
      const make = kind === 'aurora' ? auroraSkySvg : kind === 'rain' ? rainGlassSvg : kind === 'neon' ? neonSkySvg : meteorSkySvg;
      return Skia.SVG.MakeFromString(make(width, height));
    } catch (e) {
      console.warn('[theme] scene', e);
      return null;
    }
  }, [kind, width, height]);
  if (!svg) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <ImageSVG svg={svg} x={0} y={0} width={width} height={height} />
      </Canvas>
    </View>
  );
}

const rnd = (i: number, k: number) => {
  'worklet'; // dùng được cả trong hàm vẽ chạy trên UI thread (sao băng chọn vị trí mới mỗi đợt)
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
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
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
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
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
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
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

// Bộ Latte: hạt cà phê trôi lững lờ khắp màn hình, mỗi hạt một hướng, xoay chậm và nhấp nhô nhẹ như đang trôi trên mặt cà phê.
// Trôi ra khỏi mép này thì vòng lại từ mép đối diện. Vẽ bằng Skia trên UI thread như tuyết / lá
function CoffeeBeans() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  // Mỗi hạt 9 số: x, y ban đầu, hướng trôi (rad), tốc độ (px/giây), kích thước, tốc độ xoay, độ nhấp nhô, độ đậm, màu
  const beans = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(14, width, height); i++) {
      const depth = rnd(i, 3);
      out.push(
        rnd(i, 1), rnd(i, 2), rnd(i, 4) * Math.PI * 2, 5 + depth * 9, 8 + depth * 7,
        (rnd(i, 5) - 0.5) * 30, 4 + rnd(i, 6) * 8, 0.35 + depth * 0.3, i % BEAN_COLORS.length
      );
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const raw = Skia.Path.MakeFromSVGString(BEAN_SVG);
      if (raw) {
        const bean = Skia.PathBuilder.MakeFromPath(raw).setFillType(1).build(); // even-odd: rãnh giữa thành khe rỗng
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        const M = 30; // lề ngoài màn hình để hạt trôi ra / vào mượt
        const W = width + M * 2;
        const H = height + M * 2;
        for (let i = 0, k = 0; i < beans.length; i += 9, k++) {
          const dist = beans[i + 3] * t;
          const bob = Math.sin(t * 0.6 + k * 1.3) * beans[i + 6];
          let x = (beans[i] * W + Math.cos(beans[i + 2]) * dist) % W;
          let y = (beans[i + 1] * H + Math.sin(beans[i + 2]) * dist + bob) % H;
          if (x < 0) x += W;
          if (y < 0) y += H;
          paint.setColor(Skia.Color(BEAN_COLORS[beans[i + 8]]));
          paint.setAlphaf(beans[i + 7]);
          canvas.save();
          canvas.translate(x - M, y - M);
          canvas.rotate(k * 47 + t * beans[i + 5], 0, 0);
          canvas.scale(beans[i + 4], beans[i + 4]);
          canvas.drawPath(bean, paint);
          canvas.restore();
        }
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// Bộ Sakura: cánh hoa anh đào (và thỉnh thoảng cả bông hoa nhỏ) rơi chéo theo gió, đưa qua lại và lật như lá
const PETAL_COLORS = ['#F7A8C0', '#F9C2D3', '#FBD7E2', '#F48FB1'];
function SakuraPetals() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  // Mỗi cánh 10 số: x, y ban đầu, tốc độ rơi, kích thước, độ đưa, tần số đưa, độ đậm, tốc độ lật, màu, là bông hoa (1) hay cánh (0)
  const petals = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(18, width, height); i++) {
      const depth = rnd(i, 3);
      out.push(
        rnd(i, 1), rnd(i, 2), 26 + depth * 30, 7 + depth * 7, 14 + rnd(i, 4) * 26, 0.1 + rnd(i, 5) * 0.16,
        0.6 + depth * 0.35, 0.3 + rnd(i, 6) * 0.5, i % PETAL_COLORS.length, i % 6 === 0 ? 1 : 0
      );
    }
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const petal = Skia.Path.MakeFromSVGString(LOOSE_PETAL_PATH);
      const flowerPetal = Skia.Path.MakeFromSVGString(PETAL_PATH);
      if (petal && flowerPetal) {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        const center = Skia.Paint();
        center.setAntiAlias(true);
        center.setColor(Skia.Color('#E2799A'));
        const M = 40;
        const H = height + M * 2;
        const W = width + M * 2;
        for (let i = 0, k = 0; i < petals.length; i += 10, k++) {
          const sway = Math.sin(t * petals[i + 5] * 6.28 + k);
          const fall = petals[i + 2] * t;
          // gió thổi chéo nhẹ từ phải sang trái (cánh rơi từ cây bên phải)
          let x = (petals[i] * W - fall * 0.45 + sway * petals[i + 4]) % W;
          if (x < 0) x += W;
          const y = ((petals[i + 1] * H + fall) % H) - M;
          const flip = Math.cos(t * petals[i + 7] * 6.28 + k * 1.7);
          const size = petals[i + 3];
          paint.setColor(Skia.Color(PETAL_COLORS[petals[i + 8]]));
          paint.setAlphaf(petals[i + 6]);
          canvas.save();
          canvas.translate(x - M, y);
          canvas.rotate(k * 53 + sway * 40 + t * 20, 0, 0);
          if (petals[i + 9] > 0) {
            // bông hoa nhỏ 5 cánh xoay tròn khi rơi
            canvas.scale(size * 1.1, size * 1.1 * Math.max(0.35, Math.abs(flip)));
            for (let p = 0; p < 5; p++) {
              canvas.save();
              canvas.rotate(p * 72, 0, 0);
              canvas.scale(0.62, 1);
              canvas.drawPath(flowerPetal, paint);
              canvas.restore();
            }
            canvas.drawCircle(0, 0, 0.17, center);
          } else {
            canvas.scale(size, size * Math.max(0.2, Math.abs(flip)));
            canvas.drawPath(petal, paint);
          }
          canvas.restore();
        }
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// Bộ Mưa sao băng: vài ngôi sao lấp lánh, và cứ khoảng 8 giây lại có một đợt 5-6 sao băng vạch chéo xuống bên trái
// (thêm một ngôi lẻ ở giữa hai đợt). Trời sao + dải ngân hà là cảnh đứng yên (ThemeScene)
const SHOWER_EVERY = 8;
function MeteorShower() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  // Sao lấp lánh: x, y, bán kính, tốc độ nhấp nháy, pha
  const twinkles = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(26, width, height); i++) out.push(rnd(i, 31), rnd(i, 32), 0.8 + rnd(i, 33) * 1.1, 0.4 + rnd(i, 34) * 1.2, rnd(i, 35) * 6.28);
    return out;
  }, [width, height]);

  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setColor(Skia.Color('#FFFFFF'));
      for (let i = 0; i < twinkles.length; i += 5) {
        const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * twinkles[i + 3] * 3 + twinkles[i + 4]));
        paint.setAlphaf(a);
        const x = twinkles[i] * width;
        const y = twinkles[i + 1] * height;
        const r = twinkles[i + 2];
        canvas.drawCircle(x, y, r, paint);
        // tia sáng chữ thập mờ cho sao to
        if (r > 1.4) {
          paint.setAlphaf(a * 0.35);
          canvas.drawRect(Skia.XYWHRect(x - r * 3.2, y - 0.35, r * 6.4, 0.7), paint);
          canvas.drawRect(Skia.XYWHRect(x - 0.35, y - r * 3.2, 0.7, r * 6.4), paint);
        }
      }

      // Sao băng: hướng bay xuống dưới sang trái ~38°
      const dx = -Math.cos(0.66);
      const dy = Math.sin(0.66);
      const diag = Math.hypot(width, height);
      const cycle = Math.floor(t / SHOWER_EVERY);
      const local = t - cycle * SHOWER_EVERY;
      const trail = Skia.Paint();
      trail.setAntiAlias(true);
      trail.setStyle(1);
      trail.setStrokeCap(1);
      const head = Skia.Paint();
      head.setAntiAlias(true);
      head.setColor(Skia.Color('#FFFFFF'));
      // 6 ngôi trong đợt + 1 ngôi lẻ giữa hai đợt
      for (let m = 0; m < 7; m++) {
        const lone = m === 6;
        const seed = cycle * 7 + m;
        const start = lone ? SHOWER_EVERY * 0.55 + rnd(seed, 41) * 0.8 : rnd(seed, 42) * 1.8 + (m === 5 && rnd(seed, 43) < 0.4 ? 99 : 0); // đợt có 5 hoặc 6 ngôi
        const dur = 0.9 + rnd(seed, 44) * 0.6;
        const p = (local - start) / dur;
        if (p < 0 || p > 1) continue;
        const sx = width * (0.25 + rnd(seed, 45) * 0.95);
        const sy = height * (-0.05 + rnd(seed, 46) * 0.45);
        const travel = diag * (0.28 + rnd(seed, 47) * 0.2);
        const ease = 1 - (1 - p) * (1 - p);
        const hx = sx + dx * travel * ease;
        const hy = sy + dy * travel * ease;
        const len = (80 + rnd(seed, 48) * 90) * Math.min(1, p * 4); // đuôi dài dần lúc mới xuất hiện
        const fade = p < 0.12 ? p / 0.12 : p > 0.75 ? (1 - p) / 0.25 : 1;
        const tx = hx - dx * len;
        const ty = hy - dy * len;
        trail.setShader(
          Skia.Shader.MakeLinearGradient(
            { x: hx, y: hy },
            { x: tx, y: ty },
            [Skia.Color(`rgba(255,255,255,${(0.95 * fade).toFixed(3)})`), Skia.Color('rgba(180,200,255,0)')],
            null,
            0
          )
        );
        trail.setStrokeWidth(1.6);
        canvas.drawLine(hx, hy, tx, ty, trail);
        head.setAlphaf(0.25 * fade);
        canvas.drawCircle(hx, hy, 4.5, head);
        head.setAlphaf(fade);
        canvas.drawCircle(hx, hy, 1.6, head);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// ---------- Cực quang: ba dải sáng (xanh lá, ngọc, tím) uốn lượn chậm, sáng ở mép dưới, mờ dần lên trên ----------
const AURORA_BANDS: [string, number, number, number, number, number, number][] = [
  // màu "r,g,b", chân dải (phần màn hình), biên độ uốn, độ cao dải, tốc độ, pha, độ đậm
  ['61,245,160', 0.27, 0.05, 0.2, 0.05, 0, 0.55],
  ['43,217,232', 0.33, 0.06, 0.16, 0.038, 2.1, 0.42],
  ['155,108,255', 0.21, 0.045, 0.15, 0.03, 4.2, 0.38],
];
function AuroraRibbons() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const N = 28;
      for (let b = 0; b < AURORA_BANDS.length; b++) {
        const [rgb, base, amp, hgt, speed, phase, alpha] = AURORA_BANDS[b];
        const pb = Skia.PathBuilder.Make();
        const tops: number[] = [];
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const x = u * width;
          const y = height * (base + amp * Math.sin(u * 5.6 + t * speed * 6.28 + phase) + amp * 0.5 * Math.sin(u * 14.4 - t * speed * 4 + phase * 1.7));
          const hh = height * hgt * (0.65 + 0.35 * Math.sin(u * 9 + t * 0.4 + phase));
          if (i === 0) pb.moveTo(x, y);
          else pb.lineTo(x, y);
          tops.push(x, y - hh);
        }
        for (let i = tops.length - 2; i >= 0; i -= 2) pb.lineTo(tops[i], tops[i + 1]);
        pb.close();
        const path = pb.detach();
        const breath = 0.75 + 0.25 * Math.sin(t * 0.35 + phase);
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setShader(
          Skia.Shader.MakeLinearGradient(
            { x: 0, y: height * (base - hgt - amp) },
            { x: 0, y: height * (base + amp) },
            [Skia.Color(`rgba(${rgb},0)`), Skia.Color(`rgba(${rgb},${(alpha * 0.55 * breath).toFixed(3)})`), Skia.Color(`rgba(${rgb},${(alpha * breath).toFixed(3)})`)],
            [0, 0.7, 1],
            0
          )
        );
        paint.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 16, true));
        canvas.drawPath(path, paint);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// ---------- Mưa trên kính: mưa rơi phía sau, cứ vài giây một giọt nước chảy dài xuống kính, thỉnh thoảng sấm chớp ----------
const DRIP_EVERY = 2.6; // giây
const DRIP_DUR = 4.2;
const FLASH_EVERY = 21;
function RainOnGlass() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  // Vệt mưa: x, tốc độ (px/s), độ dài, độ đậm, pha
  const streaks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < scaled(70, width, height); i++) out.push(rnd(i, 51), 700 + rnd(i, 52) * 500, 14 + rnd(i, 53) * 26, 0.08 + rnd(i, 54) * 0.18, rnd(i, 55));
    return out;
  }, [width, height]);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      // Mưa rơi (phía sau kính: mảnh, mờ, hơi xiên)
      const rain = Skia.Paint();
      rain.setAntiAlias(true);
      rain.setStyle(1);
      rain.setStrokeWidth(1);
      rain.setStrokeCap(1);
      rain.setColor(Skia.Color('#D2E1F0'));
      for (let i = 0; i < streaks.length; i += 5) {
        const len = streaks[i + 2];
        const y = ((streaks[i + 4] * (height + len) + streaks[i + 1] * t) % (height + len)) - len;
        const x = streaks[i] * (width + 60) - 30 + y * 0.12;
        rain.setAlphaf(streaks[i + 3]);
        canvas.drawLine(x, y, x + len * 0.12, y + len, rain);
      }

      // Giọt nước chảy trên kính: nhanh dần, hơi lắc, để lại vệt ướt phía sau
      const trail = Skia.Paint();
      trail.setAntiAlias(true);
      trail.setStyle(1);
      trail.setStrokeCap(1);
      const head = Skia.Paint();
      head.setAntiAlias(true);
      head.setColor(Skia.Color('#FFFFFF'));
      const cur = Math.floor(t / DRIP_EVERY);
      for (let k = cur - 2; k <= cur; k++) {
        if (k < 0) continue;
        const st = k * DRIP_EVERY + rnd(k, 61) * 0.8;
        const p = (t - st) / DRIP_DUR;
        if (p < 0 || p > 1) continue;
        const x0 = width * (0.05 + rnd(k, 62) * 0.9);
        const y0 = height * (0.05 + rnd(k, 63) * 0.45);
        const dist = height * (0.3 + rnd(k, 64) * 0.4);
        const r = 2.6 + rnd(k, 65) * 2;
        const y = y0 + dist * Math.pow(p, 1.7);
        const x = x0 + Math.sin(p * 11 + k) * 2.2;
        const fade = p > 0.82 ? (1 - p) / 0.18 : p < 0.06 ? p / 0.06 : 1;
        trail.setStrokeWidth(r * 0.9);
        trail.setShader(
          Skia.Shader.MakeLinearGradient({ x, y: y0 }, { x, y }, [Skia.Color('rgba(255,255,255,0)'), Skia.Color(`rgba(255,255,255,${(0.16 * fade).toFixed(3)})`)], null, 0)
        );
        canvas.drawLine(x0, y0, x, y, trail);
        head.setAlphaf(0.2 * fade);
        canvas.drawOval(Skia.XYWHRect(x - r, y - r * 1.15, r * 2, r * 2.3), head);
        head.setAlphaf(0.55 * fade);
        canvas.drawCircle(x - r * 0.35, y - r * 0.45, Math.max(0.6, r * 0.28), head);
      }

      // Sấm chớp: ~21 giây một lần, hai lần loé nhanh rồi tắt dần, sáng từ trên trời xuống
      const c = Math.floor(t / FLASH_EVERY);
      const local = t - c * FLASH_EVERY - (5 + rnd(c, 71) * 11);
      if (local >= 0 && local < 0.75) {
        const a =
          local < 0.06 ? (local / 0.06) * 0.5
          : local < 0.14 ? 0.5 - ((local - 0.06) / 0.08) * 0.42
          : local < 0.22 ? 0.08 + ((local - 0.14) / 0.08) * 0.32
          : 0.4 * (1 - (local - 0.22) / 0.53);
        const flash = Skia.Paint();
        flash.setShader(
          Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: height }, [Skia.Color(`rgba(235,240,255,${a.toFixed(3)})`), Skia.Color(`rgba(235,240,255,${(a * 0.25).toFixed(3)})`)], null, 0)
        );
        canvas.drawRect(Skia.XYWHRect(0, 0, width, height), flash);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// ---------- Neon: lưới phối cảnh chạy về phía người xem dưới chân trời, thỉnh thoảng nháy glitch ----------
const GLITCH_EVERY = 6.5;
function NeonGrid() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    try {
      const hy = height * 0.62;
      const cx = width / 2;
      const glow = Skia.Paint();
      glow.setAntiAlias(true);
      glow.setStyle(1);
      glow.setStrokeWidth(3);
      glow.setMaskFilter(Skia.MaskFilter.MakeBlur(0, 4, true));
      const core = Skia.Paint();
      core.setAntiAlias(true);
      core.setStyle(1);
      core.setStrokeWidth(1);
      // Đường dọc: hội tụ về điểm giữa chân trời
      const V = 16;
      for (let i = 0; i <= V; i++) {
        const bx = cx + (i - V / 2) * width * 0.2;
        glow.setColor(Skia.Color('rgba(255,61,203,0.35)'));
        core.setColor(Skia.Color('rgba(255,120,225,0.55)'));
        canvas.drawLine(cx, hy, bx, height, glow);
        canvas.drawLine(cx, hy, bx, height, core);
      }
      // Đường ngang: trôi dần xuống (lại gần), càng gần càng thưa và sáng
      const Hn = 10;
      for (let k = 0; k < Hn; k++) {
        const z = ((k + t * 0.55) % Hn) / Hn;
        const y = hy + (height - hy) * Math.pow(z, 2.2);
        const a = 0.15 + 0.6 * z;
        glow.setColor(Skia.Color(`rgba(0,240,255,${(a * 0.6).toFixed(3)})`));
        core.setColor(Skia.Color(`rgba(120,250,255,${a.toFixed(3)})`));
        canvas.drawLine(0, y, width, y, glow);
        canvas.drawLine(0, y, width, y, core);
      }
      // Glitch: vài vệt màu lệch ngang trong ~0,3 giây, mỗi 6,5 giây
      const c = Math.floor(t / GLITCH_EVERY);
      const local = t - c * GLITCH_EVERY - (2 + rnd(c, 81) * 3);
      if (local >= 0 && local < 0.3) {
        const step = Math.floor(t * 20);
        const bar = Skia.Paint();
        for (let j = 0; j < 5; j++) {
          const y = rnd(step, 90 + j) * height;
          const h = 2 + rnd(step, 100 + j) * 14;
          const dx = (rnd(step, 110 + j) - 0.5) * 40;
          bar.setColor(Skia.Color(j % 2 ? 'rgba(0,240,255,0.28)' : 'rgba(255,61,203,0.28)'));
          canvas.drawRect(Skia.XYWHRect(dx, y, width, h), bar);
        }
        bar.setColor(Skia.Color('rgba(255,255,255,0.08)'));
        canvas.drawRect(Skia.XYWHRect(0, rnd(step, 120) * height, width, 1.5), bar);
      }
    } catch (e) {
      // vẽ lỗi thì khung hình này để trống
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}
