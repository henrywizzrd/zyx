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
//  - trang phía sau tối dần lên khi trang trên trượt ra, giống iOS
export function SwipeBack({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;
  const widthRef = useRef(width);
  widthRef.current = width;
  const back = useRef(onBack);
  back.current = onBack;
  const leaving = useRef(false);

  useEffect(() => {
    Animated.timing(x, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [x]);

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
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
        onPanResponderMove: (_, g) => x.setValue(Math.max(0, g.dx)),
        onPanResponderRelease: (_, g) => {
          if (g.dx > widthRef.current / 3 || g.vx > 0.6) leave();
          else Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start();
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start(),
      }),
    [x] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const shade = x.interpolate({ inputRange: [0, width], outputRange: [0.35, 0], extrapolate: 'clamp' });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: shade }]} />
      <BackContext.Provider value={leave}>
        <Animated.View
          {...pan.panHandlers}
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ translateX: x }],
              shadowColor: '#000',
              shadowOpacity: 0.35,
              shadowRadius: 12,
              shadowOffset: { width: -4, height: 0 },
            },
          ]}
        >
          {children}
        </Animated.View>
      </BackContext.Provider>
    </View>
  );
}
