// Ảnh mặt đĩa than (bóng mềm + mặt đen + các rãnh + mép) vẽ MỘT LẦN bằng Skia rồi lưu thành file PNG trong bộ nhớ đệm của app.
// Lần sau mở app chỉ việc đọc file, không vẽ lại.
// Vì sao không vẽ trực tiếp:
//  - khung Skia trên màn hình thì không được "chụp" vào ảnh lúc mở / thu nhỏ player → đĩa biến mất rồi hiện lại (giật)
//  - vẽ bằng ~40 vòng tròn View (bản 13/11 14:15) thì lúc chụp màn player, iPhone phải vẽ từng vòng to ~1300 điểm
//    → khựng 0,5–2 giây lúc mở / đóng player (log 15:25, Sentry "App Hang")
//  - một ảnh thì chỉ là MỘT lớp: chụp nhanh, xoay / dời rẻ
import { Platform } from 'react-native';
import { log } from '../../data/applog';

const K = 1.2; // độ nét: điểm ảnh trên mỗi điểm màn hình (rãnh mảnh nên không cần nét bằng màn hình)
const VER = 1; // đổi cách vẽ thì tăng số này để vẽ lại
const mem = new Map<number, string>();
const pending = new Map<number, Promise<string | null>>();

export const discPad = 30; // phần bóng mềm ngoài mép đĩa (điểm)

export function discImageCached(R: number): string | null {
  return mem.get(R) ?? null;
}

export function discImage(R: number): Promise<string | null> {
  const hit = mem.get(R);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(R);
  if (p) return p;
  const job = build(R).finally(() => pending.delete(R));
  pending.set(R, job);
  return job;
}

async function build(R: number): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const FS = require('expo-file-system') as typeof import('expo-file-system');
    const file = new FS.File(FS.Paths.cache, `zyx-disc-${R}-v${VER}.png`);
    if (file.exists) {
      mem.set(R, file.uri);
      return file.uri;
    }
    const t0 = Date.now();
    const { Skia, vec, TileMode } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const half = Math.round((R + discPad) * K);
    const N = half * 2;
    const surf = Skia.Surface.Make(N, N);
    if (!surf) return null;
    const c = surf.getCanvas();
    const C = vec(half, half);
    const r = R * K;
    const fill = (shader: ReturnType<typeof Skia.Shader.MakeRadialGradient>, rad: number) => {
      const p = Skia.Paint();
      p.setShader(shader);
      p.setAntiAlias(true);
      c.drawCircle(half, half, rad, p);
    };
    // bóng mềm quanh đĩa
    fill(Skia.Shader.MakeRadialGradient(C, half, [Skia.Color('rgba(0,0,0,0.5)'), Skia.Color('rgba(0,0,0,0.5)'), Skia.Color('rgba(0,0,0,0)')], [0, r / half, 1], TileMode.Clamp), half);
    // mặt đĩa
    fill(Skia.Shader.MakeRadialGradient(C, r, [Skia.Color('#1b1b1d'), Skia.Color('#0d0d0e'), Skia.Color('#050505')], [0, 0.7, 1], TileMode.Clamp), r);
    // rãnh
    const stroke = (rad: number, w: number, col: string) => {
      const p = Skia.Paint();
      p.setStyle(1); // Stroke
      p.setStrokeWidth(w);
      p.setAntiAlias(true);
      p.setColor(Skia.Color(col));
      c.drawCircle(half, half, rad, p);
    };
    for (let rr = 0.84 * r + 4 * K; rr < r - K; rr += 3 * K) stroke(rr, K, 'rgba(255,255,255,0.035)');
    stroke(r * 0.875, r * 0.004, 'rgba(255,255,255,0.05)');
    stroke(r * 0.934, r * 0.003, 'rgba(255,255,255,0.04)');
    stroke(r - 0.5 * K, K, 'rgba(255,255,255,0.06)');
    surf.flush();
    const bytes = surf.makeImageSnapshot().encodeToBytes();
    file.create({ overwrite: true });
    await file.write(bytes);
    mem.set(R, file.uri);
    log('ui', `đĩa than: vẽ ảnh mặt đĩa ${N}px (${Date.now() - t0}ms, chỉ lần đầu)`);
    return file.uri;
  } catch (e) {
    console.warn('[discImage]', e);
    return null;
  }
}
