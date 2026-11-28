import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { BlendMode, Canvas, FilterMode, Fill, ImageSVG, MipmapMode, Picture, Shader, Skia, TileMode, type SkCanvas, type SkImage, type SkRect } from '@shopify/react-native-skia';
import { Easing, makeMutable, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

// Đồng hồ chung cho mọi lớp hiệu ứng: hạt rơi / sao băng tính hoàn toàn theo thời gian t, nên hai lớp cùng một t
// vẽ ra y hệt nhau. Nhờ vậy bản sao nền trong trang đang vuốt quay lại khớp đúng với nền chung phía sau
// (trước đây mỗi lớp có đồng hồ riêng tính từ lúc nó xuất hiện → sao băng lệch nhau)
// Giới hạn khung hình: iPhone màn 120Hz vẽ lại hiệu ứng 120 lần/giây — gấp đôi cần thiết cho hạt rơi.
// sharedClock nhảy tối đa 60 lần/giây; slowClock 30 lần/giây cho hiệu ứng chuyển động chậm (cực quang, lưới neon):
// mỗi lần đồng hồ nhảy mới vẽ lại, nên đỡ được 1/2 đến 3/4 công vẽ mà mắt không thấy khác
const sharedClock = makeMutable(0);
const slowClock = makeMutable(0);
const clockBase = makeMutable(-1);
// Lớp hiệu ứng có đang chạy không (mở Player / app ở nền: dừng vẽ nhưng VẪN giữ lớp, mở lại không phải dựng từ đầu)
const RunningContext = createContext(true);
function useAmbientClock(slow = false) {
  const running = useContext(RunningContext);
  const cb = useFrameCallback((f) => {
    'worklet';
    if (clockBase.value < 0) clockBase.value = f.timestamp;
    const t = f.timestamp - clockBase.value;
    if (t - sharedClock.value >= 15 || t < sharedClock.value) sharedClock.value = t;
    if (t - slowClock.value >= 31 || t < slowClock.value) slowClock.value = t;
  }, running);
  useEffect(() => {
    cb.setActive(running);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  return slow ? slowClock : sharedClock;
}
import { useTheme } from '../ThemeProvider';
import { drawFlake, FLAKE_SVGS } from './snowflakes';
import { drawLeaf, LEAF_COLORS, LEAF_SVGS, makeLeafPaths } from './leaves';
import { BEAN_COLORS, BEAN_SVG } from './beans';
import { drawBubble, drawFish, FISH_BODY, FISH_COLORS, FISH_FIN, FISH_TAIL } from './ocean';
import { useScreenSize } from '../../components/ScreenSize';
import { starryBand, starryShader } from './starry';
import { auroraSkySvg, LOOSE_PETAL_PATH, meteorSkySvg, PETAL_PATH } from './scenes';
import { smokeShader } from './smoke';
import { smokeUniformColors } from '../smokeTones';
import { useCoverTint } from '../coverTint';

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
    // Quay lại app: đợi ~0,8s rồi mới chạy lại hiệu ứng (lúc mở lại app máy đang bận vẽ lại mọi thứ;
    // chạy hiệu ứng cùng lúc làm nhạc ở chế độ âm thanh bị rè / giật)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (s) => {
      if (timer) clearTimeout(timer);
      if (s === 'background') setActive(false);
      else timer = setTimeout(() => setActive(true), 800);
    });
    return () => {
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);
  const running = !paused && active;
  const effect = pickEffect(theme);
  if (!effect) return null;
  // Đóng player: trước đây lớp hiệu ứng được dựng lại từ đầu → luồng JS khựng ~300ms mỗi lần. Giờ chỉ tạm dừng và ẩn đi
  return (
    <RunningContext.Provider value={running}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: running ? 1 : 0 }]}>
        {effect}
      </View>
    </RunningContext.Provider>
  );
}

