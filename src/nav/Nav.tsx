import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

// Các trang mở chồng lên tab hiện tại (bấm vào playlist/album ở Home, Search...).
//  - source 'yt': playlist hoặc album trên YouTube Music
//  - source 'local': playlist tự tạo trong máy
//  - source 'liked': Liked Songs
export type CollectionPage = {
  type: 'collection';
  source: 'yt' | 'local' | 'liked';
  kind: 'playlist' | 'album';
  id: string;
  title: string;
  thumb?: string;
};
// Trang nghệ sĩ (mở từ Search, Thư viện, hoặc từ trang nghệ sĩ khác)
export type ArtistPage = { type: 'artist'; id: string; name: string; thumb?: string };
// Theme Studio: chọn bộ màu, nền, độ mờ kính (mở từ Cài đặt)
export type Page = CollectionPage | ArtistPage | { type: 'themeStudio' };

interface NavValue {
  stack: Page[];
  push: (p: Page) => void;
  pop: () => void;
  reset: () => void;
}

const NavContext = createContext<NavValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Page[]>([]);
  const push = useCallback((p: Page) => setStack((s) => [...s, p]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);

  // Nút back của Android: đóng trang trên cùng
  useEffect(() => {
    if (stack.length === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const value = useMemo(() => ({ stack, push, pop, reset }), [stack, push, pop, reset]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}
