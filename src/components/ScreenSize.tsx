import React, { createContext, useCallback, useContext, useState } from 'react';
import { LayoutChangeEvent, useWindowDimensions, View } from 'react-native';

// Kích thước THẬT của vùng app được vẽ (đo bằng onLayout của view gốc), dùng thay cho useWindowDimensions.
// Lý do: trên Android, "window" thường không tính thanh điều hướng / tai thỏ (và mỗi máy, mỗi bản Android tính một kiểu),
// trong khi app vẽ tràn cạnh (edge-to-edge) xuống tận đáy màn hình → màn player, hiệu ứng... ngắn hơn màn hình,
// hở một dải ở dưới. Đo trực tiếp view gốc thì đúng với mọi máy, mọi tỉ lệ màn hình.
type Size = { width: number; height: number };
const SizeContext = createContext<Size | null>(null);

export function ScreenSizeProvider({ children }: { children: React.ReactNode }) {
  const win = useWindowDimensions();
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && Math.abs(s.width - width) < 0.5 && Math.abs(s.height - height) < 0.5 ? s : { width, height }));
  }, []);
  // Lần vẽ đầu chưa đo được thì tạm dùng kích thước cửa sổ
  const value = size ?? { width: win.width, height: win.height };
  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <SizeContext.Provider value={value}>{children}</SizeContext.Provider>
    </View>
  );
}

export function useScreenSize(): Size {
  const ctx = useContext(SizeContext);
  const win = useWindowDimensions();
  return ctx ?? { width: win.width, height: win.height };
}
