import React from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

// Ô / thẻ bấm được: hơi thu nhỏ khi nhấn giữ, nảy về khi thả (thay cho kiểu mờ đi khi nhấn)
export function ScalePressable({
  style,
  children,
  scaleTo = 0.95,
  outerStyle,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>; // kiểu của phần thu nhỏ (nền, bo góc, bố cục bên trong)
  outerStyle?: StyleProp<ViewStyle>; // kiểu của khung bấm (chiều rộng theo %, khoảng cách...) — không thu nhỏ
  children?: React.ReactNode;
  scaleTo?: number;
}) {
  const s = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      style={outerStyle}
      onPressIn={(e) => {
        s.value = withTiming(scaleTo, { duration: 110 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 12, stiffness: 260 });
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, st]}>{children}</Animated.View>
    </Pressable>
  );
}