function pickEffect(theme: ReturnType<typeof useTheme>['theme']): React.ReactElement | null {
  if (theme.style === 'pop') return null; // Pop: no background effects
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
  if (theme.preset === 'meteor' && on.meteor) return <MeteorShower level={theme.effects.meteorLevel ?? 1} />;
  if (theme.preset === 'starry' && on.starry) return <StarryDrift />;
  if (theme.preset === 'aurora' && on.aurora) return <AuroraRibbons />;
  // Khói phủ kín nền nên chỉ chạy khi nền là màu của bộ (người dùng đặt ảnh / video thì để thấy ảnh của họ)
  if (theme.preset === 'smoke' && on.smoke && !onMedia) return <SmokeSky live />;
  return null;
}

// Cảnh nền đứng yên của bộ Mưa sao băng (trời sao) (vẽ một lần, không chạy liên tục nên luôn hiện, kể cả khi tắt hiệu ứng).
// Người dùng đặt ảnh / video làm nền thì không vẽ cảnh (để thấy ảnh của họ)
export function ThemeScene() {
  const { theme } = useTheme();
  if (theme.style === 'pop') return null; // Pop: plain background colour
  // Trời sao: bản đứng yên của cùng shader (sao không lấp lánh, không trôi). Bật hiệu ứng thì bản chạy được vẽ đè lên
  // Bật hiệu ứng: nền chỉ có lớp sao xa, hai lớp vừa / gần do StarryDrift vẽ và cho trôi
  if (theme.preset === 'starry' && theme.background.type === 'preset') return <StarrySky full={!theme.effects.ambient.starry} />;
  // Khói màu: luôn có một khung khói đứng yên làm nền (tắt hiệu ứng, trang đang vuốt quay lại...). Bật hiệu ứng thì lớp khói chạy phủ lên
  if (theme.preset === 'smoke' && theme.background.type === 'preset') return <SmokeSky live={false} />;
  return <SvgScene />;
}

function SvgScene() {
  const { theme } = useTheme();
  const { width, height } = useScreenSize();
  const p = theme.preset;
  const kind = theme.background.type === 'preset' && (p === 'meteor' || p === 'aurora') ? p : null;
  const svg = useMemo(() => {
    if (!kind || width < 1 || height < 1) return null;
    try {
      const make = kind === 'aurora' ? auroraSkySvg : meteorSkySvg;
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

// Bộ Trời sao: nền là một shader (xem starry.ts) vẽ MỘT LẦN rồi đứng yên (nền chàm, tinh vân, lớp sao xa).
// Bản đầu cho cả shader chạy 30 lần/giây: GPU tính lại ~3,8 triệu điểm ảnh mỗi lần → lag nặng (nhất là Home có feed).
// full = false: không vẽ 2 lớp sao vừa / gần (StarryDrift vẽ chúng và cho trôi)
function StarrySky({ full = true }: { full?: boolean }) {
  const { width, height } = useScreenSize();
  const effect = useMemo(() => starryShader(), []);
  if (!effect || width < 1 || height < 1) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={effect} uniforms={{ res: [width, height], time: 0, tw: 0, drift: 0, full: full ? 1 : 0 }} />
        </Fill>
      </Canvas>
    </View>
  );
}

// Ảnh mẫu của một ngôi sao (vẽ một lần): ô trái = sao tròn (lõi sáng + quầng mềm), ô phải = sao sáng có tia nhiễu xạ mảnh
const SPRITE = 64;
const SPRITE_CORE = 1.9; // bán kính lõi sáng (điểm) khi vẽ ở tỉ lệ 1
let starSprites: SkImage | null | undefined;
function getStarSprites(): SkImage | null {
  if (starSprites !== undefined) return starSprites;
  starSprites = null;
  try {
    const surf = Skia.Surface.Make(SPRITE * 2, SPRITE);
    if (!surf) return null;
    const c = surf.getCanvas();
    const h = SPRITE / 2;
    for (let k = 0; k < 2; k++) {
      const cx = SPRITE * k + h;
      const glow = Skia.Paint();
      glow.setAntiAlias(true);
      glow.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: cx, y: h },
          h,
          ['rgba(255,255,255,1)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0)'].map((x) => Skia.Color(x)),
          [0, 0.05, 0.16, 0.45, 1],
          TileMode.Clamp
        )
      );
      c.drawCircle(cx, h, h, glow);
      if (k === 1) {
        const ray = Skia.Paint();
        ray.setAntiAlias(true);
        const stops = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0)'].map((x) => Skia.Color(x));
        const L = h * 0.6; // tia ngắn, mảnh
        ray.setShader(Skia.Shader.MakeLinearGradient({ x: cx - L, y: h }, { x: cx + L, y: h }, stops, null, TileMode.Clamp));
        c.drawRect(Skia.XYWHRect(cx - L, h - 0.5, L * 2, 1), ray);
        ray.setShader(Skia.Shader.MakeLinearGradient({ x: cx, y: h - L }, { x: cx, y: h + L }, stops, null, TileMode.Clamp));
        c.drawRect(Skia.XYWHRect(cx - 0.5, h - L, 1, L * 2), ray);
      }
    }
    surf.flush();
    starSprites = surf.makeImageSnapshot();
  } catch (e) {
    console.warn('[theme] star sprites', e);
  }
  return starSprites;
}

