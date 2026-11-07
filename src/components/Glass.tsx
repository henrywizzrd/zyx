import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

// Lớp kính mờ (frosted) phủ kín khung chứa nó, đặt làm con đầu tiên của dock, mini player, popup...
// Gồm: làm mờ phần phía sau (độ mờ chỉnh trong Theme Studio) + lớp màu theo theme + viền mảnh.
// Độ mờ = 0 thì thành nền đặc theo theme.
// Android: expo-blur mặc định chỉ phủ màu trong suốt (làm mờ thật trên Android rất tốn máy), nhìn vẫn như kính nhạt.
// solid: độ đậm tối thiểu của lớp màu (0..1). Dock dùng mức cao để luôn rõ ràng như thanh tab của Apple Music
// slab: kiểu "tấm kính" của Apple Music: lớp màu mỏng hơn để thấy rõ phần mờ phía sau, thêm vệt sáng ở mép trên
// và viền sáng mảnh như cạnh kính bắt sáng, nên trông như một tấm kính thật đặt nổi trên nền
// Mức kính dùng chung cả app (thanh "Độ mờ kính" trong Theme Studio, 0..100):
//  0   = gần như trong suốt: nhìn rõ nền phía sau (trời sao, ảnh...), chỉ phủ một lớp màu rất mỏng
//  100 = kính mờ đục: làm nhoè mạnh, lớp màu dày
// (Trước đây kéo về 0 lại thành nền đặc, ngược với cảm giác "trong suốt")
// level: 0..1. intensity: độ nhoè cho BlurView. alpha(min, max): độ đậm lớp phủ theo mức kính
export function useGlass() {
  const { theme } = useTheme();
  const level = Math.max(0, Math.min(1, theme.glass.blur / 100));
  return {
    level,
    intensity: Math.round(level * 60),
    alpha: (min: number, max: number) => min + (max - min) * level,
  };
}

export function GlassFill({ radius = 0, solid = 0, slab = false }: { radius?: number; solid?: number; slab?: boolean }) {
  const { theme } = useTheme();
  const { glassRgb, glassTint, border } = theme.colors;
  const g = useGlass();
  const real = Platform.OS !== 'web';
  // Lớp màu phủ mỏng khi kính trong, đậm dần khi kéo thanh lên (kính mờ đục). Android không làm nhoè thật nên phủ đậm hơn chút
  const a = Math.max(solid * (0.55 + 0.45 * g.level), g.alpha(Platform.OS === 'android' ? 0.3 : 0.1, Platform.OS === 'android' ? 0.86 : 0.62));
  const tint = `rgba(${glassRgb},${a.toFixed(2)})`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {real && g.intensity > 0 && <BlurView intensity={g.intensity} tint={glassTint} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: real ? tint : theme.colors.surface }]} />
      {slab ? (
        <>
          {/* Vệt sáng mờ dần từ mép trên xuống: ánh sáng chiếu lên mặt kính */}
          <LinearGradient
            colors={glassTint === 'dark' ? ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          {/* Cạnh kính: sáng ở trên, tối nhẹ ở dưới */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius,
                borderWidth: 1,
                borderTopColor: glassTint === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.9)',
                borderLeftColor: glassTint === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)',
                borderRightColor: glassTint === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)',
                borderBottomColor: glassTint === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              },
            ]}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: border }]} />
      )}
    </View>
  );
}
