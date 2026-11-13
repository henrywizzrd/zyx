import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';

const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { SmartImage } from './Cover';
import type { Track } from '../data/mock';

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
// Mờ (frost) làm theo kính của màn đa nhiệm iOS: nhoè đậm, phủ màu theme dày hơn (ngả tối với theme tối),
// chữ / ảnh phía sau chỉ còn là mảng màu, không đọc được
// Mờ tối (matte): kiểu kính iOS cổ điển — đúng cái Tyson thấy khi xem app ở màn đa nhiệm (iOS thay Liquid Glass bằng lớp vật liệu
// nhoè dày "material" của hệ thống): nhoè rất đậm, ngả tối + nhuộm nhẹ màu theme, mép chỉ một viền sáng mảnh, không phản chiếu,
// không khúc xạ. Không dùng Liquid Glass
export type GlassMaterial = 'clear' | 'frost' | 'smoke' | 'matte';

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
// noRim: tắt ánh sáng ở viền (vệt sáng mép trên, bóng tối mép dưới, viền bắt sáng) — tuỳ chọn của dock.
// Liquid Glass thật của iOS tự vẽ ánh sáng viền và không tắt được, nên khi tắt thì dùng kính tự vẽ (vẫn mờ, vẫn trong)
export function GlassFill({ radius = 0, solid = 0, slab = false, dark: forceDark = false, noRim = false }: { radius?: number; solid?: number; slab?: boolean; dark?: boolean; noRim?: boolean }) {
  const { theme } = useTheme();
  const glassRgb = forceDark ? '22,22,26' : theme.colors.glassRgb;
  const glassTint = forceDark ? 'dark' : theme.colors.glassTint;
  const border = forceDark ? 'rgba(255,255,255,0.14)' : theme.colors.border;
  const g = useGlass();
  const material: GlassMaterial = theme.glass.material ?? 'clear';
  const dark = glassTint === 'dark';
  const real = Platform.OS !== 'web';

  // ---- Mờ tối: vật liệu nhoè dày của hệ thống
  if (material === 'matte') {
    const ios = Platform.OS === 'ios';
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, overflow: 'hidden' }]}>
        {real && (
          <BlurView
            intensity={ios ? 100 : 70}
            tint={ios ? (dark ? 'systemThickMaterialDark' : 'systemThickMaterialLight') : dark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* nhuộm nhẹ màu theme (đậm dần theo thanh "Độ mờ kính") */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: real ? `rgba(${glassRgb},${(0.18 + 0.4 * g.level + solid * 0.1 + (ios ? 0 : 0.3)).toFixed(2)})` : theme.colors.surface }]} />
        {/* viền sáng mảnh, sáng hơn ở nửa trên */}
        <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }]} />
        {!noRim && (
          <LinearGradient
            colors={[dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
            locations={[0, 0.35]}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
    );
  }

  // ---- iOS 26+: Liquid Glass thật (khúc xạ, mép kính, phản chiếu do hệ thống vẽ)
  if (LG && !noRim) {
    const tint =
      material === 'smoke'
        ? `rgba(0,0,0,${(0.22 + 0.33 * g.level).toFixed(2)})`
        : material === 'frost'
        ? `rgba(${glassRgb},${Math.min(0.85, 0.34 + 0.36 * g.level + solid * 0.12).toFixed(2)})`
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
  const blurBy = material === 'frost' ? 45 + g.level * 50 : material === 'smoke' ? 8 + g.level * 30 : 4 + g.level * 40;
  const androidBoost = Platform.OS === 'android' ? 0.2 : 0;
  const a =
    material === 'smoke'
      ? 0
      : Math.max(solid * (0.55 + 0.45 * g.level), (material === 'frost' ? 0.38 : 0.06) + androidBoost + g.level * (material === 'frost' ? 0.4 : 0.45));
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
      {!noRim && <LinearGradient
        colors={[dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.08)']}
        locations={[0, 0.18, 0.82, 1]}
        style={StyleSheet.absoluteFill}
      />}
      {/* cạnh kính: viền mảnh đều bốn phía + viền sáng hơn ở nửa trên (ánh đèn từ trên) */}
      <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: slab && !noRim ? 1 : StyleSheet.hairlineWidth, borderColor: noRim ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : slab ? (dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)') : border }]} />
      {slab && !noRim && Platform.OS !== 'web' && (
        <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['#000', 'transparent']} locations={[0, 0.55]} style={{ flex: 1 }} />}>
          <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)' }]} />
        </MaskedView>
      )}
    </View>
  );
}