// Hai lớp sao vừa / gần trôi chậm sang trái (lớp gần trôi nhanh hơn → có chiều sâu) và lấp lánh.
// Cả ~200 ngôi vẽ bằng MỘT lệnh drawAtlas (dán ảnh mẫu ở trên, mỗi ngôi một vị trí / cỡ / màu) → rất nhẹ cho GPU.
// Sao dày dần về phía dải ngân hà giống shader. Đồng hồ chậm 30 khung/giây
const STARRY_DRIFT = 3; // tốc độ trôi (giống thanh "Trời trôi" ở bản web)
function StarryDrift() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock(true);
  const sprites = useMemo(() => getStarSprites(), []);
  const data = useMemo(() => {
    const asp = width / Math.max(1, height);
    // mỗi ngôi: x (0..1), y (điểm), cỡ, tốc độ trôi (điểm/giây), tốc độ lấp lánh, pha, ấm, có tia, độ sáng
    const out: number[] = [];
    const srcs = [];
    const speed = STARRY_DRIFT * 0.006 * height;
    const layers: [number, number, number, number][] = [
      // số sao, cỡ ô (phần chiều cao), hệ số cỡ, hệ số tốc độ
      [scaled(110, width, height), 1 / 42, 0.8, 0.6],
      [scaled(30, width, height), 1 / 16, 0.6, 1],
    ];
    let k = 0;
    for (const [n, cell, sizeK, sp] of layers) {
      let made = 0;
      for (let tries = 0; made < n && tries < n * 6; tries++, k++) {
        const x = rnd(k, 81);
        const y = rnd(k, 82);
        if (rnd(k, 83) > (0.35 + 1.1 * starryBand(x, y, asp)) / 1.45) continue;
        made++;
        const b = Math.pow(rnd(k, 84), 5);
        const r = (0.035 + 0.11 * b) * sizeK * cell * height; // bán kính lõi (điểm), giống shader
        const spiky = b > 0.75 ? 1 : 0;
        out.push(x, y * height, r / SPRITE_CORE, speed * sp, 0.6 + 2.2 * rnd(k, 85), 6.283 * rnd(k, 86), rnd(k, 87) > 0.82 ? 1 : 0, spiky, b);
        srcs.push(Skia.XYWHRect(spiky ? SPRITE : 0, 0, SPRITE, SPRITE));
      }
    }
    return { stars: out, srcs };
  }, [width, height]);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (sprites) {
      const { stars, srcs } = data;
      const margin = 48;
      const span = width + margin * 2;
      const xf = [];
      const cols = [];
      for (let i = 0; i < stars.length; i += 9) {
        const sc = stars[i + 2];
        // trôi sang trái, ra khỏi mép trái (ngoài màn hình) thì vòng lại từ mép phải
        let x = (stars[i] * span - t * stars[i + 3]) % span;
        if (x < 0) x += span;
        x -= margin;
        const half = (SPRITE / 2) * sc;
        xf.push(Skia.RSXform(sc, 0, x - half, stars[i + 1] - half));
        const tw = 1 - 0.36 * (0.5 + 0.5 * Math.sin(t * stars[i + 4] + stars[i + 5]));
        const a = Math.min(1, (0.22 + 0.7 * stars[i + 8]) * tw);
        // trắng xanh / vài ngôi ngả vàng (pha 45% trắng như shader)
        cols.push(stars[i + 6] ? Float32Array.of(1, 0.92, 0.85, a) : Float32Array.of(0.85, 0.89, 1, a));
      }
      const paint = Skia.Paint();
      canvas.drawAtlas(sprites, srcs, xf, paint, BlendMode.Modulate, cols);
    }
    return rec.finishRecordingAsPicture();
  });
  if (!sprites) return null;
  return <Layer picture={picture} />;
}


