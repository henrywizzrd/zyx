import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { computeSlots, Geometry, moveId, Rect, slotIndexAt } from './gridLayout';

export type ScrollRef = React.ComponentRef<typeof ScrollView>;

const USE_NATIVE = Platform.OS !== 'web';
const LONG_PRESS_MS = 300;
const EDGE = 110; // ngón tay cách mép màn hình bao nhiêu px thì bắt đầu tự cuộn
const MAX_SPEED = 16; // px mỗi 16ms
const CARD_INSET = 8; // thẻ nổi lớn hơn ô gốc mỗi phía bấy nhiêu px
const CARD_COLOR = '#2E2E2E';
const MOVE_SPRING = { friction: 8, tension: 120 }; // các ô trượt chừa chỗ
const LAND_SPRING = { friction: 7, tension: 90 }; // thẻ vừa thả bay vào ô của nó
const EPS = 0.5;

// Mỗi ô giữ các giá trị animated riêng. Vị trí của ô luôn là một toạ độ tuyệt đối
// trong container (pos), nên đổi thứ tự chỉ là đổi toạ độ đích, không có thay đổi
// layout nào cần đồng bộ với animation.
interface Cell {
  pos: Animated.ValueXY;
  scale: Animated.Value;
  lift: Animated.Value; // 0 = nằm trên mặt bàn, 1 = đã nhấc lên
  target: { x: number; y: number }; // toạ độ đích gần nhất đã đặt cho ô
}

interface Props<T extends { id: string }> {
  data: T[];
  enabled: boolean;
  // Mô tả lưới (columns = 1 là dạng danh sách)
  columns: number;
  cellWidth: number;
  gapX: number;
  gapY: number;
  renderItem: (item: T) => React.ReactNode;
  onReorder: (ids: string[]) => void;
  // Dùng để tắt cuộn khi đang kéo và tự cuộn khi kéo sát mép
  scrollRef: React.RefObject<ScrollRef | null>;
  scrollY: React.RefObject<number>;
  setScrollEnabled: (enabled: boolean) => void;
}

