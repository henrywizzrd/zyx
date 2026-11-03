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
// Trang một thể loại / tâm trạng (mở từ lưới ô ở Search)
export type GenrePage = { type: 'genre'; title: string; params: string; color: string };
// Theme Studio: chọn bộ màu, nền, độ mờ kính (mở từ Cài đặt)
export type Page = CollectionPage | ArtistPage | GenrePage | { type: 'themeStudio' };

interface NavValue {
  push: (p: Page) => void;
  pop: () => void;
  reset: () => void;
}

// Tách làm hai: các lệnh (push/pop/reset, không bao giờ đổi) và chồng trang (đổi mỗi lần mở / đóng trang).
// Màn hình chỉ cần lệnh thì không bị vẽ lại mỗi lần mở / đóng trang hay đổi tab. Chỉ App cần chồng trang
const NavContext = createContext<NavValue | null>(null);
const StackContext = createContext<Page[]>([]);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Page[]>([]);
  const push = useCallback((p: Page) => setStack((s) => [...s, p]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const reset = useCallback(() => setStack((s) => (s.length ? [] : s)), []); // đang trống thì giữ nguyên (không vẽ lại)

  // Nút back của Android: đóng trang trên cùng
  useEffect(() => {
    if (stack.length === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const value = useMemo(() => ({ push, pop, reset }), [push, pop, reset]);
  return (
    <NavContext.Provider value={value}>
      <StackContext.Provider value={stack}>{children}</StackContext.Provider>
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}

// Chồng trang đang mở (chỉ App dùng để vẽ các trang)
export function useNavStack() {
  return useContext(StackContext);
}
