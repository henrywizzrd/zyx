import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, PanResponderInstance, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { usePlayer } from '../player/PlayerProvider';
import { SmartImage } from './Cover';

export type Rect = { x: number; y: number; w: number; h: number; r: number };

// Nơi bấm để mở player (ảnh album ở mini player hoặc mục Player trên dock).
// Nơi bấm ghi vào đây trước khi đổi tab, hiệu ứng đọc ra để biết phải phóng to từ đâu.
export const playerOrigin: {
  current: Rect | null;
  // Mini player đăng ký hàm này để lúc đóng đo lại vị trí ảnh album ở chỗ hiện tại của nó
  measureLive?: (cb: (r: Rect | null) => void) => void;
} = { current: null };

type Ctx = {
  reportCover: (r: Rect) => void; // không còn dùng, giữ lại để các file cũ không lỗi
  panHandlers: PanResponderInstance['panHandlers']; // gắn vào vùng cho phép vuốt xuống để thoát
  // true trong lúc đang phóng to / thu nhỏ (hoặc đang vuốt xuống): màn player nên tạm dừng mọi chuyển động bên trong
  moving: boolean;
};
const TransitionContext = createContext<Ctx>({ reportCover: () => {}, panHandlers: {} as Ctx['panHandlers'], moving: false });
export const usePlayerTransition = () => useContext(TransitionContext);

const SPRING = { damping: 28, stiffness: 230, mass: 1 };

// Mở player như mở app trên iPhone: một ô bo góc từ ảnh album phóng to dần ra tràn màn hình.
// Cả màn player được thu nhỏ đồng đều bên trong ô đó (không bị méo), ô chỉ cắt phần thừa ở dưới.
// Lúc đầu ô hiện ảnh album, ảnh mờ dần để lộ màn player; đóng thì chạy ngược lại.
export function PlayerTransition({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const { width: W, height: H } = useWindowDimensions();
  const { track } = usePlayer();
  const [mounted, setMountedState] = useState(open);
  const mountedRef = useRef(open);
  const openRef = useRef(open);
  openRef.current = open;
  const setMounted = useCallback((v: boolean) => {
    mountedRef.current = v;
    setMountedState(v);
  }, []);
  // Chỉ gỡ player ra khỏi màn hình nếu lúc animation đóng xong nó vẫn đang ở trạng thái đóng
  const finishClose = useCallback(() => {
    if (!openRef.current) setMounted(false);
  }, [setMounted]);

  const p = useSharedValue(open ? 1 : 0); // 0 = mini player, 1 = player đầy đủ
  const ox = useSharedValue(0), oy = useSharedValue(0), ow = useSharedValue(1), oh = useSharedValue(1), or = useSharedValue(0);

  const hRef = useRef(H);
  hRef.current = H;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const reportCover = useCallback(() => {}, []);
  // Trong lúc chuyển cảnh, cả màn player được "chụp" thành một ảnh (rasterize) rồi chỉ việc phóng to / thu nhỏ ảnh đó.
  // Không làm vậy thì mỗi khung hình máy phải vẽ lại toàn bộ: ảnh bìa có mép mờ (mask), chữ phát sáng, nền mờ...
  // bên trong một khung bo góc đang đổi kích thước → tụt khung hình
  const [moving, setMoving] = useState(open);
  const stopMoving = useCallback(() => setMoving(false), []);

  useEffect(() => {
    if (open) {
      if (!mountedRef.current) {
        const o = playerOrigin.current ?? { x: W / 2 - 24, y: H - 120, w: 48, h: 48, r: 24 };
        ox.value = o.x; oy.value = o.y; ow.value = o.w; oh.value = o.h; or.value = o.r;
        p.value = 0;
        setMounted(true);
      }
      setMoving(true);
      p.value = withSpring(1, SPRING, (done) => {
        if (done) runOnJS(stopMoving)();
      });
    } else if (mountedRef.current) {
      setMoving(true);
      // Thu nhỏ ngay lập tức (không đợi đo vị trí mini player): luồng JS có bận thì hiệu ứng vẫn chạy trên UI thread
      p.value = withTiming(0, { duration: 340, easing: Easing.bezier(0.32, 0.72, 0, 1) }, (done) => {
        if (done) runOnJS(finishClose)();
      });
      // Đo lại vị trí mini player (có thể đã bị kéo sang chỗ khác kể từ lúc mở).
      // Đo xong thì đổi điểm đích ngay giữa chừng: hiệu ứng đọc điểm đích mỗi khung hình nên tự bẻ hướng mượt
      playerOrigin.measureLive?.((r) => {
        if (r && r.w > 0 && !openRef.current) {
          ox.value = r.x; oy.value = r.y; ow.value = r.w; oh.value = r.h; or.value = r.r;
        }
      });
      // Lưới an toàn: vì lý do gì đó hiệu ứng không báo xong thì vẫn gỡ player
      const id = setTimeout(finishClose, 900);
      return () => clearTimeout(id);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vuốt xuống để thoát: ngón tay kéo tới đâu thì cả màn player thu về mini player tới đó
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setMoving(true),
        onPanResponderMove: (_, g) => {
          p.value = 1 - Math.min(1, Math.max(0, g.dy / (hRef.current * 0.9)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 0.9) onCloseRef.current();
          else
            p.value = withSpring(1, SPRING, (done) => {
              if (done) runOnJS(stopMoving)();
            });
        },
        onPanResponderTerminate: () => {
          p.value = withSpring(1, SPRING, (done) => {
            if (done) runOnJS(stopMoving)();
          });
        },
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const ctx = useMemo<Ctx>(() => ({ reportCover, panHandlers: pan.panHandlers, moving }), [reportCover, pan, moving]);

  // Ô cửa sổ: từ khung ảnh album ở mini player lớn dần tới toàn màn hình
  const win = useAnimatedStyle(() => ({
    position: 'absolute',
    overflow: 'hidden',
    left: interpolate(p.value, [0, 1], [ox.value, 0]),
    top: interpolate(p.value, [0, 1], [oy.value, 0]),
    width: interpolate(p.value, [0, 1], [ow.value, W]),
    height: interpolate(p.value, [0, 1], [oh.value, H]),
    // Hơi thu lại là bo góc kiểu màn hình iPhone ngay, chỉ vuông khi tràn hẳn màn hình
    borderRadius: interpolate(p.value, [0, 0.97, 1], [or.value, 48, 0], 'clamp'),
  }));

  // Cả màn player, thu nhỏ đồng đều sao cho rộng bằng đúng ô cửa sổ, neo ở góc trên trái
  const screen = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    top: 0,
    width: W,
    height: H,
    transformOrigin: 'top left',
    transform: [{ scale: interpolate(p.value, [0, 1], [ow.value / W, 1]) }],
    opacity: interpolate(p.value, [0.1, 0.5], [0, 1], 'clamp'),
  }));

  // Ảnh album phủ lên đầu, mờ dần để lộ màn player (đóng lại thì hiện dần trở lại)
  const art = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.4], [1, 0], 'clamp') }));

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[win, { backgroundColor: track.color }]}>
        <TransitionContext.Provider value={ctx}>
          <Animated.View style={screen} shouldRasterizeIOS={moving} renderToHardwareTextureAndroid={moving}>
            {children}
          </Animated.View>
        </TransitionContext.Provider>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, art]}>
          {track.thumb ? (
            <>
              <Image source={{ uri: track.thumb }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              <SmartImage url={track.thumb} size={600} style={StyleSheet.absoluteFill} />
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: track.color }]} />
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
