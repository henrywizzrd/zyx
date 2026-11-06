import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { SharedValue, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

// Độ nảy khi kéo quá đầu trang (kiểu iOS): nội dung trượt xuống theo ngón tay rồi đàn hồi lại khi thả.
// Ảnh bìa / nền phần đầu trang thì GIÃN RA theo ngón tay (mép trên dính vào đỉnh màn hình), nên không lộ khoảng hở phía trên.
// Cách dùng:
//   const { scrollY, onScroll } = useStretchScroll();
//   <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16}> ... <StretchyBg scrollY={scrollY} height={H}>ảnh</StretchyBg>
// Android không có độ nảy kiểu này (máy tự kéo giãn cả trang theo kiểu của Android 12+), nên chỉ iOS mới giãn ảnh.

export function useStretchScroll() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  return { scrollY, onScroll };
}

// Lớp phủ kín khung cha (absoluteFill). height = chiều cao khung cha (để tính độ giãn)
export function StretchyBg({ scrollY, height, children }: { scrollY: SharedValue<number>; height: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const pull = Math.min(0, scrollY.value); // số âm khi đang kéo quá đầu trang
    if (pull === 0 || height <= 0) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    return { transform: [{ translateY: pull }, { scale: (height - pull) / height }] };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, styles.origin, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ origin: { transformOrigin: 'top' } });
