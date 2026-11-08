import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';

const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
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

// Liquid Glass thật của iOS (iOS 26 trở lên, cần bản app có module expo-glass-effect).
// Không có (Android, iOS cũ, bản app cũ chưa build lại) thì dùng kính tự vẽ bên dưới.
type LGModule = typeof import('expo-glass-effect');
const LG: LGModule | null = (() => {
  if (Platform.OS !== 'ios') return null;
  try {
    const m = require('expo-glass-effect') as LGModule;
    return m.isLiquidGlassAvailable() && m.isGlassEffectAPIAvailable() ? m : null;
  } catch {
    return null;
  }
})();
export const hasLiquidGlass = !!LG;

// Ba loại kính (Theme Studio): Trong / Mờ / Khói. Thanh "Độ mờ kính" chỉnh độ đậm bên trong loại đó
export type GlassMaterial = 'clear' | 'frost' | 'smoke';

// Bóng hai lớp của tấm kính đặt nổi trên mặt bàn (công thức chốt từ trang thử kính):
// một bóng đậm, gọn sát chân + một bóng mềm, rộng. lift: độ nổi (1 = bình thường, cầm lên thì lớn hơn)
export function glassShadow(lift = 1, light = false) {
  const k = light ? 0.55 : 1;
  const e = 7 * lift;
  return {
    boxShadow: `0px ${(e * 0.25).toFixed(1)}px ${(e * 0.5).toFixed(1)}px rgba(0,0,0,${(0.45 * k).toFixed(2)}), 0px ${(e * 1.6).toFixed(1)}px ${(e * 4.2).toFixed(1)}px rgba(0,0,0,${(0.32 * k).toFixed(2)})`,
  } as const;
}

// Góc bo liền mạch kiểu icon iPhone (squircle) cho mọi tấm kính
export const SQUIRCLE = { borderCurve: 'continuous' as const };

// dark: luôn là kính tối (bảng mở từ trong player, chữ trắng) bất kể theme
export function GlassFill({ radius = 0, solid = 0, slab = false, dark: forceDark = false }: { radius?: number; solid?: number; slab?: boolean; dark?: boolean }) {
  const { theme } = useTheme();
  const glassRgb = forceDark ? '22,22,26' : theme.colors.glassRgb;
  const glassTint = forceDark ? 'dark' : theme.colors.glassTint;
  const border = forceDark ? 'rgba(255,255,255,0.14)' : theme.colors.border;
  const g = useGlass();
  const material: GlassMaterial = theme.glass.material ?? 'clear';
  const dark = glassTint === 'dark';
  const real = Platform.OS !== 'web';

  // ---- iOS 26+: Liquid Glass thật (khúc xạ, mép kính, phản chiếu do hệ thống vẽ)
  if (LG) {
    const tint =
      material === 'smoke'
        ? `rgba(0,0,0,${(0.22 + 0.33 * g.level).toFixed(2)})`
        : material === 'frost'
        ? `rgba(${glassRgb},${(0.12 + 0.4 * g.level + solid * 0.15).toFixed(2)})`
        : g.level > 0.02 || solid > 0
        ? `rgba(${glassRgb},${(0.22 * g.level + solid * 0.08).toFixed(2)})`
        : undefined;
    return (
      <LG.GlassView
        pointerEvents="none"
        glassEffectStyle={material === 'frost' ? 'regular' : 'clear'}
        tintColor={tint}
        colorScheme={dark ? 'dark' : 'light'}
        style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, overflow: 'hidden' }]}
      />
    );
  }

  // ---- Kính tự vẽ: làm mờ + lớp màu + mép dày (vệt sáng trên, tối dưới) + vệt phản chiếu chéo
  const blurBy = material === 'frost' ? 25 + g.level * 55 : material === 'smoke' ? 8 + g.level * 30 : 4 + g.level * 40;
  const androidBoost = Platform.OS === 'android' ? 0.2 : 0;
  const a =
    material === 'smoke'
      ? 0
      : Math.max(solid * (0.55 + 0.45 * g.level), (material === 'frost' ? 0.2 : 0.06) + androidBoost + g.level * (material === 'frost' ? 0.5 : 0.45));
  const tint = material === 'smoke' ? `rgba(6,8,14,${(0.32 + 0.35 * g.level + androidBoost).toFixed(2)})` : `rgba(${glassRgb},${Math.min(0.92, a).toFixed(2)})`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, overflow: 'hidden' }]}>
      {real && <BlurView intensity={Math.round(blurBy)} tint={dark || material === 'smoke' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: real ? tint : theme.colors.surface }]} />
      {/* vệt phản chiếu chéo trên mặt kính */}
      <LinearGradient
        colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.07)']}
        locations={[0, 0.22, 0.42, 0.72, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
      {/* mép dày: dải sáng mờ ở mép trên, dải tối ở mép dưới */}
      <LinearGradient
        colors={[dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.08)']}
        locations={[0, 0.18, 0.82, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* cạnh kính: viền mảnh đều bốn phía + viền sáng hơn ở nửa trên (ánh đèn từ trên) */}
      <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: slab ? 1 : StyleSheet.hairlineWidth, borderColor: slab ? (dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)') : border }]} />
      {slab && Platform.OS !== 'web' && (
        <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['#000', 'transparent']} locations={[0, 0.55]} style={{ flex: 1 }} />}>
          <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)' }]} />
        </MaskedView>
      )}
    </View>
  );
}
