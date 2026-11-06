import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, PanResponderInstance, StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, makeMutable, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { usePlayerPick } from '../player/PlayerProvider';
import { SmartImage } from './Cover';
import { useScreenSize } from './ScreenSize';

export type Rect = { x: number; y: number; w: number; h: number; r: number };

// Nơi bấm để mở player (ảnh album ở mini player hoặc mục Player trên dock).
// Nơi bấm ghi vào đây trước khi đổi tab, hiệu ứng đọc ra để biết phải phóng to từ đâu.
export const playerOrigin: {
  current: Rect | null;
  // Mini player đăng ký hàm này để lúc đóng đo lại vị trí ảnh album ở chỗ hiện tại của nó
  measureLive?: (cb: (r: Rect | null) => void) => void;
} = { current: null };

// Độ mở của player (0 = mini player, 1 = đầy đủ), dùng chung cho lớp làm mờ nền phía sau (BackdropBlur trong App)
export const playerProgress = makeMutable(0);

type Ctx = {
  reportCover: (r: Rect) => void; // không còn dùng, giữ lại để các file cũ không lỗi
  panHandlers: PanResponderInstance['panHandlers']; // gắn vào vùng cho phép vuốt xuống để thoát
  // true trong lúc đang phóng to / thu nhỏ (hoặc đang vuốt xuống): màn player nên tạm dừng mọi chuyển động bên trong
  moving: boolean;
  // false khi player đã đóng hẳn (đang ẩn): màn player nên dừng mọi thứ chạy liên tục
  active: boolean;
};
const TransitionContext = createContext<Ctx>({ reportCover: () => {}, panHandlers: {} as Ctx['panHandlers'], moving: false, active: true });
export const usePlayerTransition = () => useContext(TransitionContext);

// Nở ra như bong bóng cửa sổ nổi (Xiaomi / OPPO): lò xo hơi nảy nhẹ ở cuối
const SPRING = { damping: 24, stiffness: 210, mass: 1 };

