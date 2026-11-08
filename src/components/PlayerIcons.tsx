import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { VectorIcon, type VectorOp } from './VectorIcon';

// Biểu tượng hàng điều khiển kiểu mới: tam giác bo tròn góc (phát, lùi, tới), hai thanh bo tròn (dừng).
// Vẽ bằng Skia: tô kín + viền cùng màu với nét nối tròn → góc tam giác tròn mềm như ảnh mẫu.
// Web / không có Skia thì dùng biểu tượng Ionicons thay thế.
const skia = Platform.OS === 'web' ? null : (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia'));

// Tam giác trỏ sang phải trong khung (x, y, w, h)
const tri = (x: number, y: number, w: number, h: number, left = false) =>
  left ? `M${x + w} ${y}L${x} ${y + h / 2}L${x + w} ${y + h}Z` : `M${x} ${y}L${x + w} ${y + h / 2}L${x} ${y + h}Z`;

// Vẽ ra ảnh (VectorIcon) thay vì khung Skia sống: khung Skia không hiện được lúc player đang phóng to / thu nhỏ
function Shape({ d, size, color, round }: { d: string; size: number; color: string; round: number }) {
  const ops = React.useMemo<VectorOp[]>(() => [{ d, fill: true, stroke: round }], [d, round]);
  return <VectorIcon ops={ops} size={size} color={color} />;
}

// ▶ to, không có vòng tròn
export function PlayGlyph({ size, color = '#FFFFFF' }: { size: number; color?: string }) {
  const r = size * 0.14; // độ bo góc
  const p = r / 2 + 1;
  const w = size * 0.78;
  const d = tri(p + (size - w) / 2 + size * 0.04, p, w - p * 2, size - p * 2);
  if (!skia) return <Ionicons name="play" size={size} color={color} />;
  return <Shape d={d} size={size} color={color} round={r} />;
}

// ❚❚ hai thanh bo tròn
export function PauseGlyph({ size, color = '#FFFFFF' }: { size: number; color?: string }) {
  if (!skia) return <Ionicons name="pause" size={size} color={color} />;
  const bw = size * 0.26;
  const gap = size * 0.16;
  const x0 = (size - bw * 2 - gap) / 2;
  const y0 = size * 0.08;
  const h = size * 0.84;
  const rr = bw * 0.38;
  const bar = (x: number) =>
    `M${x + rr} ${y0}H${x + bw - rr}Q${x + bw} ${y0} ${x + bw} ${y0 + rr}V${y0 + h - rr}Q${x + bw} ${y0 + h} ${x + bw - rr} ${y0 + h}H${x + rr}Q${x} ${y0 + h} ${x} ${y0 + h - rr}V${y0 + rr}Q${x} ${y0} ${x + rr} ${y0}Z`;
  return <Shape d={bar(x0) + bar(x0 + bw + gap)} size={size} color={color} round={1} />;
}

// ◀◀ / ▶▶ hai tam giác bo tròn sát nhau
export function SkipGlyph({ size, dir, color = '#FFFFFF' }: { size: number; dir: 'back' | 'forward'; color?: string }) {
  if (!skia) return <Ionicons name={dir === 'back' ? 'play-back' : 'play-forward'} size={size} color={color} />;
  const r = size * 0.12;
  const p = r / 2 + 1;
  const h = size * 0.74;
  const y = (size - h) / 2;
  const w = (size - p * 2) / 2;
  const left = dir === 'back';
  const d = tri(p, y, w, h, left) + tri(p + w, y, w, h, left);
  return <Shape d={d} size={size} color={color} round={r} />;
}

// Nút phát / dừng có hiệu ứng: hai biểu tượng chồng lên nhau, đổi qua lại bằng thu nhỏ + xoay nhẹ + mờ dần
export function PlayPauseGlyph({ playing, size, color = '#FFFFFF' }: { playing: boolean; size: number; color?: string }) {
  const v = useSharedValue(playing ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(playing ? 1 : 0, { duration: 220 });
  }, [playing, v]);
  const playStyle = useAnimatedStyle(() => ({
    opacity: 1 - v.value,
    transform: [{ scale: 1 - 0.35 * v.value }, { rotate: `${v.value * -90}deg` }],
  }));
  const pauseStyle = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.65 + 0.35 * v.value }, { rotate: `${(1 - v.value) * 90}deg` }],
  }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[{ position: 'absolute' }, playStyle]}>
        <PlayGlyph size={size} color={color} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute' }, pauseStyle]}>
        <PauseGlyph size={size} color={color} />
      </Animated.View>
    </View>
  );
}

// Thu nhỏ nhẹ khi nhấn, trở lại êm khi thả (không nảy)
export function useBounce() {
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const onPressIn = () => {
    s.value = withTiming(0.88, { duration: 90 });
  };
  const onPressOut = () => {
    s.value = withTiming(1, { duration: 160 });
  };
  return { style, onPressIn, onPressOut };
}
