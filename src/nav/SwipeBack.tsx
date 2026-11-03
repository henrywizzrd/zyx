import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { useScreenSize } from '../components/ScreenSize';

const EDGE = 28; // ngón tay đặt cách cạnh trái bao nhiêu px thì tính là vuốt để quay lại
const SHADOW_W = 22; // bóng mềm ở mép trái trang
const ENTER_MS = 300;
const LEAVE_MS = 220;
const SPRING = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true };

// Cho nút "quay lại" trong trang dùng chung hiệu ứng trượt ra
const BackContext = createContext<(() => void) | null>(null);
export const useAnimatedBack = () => useContext(BackContext);
// Trang đã trượt vào xong chưa. Trang nặng (danh sách dài, nhiều ảnh) đợi tới lúc này mới dựng phần nặng,
// để hiệu ứng trượt vào không bị khựng vì máy đang bận dựng trang
const EnteredContext = createContext(true);
export const useEntered = () => useContext(EnteredContext);

// Khung cho một trang mở chồng (playlist, album, nghệ sĩ, thể loại...):
//  - mở ra: trượt vào từ bên phải
//  - đặt ngón tay sát cạnh trái rồi vuốt sang phải: trang đi theo ngón tay, thả quá 1/3 màn hình (hoặc vuốt nhanh) thì quay lại
//  - trong lúc trượt: trang có nền đặc + bóng mềm ở mép trái (giống thẻ trượt của iOS), đứng yên thì nền tan đi
//    để nền chung và hiệu ứng tuyết / lá / cá vẫn chạy phía sau
//  - `fade` (từ App) là độ hiện của lớp ngay bên dưới (tab, hoặc trang trước): trang mở ra thì lớp dưới mờ đi,
//    vuốt quay lại thì lớp dưới hiện dần theo ngón tay
// Toàn bộ chuyển động và cử chỉ chạy trên UI thread (Reanimated + Gesture Handler): luồng JS có bận dựng trang
// thì hiệu ứng vẫn mượt. (Trước đây chạy bằng luồng JS nên mở trang nặng là khựng.)
export function SwipeBack({ onBack, fade, children }: { onBack: () => void; fade?: SharedValue<number>; children: React.ReactNode }) {
  const { width } = useScreenSize();
  const { theme } = useTheme();
  const w = useSharedValue(width);
  useEffect(() => {
    w.value = width;
  }, [width, w]);
  const x = useSharedValue(width);
  const cover = useSharedValue(1);
  const leaving = useSharedValue(false);
  const [entered, setEntered] = useState(false);

  const markEntered = useCallback(() => setEntered(true), []);
  const back = useCallback(() => onBack(), [onBack]);

  // Trượt vào
  useEffect(() => {
    if (fade) fade.value = withTiming(0, { duration: ENTER_MS });
    x.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }, (done) => {
      if (!done) return;
      cover.value = withTiming(0, { duration: 180 });
      scheduleOnRN(markEntered);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Trượt ra rồi đóng trang (dùng cho cả nút back và vuốt)
  const leaveWorklet = () => {
    'worklet';
    if (leaving.value) return;
    leaving.value = true;
    cover.value = 1;
    if (fade) fade.value = withTiming(1, { duration: LEAVE_MS });
    x.value = withTiming(w.value, { duration: LEAVE_MS, easing: Easing.out(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(back);
    });
  };
  const leave = useCallback(() => {
    leaveWorklet();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Vuốt từ cạnh trái
  const onActivate = () => {
    'worklet';
    cover.value = 1;
  };
  const onUpdate = (e: { translationX: number }) => {
    'worklet';
    if (leaving.value) return;
    const v = Math.max(0, e.translationX);
    x.value = v;
    if (fade) fade.value = Math.min(1, v / w.value);
  };
  const onDeactivate = (e: { translationX: number; velocityX: number }) => {
    'worklet';
    if (leaving.value) return;
    if (e.translationX > w.value / 3 || e.velocityX > 700) {
      leaveWorklet();
      return;
    }
    if (fade) fade.value = withTiming(0, { duration: 200 });
    x.value = withSpring(0, SPRING, (done) => {
      if (done) cover.value = withTiming(0, { duration: 180 });
    });
  };
  const pan = usePanGesture({
    hitSlop: { left: 0, width: EDGE },
    activeOffsetX: 8,
    failOffsetY: [-14, 14],
    onActivate,
    onUpdate,
    onDeactivate,
  });

  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const bg = theme.background.type === 'preset' ? theme.colors.bg : theme.colors.bg + 'EE';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BackContext.Provider value={leave}>
        <EnteredContext.Provider value={entered}>
          <GestureDetector gesture={pan}>
            <Animated.View style={[StyleSheet.absoluteFill, pageStyle]}>
              {/* Bóng mềm ngay bên trái mép trang (chỉ thấy khi trang đã trượt sang phải) */}
              <LinearGradient
                pointerEvents="none"
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.16)']}
                style={{ position: 'absolute', top: 0, bottom: 0, left: -SHADOW_W, width: SHADOW_W }}
              />
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bg }, coverStyle]} />
              {children}
            </Animated.View>
          </GestureDetector>
        </EnteredContext.Provider>
      </BackContext.Provider>
    </View>
  );
}

// Lớp có độ hiện theo một shared value (tab bên dưới, hoặc trang bên dưới trang trên cùng)
export function FadeLayer({ value, style, pointerEvents, children }: {
  value: SharedValue<number>;
  style?: any;
  pointerEvents?: 'auto' | 'none' | 'box-none';
  children: React.ReactNode;
}) {
  const s = useAnimatedStyle(() => ({ opacity: value.value }));
  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, s]}>
      {children}
    </Animated.View>
  );
}

