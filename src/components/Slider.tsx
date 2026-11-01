import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

// Thanh kéo 0..1: chạm hoặc kéo ngón tay để đổi giá trị.
// onChange chạy liên tục khi đang kéo, onCommit chạy một lần khi nhả tay.
// vertical: thanh dựng đứng, kéo lên là tăng (dùng cho âm lượng ở chế độ màn hình ngang).
export function Slider({
  value,
  onChange,
  onCommit,
  thickness = 8,
  fill = '#FFFFFF',
  track = 'rgba(255,255,255,0.25)',
  vertical = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  thickness?: number;
  fill?: string;
  track?: string;
  vertical?: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const length = useRef(1);
  const start = useRef(0);
  const cb = useRef({ onChange, onCommit });
  cb.current = { onChange, onCommit };
  const verticalRef = useRef(vertical);
  verticalRef.current = vertical;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const v = verticalRef.current
            ? clamp(1 - e.nativeEvent.locationY / length.current)
            : clamp(e.nativeEvent.locationX / length.current);
          start.current = v;
          setDrag(v);
          cb.current.onChange?.(v);
        },
        onPanResponderMove: (_, g) => {
          const v = clamp(start.current + (verticalRef.current ? -g.dy : g.dx) / length.current);
          setDrag(v);
          cb.current.onChange?.(v);
        },
        onPanResponderRelease: (_, g) => {
          const v = clamp(start.current + (verticalRef.current ? -g.dy : g.dx) / length.current);
          setDrag(null);
          cb.current.onCommit?.(v);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    []
  );

  const shown = drag ?? clamp(value);

  if (vertical) {
    return (
      <View
        {...pan.panHandlers}
        onLayout={(e) => (length.current = Math.max(1, e.nativeEvent.layout.height))}
        style={{ width: 32, flex: 1, alignItems: 'center' }}
      >
        <View
          pointerEvents="none"
          style={{ flex: 1, width: thickness, borderRadius: thickness / 2, backgroundColor: track, overflow: 'hidden', justifyContent: 'flex-end' }}
        >
          <View style={{ height: `${shown * 100}%`, width: thickness, backgroundColor: fill }} />
        </View>
      </View>
    );
  }

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => (length.current = Math.max(1, e.nativeEvent.layout.width))}
      style={{ height: 32, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: thickness, borderRadius: thickness / 2, backgroundColor: track, overflow: 'hidden' }}>
        <View style={{ width: `${shown * 100}%`, height: thickness, backgroundColor: fill }} />
      </View>
    </View>
  );
}
