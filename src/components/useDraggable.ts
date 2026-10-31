import { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, PanResponder, Platform, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { Position } from '../theme/types';
import { targetPosition } from './layout';

const USE_NATIVE = Platform.OS !== 'web';
const MERGE_PAD = 12; // ngón tay cách khối kia bao nhiêu px thì tính là chạm để hợp nhất
const LONG_PRESS_MS = 300;

type Rect = { x: number; y: number; w: number; h: number };

function isOver(r: Rect | null, px: number, py: number) {
  if (!r) return false;
  return px > r.x - MERGE_PAD && px < r.x + r.w + MERGE_PAD && py > r.y - MERGE_PAD && py < r.y + r.h + MERGE_PAD;
}

export function useDraggable(kind: 'dock' | 'player') {
  const { theme, setDockPosition, setMiniPlayerPosition, setMerged } = useTheme();
  const { dockRef, playerRef, drag, setDrag } = usePlayer();
  const { width, height } = useWindowDimensions();

  const selfRef = kind === 'dock' ? dockRef : playerRef;
  const otherRef = kind === 'dock' ? playerRef : dockRef;
  const position = kind === 'dock' ? theme.dock.position : theme.miniPlayer.position;
  const setPosition = kind === 'dock' ? setDockPosition : setMiniPlayerPosition;

  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const armed = useRef(false); // đã giữ đủ lâu, sẵn sàng kéo
  const dragging = useRef(false); // đang kéo thật sự
  const start = useRef({ cx: 0, cy: 0 });
  const otherRect = useRef<Rect | null>(null);
  const target = useRef<Position | 'merge' | null>(null);
  const landFrom = useRef<{ cx: number; cy: number } | null>(null);

  // PanResponder chỉ tạo một lần nên cần đọc giá trị mới nhất qua ref
  const latest = useRef({ width, height, position });
  latest.current = { width, height, position };

  const active = drag?.kind === kind;
  const merging = !!drag && drag.kind !== kind && drag.target === 'merge';

  // Nổi lên và phóng nhẹ khi đang giữ/kéo, hoặc khi khối kia đang kéo tới để hợp nhất
  useEffect(() => {
    Animated.spring(scale, { toValue: active || merging ? 1.08 : 1, friction: 6, useNativeDriver: USE_NATIVE }).start();
  }, [active, merging, scale]);

  const snapBack = () => {
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: USE_NATIVE }).start();
  };

  const finish = (dx: number, dy: number) => {
    const t = target.current;
    dragging.current = false;
    armed.current = false;
    target.current = null;

    if (t === 'merge') {
      const r = otherRect.current;
      if (kind === 'player' && r) {
        // Bay vào giữa dock, nhỏ dần rồi hợp nhất
        const tx = r.x + r.w / 2 - start.current.cx;
        const ty = r.y + r.h / 2 - start.current.cy;
        Animated.parallel([
          Animated.timing(pan, { toValue: { x: tx, y: ty }, duration: 200, useNativeDriver: USE_NATIVE }),
          Animated.timing(scale, { toValue: 0.3, duration: 200, useNativeDriver: USE_NATIVE }),
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: USE_NATIVE }),
        ]).start(() => {
          setMerged(true);
          setDrag(null);
        });
      } else {
        // Dock thả lên mini player: mini player được nhập vào dock
        setMerged(true);
        setDrag(null);
        snapBack();
      }
      return;
    }

    if (t && t !== latest.current.position) {
      landFrom.current = { cx: start.current.cx + dx, cy: start.current.cy + dy };
      setPosition(t);
      setDrag(null);
      return;
    }

    setDrag(null);
    snapBack();
  };

  const cancel = () => {
    dragging.current = false;
    armed.current = false;
    target.current = null;
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
        const { width: W, height: H } = latest.current;
        const next: Position | 'merge' = isOver(otherRect.current, g.moveX, g.moveY)
          ? 'merge'
          : targetPosition(g.moveX, g.moveY, W, H);
        if (target.current !== next) {
          target.current = next;
          setDrag({ kind, target: next });
        }
      },
      onPanResponderRelease: (_, g) => finish(g.dx, g.dy),
      onPanResponderTerminate: () => cancel(),
    })
  ).current;

  // Gọi khi giữ đủ lâu: đo vị trí của mình và của khối kia, rồi bật hiệu ứng nổi lên
  const arm = () => {
    if (armed.current) return;
    armed.current = true;
    target.current = null;
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
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 7, tension: 90, useNativeDriver: USE_NATIVE }).start();
    });
  }, [position]);

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