import { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, LayoutAnimation, PanResponder, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useDrag, usePlayerPick } from '../player/PlayerProvider';
import { Edge, MiniAnchor, Position } from '../theme/types';
import { DOCK_GAP, DOCK_PADDING, dockCell, targetAnchor, targetPosition, useFrame } from './layout';
import { log } from '../data/applog';

const USE_NATIVE = Platform.OS !== 'web';
const MERGE_PAD = 12; // ngón tay cách khối kia bao nhiêu px thì tính là chạm để hợp nhất
const LONG_PRESS_MS = 300;

type Rect = { x: number; y: number; w: number; h: number };
type Target = Position | MiniAnchor | 'merge';

function isOver(r: Rect | null, px: number, py: number) {
  if (!r) return false;
  return px > r.x - MERGE_PAD && px < r.x + r.w + MERGE_PAD && py > r.y - MERGE_PAD && py < r.y + r.h + MERGE_PAD;
}

const anchorKey = (a: MiniAnchor, digits: number) => `${a.edge}:${a.t.toFixed(digits)}`;
const targetKey = (t: Target) => (typeof t === 'string' ? t : anchorKey(t, 2));

// kind 'dock': dock nhảy giữa 8 vị trí cố định. kind 'player': mini player nằm tự do dọc viền màn hình.
// live: chỉ mini player dùng. Vị trí đang hiển thị nằm ở state cục bộ của MiniPlayer (đổi tức thì, nhẹ),
// còn theme (làm cả app vẽ lại và ghi ổ đĩa) được cập nhật sau.
//  - origin: tâm ảnh album trên màn hình (tính từ hình học, không đo)
//  - drop: thả ở chỗ mới; MiniPlayer tự lo hiệu ứng trượt vào chỗ
export interface LiveAnchor {
  anchor: MiniAnchor;
  origin: () => { cx: number; cy: number };
  drop: (a: MiniAnchor, dx: number, dy: number) => void;
}

