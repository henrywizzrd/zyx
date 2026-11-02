import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';

// Lớp kính mờ (frosted) phủ kín khung chứa nó, đặt làm con đầu tiên của dock, mini player, popup...
// Gồm: làm mờ phần phía sau (độ mờ chỉnh trong Theme Studio) + lớp màu theo theme + viền mảnh.
// Độ mờ = 0 thì thành nền đặc theo theme.
// Android: expo-blur mặc định chỉ phủ màu trong suốt (làm mờ thật trên Android rất tốn máy), nhìn vẫn như kính nhạt.
// solid: độ đậm tối thiểu của lớp màu (0..1). Dock dùng mức cao để luôn rõ ràng như thanh tab của Apple Music
export function GlassFill({ radius = 0, solid = 0 }: { radius?: number; solid?: number }) {
  const { theme } = useTheme();
  const { glassRgb, glassTint, surface, border } = theme.colors;
  const blur = theme.glass.blur;
  const real = blur > 0 && Platform.OS !== 'web';
  // Lớp màu phủ mỏng khi kính trong, đậm dần khi kéo thanh lên (kính mờ đục). Phủ dày quá sẽ che mất phần mờ phía dưới.
  const tint = `rgba(${glassRgb},${Math.max(solid, 0.18 + 0.32 * (blur / 100)).toFixed(2)})`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      {real && <BlurView intensity={blur} tint={glassTint} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: real ? tint : surface }]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: border }]} />
    </View>
  );
}
