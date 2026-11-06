import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { playerProgress } from './PlayerTransition';
import { useTheme } from '../theme/ThemeProvider';

// Lớp làm mờ nằm giữa nền (tab, hiệu ứng tuyết / lá / cá / cà phê) và player.
// Độ mờ đi theo độ mở của player: mở ra thì mờ dần, đóng lại thì từ mờ trở về rõ dần.
// iPhone: kính mờ thật. Android: lớp màu nền phủ mờ (kính mờ thật trên Android nặng và hay lỗi khi nền là Skia)
export function BackdropBlur() {
  const { theme } = useTheme();
  const style = useAnimatedStyle(() => {
    const v = playerProgress.value;
    // Lên mờ nhanh hơn độ mở một chút, lúc đóng thì giữ mờ lâu hơn rồi mới rõ hẳn
    return { opacity: interpolate(v, [0, 0.55], [0, 1], 'clamp') };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={45} tint={theme.colors.statusBar === 'light-content' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background.color, opacity: 0.7 }]} />
      )}
    </Animated.View>
  );
}
