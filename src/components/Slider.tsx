import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

const clamp = (v: number) => Math.max(0, Math.min(1, v));

// Thanh kéo 0..1: chạm hoặc kéo ngón tay để đổi giá trị.
// onChange chạy liên tục khi đang kéo, onCommit chạy một lần khi nhả tay.
export function Slider({
  value,
  onChange,
  onCommit,
  thickness = 8,
  fill = '#FFFFFF',
  track = 'rgba(255,255,255,0.25)',
}: {
  value: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  thickness?: number;
  fill?: string;
  track?: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const width = useRef(1);
  const start = useRef(0);
  const cb = useRef({ onChange, onCommit });
  cb.current = { onChange, onCommit };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const v = clamp(e.nativeEvent.locationX / width.current);
          start.current = v;
          setDrag(v);
          cb.current.onChange?.(v);
        },
        onPanResponderMove: (_, g) => {
          const v = clamp(start.current + g.dx / width.current);
          setDrag(v);
          cb.current.onChange?.(v);
        },
        onPanResponderRelease: (_, g) => {
          const v = clamp(start.current + g.dx / width.current);
          setDrag(null);
          cb.current.onCommit?.(v);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    []
  );

  const shown = drag ?? clamp(value);

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))}
      style={{ height: 32, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: thickness, borderRadius: thickness / 2, backgroundColor: track, overflow: 'hidden' }}>
        <View style={{ width: `${shown * 100}%`, height: thickness, backgroundColor: fill }} />
      </View>
    </View>
  );
}
