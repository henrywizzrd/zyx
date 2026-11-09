// Dải báo "Đang offline" ở đầu màn hình: tấm kính nhỏ trượt xuống khi mất mạng, trượt lên khi có mạng lại
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useOffline } from '../data/net';
import { GlassFill, glassShadow } from './Glass';

const EASE = Easing.bezier(0.23, 1, 0.32, 1);

export function OfflineBanner() {
  const offline = useOffline();
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(offline ? 1 : 0, { duration: offline ? 260 : 200, easing: EASE });
  }, [offline]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * -16 }, { scale: 0.96 + 0.04 * v.value }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 40 }]}>
      <Animated.View style={[styles.pill, { top: insets.top + 6 }, glassShadow(0.8, theme.colors.glassTint !== 'dark'), st]}>
        <GlassFill radius={16} solid={0.75} slab />
        <Ionicons name="cloud-offline-outline" size={15} color={theme.colors.text} />
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>{t('offline.banner')}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 32, borderRadius: 16, borderCurve: 'continuous' },
});
