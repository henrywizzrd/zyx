import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { Palette } from './presets';
import { log } from '../data/applog';

// Bộ màu "Theo ảnh bìa": lấy màu nổi bật của ảnh bìa bài đang phát → nền tối ngả theo màu đó + màu nhấn sáng.
// Ảnh bìa thu nhỏ còn 24×24 điểm bằng Skia rồi đọc màu (nhẹ, vài mili giây)
export type CoverTint = Pick<Palette, 'bg' | 'surface' | 'card' | 'accent' | 'onAccent' | 'textSecondary' | 'glass' | 'glassRgb' | 'border' | 'switchOff'>;

let tint: CoverTint | null = null;
let tintFor = '';
const subs = new Set<() => void>();
export const getCoverTint = () => tint;
export function useCoverTint(): CoverTint | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => tint
  );
}

const hsl = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
};
const hex = (rgb: number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgba = (rgb: number[], a: number) => `rgba(${rgb.join(',')},${a})`;

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

// Màu nổi bật: điểm ảnh vừa đậm vừa không quá tối / quá sáng, gom theo dải màu (hue) rồi lấy dải "nặng" nhất
function pick(px: Uint8Array): { h: number; s: number } {
  const bins = new Array(24).fill(0);
  const sat = new Array(24).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const { h, s, l } = toHsl(px[i], px[i + 1], px[i + 2]);
    if (l < 0.12 || l > 0.92) continue;
    const w = s * s * (1 - Math.abs(l - 0.5));
    const b = Math.floor(h / 15) % 24;
    bins[b] += w;
    sat[b] += s * w;
  }
  let best = -1;
  let bw = 0;
  bins.forEach((w, i) => {
    if (w > bw) {
      bw = w;
      best = i;
    }
  });
  if (best < 0 || bw < 0.4) return { h: 230, s: 0.08 }; // ảnh gần như đen trắng: xám hơi lạnh
  return { h: best * 15 + 7.5, s: Math.min(1, sat[best] / bw) };
}

function build(h: number, s: number): CoverTint {
  const bg = hsl(h, Math.min(0.55, s * 0.7), 0.1);
  const surface = hsl(h, Math.min(0.45, s * 0.55), 0.17);
  const accent = hsl(h, Math.max(0.55, Math.min(0.9, s)), s < 0.15 ? 0.85 : 0.7);
  const glass = hsl(h, Math.min(0.45, s * 0.6), 0.13);
  return {
    bg: hex(bg),
    surface: hex(surface),
    card: rgba(surface, 0.6),
    accent: hex(accent),
    onAccent: hex(hsl(h, 0.5, 0.08)),
    textSecondary: hex(hsl(h, Math.min(0.25, s * 0.4), 0.72)),
    glass: rgba(glass, 0.58),
    glassRgb: glass.join(','),
    border: rgba(hsl(h, 0.5, 0.8), 0.13),
    switchOff: hex(hsl(h, Math.min(0.3, s * 0.5), 0.26)),
  };
}

// Tính màu cho ảnh bìa url (bỏ qua nếu vừa tính cho đúng ảnh này)
export async function updateCoverTint(url: string | undefined | null) {
  if (Platform.OS === 'web' || !url || url === tintFor) return;
  tintFor = url;
  const t0 = Date.now();
  try {
    const S = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const data = await S.Skia.Data.fromURI(url);
    if (tintFor !== url) return;
    const img = S.Skia.Image.MakeImageFromEncoded(data);
    if (!img) return;
    const N = 24;
    const surf = S.Skia.Surface.Make(N, N);
    if (!surf) return;
    surf.getCanvas().drawImageRect(img, S.Skia.XYWHRect(0, 0, img.width(), img.height()), S.Skia.XYWHRect(0, 0, N, N), S.Skia.Paint());
    surf.flush();
    const px = surf.makeImageSnapshot().readPixels(0, 0, { width: N, height: N, colorType: S.ColorType.RGBA_8888, alphaType: S.AlphaType.Unpremul });
    if (!px || tintFor !== url) return;
    const { h, s } = pick(px instanceof Uint8Array ? px : Uint8Array.from(px, (v) => Math.round(v * 255)));
    tint = build(h, s);
    const t1 = Date.now();
    subs.forEach((f) => f());
    log('ui', `màu ảnh bìa: ${tint.accent} (đọc ảnh ${t1 - t0}ms, vẽ lại app ${Date.now() - t1}ms)`);
  } catch (e) {
    console.warn('[coverTint]', e);
  }
}