export function Reorderable<T extends { id: string }>({
  data,
  enabled,
  columns,
  cellWidth,
  gapX,
  gapY,
  renderItem,
  onReorder,
  scrollRef,
  scrollY,
  setScrollEnabled,
}: Props<T>) {
  const { theme } = useTheme();
  const { height: winH } = useWindowDimensions();

  const ids = useMemo(() => data.map((d) => d.id), [data]);
  const geom = useMemo<Geometry>(
    () => ({ columns, cellWidth, gapX, gapY }),
    [columns, cellWidth, gapX, gapY]
  );

  // Chiều cao thật của từng ô, đo bằng onLayout (phụ thuộc cỡ chữ, kiểu hiển thị...)
  const heights = useRef<Record<string, number>>({});
  const lastH = useRef(0); // dùng tạm cho ô mới chưa đo
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false); // ẩn danh sách tới khi đo xong lần đầu
  const [activeId, setActiveId] = useState<string | null>(null);

  const cells = useRef<Record<string, Cell>>({});
  const armed = useRef<string | null>(null); // đã giữ đủ lâu trên mục này, sẵn sàng kéo
  const dragging = useRef(false); // đang kéo thật sự
  const scroll0 = useRef(0);
  const finger = useRef({ x: 0, y: 0 });
  const gesture = useRef({ dx: 0, dy: 0 });
  const baseOrder = useRef<string[]>([]); // thứ tự lúc bắt đầu kéo
  const hyp = useRef<string[]>([]); // thứ tự giả định theo vị trí ngón tay hiện tại
  const origin = useRef({ x: 0, y: 0 }); // toạ độ ô của mục đang kéo lúc bắt đầu
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const layoutFor = (order: string[]) => computeSlots(order, heights.current, lastH.current, geom);

  // Toạ độ ô theo thứ tự hiện tại của data
  const slots = useMemo(() => {
    const { rects, totalHeight } = computeSlots(ids, heights.current, lastH.current, geom);
    const byId: Record<string, Rect> = {};
    ids.forEach((id, i) => {
      byId[id] = rects[i];
    });
    return { byId, totalHeight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, geom, version]);

  // PanResponder chỉ tạo một lần nên đọc giá trị mới nhất qua ref
  const latest = useRef({ ids, layoutFor, geom, onReorder, winH, enabled, scrollRef, setScrollEnabled });
  latest.current = { ids, layoutFor, geom, onReorder, winH, enabled, scrollRef, setScrollEnabled };

  const getCell = (id: string, s: Rect): Cell => {
    let c = cells.current[id];
    if (!c) {
      c = {
        pos: new Animated.ValueXY({ x: s.x, y: s.y }),
        scale: new Animated.Value(1),
        lift: new Animated.Value(0),
        target: { x: s.x, y: s.y },
      };
      cells.current[id] = c;
    }
    return c;
  };

  const springTo = (id: string, to: { x: number; y: number }) => {
    const c = cells.current[id];
    if (!c) return;
    c.target = { x: to.x, y: to.y };
    Animated.spring(c.pos, {
      toValue: { x: to.x, y: to.y },
      ...MOVE_SPRING,
      useNativeDriver: USE_NATIVE,
    }).start();
  };

  // Đưa mọi ô (trừ ô đang kéo) về đúng chỗ theo thứ tự `order`
  const arrange = (order: string[], skipId: string | null) => {
    const { rects } = latest.current.layoutFor(order);
    order.forEach((id, i) => {
      if (id === skipId) return;
      const c = cells.current[id];
      const r = rects[i];
      if (!c || !r) return;
      if (Math.abs(c.target.x - r.x) < EPS && Math.abs(c.target.y - r.y) < EPS) return;
      springTo(id, r);
    });
  };

  // Cập nhật vị trí mục đang kéo và thứ tự giả định
  const refresh = () => {
    const id = armed.current;
    if (!id) return;
    const c = cells.current[id];
    if (!c) return;
    const { dx, dy } = gesture.current;
    const sy = (scrollY.current ?? 0) - scroll0.current;
    c.pos.setValue({ x: origin.current.x + dx, y: origin.current.y + dy + sy });

    // Ô đích là ô có tâm gần tâm của thẻ đang kéo nhất
    const { layoutFor: lf, geom: g } = latest.current;
    const { rects } = lf(hyp.current);
    const h = heights.current[id] ?? lastH.current;
    const idx = slotIndexAt(
      rects,
      origin.current.x + g.cellWidth / 2 + dx,
      origin.current.y + h / 2 + dy + sy
    );
    if (idx < 0 || idx === hyp.current.indexOf(id)) return;
    hyp.current = moveId(hyp.current, id, idx);
    arrange(hyp.current, id);
  };

  const stopAutoScroll = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const startAutoScroll = () => {
    stopAutoScroll();
    timer.current = setInterval(() => {
      const h = latest.current.winH;
      const fy = finger.current.y;
      let v = 0;
      if (fy < EDGE) v = -MAX_SPEED * Math.min(1, (EDGE - fy) / EDGE);
      else if (fy > h - EDGE) v = MAX_SPEED * Math.min(1, (fy - (h - EDGE)) / EDGE);
      if (v === 0) return;
      latest.current.scrollRef.current?.scrollTo({ y: Math.max(0, (scrollY.current ?? 0) + v), animated: false });
      refresh();
    }, 16);
  };

  // Chỉ bỏ thẻ nổi khi không có mục nào khác vừa được nhấc lên thay thế
  const settle = () => {
    if (armed.current === null) setActiveId(null);
  };

  // Giữ đủ lâu: nhấc thẻ lên khỏi mặt bàn
  const arm = (id: string) => {
    const L = latest.current;
    if (!L.enabled || armed.current) return;
    const idx = L.ids.indexOf(id);
    const c = cells.current[id];
    if (idx < 0 || !c) return;
    const slot = L.layoutFor(L.ids).rects[idx];
    armed.current = id;
    baseOrder.current = L.ids;
    hyp.current = L.ids;
    origin.current = { x: slot.x, y: slot.y };
    gesture.current = { dx: 0, dy: 0 };
    scroll0.current = scrollY.current ?? 0;
    setActiveId(id);
    L.setScrollEnabled(false);
    Animated.parallel(
      [
        Animated.spring(c.scale, { toValue: 1.05, friction: 6, useNativeDriver: USE_NATIVE }),
        Animated.spring(c.lift, { toValue: 1, friction: 7, useNativeDriver: USE_NATIVE }),
      ],
      { stopTogether: false }
    ).start();
  };

  // Nhả tay mà chưa kéo thì đặt thẻ xuống lại
  const disarm = () => {
    if (dragging.current || armed.current === null) return;
    const id = armed.current;
    armed.current = null;
    latest.current.setScrollEnabled(true);
    const c = cells.current[id];
    if (!c) {
      setActiveId(null);
      return;
    }
    Animated.parallel(
      [
        Animated.spring(c.scale, { toValue: 1, useNativeDriver: USE_NATIVE }),
        Animated.timing(c.lift, { toValue: 0, duration: 160, useNativeDriver: USE_NATIVE }),
      ],
      { stopTogether: false }
    ).start(settle);
  };

  const finish = (cancelled: boolean) => {
    stopAutoScroll();
    const id = armed.current;
    armed.current = null;
    dragging.current = false;
    latest.current.setScrollEnabled(true);

    if (!id) {
      setActiveId(null);
      return;
    }

    const finalOrder = cancelled ? baseOrder.current : hyp.current;
    const slot = latest.current.layoutFor(finalOrder).rects[finalOrder.indexOf(id)];
    const c = cells.current[id];

    // Các ô khác đã (hoặc đang) trượt về đúng chỗ cuối cùng; đảm bảo chắc chắn
    arrange(finalOrder, id);

    // Thẻ vừa thả bay thẳng từ chỗ ngón tay vào ô của nó, không có bước nhảy nào
    if (c && slot) {
      c.target = { x: slot.x, y: slot.y };
      Animated.parallel(
        [
          Animated.spring(c.pos, {
            toValue: { x: slot.x, y: slot.y },
            ...LAND_SPRING,
            useNativeDriver: USE_NATIVE,
          }),
          Animated.spring(c.scale, { toValue: 1, useNativeDriver: USE_NATIVE }),
          Animated.timing(c.lift, { toValue: 0, duration: 260, useNativeDriver: USE_NATIVE }),
        ],
        { stopTogether: false }
      ).start(settle);
    } else {
      setActiveId(null);
    }

    // Báo thứ tự mới ra ngoài. Toạ độ đích đã khớp với thứ tự mới nên khi data đổi
    // theo, không có ô nào phải di chuyển thêm.
    if (finalOrder.some((x, i) => x !== baseOrder.current[i])) {
      latest.current.onReorder(finalOrder);
    }
  };

  const responder = useRef(
    PanResponder.create({
      // Chỉ nhận cử chỉ kéo sau khi đã giữ lâu, để cuộn bình thường vẫn hoạt động
      onMoveShouldSetPanResponder: () => armed.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        finger.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        startAutoScroll();
      },
      onPanResponderMove: (_, g) => {
        gesture.current = { dx: g.dx, dy: g.dy };
        finger.current = { x: g.moveX, y: g.moveY };
        refresh();
      },
      onPanResponderRelease: () => finish(false),
      onPanResponderTerminate: () => finish(true),
    })
  ).current;

  // Đồng bộ toạ độ đích khi data hoặc hình học đổi từ bên ngoài (đổi kiểu hiển thị,
  // lọc, sắp xếp A-Z, đo xong chiều cao...). Không đụng vào gì trong lúc đang kéo.
  const prevGeomKey = useRef('');
  useLayoutEffect(() => {
    // Dọn các ô không còn trong data
    const alive = new Set(ids);
    for (const k of Object.keys(cells.current)) {
      if (!alive.has(k) && k !== armed.current && k !== activeId) delete cells.current[k];
    }
    if (armed.current) return;

    const geomKey = `${geom.columns}|${geom.cellWidth}|${geom.gapX}|${geom.gapY}|${version}`;
    const geomChanged = prevGeomKey.current !== geomKey;
    prevGeomKey.current = geomKey;

    for (const id of ids) {
      const c = cells.current[id];
      const s = slots.byId[id];
      if (!c || !s) continue;
      if (Math.abs(c.target.x - s.x) < EPS && Math.abs(c.target.y - s.y) < EPS) continue;
      if (geomChanged) {
        // Kích thước đổi thì nhảy thẳng tới chỗ mới, không animate
        c.target = { x: s.x, y: s.y };
        c.pos.stopAnimation();
        c.pos.setValue({ x: s.x, y: s.y });
      } else {
        springTo(id, s);
      }
    }
  }, [ids, slots, geom, version, activeId]);

  // Hiện danh sách sau khi mọi ô đã được đo lần đầu
  useEffect(() => {
    if (!ready && ids.every((id) => heights.current[id] !== undefined)) setReady(true);
  }, [ready, ids, version]);

  const onCellLayout = (id: string, h: number) => {
    if (Math.abs((heights.current[id] ?? -1) - h) < EPS) return;
    heights.current[id] = h;
    lastH.current = h;
    setVersion((v) => v + 1);
  };

  return (
    <View
      collapsable={false}
      {...responder.panHandlers}
      style={{ height: slots.totalHeight, opacity: ready ? 1 : 0 }}
    >
      {data.map((item) => {
        const slot = slots.byId[item.id];
        const cell = getCell(item.id, slot);
        const isActive = item.id === activeId;
        return (
          <Animated.View
            key={item.id}
            onLayout={(e) => onCellLayout(item.id, e.nativeEvent.layout.height)}
            style={[
              styles.cell,
              {
                width: geom.cellWidth,
                zIndex: isActive ? 50 : 0,
                transform: [{ translateX: cell.pos.x }, { translateY: cell.pos.y }, { scale: cell.scale }],
              },
            ]}
          >
            {isActive && (
              // Thẻ nổi: nền sáng hơn, bo 4 góc, có bóng đổ, lớn hơn ô gốc một chút
              <Animated.View
                pointerEvents="none"
                style={[styles.card, { borderColor: theme.colors.accent, opacity: cell.lift }]}
              />
            )}
            <Pressable
              onLongPress={enabled ? () => arm(item.id) : undefined}
              delayLongPress={LONG_PRESS_MS}
              onPressOut={disarm}
            >
              {renderItem(item)}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  card: {
    position: 'absolute',
    top: -CARD_INSET,
    left: -CARD_INSET,
    right: -CARD_INSET,
    bottom: -CARD_INSET,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: CARD_COLOR,
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
});
