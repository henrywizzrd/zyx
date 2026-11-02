import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

const USE_NATIVE = Platform.OS !== 'web';
const EDGE = 28; // ngón tay đặt cách cạnh trái bao nhiêu px thì tính là vuốt để quay lại

// Cho nút "quay lại" trong trang dùng chung hiệu ứng trượt ra
const BackContext = createContext<(() => void) | null>(null);
export const useAnimatedBack = () => useContext(BackContext);

// Khung cho một trang mở chồng (playlist, album...):
//  - mở ra: trượt vào từ bên phải
//  - đặt ngón tay sát cạnh trái rồi vuốt sang phải: trang đi theo ngón tay, thả quá 1/3 màn hình (hoặc vuốt nhanh) thì quay lại trang trước
//  - trang trong suốt như một tấm kính: nền chung của app (màu, ảnh, video, tuyết/lá/cá...) vẫn chạy liền mạch phía sau.
//  - `fade` (từ App) là độ hiện của tab phía dưới: trang mở ra thì tab mờ đi, vuốt quay lại thì tab hiện dần theo ngón tay.
//    Chạy bằng luồng JS (không dùng native driver) để mỗi lần app vẽ lại (đổi theme...) giá trị không bị lệch → tab không bị trắng
//  - bottom = trang này nằm ngay trên tab (trang đầu tiên). Trang thứ hai trở đi thì tab luôn ẩn
export function SwipeBack({ onBack, fade, bottom = true, children }: {
  onBack: () => void;
  fade?: Animated.Value;
  bottom?: boolean;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;
  const fadeTo = (v: number, duration: number) => fade && Animated.timing(fade, { toValue: v, duration, useNativeDriver: false }).start();
  const widthRef = useRef(width);
  widthRef.current = width;
  const back = useRef(onBack);
  back.current = onBack;
  const leaving = useRef(false);

  useEffect(() => {
    fadeTo(0, 280);
    Animated.timing(x, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [x]);

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (bottom) fadeTo(1, 220);
    Animated.timing(x, { toValue: widthRef.current, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: USE_NATIVE }).start(() =>
      back.current()
    );
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Chỉ giành cử chỉ khi bắt đầu sát cạnh trái và kéo ngang sang phải (để danh sách vẫn cuộn dọc bình thường)
        onMoveShouldSetPanResponderCapture: (_, g) => g.x0 <= EDGE && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          x.setValue(Math.max(0, g.dx));
          if (bottom && fade) fade.setValue(Math.min(1, Math.max(0, g.dx / widthRef.current)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > widthRef.current / 3 || g.vx > 0.6) leave();
          else {
            fadeTo(0, 200);
            Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start();
          }
        },
        onPanResponderTerminate: () => {
          fadeTo(0, 200);
          Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start();
        },
      }),
    [x] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BackContext.Provider value={leave}>
        <Animated.View {...pan.panHandlers} style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
          {children}
        </Animated.View>
      </BackContext.Provider>
    </View>
  );
}
