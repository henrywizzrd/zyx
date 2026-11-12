import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { hapticSnap } from './haptics';
import { beginMotion, endMotion } from './JankMonitor';
import { BlurView } from 'expo-blur';
import Animated, { Easing, interpolate, makeMutable, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { usePlayerPick } from '../player/PlayerProvider';
import { SmartImage } from './Cover';
import { ArtSlab, glassShadow as liftShadow } from './Glass';
import { Freeze } from './Freeze';
import { useTheme } from '../theme/ThemeProvider';
import { useScreenSize } from './ScreenSize';

export type Rect = {
  x: number; y: number; w: number; h: number; r: number;
  slab?: boolean; // điểm xuất phát là bong bóng kiểu khối kính
  // sized: khung player thật sự co / giãn về đúng khung này, và lớp hiệu ứng biến mất NGAY khi thu về xong
  // (nút thật nằm đúng chỗ đó hiện lên thay) — mặc định chỉ bật cho viên thuốc dẹt (dài > 2,2 lần cao)
  sized?: boolean;
  // Khung player nở ra từ (x,y,w,h,r) — vd cả viên mini player; còn ảnh bìa bay riêng từ ô ảnh nhỏ này (nếu có)
  art?: { x: number; y: number; w: number; h: number; r: number };
}; // slab: điểm xuất phát là bong bóng kiểu khối kính

// Nơi bấm để mở player (ảnh album ở mini player hoặc mục Player trên dock).
// Nơi bấm ghi vào đây trước khi đổi tab, hiệu ứng đọc ra để biết phải phóng to từ đâu.
export const playerOrigin: {
  current: Rect | null;
  // Mini player đăng ký hàm này để lúc đóng đo lại vị trí ảnh album ở chỗ hiện tại của nó
  measureLive?: (cb: (r: Rect | null) => void) => void;
} = { current: null };

// Độ mở của player (0 = mini player, 1 = đầy đủ), dùng chung cho lớp làm mờ nền phía sau (BackdropBlur trong App)
export const playerProgress = makeMutable(0);

// Đánh thức màn player TRƯỚC khi mở: ngón tay vừa chạm bong bóng (chưa nhấc lên) là màn player đang ngủ được vẽ lại
// ngay (vẫn ẩn), tới lúc nhấc tay mở ra thì đã sẵn sàng — không còn cảnh nở ra mà thiếu nút, đợi phóng to xong mới hiện
let warmHook: (() => void) | null = null;
export function prewarmPlayer() {
  warmHook?.();
}

type CloseCfg = Parameters<typeof usePanGesture>[0];
type Ctx = {
  reportCover: (r: Rect) => void; // không còn dùng, giữ lại để các file cũ không lỗi
  closeCfg: CloseCfg | null; // cấu hình cử chỉ vuốt xuống để thoát (mỗi vùng <CloseZone> tạo một cử chỉ riêng từ đây)
  // true trong lúc đang phóng to / thu nhỏ (hoặc đang vuốt xuống): màn player nên tạm dừng mọi chuyển động bên trong
  moving: boolean;
  // false khi player đã đóng hẳn (đang ẩn): màn player nên dừng mọi thứ chạy liên tục
  active: boolean;
};
const TransitionContext = createContext<Ctx>({ reportCover: () => {}, closeCfg: null, moving: false, active: true });
export const usePlayerTransition = () => useContext(TransitionContext);

// Vùng cho phép vuốt xuống để thu player (thanh nắm, ảnh bìa, khoảng trống...). Cử chỉ chạy trên luồng giao diện:
// player bám ngón tay 1:1 kể cả khi JS đang bận
export function CloseZone({ children }: { children: React.ReactElement }) {
  const { closeCfg } = useContext(TransitionContext);
  const g = usePanGesture(closeCfg ?? { enabled: false });
  return <GestureDetector gesture={g}>{children}</GestureDetector>;
}

// Nở ra như bong bóng cửa sổ nổi (Xiaomi / OPPO): lò xo hơi nảy nhẹ ở cuối
const SPRING = { damping: 24, stiffness: 210, mass: 1, overshootClamping: true }; // không nảy quá đích

// Mở player như mở app trên iPhone: một ô bo góc từ ảnh album phóng to dần ra tràn màn hình.
// Cả màn player được thu nhỏ đồng đều bên trong ô đó (không bị méo), ô chỉ cắt phần thừa ở dưới.
// Lúc đầu ô hiện ảnh album, ảnh mờ dần để lộ màn player; đóng thì chạy ngược lại.
export function PlayerTransition({ open, onClose, onClosed, onOpened, onReopen, children }: { open: boolean; onClose: () => void; onClosed?: () => void; onOpened?: () => void; onReopen?: () => void; children: React.ReactNode }) {
  const reduced = useReducedMotion(); // "Giảm chuyển động": player chỉ mờ vào / mờ ra, không phóng to từ bong bóng
  const { width: W, height: H } = useScreenSize();
  const { track } = usePlayerPick('track');
  const light = useTheme().theme.colors.glassTint !== 'dark';
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
    endMotion('đã thu về');
    onClosedRef.current?.();
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null;
      if (!openRef.current) setMounted(false);
    }, 600); // gỡ hẳn sau một nhịp (lớp chuyển cảnh đã tự ẩn trên luồng giao diện), tránh đè lên đúng lúc dock / mini player vừa hiện
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
  // ô xuất phát của ảnh bìa bay (mặc định trùng khung player)
  const sized = useSharedValue(0); // 1 = khung thật sự đổi kích thước (xuất phát từ viên thuốc dẹt)
  const liveSV = useSharedValue(0); // 1 = player đang mở / đang thu về (mounted); 0 = đang ẩn chờ (kể cả lúc hâm nóng)
  const ax = useSharedValue(0), ay = useSharedValue(0), aw = useSharedValue(1), ar = useSharedValue(0);

  const openSize = useRef({ W, H }); // kích thước màn hình lúc mở player
  const hRef = useRef(H);
  hRef.current = H;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const reportCover = useCallback(() => {}, []);
  const frozenRef = useRef(false); // cho nhật ký chuyển động: lúc mở, màn player có đang ngủ không
  const warmRef = useRef(false);
  // Trong lúc chuyển cảnh, cả màn player được "chụp" thành một ảnh (rasterize) rồi chỉ việc phóng to / thu nhỏ ảnh đó.
  // Không làm vậy thì mỗi khung hình máy phải vẽ lại toàn bộ: ảnh bìa có mép mờ (mask), chữ phát sáng, nền mờ...
  // bên trong một khung bo góc đang đổi kích thước → tụt khung hình
  const [moving, setMoving] = useState(open);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const stopMoving = useCallback(() => {
    endMotion(openRef.current ? '' : 'thả tay → bật lại mở');
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
      flung.value = 0; // mở lại giữa lúc đang thu theo cú vuốt: lần đóng sau phải chạy bình thường
      let justMounted = false;
      let from = '';
      if (!mountedRef.current) {
        justMounted = true;
        // Giảm chuyển động: "điểm xuất phát" là cả màn hình → không phóng to / dịch chuyển, chỉ còn mờ dần
        const o = reduced ? { x: 0, y: 0, w: W, h: H, r: 0 } : playerOrigin.current ?? { x: W / 2 - 24, y: H - 120, w: 48, h: 48, r: 24 };
        artOff.value = reduced ? 1 : 0;
        ox.value = o.x; oy.value = o.y; ow.value = o.w; oh.value = o.h; or.value = o.r;
        const a = (o as Rect).art ?? o;
        ax.value = a.x; ay.value = a.y; aw.value = a.w; ar.value = a.r;
        const isSized = o.sized ?? (o.h > 0 && o.w / o.h > 2.2);
        sized.value = isSized ? 1 : 0;
        // Ghi nhật ký bằng số thật: đọc lại giá trị chuyển động ngay sau khi gán thì luồng JS còn trả số cũ ("bong bóng 1×1")
        from = `${o.h > 0 && o.w / o.h > 2.2 ? 'từ viên mini player' : isSized ? 'từ bong bóng dock ZYX' : 'từ bong bóng'} ${Math.round(o.w)}×${Math.round(o.h)}`;
        p.value = 0;
        flung.value = 0;
        openSize.current = { W, H };
        setMounted(true);
      }
      setMoving(true);
      beginMotion('mở player', `${justMounted ? from : 'mở lại khi chưa gỡ xong'}${frozenRef.current && !warmRef.current ? ', màn player đang ngủ (phải vẽ lại)' : ''}`);
      p.value = withSpring(1, SPRING, (done) => {
        if (done) runOnJS(stopMoving)();
      });
      // Lưới an toàn: hiệu ứng mở vì lý do gì đó không báo xong thì vẫn tắt trạng thái "đang chuyển".
      // (Kẹt ở trạng thái này thì màn player bị chụp thành ảnh mãi → lời đứng im, mọi thứ nặng hơn)
      const id = setTimeout(stopMoving, 900);
      return () => clearTimeout(id);
    } else if (mountedRef.current) {
      setMoving(true);
      if (!flung.value) beginMotion('đóng player', sized.value ? 'về viên mini player' : 'về bong bóng');
      // Đã xoay màn hình trong lúc mở player (dọc ↔ ngang): chỗ cũ của bong bóng không còn đúng,
      // thu về chỗ mới của bong bóng (tính theo hình học, không đo nên không bị sai)
      const os = openSize.current;
      const o = playerOrigin.current;
      if (o && (Math.abs(os.W - W) > 1 || Math.abs(os.H - H) > 1)) {
        ox.value = o.x; oy.value = o.y; ow.value = o.w; oh.value = o.h; or.value = o.r;
        const a = (o as Rect).art ?? o;
        ax.value = a.x; ay.value = a.y; aw.value = a.w; ar.value = a.r;
      }
      // Thu nhỏ ngay lập tức (không đợi đo vị trí mini player): luồng JS có bận thì hiệu ứng vẫn chạy trên UI thread
      // Đường cong đi tới đích dứt khoát (không bò chậm ở cuối): trước đây đoạn cuối kéo dài, ảnh album còn to hơn
      // bong bóng một chút rồi mới "bụp" thành bong bóng
      // Vuốt xuống thả tay đã tự thu về bằng lò xo mang đà cú vuốt (xem closeCfg) → không chạy lại từ đầu ở đây
      if (!flung.value)
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

  // Vuốt xuống để thoát (chạy trên luồng giao diện): ngón tay kéo tới đâu thì player thu về tới đó.
  // Thả tay: hất nhanh HOẶC kéo đủ xa là đóng — player thu về bằng lò xo nhận đúng vận tốc ngón tay lúc thả
  // (vuốt mạnh thu nhanh, vuốt nhẹ thu chậm, không khựng lúc nhả); chưa đủ thì bật về mở, cũng mang đà
  const flung = useSharedValue(0); // 1 = đang thu về theo cú vuốt
  const artOff = useSharedValue(0); // 1 = giảm chuyển động: không có ảnh bay
  const hV = useSharedValue(H);
  useEffect(() => {
    hV.value = H;
  }, [H]); // eslint-disable-line react-hooks/exhaustive-deps
  const startDrag = useCallback(() => {
    setMoving(true);
    beginMotion('vuốt player xuống');
  }, []);
  const requestClose = useCallback(() => onCloseRef.current(), []);
  const closeCfg = useMemo<CloseCfg>(
    () => ({
      activeOffsetY: 8,
      failOffsetX: [-24, 24],
      onActivate: () => {
        'worklet';
        scheduleOnRN(startDrag);
      },
      onUpdate: (e) => {
        'worklet';
        const t = e.translationY;
        // kéo lên quá đầu: cản lại (dây chun), không văng player lên trên
        p.value = t >= 0 ? 1 - Math.min(1, t / (hV.value * 0.9)) : 1;
      },
      onDeactivate: (e) => {
        'worklet';
        const dist = hV.value * 0.9;
        const v = -e.velocityY / dist; // vận tốc của độ mở (1/giây)
        if (e.translationY > 120 || e.velocityY > 900) {
          flung.value = 1;
          p.value = withSpring(0, { duration: 380, dampingRatio: 1, velocity: v, overshootClamping: true }, (done) => {
            if (done) scheduleOnRN(finishClose);
          });
          scheduleOnRN(hapticSnap);
          scheduleOnRN(requestClose);
        } else
          p.value = withSpring(1, { duration: 400, dampingRatio: 0.8, velocity: v, overshootClamping: true }, (done) => {
            if (done) scheduleOnRN(stopMoving);
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
  // (phải đứng SAU radiusAt: hàm animation nắm biến ngay lúc khai báo, gọi trước khi có là văng app)
  // Bo góc của ảnh bìa bay: từ bo góc ô ảnh nhỏ tới bo góc ảnh lớn
  const artRadiusAt = (pv: number) => {
    'worklet';
    if (ar.value === or.value && aw.value === ow.value) return radiusAt(pv);
    return interpolate(pv, [0, 0.97, 1], [ar.value, 48, 0], 'clamp');
  };


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
    if (sized.value) {
      // Xuất phát từ viên thuốc dẹt (mini player kiểu Apple Music): co giãn hai chiều khác nhau thì bo góc bị méo
      // thành hình chữ nhật góc nhọn → ở đây khung đổi kích thước thật (bên trong chỉ có màn player đặt tuyệt đối,
      // cỡ cố định, nên máy chỉ tính lại đúng khung này), bo góc là bo góc thật, vị trí vẫn đi bằng transform
      return {
        width: W * sw,
        height: H * sh,
        borderRadius: r,
        transform: [
          { translateX: interpolate(p.value, [0, 1], [ox.value, 0]) },
          { translateY: interpolate(p.value, [0, 1], [oy.value, 0]) },
          { scaleX: 1 },
          { scaleY: 1 },
        ],
      };
    }
    return {
      width: W,
      height: H,
      transform: [
        { translateX: interpolate(p.value, [0, 1], [ox.value, 0]) },
        { translateY: interpolate(p.value, [0, 1], [oy.value, 0]) },
        { scaleX: sw },
        { scaleY: sh },
      ],
      borderRadius: r / ((sw + sh) / 2),
    };
  });

  // Bên trong ô cửa sổ: cả màn player thu nhỏ đều theo tỉ lệ k = tỉ lệ LỚN hơn trong hai chiều, rồi ô cắt phần thừa.
  //  - màn dọc: k = sw → player vừa khít bề ngang, thừa ở dưới thì bị cắt (như trước)
  //  - màn ngang: k = sh → player vừa khít chiều cao, thừa bên phải bị cắt. Trước đây vẫn lấy sw nên player nhỏ hơn ô,
  //    dưới đáy ô trống trơn, ảnh bìa bay lại to hơn player → thò ra dưới thành một khối lệch, nhìn rất sượng
  const inner = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [ow.value / W, 1]);
    const sh = interpolate(p.value, [0, 1], [oh.value / H, 1]);
    const k = Math.max(sw, sh);
    if (sized.value) return { transform: [{ scaleX: k }, { scaleY: k }] };
    return { transform: [{ scaleX: k / sw }, { scaleY: k / sh }] };
  });
  const veil = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.04, 0.3, 0.92], [0, 1, 1, 0], 'clamp') }));
  // Thu về hẳn (độ mở ~0): giấu toàn bộ lớp chuyển cảnh ngay trên luồng giao diện, không đợi JS gỡ ra.
  // Trước đây khung player (cỡ viên mini player, phủ lớp nhoè) còn nằm đè lên viên mini player vài giây → thấy viên bị nhoè
  // Chỉ áp cho kiểu viên mini player (dock Apple Music): viên thật hiện dần theo độ mở trên luồng giao diện nên không hở.
  // Bong bóng thì chỉ hiện lại khi JS báo (onClosed) → giấu sớm ở đây là hở một nhịp không có gì (bong bóng nháy)
  const rootVis = useAnimatedStyle(() => ({ opacity: (sized.value || !liveSV.value) && p.value < 0.003 ? 0 : 1 }));
  const screen = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.22, 0.55], [0, 1], 'clamp') }));

  // Ảnh album (vuông, ở đầu) phủ lên, mờ dần để lộ màn player (đóng lại thì hiện dần trở lại).
  // Nằm ngoài ô cửa sổ và tự co giãn đều (không bị kéo méo), bo góc đúng như ảnh ở mini player:
  // lúc thu về mini player sẽ khớp đúng hình tròn / bo góc, không còn bị vuông vuông rồi mới tròn lại
  // Bo góc của lớp cắt bên trong ảnh album bay (bằng lớp ngoài)
  // Ảnh bay là hình vuông cạnh A = cạnh ngắn của màn hình. Màn hình ngang: trước đây lấy cạnh = bề ngang (dài hơn
  // chiều cao) nên ảnh thò ra dưới khung player lúc thu nhỏ → cạnh dưới vuông, trông sượng
  const A = Math.min(W, H);
  const artClip = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [aw.value / A, 1]);
    const r = artRadiusAt(p.value);
    return { borderRadius: r / sw };
  });

  // Mép kính trên ảnh bay: cùng cỡ với ảnh bay (A), bo góc = bo góc bong bóng phóng theo tỉ lệ A / cạnh bong bóng
  const o0 = playerOrigin.current;
  const slabRadius = o0?.slab && o0.w > 0 ? (o0.r * A) / o0.w : 0;
  const slabFade = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.3], [1, 0], 'clamp') }));
  // Bóng đổ của bong bóng cũng hiện dần theo (bong bóng thật có bóng, ảnh bay trước đây không có → bóng "bụp" ra)
  const shadowFade = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.25], [1, 0], 'clamp') }));

  const art = useAnimatedStyle(() => {
    const sw = interpolate(p.value, [0, 1], [aw.value / A, 1]);
    const r = artRadiusAt(p.value);
    return {
      opacity: artOff.value ? 0 : interpolate(p.value, [0.25, 0.6], [1, 0], 'clamp'),
      borderRadius: r / sw,
      transform: [
        { translateX: interpolate(p.value, [0, 1], [ax.value, 0]) },
        { translateY: interpolate(p.value, [0, 1], [ay.value, 0]) },
        { scale: sw },
      ],
    };
  });

  // Player đã mở một lần thì giữ lại (ẩn + đóng băng khi đóng), không gỡ ra rồi dựng lại mỗi lần:
  // dựng cả màn player tốn ~0,3–0,6 giây luồng JS (mở player bị khựng), gỡ ra cũng khựng ~0,3 giây lúc vừa thu về bong bóng
  const everRef = useRef(false);
  if (mounted) everRef.current = true;
  // Dựng sẵn màn player lúc rảnh, ~2,5 giây sau khi mở app (trong suốt, không ai thấy), rồi cho ngủ.
  // Trước đây lần mở player ĐẦU TIÊN sau khi mở app phải dựng cả màn từ đầu → chỉ ~90–100fps; các lần sau đã ~120fps
  const [pre, setPre] = useState(false);
  if (pre) everRef.current = true;
  // Đóng băng sau một nhịp: để màn player kịp nhận active = false (dừng xoay nền, dừng đồng hồ lời...) rồi mới đứng im
  const [frozen, setFrozen] = useState(false);
  const [warm, setWarm] = useState(false);
  frozenRef.current = frozen;
  warmRef.current = warm;
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    warmHook = () => {
      setWarm(true);
      // Chạm rồi kéo đi chỗ khác (không mở): một lúc sau ngủ lại
      if (warmTimer.current) clearTimeout(warmTimer.current);
      warmTimer.current = setTimeout(() => setWarm(false), 2500);
    };
    return () => {
      warmHook = null;
    };
  }, []);
  useEffect(() => {
    if (mounted) return setFrozen(false);
    // Đợi hẳn một lúc sau khi thu về mới đóng băng: đóng băng = ẩn cả cây màn player trên luồng giao diện (tốn vài
    // chục ms) — làm ngay lúc vừa thu về thì rơi đúng khoảnh khắc cuối của chuyển động → thấy khựng một cái
    const id = setTimeout(() => setFrozen(true), 1200);
    return () => clearTimeout(id);
  }, [mounted]);
  useEffect(() => {
    liveSV.value = mounted ? 1 : 0;
  }, [mounted, liveSV]);
  // Hâm nóng (vừa chạm vào mini player, chưa nhấc tay): làm sẵn mọi việc nặng TRƯỚC khi hiệu ứng mở chạy —
  // bỏ đóng băng, hiện lại cả cây màn player (trong suốt, chưa thấy gì), bật active (đồng hồ lời, nền xoay...).
  // Trước đây những việc này dồn vào đúng lúc player bắt đầu nở ra → một khung hình 50–130ms giữa hiệu ứng (~65fps)
  useEffect(() => {
    const t = setTimeout(() => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (ric) ric(() => setPre(true));
      else setPre(true);
    }, 2500);
    return () => clearTimeout(t);
  }, []);
  // Vừa dựng sẵn: thức một lúc cho cả cây kịp vẽ ra, rồi ngủ lại (giống lúc vừa đóng player)
  useEffect(() => {
    if (!pre || mountedRef.current) return;
    setFrozen(false);
    const id = setTimeout(() => {
      if (!mountedRef.current) setFrozen(true);
    }, 1500);
    return () => clearTimeout(id);
  }, [pre]);
  const ready = mounted || warm;
  const ctx = useMemo<Ctx>(() => ({ reportCover, closeCfg, moving, active: ready }), [reportCover, closeCfg, moving, ready]);
  if (!everRef.current) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 50 }, !ready && !pre && styles.gone, rootVis]} pointerEvents={open ? 'auto' : 'box-none'}>
      {/* Không tô nền cho khung: nền của khung bị kéo méo theo hai chiều nên ở cuối hiệu ứng thu về thành hình vuông vuông
          (đó là cái ô vuông thấy được trước khi thành hình tròn). Màn player đã có nền riêng bên trong */}
      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.frame, { width: W, height: H }, win]}>
        <Animated.View style={[styles.innerFrame, { width: W, height: H }, inner]}>
          <TransitionContext.Provider value={ctx}>
            <Animated.View style={[{ width: W, height: H }, screen]} shouldRasterizeIOS={moving} renderToHardwareTextureAndroid={moving}>
              <Freeze freeze={frozen && !mounted && !warm}>{children}</Freeze>
            </Animated.View>
            {/* Nhoè chuyển động: lúc mới nở ra màn player mờ nhoè, nét dần khi gần to hẳn (đóng thì ngược lại) —
                mắt thấy chuyển động liền mạch hơn, che luôn những khung hình chưa kịp vẽ */}
            {Platform.OS === 'ios' && (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, veil]}>
                <BlurView intensity={40} tint={light ? "light" : "dark"} style={StyleSheet.absoluteFill} />
              </Animated.View>
            )}
          </TransitionContext.Provider>
        </Animated.View>
      </Animated.View>
      {/* Đang thu về mà chạm vào ảnh đang bay: mở ngược ra lại từ đúng chỗ đó, không phải đợi thu xong */}
      <Animated.View
        pointerEvents={!open && mounted && onReopen ? 'auto' : 'none'}
        onTouchStart={!open && mounted ? onReopen : undefined}
        style={[styles.artShadow, { width: A, height: A }, art]}
      >
        {slabRadius > 0 && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { borderRadius: slabRadius, borderCurve: 'continuous' }, liftShadow(1.15 * (A / (o0?.w || A)), light), shadowFade]}
          />
        )}
        <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, artClip]}>
          {track.thumb ? (
            <>
              <Image source={{ uri: track.thumb }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              <SmartImage url={track.thumb} size={600} style={StyleSheet.absoluteFill} />
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: track.color }]} />
          )}
          {/* Gần về tới bong bóng: mép kính (viền, mép vát, vành khúc xạ) hiện dần trên ảnh bay, đúng tỉ lệ với bong bóng,
              nên lúc đổi sang bong bóng thật không còn nhịp "ảnh trơn rồi mới có viền" */}
          {slabRadius > 0 && (
            <Animated.View style={[StyleSheet.absoluteFill, slabFade]}>
              <ArtSlab track={track} size={A} radius={slabRadius} />
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', transformOrigin: 'left top' },
  innerFrame: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  // Ảnh album bay: lớp ngoài lo vị trí / co giãn, lớp trong cắt bo góc. Không đổ bóng (giống bong bóng)
  artShadow: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  // Player đã đóng: ẩn hẳn (vẫn giữ trong bộ nhớ)
  gone: { display: 'none' },
});
