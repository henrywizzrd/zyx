import React from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

// Hàng trong danh sách hiện lần lượt từ dưới lên khi mở trang (chỉ ~14 hàng đầu, hàng sau hiện luôn cho đỡ chờ)
export function Stagger({ i, children }: { i: number; children: React.ReactNode }) {
  if (i > 14) return <>{children}</>;
  return <Animated.View entering={FadeInDown.delay(i * 35).duration(260)}>{children}</Animated.View>;
}
