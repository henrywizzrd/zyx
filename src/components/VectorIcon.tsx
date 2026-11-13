import React, { useMemo } from 'react';
import { Image, Platform, View } from 'react-native';

// Biểu tượng vẽ bằng Skia nhưng hiện ra như một ẢNH thường (vẽ một lần ra ảnh PNG, nhớ lại để dùng tiếp).
// Lý do: khung vẽ Skia (<Canvas>) là lớp đồ hoạ riêng của GPU — lúc màn player được "chụp thành ảnh" để phóng to / thu nhỏ
// cho mượt (shouldRasterizeIOS), các khung Skia KHÔNG được chụp vào → nút phát, tua, lặp, lời bài hát biến mất
// suốt lúc mở player. Ảnh thường thì được chụp bình thường, nhìn y hệt bản Skia.
const skia = Platform.OS === 'web' ? null : (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia'));

// clear: vẽ bằng "tẩy" (đục lỗ trong suốt) — ví dụ nốt nhạc khoét trong hình đặc
export type VectorOp =
  | { d: string; fill?: boolean; stroke?: number; round?: boolean; clear?: boolean } // round: nối / đầu nét bo tròn
  | { circle: [number, number, number]; stroke?: number; clear?: boolean }; // stroke: vòng tròn rỗng thay vì đặc

const cache = new Map<string, string>();

// Vẽ biểu tượng bằng màu TRẮNG ĐẶC một lần cho mỗi (hình, cỡ); màu thật được nhuộm lúc hiện (Image tintColor) và độ trong
// đặt bằng opacity. Trước đây mỗi màu vẽ + nén PNG riêng trên luồng JS: đổi theme (màu nhấn đổi) là mọi biểu tượng vẽ lại cùng
// lúc → luồng JS đứng lâu. Vẽ màu đặc cũng giữ được nét liền mạch ở chỗ các nét chồng nhau
function render(ops: VectorOp[], box: number, px: number): string | null {
  if (!skia) return null;
  const key = `${px}|${box}|${JSON.stringify(ops)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { Skia, PaintStyle, StrokeJoin, StrokeCap, BlendMode } = skia;
    const surface = Skia.Surface.Make(px, px);
    if (!surface) return null;
    const c = surface.getCanvas();
    c.scale(px / box, px / box);
    const col = Skia.Color('#FFFFFF');
    for (const op of ops) {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setColor(col);
      if (op.clear) paint.setBlendMode(BlendMode.Clear);
      if ('circle' in op) {
        if (op.stroke) {
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(op.stroke);
        }
        c.drawCircle(op.circle[0], op.circle[1], op.circle[2], paint);
        continue;
      }
      const path = Skia.Path.MakeFromSVGString(op.d);
      if (!path) continue;
      if (op.fill) c.drawPath(path, paint);
      if (op.stroke) {
        const s = Skia.Paint();
        s.setAntiAlias(true);
        s.setColor(col);
        if (op.clear) s.setBlendMode(BlendMode.Clear);
        s.setStyle(PaintStyle.Stroke);
        s.setStrokeWidth(op.stroke);
        if (op.round !== false) {
          s.setStrokeJoin(StrokeJoin.Round);
          s.setStrokeCap(StrokeCap.Round);
        }
        c.drawPath(path, s);
      }
    }
    surface.flush();
    const uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
    cache.set(key, uri);
    return uri;
  } catch (e) {
    console.warn('[icon]', e);
    return null;
  }
}

// ops tính theo hệ toạ độ box × box (mặc định = size), hiện ra đúng size × size điểm
export function VectorIcon({ ops, size, color, box = size, fallback }: { ops: VectorOp[]; size: number; color: string; box?: number; fallback?: React.ReactNode }) {
  const scale = Platform.OS === 'web' ? 1 : Math.min(3, Math.max(2, Math.ceil((require('react-native').PixelRatio as typeof import('react-native').PixelRatio).get())));
  const uri = useMemo(() => render(ops, box, Math.round(size * scale)), [ops, box, size, scale]);
  // màu → (màu đặc, độ trong)
  const tint = useMemo(() => {
    if (!skia) return { c: color, a: 1 };
    const f = skia.Skia.Color(color);
    const to = (v: number) => Math.round(v * 255);
    return { c: `rgb(${to(f[0])},${to(f[1])},${to(f[2])})`, a: f[3] };
  }, [color]);
  if (!uri) return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>{fallback}</View>;
  return <Image source={{ uri }} style={{ width: size, height: size, tintColor: tint.c, opacity: tint.a }} fadeDuration={0} />;
}
