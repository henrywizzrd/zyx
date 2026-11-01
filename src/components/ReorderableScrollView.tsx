import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleProp, useWindowDimensions, ViewStyle } from 'react-native';
import { GestureDetector, useManualGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  scrollTo,
  SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
  withDecay,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// ScrollView hỗ trợ kéo thả đa ngón:
//  - Ngón thứ nhất (giữ lâu trên một ô) giữ thẻ đang kéo.
//  - Ngón thứ hai chạm vào bất kỳ đâu rồi vuốt lên/xuống sẽ cuộn danh sách,
//    thẻ vẫn bám theo ngón thứ nhất.
//  - Kéo ngón thứ nhất sát mép trên/dưới thì danh sách tự cuộn.
//
// Cuộn native bị tắt trong lúc kéo, toàn bộ việc cuộn do UI thread điều khiển
// bằng scrollTo. Lý do: ScrollView native và PanResponder tính cử chỉ theo
// trung điểm của mọi ngón, nên không thể tách "ngón giữ" và "ngón cuộn".
// Ở đây ta đọc từng ngón riêng qua touch events của Gesture Handler (theo id).

const EDGE = 110; // ngón cách mép màn hình bao nhiêu px thì bắt đầu tự cuộn
const MAX_SPEED = 16; // px mỗi 16ms
const FLING_MIN_VELOCITY = 0.05; // px/ms, chậm hơn mức này thì thả là dừng luôn
const FLING_DECELERATION = 0.997; // càng gần 1 thì trôi càng xa

export interface ReorderContextValue {
  // Gesture dùng chung để các ô khai báo simultaneousWith (không bị huỷ khi long press kích hoạt)
  manual: ReturnType<typeof useManualGesture>;
  // Ngón vừa chạm xuống gần nhất khi chưa kéo (ứng viên để trở thành ngón giữ thẻ), -1 nếu không có
  candidateId: SharedValue<number>;
  // Ngón đang giữ thẻ, -1 nếu không đang kéo
  trackedId: SharedValue<number>;
  // true nếu lần kết thúc gần nhất là bị huỷ (hệ thống cướp cử chỉ) thay vì nhả tay
  cancelled: SharedValue<boolean>;
  // Toạ độ tuyệt đối (theo cửa sổ) của ngón giữ thẻ / ngón ứng viên
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  // Vị trí cuộn hiện tại. Trong lúc kéo, đây là giá trị chuẩn (không đọc lại từ sự kiện native)
  scrollY: SharedValue<number>;
}

const ReorderContext = createContext<ReorderContextValue | null>(null);

export function useReorderContext() {
  const ctx = useContext(ReorderContext);
  if (!ctx) throw new Error('Reorderable must be used inside ReorderableScrollView');
  return ctx;
}

interface Props {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export function ReorderableScrollView({ children, contentContainerStyle, style }: Props) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const { height: winHeight } = useWindowDimensions();
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const candidateId = useSharedValue(-1);
  const trackedId = useSharedValue(-1);
  const scrollerId = useSharedValue(-1); // ngón thứ hai đang điều khiển cuộn
  const scrollerY = useSharedValue(0);
  const cancelled = useSharedValue(false);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  const winH = useSharedValue(winHeight);

  // Quán tính sau khi ngón cuộn nhấc lên
  const scrollerSampleY = useSharedValue(0);
  const scrollerVel = useSharedValue(0); // px/ms của offset cuộn, làm mượt qua các frame
  const flingY = useSharedValue(0);
  const flinging = useSharedValue(false);

  useEffect(() => {
    winH.value = winHeight;
  }, [winHeight, winH]);

  // Chỉ lấy vị trí cuộn từ sự kiện native khi không kéo và không đang trôi theo quán tính
  const onScroll = useAnimatedScrollHandler((e) => {
    if (trackedId.value >= 0 || flinging.value) return;
    scrollY.value = e.contentOffset.y;
  });

  const stopFling = () => {
    'worklet';
    if (!flinging.value) return;
    cancelAnimation(flingY);
    flinging.value = false;
  };

  // Ngón cuộn nhấc lên: cho danh sách trôi tiếp với vận tốc của ngón rồi chậm dần
  const startFling = () => {
    'worklet';
    const v = scrollerVel.value;
    if (Math.abs(v) < FLING_MIN_VELOCITY) return;
    const max = Math.max(0, contentH.value - viewH.value);
    flinging.value = true;
    flingY.value = scrollY.value;
    flingY.value = withDecay(
      { velocity: v * 1000, deceleration: FLING_DECELERATION, clamp: [0, max] },
      (finished) => {
        if (finished) flinging.value = false;
      }
    );
  };

  // Gesture này không bao giờ tự kích hoạt: chỉ dùng để nhận touch events của từng ngón.
  const manual = useManualGesture({
    onTouchesDown: (e) => {
      // Chạm vào màn hình lúc đang trôi thì dừng ngay
      stopFling();
      for (const t of e.changedTouches) {
        if (trackedId.value < 0) {
          candidateId.value = t.id;
          fingerX.value = t.absoluteX;
          fingerY.value = t.absoluteY;
        } else if (scrollerId.value < 0 && t.id !== trackedId.value) {
          scrollerId.value = t.id;
          scrollerY.value = t.absoluteY;
          scrollerSampleY.value = t.absoluteY;
          scrollerVel.value = 0;
        }
      }
    },
    onTouchesMove: (e) => {
      for (const t of e.changedTouches) {
        if (trackedId.value < 0) {
          if (t.id === candidateId.value) {
            fingerX.value = t.absoluteX;
            fingerY.value = t.absoluteY;
          }
        } else if (t.id === trackedId.value) {
          fingerX.value = t.absoluteX;
          fingerY.value = t.absoluteY;
        } else if (t.id === scrollerId.value) {
          // Ngón cuộn: nội dung đi theo ngón nên vuốt xuống thì offset giảm
          const dy = t.absoluteY - scrollerY.value;
          scrollerY.value = t.absoluteY;
          const max = Math.max(0, contentH.value - viewH.value);
          const next = Math.min(max, Math.max(0, scrollY.value - dy));
          if (next !== scrollY.value) {
            scrollY.value = next;
            scrollTo(scrollRef, 0, next, false);
          }
        }
      }
    },
    onTouchesUp: (e) => {
      for (const t of e.changedTouches) {
        if (t.id === trackedId.value) {
          // Nhả ngón giữ thẻ: kết thúc kéo (Reorderable lắng nghe trackedId để chốt vị trí)
          cancelled.value = false;
          if (scrollerId.value >= 0) startFling();
          scrollerId.value = -1;
          trackedId.value = -1;
        } else if (t.id === scrollerId.value) {
          startFling();
          scrollerId.value = -1;
        }
        if (t.id === candidateId.value) candidateId.value = -1;
      }
    },
    onTouchesCancel: () => {
      stopFling();
      if (trackedId.value >= 0) {
        cancelled.value = true;
        trackedId.value = -1;
      }
      scrollerId.value = -1;
      candidateId.value = -1;
    },
  });

  // Tắt cuộn native trong lúc kéo (cuộn do scrollTo ở trên điều khiển)
  useAnimatedReaction(
    () => trackedId.value >= 0,
    (dragging, prev) => {
      if (dragging !== prev) scheduleOnRN(setScrollEnabled, !dragging);
    }
  );

  // Mỗi khi flingY đổi (do withDecay) thì cuộn theo
  useAnimatedReaction(
    () => flingY.value,
    (y) => {
      if (!flinging.value) return;
      scrollY.value = y;
      scrollTo(scrollRef, 0, y, false);
    }
  );

  useFrameCallback((info) => {
    // Đo vận tốc của ngón cuộn: nếu ngón dừng lại trước khi nhấc lên thì vận tốc về 0, không trôi
    if (scrollerId.value >= 0) {
      const dt = Math.max(1, info.timeSincePreviousFrame ?? 16);
      const dy = scrollerY.value - scrollerSampleY.value;
      scrollerSampleY.value = scrollerY.value;
      scrollerVel.value = scrollerVel.value * 0.6 + (-dy / dt) * 0.4;
    }

    // Tự cuộn khi ngón giữ thẻ ở sát mép trên/dưới màn hình
    if (trackedId.value < 0) return;
    const fy = fingerY.value;
    const h = winH.value;
    let v = 0;
    if (fy < EDGE) v = -MAX_SPEED * Math.min(1, (EDGE - fy) / EDGE);
    else if (fy > h - EDGE) v = MAX_SPEED * Math.min(1, (fy - (h - EDGE)) / EDGE);
    if (v === 0) return;
    const dt = info.timeSincePreviousFrame ?? 16;
    const max = Math.max(0, contentH.value - viewH.value);
    const next = Math.min(max, Math.max(0, scrollY.value + (v * dt) / 16));
    if (next === scrollY.value) return;
    scrollY.value = next;
    scrollTo(scrollRef, 0, next, false);
  });

  const ctx = useMemo<ReorderContextValue>(
    () => ({ manual, candidateId, trackedId, cancelled, fingerX, fingerY, scrollY }),
    [manual, candidateId, trackedId, cancelled, fingerX, fingerY, scrollY]
  );

  return (
    <ReorderContext.Provider value={ctx}>
      <GestureDetector gesture={manual}>
        <Animated.ScrollView
          ref={scrollRef}
          style={style}
          scrollEnabled={scrollEnabled}
          onScroll={onScroll}
          scrollEventThrottle={16}
          bounces={false}
          overScrollMode="never"
          onContentSizeChange={(_, h) => {
            contentH.value = h;
          }}
          onLayout={(e) => {
            viewH.value = e.nativeEvent.layout.height;
          }}
          contentContainerStyle={contentContainerStyle}
        >
          {children}
        </Animated.ScrollView>
      </GestureDetector>
    </ReorderContext.Provider>
  );
}