// Mở player như mở app trên iPhone: một ô bo góc từ ảnh album phóng to dần ra tràn màn hình.
// Cả màn player được thu nhỏ đồng đều bên trong ô đó (không bị méo), ô chỉ cắt phần thừa ở dưới.
// Lúc đầu ô hiện ảnh album, ảnh mờ dần để lộ màn player; đóng thì chạy ngược lại.
export function PlayerTransition({ open, onClose, onClosed, onOpened, children }: { open: boolean; onClose: () => void; onClosed?: () => void; onOpened?: () => void; children: React.ReactNode }) {
  const { width: W, height: H } = useScreenSize();
  const { track } = usePlayerPick('track');
  const [mounted, setMountedState] = useState(open);
  const mountedRef = useRef(open);
  const openRef = useRef(open);
  openRef.current = open;
  const setMounted = useCallback((v: boolean) => {
    mountedRef.current = v;
    setMountedState(v);
  }, []);
  // Chỉ gỡ player ra khỏi màn hình nếu lúc animation đóng xong nó vẫn đang ở trạng thái đóng
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  // Thu về xong (ảnh album bay đã nằm đúng chỗ, đúng cỡ, đúng bo góc của bong bóng):
  //  1. báo App hiện lại bong bóng thật, nằm NGAY BÊN DƯỚI ảnh album bay (hai cái trùng khít nhau)
  //  2. đợi vài khung hình cho bong bóng thật vẽ xong rồi mới gỡ ảnh bay đi
  // → mắt chỉ thấy một hình duy nhất thu nhỏ liền một mạch rồi đứng yên.
  // (Trước đây bong bóng được cho hiện sớm khi ảnh bay còn to hơn → thấy bong bóng mọc ra trước, lệch chỗ)
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishClose = useCallback(() => {
    if (openRef.current || !mountedRef.current || unmountTimer.current) return;
    onClosedRef.current?.();
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null;
      if (!openRef.current) setMounted(false);
    }, 80);
  }, [setMounted]);
  useEffect(() => () => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
  }, []);

  const p = playerProgress; // 0 = mini player, 1 = player đầy đủ
  const first = useRef(true);
  if (first.current) {
    first.current = false;
    p.value = open ? 1 : 0;
  }
  const ox = useSharedValue(0), oy = useSharedValue(0), ow = useSharedValue(1), oh = useSharedValue(1), or = useSharedValue(0);

  const openSize = useRef({ W, H }); // kích thước màn hình lúc mở player
  const hRef = useRef(H);
  hRef.current = H;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const reportCover = useCallback(() => {}, []);
  // Trong lúc chuyển cảnh, cả màn player được "chụp" thành một ảnh (rasterize) rồi chỉ việc phóng to / thu nhỏ ảnh đó.
  // Không làm vậy thì mỗi khung hình máy phải vẽ lại toàn bộ: ảnh bìa có mép mờ (mask), chữ phát sáng, nền mờ...
  // bên trong một khung bo góc đang đổi kích thước → tụt khung hình
  const [moving, setMoving] = useState(open);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const stopMoving = useCallback(() => {
    setMoving(false);
    if (openRef.current) onOpenedRef.current?.(); // đã phóng to xong hẳn
  }, []);

  useEffect(() => {
    if (open) {
      // Đang chờ gỡ ảnh bay mà lại mở tiếp: huỷ việc gỡ, player vẫn còn nguyên trên màn hình
      if (unmountTimer.current) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
      if (!mountedRef.current) {
        const o = playerOrigin.current ?? { x: W / 2 - 24, y: H - 120, w: 48, h: 48, r: 24 };
        ox.value = o.x; oy.value = o.y; ow.value = o.w; oh.value = o.h; or.value = o.r;
        p.value = 0;
        openSize.current = { W, H };
        setMounted(true);
      }
      setMoving(true);
      p.value = withSpring(1, SPRING, (done) => {
        if (done) runOnJS(stopMoving)();
      });
      // Lưới an toàn: hiệu ứng mở vì lý do gì đó không báo xong thì vẫn tắt trạng thái "đang chuyển".
      // (Kẹt ở trạng thái này thì màn player bị chụp thành ảnh mãi → lời đứng im, mọi thứ nặng hơn)
      const id = setTimeout(stopMoving, 900);
      return () => clearTimeout(id);
    } else if (mountedRef.current) {
      setMoving(true);
      // Đã xoay màn hình trong lúc mở player (dọc ↔ ngang): chỗ cũ của bong bóng không còn đúng,
      // thu về chỗ mới của bong bóng (tính theo hình học, không đo nên không bị sai)
      const os = openSize.current;
      const o = playerOrigin.current;
      if (o && (Math.abs(os.W - W) > 1 || Math.abs(os.H - H) > 1)) {
        ox.value = o.x; oy.value = o.y; ow.value = o.w; oh.value = o.h; or.value = o.r;
      }
      // Thu nhỏ ngay lập tức (không đợi đo vị trí mini player): luồng JS có bận thì hiệu ứng vẫn chạy trên UI thread
      // Đường cong đi tới đích dứt khoát (không bò chậm ở cuối): trước đây đoạn cuối kéo dài, ảnh album còn to hơn
      // bong bóng một chút rồi mới "bụp" thành bong bóng
      p.value = withTiming(0, { duration: 360, easing: Easing.bezier(0.3, 0, 0.15, 1) }, (done) => {
        if (done) runOnJS(finishClose)();
      });
      // Thu về đúng chỗ đã mở ra (ảnh album ở mini player lúc bấm mở). KHÔNG đo lại lúc đóng: lúc đó mini player
      // vừa hiện lại và còn đang chạy hiệu ứng (tách khỏi dock, co thành bong bóng...) nên số đo bị sai
      // → ảnh album bay tới chỗ khác, thấy hai ảnh cùng lúc. Trong lúc player mở thì mini player không di chuyển được
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

  // Bo góc (theo điểm ảnh thật trên màn hình) ở mỗi thời điểm.
  // Bong bóng tròn: lúc gần về bong bóng thì bo góc = nửa cạnh ảnh đang bay (luôn là hình tròn), xa dần thì chuyển
  // về bo góc thường. Không làm vậy thì ảnh bay trông như ô vuông bo góc, tới cuối mới "bụp" thành hình tròn
  const radiusAt = (pv: number) => {
    'worklet';
    const base = interpolate(pv, [0, 0.97, 1], [or.value, 48, 0], 'clamp');
    const round = or.value >= ow.value / 2 - 0.5;
    if (!round) return base;
    const size = interpolate(pv, [0, 1], [ow.value, W]); // cạnh ảnh album đang bay
    const t = interpolate(pv, [0, 0.35], [0, 1], 'clamp');
    return (size / 2) * (1 - t) + base * t;
  };

  const ctx = useMemo<Ctx>(() => ({ reportCover, panHandlers: pan.panHandlers, moving, active: mounted }), [reportCover, pan, moving, mounted]);

  // Ô cửa sổ: từ khung ảnh album ở mini player lớn dần tới toàn màn hình
  // Ô cửa sổ: từ khung ảnh album ở mini player lớn dần tới toàn màn hình.
  // CHỈ dùng transform (dịch + co giãn), không đổi left/top/width/height: đổi kích thước bắt máy tính lại bố cục
  // mỗi khung hình (rất nặng), còn transform thì card đồ hoạ tự làm → mở / đóng player mượt hơn hẳn.
  //  - ô cửa sổ là một khung W×H được co theo chiều ngang sw và chiều dọc sh (hai tỉ lệ khác nhau) để thành đúng
  //    hình chữ nhật cần cắt
  //  - bên trong co ngược chiều dọc lại (sw / sh) để màn player được thu nhỏ đều, không bị méo
  const win = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [ow.value / W, 1]);
    const sh = interpolate(p.value, [0, 1], [oh.value / H, 1]);
    // Bo góc mong muốn (theo điểm ảnh thật), đổi ra đơn vị của khung trước khi co
    const r = radiusAt(p.value);
    return {
      transform: [
        { translateX: interpolate(p.value, [0, 1], [ox.value, 0]) },
        { translateY: interpolate(p.value, [0, 1], [oy.value, 0]) },
        { scaleX: sw },
        { scaleY: sh },
      ],
      borderRadius: r / ((sw + sh) / 2),
    };
  });

  // Bên trong ô cửa sổ: co ngược chiều dọc để cả màn player thu nhỏ đều theo sw
  const inner = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [ow.value / W, 1]);
    const sh = interpolate(p.value, [0, 1], [oh.value / H, 1]);
    return { transform: [{ scaleY: sw / sh }] };
  });
  const screen = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.22, 0.55], [0, 1], 'clamp') }));

  // Ảnh album (vuông, ở đầu) phủ lên, mờ dần để lộ màn player (đóng lại thì hiện dần trở lại).
  // Nằm ngoài ô cửa sổ và tự co giãn đều (không bị kéo méo), bo góc đúng như ảnh ở mini player:
  // lúc thu về mini player sẽ khớp đúng hình tròn / bo góc, không còn bị vuông vuông rồi mới tròn lại
  // Bo góc của lớp cắt bên trong ảnh album bay (bằng lớp ngoài)
  const artClip = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [ow.value / W, 1]);
    const r = radiusAt(p.value);
    return { borderRadius: r / sw };
  });

  const art = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [ow.value / W, 1]);
    const r = radiusAt(p.value);
    return {
      opacity: interpolate(p.value, [0.25, 0.6], [1, 0], 'clamp'),
      borderRadius: r / sw,
      transform: [
        { translateX: interpolate(p.value, [0, 1], [ox.value, 0]) },
        { translateY: interpolate(p.value, [0, 1], [oy.value, 0]) },
        { scale: sw },
      ],
    };
  });

  if (!mounted) return null;


  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents={open ? 'auto' : 'none'}>
      {/* Không tô nền cho khung: nền của khung bị kéo méo theo hai chiều nên ở cuối hiệu ứng thu về thành hình vuông vuông
          (đó là cái ô vuông thấy được trước khi thành hình tròn). Màn player đã có nền riêng bên trong */}
      <Animated.View style={[styles.frame, { width: W, height: H }, win]}>
        <Animated.View style={[styles.innerFrame, { width: W, height: H }, inner]}>
          <TransitionContext.Provider value={ctx}>
            <Animated.View style={[{ width: W, height: H }, screen]} shouldRasterizeIOS={moving} renderToHardwareTextureAndroid={moving}>
              {children}
            </Animated.View>
          </TransitionContext.Provider>
        </Animated.View>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.artShadow, { width: W, height: W }, art]}>
        <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, artClip]}>
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

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', transformOrigin: 'left top' },
  innerFrame: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  // Ảnh album bay: lớp ngoài lo vị trí / co giãn, lớp trong cắt bo góc. Không đổ bóng (giống bong bóng)
  artShadow: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
});