// Dock giãn ra / co lại êm khi thêm / bớt mục Player (không nảy)
export const DOCK_RESIZE = {
  duration: 280,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

// Tâm của ô cuối dock SAU khi dock đã giãn thêm một ô (dock căn giữa thì giãn đều hai đầu,
// dính góc trên thì giãn xuống, dính góc dưới thì giãn lên)
function mergeSlot(r: { x: number; y: number; w: number; h: number }, pos: Position, labels: boolean) {
  const cell = dockCell(pos, labels);
  const step = cell.main + DOCK_GAP;
  const endOff = DOCK_PADDING + cell.main / 2;
  if (pos === 'top' || pos === 'bottom') return { x: r.x + r.w + step / 2 - endOff, y: r.y + r.h / 2 };
  const grow = pos === 'left' || pos === 'right' ? step / 2 : pos.startsWith('top') ? step : 0;
  return { x: r.x + r.w / 2, y: r.y + r.h + grow - endOff };
}

export function useDraggable(kind: 'dock' | 'player', live?: LiveAnchor) {
  const { theme, landscape, setDockPosition, setMiniPlayerAnchor, setMerged } = useTheme();
  const landRef = useRef(landscape);
  landRef.current = landscape;
  const { dockRef, playerRef } = usePlayerPick('dockRef', 'playerRef');
  const { drag, setDrag } = useDrag();
  const { width, height, left } = useFrame();
  const insets = useSafeAreaInsets();

  const selfRef = kind === 'dock' ? dockRef : playerRef;
  const otherRef = kind === 'dock' ? playerRef : dockRef;
  const anchor = live?.anchor ?? theme.miniPlayer.anchor;
  const position: Position | MiniAnchor = kind === 'dock' ? theme.dock.position : anchor;
  const akey = kind === 'dock' ? theme.dock.position : anchorKey(anchor, 3);
  const posKey = akey;

  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const armed = useRef(false); // đã giữ đủ lâu, sẵn sàng kéo
  const dragging = useRef(false); // đang kéo thật sự
  const start = useRef({ cx: 0, cy: 0 });
  const otherRect = useRef<Rect | null>(null);
  const target = useRef<Target | null>(null);
  const lastKey = useRef<string | null>(null);
  const lastEdge = useRef<Edge | undefined>(undefined);
  const landFrom = useRef<{ cx: number; cy: number } | null>(null);

  // PanResponder chỉ tạo một lần nên cần đọc giá trị mới nhất qua ref
  const latest = useRef({ width, height, left, position, posKey, insets, margin: theme.dock.style.margin, live, akey, dockPos: theme.dock.position, dockLabels: theme.dock.labels });
  latest.current = { width, height, left, position, posKey, insets, margin: theme.dock.style.margin, live, akey, dockPos: theme.dock.position, dockLabels: theme.dock.labels };

  const active = drag?.kind === kind;
  const merging = !!drag && drag.kind !== kind && drag.target === 'merge';

  // Nổi lên và phóng nhẹ khi đang giữ/kéo, hoặc khi khối kia đang kéo tới để hợp nhất
  useEffect(() => {
    Animated.timing(scale, { toValue: active || merging ? 1.06 : 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [active, merging, scale]);

  const snapBack = () => {
    if (latest.current.live) {
      // Mini player: trượt về chỗ cũ, không nảy
      Animated.timing(pan, { toValue: { x: 0, y: 0 }, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
      return;
    }
    Animated.timing(pan, { toValue: { x: 0, y: 0 }, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  };

  const reset = () => {
    dragging.current = false;
    armed.current = false;
    target.current = null;
    lastKey.current = null;
    lastEdge.current = undefined;
  };

  const finish = (dx: number, dy: number) => {
    const t = target.current;
    reset();

    if (t === 'merge') {
      const r = otherRect.current;
      if (kind === 'player' && r) {
        // Bay thẳng vào đúng ô cuối của dock (chỗ mục Player sẽ hiện ra), nhỏ dần và mờ ở đoạn cuối,
        // rồi dock giãn ra êm (LayoutAnimation) và mục Player hiện dần đúng tại chỗ bong bóng vừa đáp xuống
        const { x: cx, y: cy } = mergeSlot(r, latest.current.dockPos, latest.current.dockLabels);
        const tx = cx - start.current.cx;
        const ty = cy - start.current.cy;
        log('ui', 'thả mini player vào dock');
        const ease = Easing.inOut(Easing.cubic);
        Animated.parallel([
          Animated.timing(pan, { toValue: { x: tx, y: ty }, duration: 280, easing: ease, useNativeDriver: USE_NATIVE }),
          Animated.timing(scale, { toValue: 0.55, duration: 280, easing: ease, useNativeDriver: USE_NATIVE }),
          Animated.timing(opacity, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: USE_NATIVE }),
        ]).start(() => {
          if (Platform.OS !== 'web') LayoutAnimation.configureNext(DOCK_RESIZE);
          setMerged(true);
          setDrag(null);
        });
      } else {
        // Dock thả lên mini player: mini player được nhập vào dock
        if (Platform.OS !== 'web') LayoutAnimation.configureNext(DOCK_RESIZE);
        setMerged(true);
        setDrag(null);
        snapBack();
      }
      return;
    }

    // Mini player: thả ở đâu nằm ở đó (dán vào viền gần nhất)
    if (t && typeof t !== 'string') {
      if (anchorKey(t, 3) !== latest.current.akey) {
        const live = latest.current.live;
        if (live) live.drop(t, dx, dy);
        else {
          landFrom.current = { cx: start.current.cx + dx, cy: start.current.cy + dy };
          setMiniPlayerAnchor(t);
        }
        setDrag(null);
        return;
      }
      setDrag(null);
      snapBack();
      return;
    }

    // Dock: nhảy tới một trong 8 vị trí
    if (t && t !== latest.current.position) {
      landFrom.current = { cx: start.current.cx + dx, cy: start.current.cy + dy };
      setDockPosition(t);
      setDrag(null);
      return;
    }

    setDrag(null);
    snapBack();
  };

  const cancel = () => {
    reset();
    setDrag(null);
    snapBack();
  };

  const responder = useRef(
    PanResponder.create({
      // Chỉ nhận cử chỉ kéo sau khi đã giữ lâu, để các nút bên trong vẫn bấm bình thường
      onMoveShouldSetPanResponder: () => armed.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = true;
      },
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        const { width: W, height: H, left: L, insets: ins, margin } = latest.current;
        let next: Target;
        if (isOver(otherRect.current, g.moveX, g.moveY)) next = 'merge';
        else if (kind === 'dock') next = targetPosition(g.moveX - L, g.moveY, W, H);
        else {
          next = targetAnchor(g.moveX - L, g.moveY, W, H, ins, margin, lastEdge.current);
          lastEdge.current = next.edge;
        }

        const key = targetKey(next);
        if (lastKey.current !== key) {
          lastKey.current = key;
          target.current = next;
          setDrag({ kind, target: next });
        }
      },
      onPanResponderRelease: (_, g) => {
        // Ném có quán tính (như tấm kính trượt trên mặt bàn): đoán chỗ nó sẽ trượt tới theo vận tốc lúc buông tay,
        // rồi chọn vị trí theo chỗ đó thay vì chỗ ngón tay đang đứng
        if (kind === 'player' && target.current !== 'merge') {
          const K = 240; // ms — quãng trượt ≈ vận tốc × K (ma sát mặt bàn)
          const { width: W, height: H, left: L, insets: ins, margin } = latest.current;
          const px = Math.max(0, Math.min(W, g.moveX - L + g.vx * K));
          const py = Math.max(0, Math.min(H, g.moveY + g.vy * K));
          if (Math.hypot(g.vx, g.vy) > 0.25 && !isOver(otherRect.current, px + L, py)) {
            const next = targetAnchor(px, py, W, H, ins, margin, lastEdge.current);
            target.current = next;
            lastKey.current = targetKey(next);
          }
        }
        finish(g.dx, g.dy);
      },
      onPanResponderTerminate: () => cancel(),
    })
  ).current;

  // Gọi khi giữ đủ lâu: đo vị trí của mình và của khối kia, rồi bật hiệu ứng nổi lên
  const arm = () => {
    // Màn hình ngang: dock và mini player nằm cố định (cạnh phải / góc dưới phải), không kéo đổi chỗ
    if (armed.current || landRef.current) return;
    armed.current = true;
    target.current = null;
    lastKey.current = null;
    if (latest.current.live) start.current = latest.current.live.origin();
    else
      selfRef.current?.measureInWindow((x, y, w, h) => {
        start.current = { cx: x + w / 2, cy: y + h / 2 };
      });
    if (otherRef.current) {
      otherRef.current.measureInWindow((x, y, w, h) => {
        otherRect.current = { x, y, w, h };
      });
    } else {
      otherRect.current = null;
    }
    setDrag({ kind, target: latest.current.position });
  };

  // Nhả tay mà chưa kéo thì tắt hiệu ứng
  const disarm = () => {
    if (dragging.current || !armed.current) return;
    armed.current = false;
    setDrag(null);
  };

  // Sau khi đổi vị trí: bay mượt từ chỗ vừa thả sang vị trí mới
  useLayoutEffect(() => {
    const from = landFrom.current;
    if (!from) return;
    landFrom.current = null;
    pan.stopAnimation();
    pan.setValue({ x: 0, y: 0 });
    opacity.setValue(0);
    selfRef.current?.measureInWindow((x, y, w, h) => {
      pan.setValue({ x: from.cx - (x + w / 2), y: from.cy - (y + h / 2) });
      opacity.setValue(1);
      // Trượt về chỗ mới như vật có khối lượng: lò xo giảm chấn tới hạn, tới nơi là dừng (không vượt, không nảy)
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, stiffness: 140, damping: 24, mass: 1, overshootClamping: true, useNativeDriver: USE_NATIVE }).start();
    });
  }, [posKey]);

  return {
    pan,
    scale,
    opacity,
    active,
    merging,
    zIndex: active ? 30 : kind === 'dock' ? 5 : 10,
    panHandlers: responder.panHandlers,
    pressProps: { onLongPress: arm, delayLongPress: LONG_PRESS_MS, onPressOut: disarm },
  };
}
