import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultTheme } from './defaultTheme';
import { Edge, HomeSection, LibraryLayout, MiniAnchor, MiniPlayerVariant, Position, TabId, Theme, TrendingRange } from './types';

const STORAGE_KEY = 'zyx:theme';

const POSITIONS: Position[] = [
  'bottom', 'top', 'left', 'right',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
];
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const VARIANTS: MiniPlayerVariant[] = ['pill', 'rect'];
const TABS: TabId[] = ['home', 'search', 'library', 'settings'];
const SECTIONS: HomeSection[] = ['myPlaylists', 'recent', 'trending', 'recommended', 'playlistPicks'];
const RANGES: TrendingRange[] = ['week', 'month', 'year'];
const LANGS = ['vi', 'en'] as const;
const LIBRARY_LAYOUTS: LibraryLayout[] = ['list', 'columns', 'covers2', 'covers3'];

// Bản lưu cũ có miniPlayer.position (8 vị trí cố định): đổi sang vị trí tự do theo viền
function migrate(saved: unknown): unknown {
  if (!isPlainObject(saved) || !isPlainObject(saved.miniPlayer)) return saved;
  const mp = saved.miniPlayer;
  if (mp.anchor || typeof mp.position !== 'string') return saved;
  const map: Record<string, MiniAnchor> = {
    bottom: { edge: 'bottom', t: 0.5 }, top: { edge: 'top', t: 0.5 },
    left: { edge: 'left', t: 0.5 }, right: { edge: 'right', t: 0.5 },
    'top-left': { edge: 'left', t: 0 }, 'top-right': { edge: 'right', t: 0 },
    'bottom-left': { edge: 'left', t: 1 }, 'bottom-right': { edge: 'right', t: 1 },
  };
  const anchor = map[mp.position];
  return anchor ? { ...saved, miniPlayer: { ...mp, anchor } } : saved;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Trộn bản đã lưu vào bản mặc định: thiếu trường thì lấy mặc định, sai kiểu thì bỏ.
// Nhờ vậy sau này thêm trường mới vào theme thì bản lưu cũ vẫn chạy được.
function merge<T>(base: T, saved: unknown): T {
  if (isPlainObject(base)) {
    const src = isPlainObject(saved) ? saved : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) {
      out[key] = merge((base as Record<string, unknown>)[key], src[key]);
    }
    return out as T;
  }
  if (Array.isArray(base)) return (Array.isArray(saved) ? saved : base) as T;
  return (typeof saved === typeof base ? saved : base) as T;
}

// Chặn giá trị không hợp lệ (ví dụ file lưu bị sửa tay hoặc từ phiên bản cũ)
function sanitize(t: Theme): Theme {
  const d = defaultTheme;
  const items = t.dock.items.filter((i) => TABS.includes(i));
  // Giữ thứ tự đã lưu, bỏ khối lạ (bản cũ), thêm khối mới chưa có vào cuối
  const kept = t.home.sections.filter((s, i, a) => SECTIONS.includes(s) && a.indexOf(s) === i);
  const sections = kept.length ? [...kept, ...SECTIONS.filter((s) => !kept.includes(s))] : d.home.sections;
  return {
    ...t,
    language: (LANGS as readonly string[]).includes(t.language) ? t.language : d.language,
    dock: {
      ...t.dock,
      position: POSITIONS.includes(t.dock.position) ? t.dock.position : d.dock.position,
      items: items.length ? items : d.dock.items,
    },
    miniPlayer: {
      ...t.miniPlayer,
      anchor: {
        edge: EDGES.includes(t.miniPlayer.anchor.edge) ? t.miniPlayer.anchor.edge : d.miniPlayer.anchor.edge,
        t: Number.isFinite(t.miniPlayer.anchor.t) ? Math.max(0, Math.min(1, t.miniPlayer.anchor.t)) : d.miniPlayer.anchor.t,
      },
      variant: VARIANTS.includes(t.miniPlayer.variant) ? t.miniPlayer.variant : d.miniPlayer.variant,
    },
    library: {
      ...t.library,
      layout: LIBRARY_LAYOUTS.includes(t.library.layout) ? t.library.layout : d.library.layout,
      order: t.library.order.filter((id) => typeof id === 'string'),
    },
    home: {
      ...t.home,
      sections,
      hidden: t.home.hidden.filter((s) => SECTIONS.includes(s)),
      trendingRange: RANGES.includes(t.home.trendingRange) ? t.home.trendingRange : d.home.trendingRange,
    },
  };
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resetTheme: () => void;
  setDockPosition: (p: Position) => void;
  setMiniPlayerAnchor: (a: MiniAnchor) => void;
  setMiniPlayerCollapsed: (c: boolean) => void;
  setMiniPlayerVariant: (v: MiniPlayerVariant) => void;
  setMerged: (merged: boolean) => void;
  setLibraryLayout: (l: LibraryLayout) => void;
  setLibraryOrder: (ids: string[]) => void;
  setHome: (patch: Partial<Theme['home']>) => void;
  setLanguage: (l: Theme['language']) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [ready, setReady] = useState(false);

  // Đọc theme đã lưu khi mở app
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw && alive) setThemeState(sanitize(merge(defaultTheme, migrate(JSON.parse(raw)))));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Lưu lại mỗi khi theme đổi (chờ 300ms để không ghi liên tục)
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(theme)).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [theme, ready]);

  const value = useMemo<ThemeContextValue>(() => {
    const patchMini = (patch: Partial<Theme['miniPlayer']>) =>
      setThemeState((t) => ({ ...t, miniPlayer: { ...t.miniPlayer, ...patch } }));

    return {
      theme,
      setTheme: setThemeState,
      resetTheme: () => setThemeState((t) => ({ ...defaultTheme, language: t.language })), // giữ ngôn ngữ đang chọn
      setDockPosition: (position) =>
        setThemeState((t) => ({ ...t, dock: { ...t.dock, position } })),
      setMiniPlayerAnchor: (anchor) => patchMini({ anchor }),
      setMiniPlayerCollapsed: (collapsed) => patchMini({ collapsed }),
      setMiniPlayerVariant: (variant) => patchMini({ variant }),
      setMerged: (merged) => patchMini({ merged }),
      setLibraryLayout: (layout) =>
        setThemeState((t) => ({ ...t, library: { ...t.library, layout } })),
      setLibraryOrder: (order) =>
        setThemeState((t) => ({ ...t, library: { ...t.library, order } })),
      setHome: (patch) => setThemeState((t) => ({ ...t, home: { ...t.home, ...patch } })),
      setLanguage: (language) => setThemeState((t) => ({ ...t, language })),
    };
  }, [theme]);

  // Chờ đọc xong để không bị nháy từ giao diện mặc định sang giao diện đã lưu
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: defaultTheme.background.color }} />;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}