// Ảnh bìa là chính tấm kính (mini player): mặt ảnh đặc, không trong suốt, còn phần "kính" nằm ở mép và góc —
// như ảnh được đúc trong một khối kính dày đặt trên mặt bàn:
//  1. vành khúc xạ: dải mép rộng ~8% cạnh hiện lại chính ảnh đó nhưng phóng to + nhoè (ánh sáng bẻ cong qua mép vát)
//  2. mép vát: sáng ở góc trên trái (đèn chiếu từ trên), tối dần về góc dưới phải
//  3. đường cạnh: viền sáng mảnh bắt sáng ở mép ngoài + một đường mảnh nơi mép vát gặp mặt phẳng
//  4. vệt phản chiếu chéo nhẹ trên mặt
// Bóng đổ do khung bên ngoài lo (glassShadow)
export function ArtSlab({ track, size, radius }: { track: Track; size: number; radius: number }) {
  const E = Math.max(4, Math.round(size * 0.085)); // bề rộng mép vát
  const masks = Platform.OS !== 'web';
  const round = [StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius }];
  const ring = (w: number) => <View style={[StyleSheet.absoluteFill, SQUIRCLE, { borderRadius: radius, borderWidth: w, borderColor: '#000' }]} />;
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: track.color }, SQUIRCLE]}>
      {track.thumb ? (
        <SmartImage url={track.thumb} size={180} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="musical-notes" size={Math.round(size * 0.36)} color="rgba(255,255,255,0.85)" />
        </View>
      )}
      {/* vệt phản chiếu chéo trên mặt */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
        locations={[0, 0.3, 0.55]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {masks && (
        <MaskedView pointerEvents="none" style={StyleSheet.absoluteFill} maskElement={ring(E)}>
          {/* 1. vành khúc xạ */}
          {track.thumb ? (
            <View style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.14 }] }]}>
              <SmartImage url={track.thumb} size={96} blurRadius={4} style={StyleSheet.absoluteFill} />
            </View>
          ) : null}
          {/* 2. mép vát: sáng trên trái → tối dưới phải */}
          <LinearGradient
            colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.34)']}
            locations={[0, 0.35, 0.65, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      )}
      {/* 3. đường cạnh: viền ngoài bắt sáng (sáng nhất ở góc trên trái, hắt lại nhẹ ở góc dưới phải) */}
      {masks ? (
        <MaskedView pointerEvents="none" style={StyleSheet.absoluteFill} maskElement={ring(1.25)}>
          <LinearGradient
            colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.5)']}
            locations={[0, 0.4, 0.7, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      ) : (
        <View pointerEvents="none" style={[...round, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }]} />
      )}
      {/* đường mảnh nơi mép vát gặp mặt phẳng */}
      <View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: E, top: E, right: E, bottom: E, borderRadius: Math.max(2, radius - E), borderWidth: StyleSheet.hairlineWidth },
          SQUIRCLE,
          { borderTopColor: 'rgba(0,0,0,0.25)', borderLeftColor: 'rgba(0,0,0,0.2)', borderRightColor: 'rgba(255,255,255,0.28)', borderBottomColor: 'rgba(255,255,255,0.32)' },
        ]}
      />
    </View>
  );
}
