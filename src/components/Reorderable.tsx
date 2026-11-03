import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, useLongPressGesture } from 'react-native-gesture-handler';
import Animated, {
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { computeSlots, Geometry, GridResult, moveId, slotIndexAt } from './gridLayout';
import { useReorderContext } from './ReorderableScrollView';

// Danh sách/lưới kéo thả đổi thứ tự. Phải nằm trong ReorderableScrollView.
//
// Mọi thứ liên quan tới kéo chạy trên UI thread:
//  - Mỗi ô có toạ độ (px, py) là shared value, luôn là toạ độ tuyệt đối trong container.
//    Đổi thứ tự chỉ là đổi toạ độ đích, không có thay đổi layout thật nào.
//  - Ngón giữ thẻ do ReorderableScrollView theo dõi riêng (theo id), nên ngón thứ hai
//    chạm vào màn hình để cuộn không làm thẻ bị giật.
//  - JS thread chỉ được gọi khi thả tay xong (onReorder).

const LONG_PRESS_MS = 300;
const CARD_INSET = 8; // thẻ nổi lớn hơn ô gốc mỗi phía bấy nhiêu px
const MOVE_SPRING = { damping: 20, stiffness: 220, mass: 1 }; // các ô trượt chừa chỗ / thẻ vừa thả bay vào ô
const LIFT_SPRING = { damping: 14, stiffness: 220, mass: 1 };
const LIFT_SCALE = 1.05;
const EPS = 0.5;

// Các shared value dùng chung giữa Reorderable và từng ô
interface Shared {
  hypOrder: SharedValue<string[]>; // thứ tự giả định theo vị trí ngón tay hiện tại
  layout: Readonly<SharedValue<GridResult>>; // toạ độ các ô theo hypOrder
  dragId: SharedValue<string | null>; // ô đang bám theo ngón tay
  activeId: SharedValue<string | null>; // ô đang nổi (kể cả lúc đang bay vào chỗ sau khi thả)
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  scale: SharedValue<number>;
  lift: SharedValue<number>; // 0 = nằm trên mặt bàn, 1 = đã nhấc lên
  animate: SharedValue<boolean>; // false khi chưa đo xong: đặt ô thẳng vào chỗ, không animate
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
  // Chiều cao dự đoán của mỗi ô (khi các ô cao bằng nhau): có số này thì hiện danh sách ngay từ khung hình đầu,
  // không phải ẩn đi chờ đo xong rồi mới hiện (đỡ cảm giác "nháy")
  estimatedHeight?: number;
}

interface CellProps {
  id: string;
  fallbackIndex: number;
  width: number;
  enabled: boolean;
  accent: string;
  cardColor: string; // màu thẻ nổi khi nhấc lên (theo theme)
  sh: Shared;
  begin: (id: string) => void; // worklet
  onMeasure: (id: string, height: number) => void;
  children: React.ReactNode;
}

function Cell({ id, fallbackIndex, width, enabled, accent, cardColor, sh, begin, onMeasure, children }: CellProps) {
  const { hypOrder, layout, dragId, activeId, dragX, dragY, scale, lift, animate } = sh;
  const { manual } = useReorderContext();
  const px = useSharedValue(0);
  const py = useSharedValue(0);

  // Quyết định toạ độ của ô này: bám theo ngón tay nếu đang kéo, ngược lại trượt tới ô đích của nó
  useAnimatedReaction(
    () => {
      if (dragId.value === id) return { drag: true, x: dragX.value, y: dragY.value };
      let idx = hypOrder.value.indexOf(id);
      if (idx < 0) idx = fallbackIndex; // ô mới, hypOrder chưa kịp cập nhật
      const r = layout.value.rects[idx];
      return r ? { drag: false, x: r.x, y: r.y } : null;
    },
    (t, prev) => {
      if (!t) return;
      if (t.drag || !prev) {
        px.value = t.x;
        py.value = t.y;
        return;
      }
      if (!prev.drag && Math.abs(prev.x - t.x) < EPS && Math.abs(prev.y - t.y) < EPS) return;
      if (animate.value) {
        // Lúc vừa thả, ô đang ở chỗ ngón tay nên sẽ bay thẳng từ đó vào ô của nó, không có bước nhảy
        px.value = withSpring(t.x, MOVE_SPRING);
        py.value = withSpring(t.y, MOVE_SPRING);
      } else {
        px.value = t.x;
        py.value = t.y;
      }
    }
  );

  const style = useAnimatedStyle(() => {
    const active = activeId.value === id;
    return {
      transform: [{ translateX: px.value }, { translateY: py.value }, { scale: active ? scale.value : 1 }],
      zIndex: active ? 50 : 0,
    };
  });

  // Thẻ nổi: nền sáng hơn, bo 4 góc, có bóng đổ, lớn hơn ô gốc một chút
  const cardStyle = useAnimatedStyle(() => ({
    opacity: activeId.value === id ? lift.value : 0,
  }));

  // Giữ lâu để nhấc ô lên. Cho phép chạy cùng lúc với gesture theo dõi ngón tay ở ScrollView.
  const press = useLongPressGesture({
    enabled,
    minDuration: LONG_PRESS_MS,
    simultaneousWith: manual,
    onActivate: () => {
      begin(id);
    },
  });

  return (
    <Animated.View
      onLayout={(e) => onMeasure(id, e.nativeEvent.layout.height)}
      style={[styles.cell, { width }, style]}
    >
      <Animated.View pointerEvents="none" style={[styles.card, { borderColor: accent, backgroundColor: cardColor }, cardStyle]} />
      <GestureDetector gesture={press}>
        <View collapsable={false}>{children}</View>
      </GestureDetector>
    </Animated.View>
  );
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
  estimatedHeight,
}: Props<T>) {
  const { theme } = useTheme();
  const { candidateId, trackedId, cancelled, fingerX, fingerY, scrollY } = useReorderContext();

  const ids = useMemo(() => data.map((d) => d.id), [data]);
  const geom = useMemo<Geometry>(
    () => ({ columns, cellWidth, gapX, gapY }),
    [columns, cellWidth, gapX, gapY]
  );

  // ----- Đo chiều cao thật của từng ô (phụ thuộc cỡ chữ, kiểu hiển thị...) -----
  const heights = useRef<Record<string, number>>({});
  const lastH = useRef(estimatedHeight ?? 0); // dùng tạm cho ô mới chưa đo
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(!!estimatedHeight); // ẩn danh sách tới khi đo xong lần đầu

  const heightsSV = useSharedValue<Record<string, number>>({});
  const fallbackH = useSharedValue(estimatedHeight ?? 0);
  const geomSV = useSharedValue<Geometry>(geom);
  const hypOrder = useSharedValue<string[]>(ids);
  const animate = useSharedValue(false);

  const dragId = useSharedValue<string | null>(null);
  const activeId = useSharedValue<string | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);

  // Trạng thái lúc bắt đầu kéo
  const baseOrder = useSharedValue<string[]>([]); // thứ tự lúc bắt đầu kéo (để huỷ)
  const originX = useSharedValue(0); // toạ độ ô của mục đang kéo lúc bắt đầu
  const originY = useSharedValue(0);
  const startFX = useSharedValue(0); // vị trí ngón tay lúc bắt đầu
  const startFY = useSharedValue(0);
  const scrollStart = useSharedValue(0);

  const layout = useDerivedValue(() =>
    computeSlots(hypOrder.value, heightsSV.value, fallbackH.value, geomSV.value)
  );

  // Gom các lần onLayout trong cùng một nhịp thành một lần cập nhật
  const flush = useCallback(() => {
    flushTimer.current = null;
    heightsSV.value = { ...heights.current };
    fallbackH.value = lastH.current;
    setVersion((v) => v + 1);
  }, [heightsSV, fallbackH]);

  const onMeasure = useCallback(
    (id: string, h: number) => {
      if (Math.abs((heights.current[id] ?? -1) - h) < EPS) return;
      heights.current[id] = h;
      lastH.current = h;
      if (flushTimer.current === null) flushTimer.current = setTimeout(flush, 0);
    },
    [flush]
  );

  useEffect(
    () => () => {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    },
    []
  );

  // Chiều cao container theo thứ tự hiện tại của data (đo xong mới có số đúng)
  const totalHeight = useMemo(
    () => computeSlots(ids, heights.current, lastH.current, geom).totalHeight,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, geom, version]
  );

  // Đồng bộ khi data hoặc hình học đổi từ bên ngoài (đổi kiểu hiển thị, lọc, A-Z, thả xong...)
  useLayoutEffect(() => {
    hypOrder.value = ids;
  }, [ids, hypOrder]);

  useLayoutEffect(() => {
    geomSV.value = geom;
  }, [geom, geomSV]);

  // Hiện danh sách sau khi mọi ô đã được đo lần đầu, từ đó mới animate khi ô đổi chỗ
  useEffect(() => {
    if (!ready && ids.every((id) => heights.current[id] !== undefined)) setReady(true);
  }, [ready, ids, version]);

  useEffect(() => {
    animate.value = ready;
  }, [ready, animate]);

  // Báo thứ tự mới ra ngoài (gọi ở JS thread khi thả tay)
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const commit = useCallback((order: string[]) => {
    onReorderRef.current(order);
  }, []);

  // Giữ đủ lâu trên một ô: nhấc lên và gắn với ngón tay vừa chạm xuống
  const begin = (id: string) => {
    'worklet';
    const tid = candidateId.value;
    if (tid < 0 || trackedId.value >= 0 || dragId.value !== null) return;
    const order = hypOrder.value;
    const idx = order.indexOf(id);
    const rect = layout.value.rects[idx];
    if (idx < 0 || !rect) return;

    trackedId.value = tid;
    cancelled.value = false;
    baseOrder.value = order;
    originX.value = rect.x;
    originY.value = rect.y;
    startFX.value = fingerX.value;
    startFY.value = fingerY.value;
    scrollStart.value = scrollY.value;
    dragX.value = rect.x;
    dragY.value = rect.y;
    dragId.value = id;
    activeId.value = id;
    lift.value = withTiming(1, { duration: 120 });
    scale.value = withSpring(LIFT_SCALE, LIFT_SPRING);
  };

  // Mỗi khi ngón tay hoặc vị trí cuộn đổi: thẻ bám theo ngón tay và tính lại thứ tự giả định.
  // Vị trí cuộn được cộng thêm nên ngón thứ hai cuộn danh sách thì thẻ vẫn nằm dưới ngón thứ nhất.
  useAnimatedReaction(
    () => (dragId.value === null ? null : { fx: fingerX.value, fy: fingerY.value, sy: scrollY.value }),
    (cur) => {
      const id = dragId.value;
      if (cur === null || id === null) return;
      const dx = cur.fx - startFX.value;
      const dy = cur.fy - startFY.value + (cur.sy - scrollStart.value);
      dragX.value = originX.value + dx;
      dragY.value = originY.value + dy;

      // Ô đích là ô có tâm gần tâm của thẻ đang kéo nhất
      const order = hypOrder.value;
      const h = heightsSV.value[id] ?? fallbackH.value;
      const idx = slotIndexAt(
        layout.value.rects,
        originX.value + geomSV.value.cellWidth / 2 + dx,
        originY.value + h / 2 + dy
      );
      if (idx >= 0 && idx !== order.indexOf(id)) hypOrder.value = moveId(order, id, idx);
    }
  );

  // Nhả tay (hoặc bị huỷ): chốt thứ tự, thẻ bay vào ô của nó
  useAnimatedReaction(
    () => trackedId.value,
    (cur, prev) => {
      if (prev === null || prev < 0 || cur >= 0) return;
      const id = dragId.value;
      if (id === null) return;

      const base = baseOrder.value;
      const finalOrder = cancelled.value ? base : hypOrder.value;
      hypOrder.value = finalOrder;
      dragId.value = null; // từ đây ô tự trượt từ chỗ ngón tay vào đúng ô của nó
      scale.value = withSpring(1, LIFT_SPRING);
      lift.value = withTiming(0, { duration: 260 }, (finished) => {
        if (finished && dragId.value === null) activeId.value = null;
      });

      let changed = false;
      for (let i = 0; i < finalOrder.length; i++) {
        if (finalOrder[i] !== base[i]) {
          changed = true;
          break;
        }
      }
      if (changed) scheduleOnRN(commit, finalOrder);
    }
  );

  return (
    <View collapsable={false} style={{ height: totalHeight, opacity: ready ? 1 : 0 }}>
      {data.map((item, i) => (
        <Cell
          key={item.id}
          id={item.id}
          fallbackIndex={i}
          width={cellWidth}
          enabled={enabled}
          accent={theme.colors.accent}
          cardColor={theme.colors.surface}
          sh={{ hypOrder, layout, dragId, activeId, dragX, dragY, scale, lift, animate }}
          begin={begin}
          onMeasure={onMeasure}
        >
          {renderItem(item)}
        </Cell>
      ))}
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
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
});
