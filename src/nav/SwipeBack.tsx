import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

const USE_NATIVE = Platform.OS !== 'web';
const EDGE = 28;
const SHADOW_W = 22; // bóng mềm ở mép trái trang // ngón tay đặt cách cạnh trái bao nhiêu px thì tính là vuốt để quay lại

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
  const { theme } = useTheme();
  const x = useRef(new Animated.Value(width)).current;
  // Trong lúc trượt (mở ra, vuốt quay lại, đóng): trang có nền đặc + bóng mềm ở mép trái, giống thẻ trượt của iOS,
  // để không thấy chữ của tab phía dưới chồng lên. (Không bo góc: góc bo để lộ một mảng sáng của tab phía dưới.)
  // Đứng yên thì nền tan đi (trong suốt như cũ) để nền chung và hiệu ứng tuyết / lá / cá vẫn chạy phía sau.
  const cover = useRef(new Animated.Value(1)).current;
  const startMoving = useCallback(() => {
    cover.stopAnimation();
    cover.setValue(1);
  }, [cover]);
  const settle = useCallback(() => {
    Animated.timing(cover, { toValue: 0, duration: 180, useNativeDriver: USE_NATIVE }).start();
  }, [cover]);
  const fadeTo = (v: number, duration: number) => fade && Animated.timing(fade, { toValue: v, duration, useNativeDriver: false }).start();
  const widthRef = useRef(width);
  widthRef.current = width;
  const back = useRef(onBack);
  back.current = onBack;
  const leaving = useRef(false);

  useEffect(() => {
    fadeTo(0, 280);
    Animated.timing(x, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start(({ finished }) => finished && settle());
  }, [x]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    startMoving();
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
        onPanResponderGrant: () => startMoving(),
        onPanResponderMove: (_, g) => {
          x.setValue(Math.max(0, g.dx));
          if (bottom && fade) fade.setValue(Math.min(1, Math.max(0, g.dx / widthRef.current)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > widthRef.current / 3 || g.vx > 0.6) leave();
          else {
            fadeTo(0, 200);
            Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start(({ finished }) => finished && settle());
          }
        },
        onPanResponderTerminate: () => {
          fadeTo(0, 200);
          Animated.spring(x, { toValue: 0, friction: 9, tension: 90, useNativeDriver: USE_NATIVE }).start(({ finished }) => finished && settle());
        },
      }),
    [x] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BackContext.Provider value={leave}>
        <Animated.View {...pan.panHandlers} style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
          {/* Bóng mềm ngay bên trái mép trang (chỉ thấy khi trang đã trượt sang phải) */}
          <LinearGradient
            pointerEvents="none"
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.16)']}
            style={{ position: 'absolute', top: 0, bottom: 0, left: -SHADOW_W, width: SHADOW_W }}
          />
          <View style={StyleSheet.absoluteFill}>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.background.type === 'preset' ? theme.colors.bg : theme.colors.bg + 'EE', opacity: cover }]}
            />
            {children}
          </View>
        </Animated.View>
      </BackContext.Provider>
    </View>
  );
}
