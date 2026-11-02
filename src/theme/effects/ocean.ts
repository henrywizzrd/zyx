// Hình cho bộ Ocean: cá (kiểu icon) và bong bóng oxy như trong bể cá.
// Cá vẽ trong khung: thân từ x = -0.75 (đuôi) đến x = 1 (miệng), cao khoảng ±0.55, quay mặt sang phải.

export const FISH_BODY = 'M1 0C0.62 -0.58 -0.45 -0.6 -0.75 0C-0.45 0.6 0.62 0.58 1 0Z';
export const FISH_TAIL = 'M-0.68 0L-1.3 -0.5Q-1.12 0 -1.3 0.5Z';
export const FISH_FIN = 'M0.18 -0.44Q-0.05 -0.82 -0.4 -0.42Z M0.05 0.42Q-0.12 0.66 -0.3 0.4Z';

type Canvas = import('@shopify/react-native-skia').SkCanvas;
type Paint = import('@shopify/react-native-skia').SkPaint;
type Path = import('@shopify/react-native-skia').SkPath;
type Color = import('@shopify/react-native-skia').SkColor;

// Vẽ một chú cá. size = nửa chiều dài thân (px), dir = 1 bơi sang phải / -1 sang trái,
// wiggle = góc vẫy đuôi (độ), tilt = góc ngóc lên/chúi xuống (độ)
export function drawFish(
  canvas: Canvas, paint: Paint,
  body: Path, tail: Path, fin: Path,
  x: number, y: number, size: number, dir: number, wiggle: number, tilt: number,
  color: Color, eye: Color, alpha: number
) {
  'worklet';
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(dir * size, size);
  canvas.rotate(tilt, 0, 0);
  paint.setStyle(0);
  paint.setColor(color);
  paint.setAlphaf(alpha);
  canvas.drawPath(fin, paint);
  // Đuôi xoay quanh gốc đuôi
  canvas.save();
  canvas.translate(-0.68, 0);
  canvas.rotate(wiggle, 0, 0);
  canvas.translate(0.68, 0);
  canvas.drawPath(tail, paint);
  canvas.restore();
  canvas.drawPath(body, paint);
  // Mắt: chấm sáng + con ngươi
  paint.setColor(eye);
  paint.setAlphaf(alpha);
  canvas.drawCircle(0.58, -0.12, 0.11, paint);
  paint.setColor(color);
  canvas.drawCircle(0.61, -0.12, 0.05, paint);
  canvas.restore();
}

// Bong bóng oxy: vòng tròn viền mảnh + đốm sáng nhỏ phía trên bên trái
export function drawBubble(canvas: Canvas, paint: Paint, x: number, y: number, r: number, color: Color, shine: Color, alpha: number) {
  'worklet';
  paint.setStyle(1);
  paint.setStrokeWidth(Math.max(1, r * 0.18));
  paint.setColor(color);
  paint.setAlphaf(alpha);
  canvas.drawCircle(x, y, r, paint);
  paint.setStyle(0);
  paint.setColor(color);
  paint.setAlphaf(alpha * 0.12);
  canvas.drawCircle(x, y, r, paint);
  paint.setColor(shine);
  paint.setAlphaf(alpha * 0.9);
  canvas.drawCircle(x - r * 0.35, y - r * 0.35, Math.max(0.8, r * 0.22), paint);
}

// Màu cá: xanh biển, cam (cá hề), xanh ngọc, vàng — đậm vừa phải trên nền xanh nhạt
export const FISH_COLORS = ['#2E78C7', '#F08A3C', '#2AA5A0', '#E9B23A'];