// ---------- Ảnh mẫu hạt (tuyết, lá, hạt cà phê, cánh hoa) ----------
// Trước đây MỖI khung hình (60 lần / giây, trên luồng giao diện) đều đọc lại hình từ chuỗi SVG, tạo lại cọ vẽ rồi vẽ từng hạt
// một. Giờ làm như Trời sao: vẽ sẵn hình mẫu MỘT lần (màu trắng, lá / cánh hoa có thêm các khung "đang lật"), mỗi khung hình
// chỉ tính vị trí + góc của từng hạt rồi dán tất cả bằng MỘT lệnh drawAtlas, nhuộm màu lúc dán (Modulate) → nhìn như cũ,
// GPU / CPU nhẹ hơn nhiều. Vẽ mẫu ở mật độ 2× (đủ nét cho hạt nhỏ đang chuyển động, ảnh mẫu chỉ vài trăm KB)
const SPR_PR = 2;
type Sheet = { img: SkImage; srcs: SkRect[]; half: number };
const sheetCache = new Map<string, Sheet | null>();
function bakeSheet(key: string, n: number, halfPt: number, draw: (c: SkCanvas, i: number) => void): Sheet | null {
  if (sheetCache.has(key)) return sheetCache.get(key) ?? null;
  let out: Sheet | null = null;
  try {
    const cell = Math.ceil(halfPt * 2 * SPR_PR);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const surf = Skia.Surface.Make(cols * cell, rows * cell);
    if (surf) {
      const c = surf.getCanvas();
      const srcs: SkRect[] = [];
      for (let i = 0; i < n; i++) {
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * cell;
        c.save();
        c.translate(x + cell / 2, y + cell / 2);
        c.scale(SPR_PR, SPR_PR);
        draw(c, i);
        c.restore();
        srcs.push(Skia.XYWHRect(x, y, cell, cell));
      }
      surf.flush();
      out = { img: surf.makeImageSnapshot(), srcs, half: cell / 2 };
    }
  } catch (e) {
    console.warn('[theme] sprites', key, e);
  }
  sheetCache.set(key, out);
  return out;
}
const whitePaint = () => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color('#FFFFFF'));
  return p;
};
const rgb01 = (hex: string) => {
  const c = Skia.Color(hex);
  return [c[0], c[1], c[2]];
};
// lọc mượt khi dán ảnh mẫu xoay / thu nhỏ (mặc định là lấy điểm gần nhất → răng cưa)
const SMOOTH = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
// khung lật: chọn khung vẽ sẵn gần nhất với độ lật hiện tại
const FLIPS = 16;

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
  // Mẫu: 4 kiểu bông × 2 cỡ (nhỏ / lớn) để nét luôn mảnh ~1,2 điểm như vẽ thẳng (phóng to một mẫu thì nét dày theo)
  const SIZES = [7, 11.5];
  const sheet = useMemo(
    () =>
      bakeSheet('snow', FLAKE_SVGS.length * 2, 11.5 + 2, (c, i) => {
        const path = Skia.Path.MakeFromSVGString(FLAKE_SVGS[i % FLAKE_SVGS.length]);
        if (!path) return;
        const p = whitePaint();
        p.setStyle(1);
        p.setStrokeCap(1);
        p.setStrokeJoin(1);
        drawFlake(c, p, path, 0, 0, SIZES[i < FLAKE_SVGS.length ? 0 : 1], 0, 1.2);
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rgb = useMemo(() => rgb01(color), [color]);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (sheet) {
      const n4 = FLAKE_SVGS.length;
      const H = height + 30;
      const srcs = [];
      const xf = [];
      const cols = [];
      for (let i = 0, k = 0; i < flakes.length; i += 8, k++) {
        const y = ((flakes[i + 1] * H + flakes[i + 2] * t) % H) - 15;
        const x = flakes[i] * width + Math.sin(t * flakes[i + 5] * 6.28 + i) * flakes[i + 4];
        const r = flakes[i + 3];
        const big = r > 9 ? 1 : 0;
        srcs.push(sheet.srcs[(k % n4) + big * n4]);
        const rad = ((k * 23 + t * flakes[i + 7]) * Math.PI) / 180;
        xf.push(Skia.RSXformFromRadians(r / SIZES[big] / SPR_PR, rad, x, y, sheet.half, sheet.half));
        cols.push(Float32Array.of(rgb[0], rgb[1], rgb[2], flakes[i + 6]));
      }
      canvas.drawAtlas(sheet.img, srcs, xf, Skia.Paint(), BlendMode.Modulate, cols, SMOOTH);
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

function LeafCanvas() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock();
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
  // Mẫu: 4 kiểu lá × 16 khung lật (−1 … 1), vẽ ở cỡ lớn nhất (15) rồi thu nhỏ khi dán
  const R = 15;
  const sheet = useMemo(
    () =>
      bakeSheet('leaf', LEAF_SVGS.length * FLIPS, R * 1.35 + 2, (c, i) => {
        const shapes = makeLeafPaths(Skia, LEAF_SVGS);
        const shape = shapes[Math.floor(i / FLIPS)];
        if (!shape) return;
        const flip = -1 + (2 * (i % FLIPS)) / (FLIPS - 1);
        drawLeaf(c, whitePaint(), shape, 0, 0, R, 0, flip);
      }),
    []
  );
  const tint = useMemo(() => LEAF_COLORS.map(rgb01), []);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (sheet) {
      const nShapes = LEAF_SVGS.length;
      const H = height + 60;
      const srcs = [];
      const xf = [];
      const cols = [];
      for (let i = 0, k = 0; i < leaves.length; i += 9, k++) {
        const sway = Math.sin(t * leaves[i + 5] * 6.28 + k);
        const y = ((leaves[i + 1] * H + leaves[i + 2] * t) % H) - 30;
        const x = leaves[i] * width + sway * leaves[i + 4];
        // Lá nghiêng theo hướng đang đưa, và lật (bóp ngang) theo nhịp riêng
        const rot = 25 + sway * 35 + k * 40;
        const flip = Math.cos(t * leaves[i + 7] * 6.28 + k * 1.7);
        const f = Math.round(((flip + 1) / 2) * (FLIPS - 1));
        srcs.push(sheet.srcs[(k % nShapes) * FLIPS + f]);
        xf.push(Skia.RSXformFromRadians(leaves[i + 3] / R / SPR_PR, (rot * Math.PI) / 180, x, y, sheet.half, sheet.half));
        const c = tint[leaves[i + 8]];
        cols.push(Float32Array.of(c[0], c[1], c[2], leaves[i + 6]));
      }
      canvas.drawAtlas(sheet.img, srcs, xf, Skia.Paint(), BlendMode.Modulate, cols, SMOOTH);
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
  // Hình cá dựng MỘT lần (trước đây đọc lại từ chuỗi SVG ở mỗi khung hình)
  const fishPaths = useMemo(
    () => ({ body: Skia.Path.MakeFromSVGString(FISH_BODY), tail: Skia.Path.MakeFromSVGString(FISH_TAIL), fin: Skia.Path.MakeFromSVGString(FISH_FIN) }),
    []
  );
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
      const { body, tail, fin } = fishPaths;
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
  // Mẫu: một hạt (cỡ 15), rãnh chữ S khoét rỗng
  const R = 15;
  const sheet = useMemo(
    () =>
      bakeSheet('bean', 1, R * 1.05 + 2, (c) => {
        const raw = Skia.Path.MakeFromSVGString(BEAN_SVG);
        if (!raw) return;
        const bean = Skia.PathBuilder.MakeFromPath(raw).setFillType(1).build(); // even-odd: rãnh giữa thành khe rỗng
        c.save();
        c.scale(R, R);
        c.drawPath(bean, whitePaint());
        c.restore();
      }),
    []
  );
  const tint = useMemo(() => BEAN_COLORS.map(rgb01), []);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (sheet) {
      const M = 30; // lề ngoài màn hình để hạt trôi ra / vào mượt
      const W = width + M * 2;
      const H = height + M * 2;
      const srcs = [];
      const xf = [];
      const cols = [];
      for (let i = 0, k = 0; i < beans.length; i += 9, k++) {
        const dist = beans[i + 3] * t;
        const bob = Math.sin(t * 0.6 + k * 1.3) * beans[i + 6];
        let x = (beans[i] * W + Math.cos(beans[i + 2]) * dist) % W;
        let y = (beans[i + 1] * H + Math.sin(beans[i + 2]) * dist + bob) % H;
        if (x < 0) x += W;
        if (y < 0) y += H;
        srcs.push(sheet.srcs[0]);
        xf.push(Skia.RSXformFromRadians(beans[i + 4] / R / SPR_PR, ((k * 47 + t * beans[i + 5]) * Math.PI) / 180, x - M, y - M, sheet.half, sheet.half));
        const c = tint[beans[i + 8]];
        cols.push(Float32Array.of(c[0], c[1], c[2], beans[i + 7]));
      }
      canvas.drawAtlas(sheet.img, srcs, xf, Skia.Paint(), BlendMode.Modulate, cols, SMOOTH);
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
  // Mẫu: [cánh rời × 16 khung lật] + [bông hoa × 16 khung lật], vẽ trắng ở cỡ 15.4 (cỡ lớn nhất của bông) rồi thu nhỏ khi dán.
  // Nhuỵ hồng của bông hoa: nhuộm trắng thì mất màu → vẽ nhuỵ đậm hơn (độ trong thấp) để nhuộm hồng vẫn thấy tâm sẫm hơn
  const R = 15.4;
  const sheet = useMemo(
    () =>
      bakeSheet('sakura', FLIPS * 2, R * 1.15 + 2, (c, i) => {
        const flower = i >= FLIPS;
        const q = (i % FLIPS) / (FLIPS - 1);
        const p = whitePaint();
        if (flower) {
          const fp = Skia.Path.MakeFromSVGString(PETAL_PATH);
          if (!fp) return;
          c.save();
          c.scale(R, R * (0.35 + 0.65 * q));
          for (let k = 0; k < 5; k++) {
            c.save();
            c.rotate(k * 72, 0, 0);
            c.scale(0.62, 1);
            c.drawPath(fp, p);
            c.restore();
          }
          const ctr = Skia.Paint();
          ctr.setAntiAlias(true);
          ctr.setColor(Skia.Color('rgba(150,150,150,1)'));
          c.drawCircle(0, 0, 0.17, ctr);
          c.restore();
        } else {
          const lp = Skia.Path.MakeFromSVGString(LOOSE_PETAL_PATH);
          if (!lp) return;
          c.save();
          c.scale(R / 1.1, (R / 1.1) * (0.2 + 0.8 * q));
          c.drawPath(lp, p);
          c.restore();
        }
      }),
    []
  );
  const tint = useMemo(() => PETAL_COLORS.map(rgb01), []);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    if (sheet) {
      const M = 40;
      const H = height + M * 2;
      const W = width + M * 2;
      const srcs = [];
      const xf = [];
      const cols = [];
      for (let i = 0, k = 0; i < petals.length; i += 10, k++) {
        const sway = Math.sin(t * petals[i + 5] * 6.28 + k);
        const fall = petals[i + 2] * t;
        // gió thổi chéo nhẹ từ phải sang trái (cánh rơi từ cây bên phải)
        let x = (petals[i] * W - fall * 0.45 + sway * petals[i + 4]) % W;
        if (x < 0) x += W;
        const y = ((petals[i + 1] * H + fall) % H) - M;
        const flip = Math.abs(Math.cos(t * petals[i + 7] * 6.28 + k * 1.7));
        const flower = petals[i + 9] > 0;
        // khung lật: cánh rời bóp tới 20%, bông hoa tới 35% (như bản vẽ thẳng)
        const q = flower ? (Math.max(0.35, flip) - 0.35) / 0.65 : (Math.max(0.2, flip) - 0.2) / 0.8;
        srcs.push(sheet.srcs[(flower ? FLIPS : 0) + Math.round(q * (FLIPS - 1))]);
        const size = flower ? petals[i + 3] * 1.1 : petals[i + 3] * 1.1;
        xf.push(Skia.RSXformFromRadians(size / R / SPR_PR, ((k * 53 + sway * 40 + t * 20) * Math.PI) / 180, x - M, y, sheet.half, sheet.half));
        const c = tint[petals[i + 8]];
        cols.push(Float32Array.of(c[0], c[1], c[2], petals[i + 6]));
      }
      canvas.drawAtlas(sheet.img, srcs, xf, Skia.Paint(), BlendMode.Modulate, cols, SMOOTH);
    }
    return rec.finishRecordingAsPicture();
  });
  return <Layer picture={picture} />;
}

// Bộ Mưa sao băng: vài ngôi sao lấp lánh, và cứ khoảng 8 giây lại có một đợt 5-6 sao băng vạch chéo xuống bên trái
// (thêm một ngôi lẻ ở giữa hai đợt). Trời sao + dải ngân hà là cảnh đứng yên (ThemeScene)
const SHOWER_EVERY = 8;
// Mật độ sao băng (Ít / Vừa / Nhiều / Bão): mấy giây một đợt, mỗi đợt mấy ngôi
const SHOWER_LEVELS: [number, number][] = [
  [14, 3],
  [SHOWER_EVERY, 6],
  [5, 9],
  [3.2, 14],
];
function MeteorShower({ level = 1 }: { level?: number }) {
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
      const [every, count] = SHOWER_LEVELS[Math.max(0, Math.min(3, level))];
      const cycle = Math.floor(t / every);
      const local = t - cycle * every;
      const trail = Skia.Paint();
      trail.setAntiAlias(true);
      trail.setStyle(1);
      trail.setStrokeCap(1);
      const head = Skia.Paint();
      head.setAntiAlias(true);
      head.setColor(Skia.Color('#FFFFFF'));
      // count ngôi trong đợt (đôi khi thiếu 1) + 1 ngôi lẻ giữa hai đợt; đợt đông thì các ngôi rải ra lâu hơn
      const spread = 1.8 + Math.max(0, count - 6) * 0.15;
      for (let m = 0; m <= count; m++) {
        const lone = m === count;
        const seed = cycle * 31 + m;
        const start = lone ? every * 0.55 + rnd(seed, 41) * 0.8 : rnd(seed, 42) * spread + (m === count - 1 && rnd(seed, 43) < 0.4 ? 99 : 0);
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
// Hiệu năng: dải cực quang vốn mềm (làm nhoè 16 điểm) → vẽ trên khung bằng 1/3 màn hình rồi phóng to 3 lần (như khói).
// Độ nhoè đi theo tỉ lệ khung (MakeBlur … true) nên nhìn như cũ, mà GPU chỉ phải làm nhoè ~1/9 số điểm ảnh mỗi khung
const AURORA_DIV = 3;
function AuroraRibbons() {
  const { width, height } = useScreenSize();
  const clock = useAmbientClock(true);
  const cw = Math.ceil(width / AURORA_DIV);
  const ch = Math.ceil(height / AURORA_DIV);
  const picture = useDerivedValue(() => {
    const t = clock.value / 1000;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, cw, ch));
    canvas.scale(1 / AURORA_DIV, 1 / AURORA_DIV);
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
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Canvas
        style={{
          position: 'absolute',
          width: cw,
          height: ch,
          left: (width - cw) / 2,
          top: (height - ch) / 2,
          transform: [{ scale: AURORA_DIV }],
        }}
      >
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

// ---------- Mưa trên kính: mưa rơi phía sau, cứ vài giây một giọt nước chảy dài xuống kính, thỉnh thoảng sấm chớp ----------
const SMOKE_DIV = 5;
const smokeTime = makeMutable(3);
const smokeAcc = makeMutable(0);
function SmokeSky({ live }: { live: boolean }) {
  const { theme } = useTheme();
  const { width, height } = useScreenSize();
  const running = useContext(RunningContext) && live;
  const effect = useMemo(() => smokeShader(), []);
  const cw = Math.ceil(width / SMOKE_DIV);
  const ch = Math.ceil(height / SMOKE_DIV);
  const speed = useSharedValue(theme.effects.smokeSpeed ?? 1);
  useEffect(() => {
    speed.value = theme.effects.smokeSpeed ?? 1;
  }, [theme.effects.smokeSpeed]); // eslint-disable-line react-hooks/exhaustive-deps
  const cb = useFrameCallback((f) => {
    'worklet';
    // tốc độ nhân vào bước thời gian (không nhân vào tổng) nên kéo thanh tốc độ khói không bị giật cục
    smokeAcc.value += Math.min(f.timeSincePreviousFrame ?? 0, 100);
    if (smokeAcc.value >= 33) {
      smokeTime.value += (smokeAcc.value / 1000) * speed.value;
      smokeAcc.value = 0;
    }
  }, false);
  useEffect(() => {
    cb.setActive(running);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lớp đứng yên giữ nguyên khung khói lúc nó xuất hiện (không đọc đồng hồ chung → không vẽ lại mỗi khung hình)
  const [still] = useState(() => smokeTime.value);
  const tone = theme.effects.smokeTone ?? 'coffee';
  const cover = useCoverTint();
  const coverKey = tone === 'cover' && cover ? `${cover.bg}|${cover.accent}` : '';
  const target = useMemo(
    () => smokeUniformColors(tone, tone === 'cover' && cover ? { bg: cover.bg, accent: cover.accent } : null),
    [tone, coverKey] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const from = useSharedValue(target);
  const to = useSharedValue(target);
  const k = useSharedValue(1);
  const shown = React.useRef(target);
  useEffect(() => {
    if (shown.current === target) return;
    const kk = k.value; // đang chuyển dở (đổi dải liên tiếp): đi tiếp từ màu đang hiện, không nhảy
    from.value = from.value.map((v, i) => v + (to.value[i] - v) * kk);
    to.value = target;
    shown.current = target;
    k.value = 0;
    k.value = withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.cubic) });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const uniforms = useDerivedValue(() => {
    const a = from.value;
    const b = to.value;
    const m = (i: number) => a[i] + (b[i] - a[i]) * k.value;
    return {
      res: [cw, ch],
      time: live ? smokeTime.value : still,
      c0: [m(0), m(1), m(2)],
      c1: [m(3), m(4), m(5)],
      c2: [m(6), m(7), m(8)],
      c3: [m(9), m(10), m(11)],
    };
  });
  if (!effect || width < 1 || height < 1) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]}>
      <Canvas
        style={{
          position: 'absolute',
          width: cw,
          height: ch,
          left: (width - cw) / 2,
          top: (height - ch) / 2,
          transform: [{ scale: SMOKE_DIV * 1.02 }],
        }}
      >
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
      {/* tối nhẹ để chữ trắng luôn đọc được */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.16)' }]} />
    </View>
  );
}
