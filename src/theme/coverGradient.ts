// Màu "tách từ ảnh bìa" cho player Đĩa than: ảnh bìa thu nhỏ còn 16×16 điểm bằng Skia, gom điểm ảnh theo dải màu → lấy 4 màu
// nổi bật (cho nền khói — theme/effects/smoke.ts) + 1 màu nhấn sáng (thanh thời gian, nút phát)
// Mỗi ảnh bìa chỉ tính một lần (nhớ lại 40 ảnh gần nhất). Tính mất vài mili giây, chạy lúc rảnh
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { log } from '../data/applog';

type Rgb = [number, number, number];
// rgb: 4 màu (0..1) cho shader nền khói · accent: màu sáng của ảnh bìa cho thanh thời gian / nút phát
export type CoverGradient = { rgb: number[][]; colors: string[]; accent: string };

const cache = new Map<string, CoverGradient>();

function toHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}
function fromHsl(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [f(0), f(8), f(4)];
}
const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Gom theo 12 dải màu (mỗi dải 30°). Màu nhạt / xám gom riêng theo độ sáng.
// Mỗi màu được kéo về độ sáng vừa phải (chữ trắng luôn đọc được) và đậm lên chút cho nền có sức sống
function palette(px: Uint8Array): Rgb[] {
  type Bin = { w: number; h: number; s: number; l: number };
  const bins: Bin[] = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  const grey = { w: 0, l: 0 };
  for (let i = 0; i < px.length; i += 4) {
    const { h, s, l } = toHsl(px[i], px[i + 1], px[i + 2]);
    if (s < 0.14 || l < 0.08 || l > 0.95) {
      grey.w += 1;
      grey.l += l;
      continue;
    }
    const b = bins[Math.floor(h / 30) % 12];
    const w = 0.4 + s;
    b.w += w;
    b.h += h * w; // (dải hẹp 30° nên cộng trung bình thẳng được)
    b.s += s * w;
    b.l += l * w;
  }
  const out: Rgb[] = [];
  const top = bins.filter((b) => b.w > 1.5).sort((a, b) => b.w - a.w).slice(0, 4);
  for (const b of top) {
    const h = b.h / b.w;
    const s = Math.min(0.75, Math.max(0.35, (b.s / b.w) * 1.15));
    const l = Math.min(0.5, Math.max(0.26, b.l / b.w));
    out.push(fromHsl(h, s, l));
  }
  // Ảnh gần như đen trắng / ít màu: thêm các sắc xám hơi lạnh ở vài độ sáng khác nhau cho nền vẫn có chiều sâu
  const base = top.length ? top[0].h / top[0].w : 230;
  const gl = grey.w ? grey.l / grey.w : 0.4;
  const greys: Rgb[] = [fromHsl(base, 0.08, Math.min(0.46, Math.max(0.3, gl))), fromHsl(base, 0.1, 0.2), fromHsl((base + 30) % 360, 0.12, 0.36), fromHsl(base, 0.06, 0.28)];
  for (const g of greys) if (out.length < 4) out.push(g);
  return out;
}

// Màu nhấn: màu đậm (bão hoà) nhất trong bảng màu, kéo sáng lên để nổi trên nền tối. Ảnh đen trắng → trắng ngà
function accentOf(colors: Rgb[]): string {
  let best = toHsl(...colors[0]);
  for (const c of colors) {
    const x = toHsl(...c);
    if (x.s > best.s) best = x;
  }
  const rgb = best.s < 0.2 ? fromHsl(best.h, 0.12, 0.88) : fromHsl(best.h, Math.min(0.85, Math.max(0.5, best.s)), 0.74);
  return css(rgb);
}

export async function coverGradient(url: string): Promise<CoverGradient | null> {
  if (Platform.OS === 'web') return null;
  const hit = cache.get(url);
  if (hit) return hit;
  const t0 = Date.now();
  try {
    const S = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const data = await S.Skia.Data.fromURI(url);
    const img = S.Skia.Image.MakeImageFromEncoded(data);
    if (!img) return null;
    const N = 16;
    const surf = S.Skia.Surface.Make(N, N);
    if (!surf) return null;
    const paint = S.Skia.Paint();
    surf.getCanvas().drawImageRect(img, S.Skia.XYWHRect(0, 0, img.width(), img.height()), S.Skia.XYWHRect(0, 0, N, N), paint);
    surf.flush();
    const px = surf.makeImageSnapshot().readPixels(0, 0, { width: N, height: N, colorType: S.ColorType.RGBA_8888, alphaType: S.AlphaType.Unpremul });
    if (!px) return null;
    const cols = palette(px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255)));
    const g = { rgb: cols.map((c) => c.map((v) => v / 255)), colors: cols.map((c) => css(c)), accent: accentOf(cols) };
    cache.set(url, g);
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    log('ui', `nền gradient ảnh bìa: ${cols.length} màu (${Date.now() - t0}ms)`);
    return g;
  } catch (e) {
    console.warn('[coverGradient]', e);
    return null;
  }
}

// Gradient của ảnh bìa url (null trong lúc đang tính lần đầu; đổi bài thì giữ gradient cũ tới khi có cái mới)
export function useCoverGradient(url: string | undefined | null) {
  const [g, setG] = useState<CoverGradient | null>(() => (url ? cache.get(url) ?? null : null));
  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit) {
      setG(hit);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      coverGradient(url).then((r) => alive && r && setG(r));
    }, 60);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [url]);
  return g;
}
