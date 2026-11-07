import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme, View } from 'react-native';
import { useScreenSize } from '../components/ScreenSize';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultTheme } from './defaultTheme';
import { AmbientPresetId, PRESETS, ThemePresetId } from './presets';
import { Edge, HomeSection, LibraryLayout, MiniAnchor, MiniPlayerVariant, Position, TabId, Theme, TrendingRange } from './types';

const STORAGE_KEY = 'zyx:theme';

const POSITIONS: Position[] = [
  'bottom', 'top', 'left', 'right',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
];
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const VARIANTS: MiniPlayerVariant[] = ['pill', 'rect'];
const TABS: TabId[] = ['home', 'search', 'library', 'settings'];
const SECTIONS: HomeSection[] = ['myPlaylists', 'recent', 'feed', 'trending', 'recommended', 'playlistPicks'];
const RANGES: TrendingRange[] = ['week', 'month', 'year'];
const LANGS = ['vi', 'en'] as const;
const BG_TYPES = ['preset', 'image', 'video'] as const;
const clampN = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

// Màu luôn tính lại từ bộ màu đang chọn (không tin màu đã lưu, để đổi bảng màu trong code là app cập nhật theo)
function derive(t: Theme): Theme {
  // Bộ 'blue' cũ nay là 'ocean'
  const id = (t.preset as string) === 'blue' ? 'ocean' : t.preset;
  const preset: ThemePresetId = id in PRESETS ? id : defaultTheme.preset;
  const palette = PRESETS[preset];
  // Nền là ảnh/video: thẻ dùng màu trong suốt một phần để lộ nền phía sau (trông như kính, cuộn vẫn mượt)
  const media = t.background.type !== 'preset' && !!t.background.uri;
  const colors = media ? { ...palette, surface: palette.card } : palette;
  return { ...t, preset, colors, background: { ...t.background, color: palette.bg } };
}
// Bộ màu ứng với chế độ sáng/tối của điện thoại
export const systemPreset = (scheme: string | null | undefined): ThemePresetId => (scheme === 'light' ? 'light' : 'dark');

const LIBRARY_LAYOUTS: LibraryLayout[] = ['list', 'columns', 'covers2', 'covers3'];

// Bản lưu cũ có miniPlayer.position (8 vị trí cố định): đổi sang vị trí tự do theo viền
function migrate(saved: unknown): unknown {
  // Bản lưu từ trước khi có tuỳ chọn "Theo hệ thống": giữ nguyên bộ màu người dùng đã chọn
  if (isPlainObject(saved) && !('followSystem' in saved)) saved = { ...saved, followSystem: false };
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
  let sections = kept.length ? [...kept, ...SECTIONS.filter((s) => !kept.includes(s))] : d.home.sections;
  // Bản cũ chưa có Bảng tin: đặt ngay sau "Nghe gần đây" thay vì cuối trang
  if (kept.length && !kept.includes('feed')) {
    const rest = sections.filter((s) => s !== 'feed');
    const at = rest.indexOf('recent') + 1;
    sections = [...rest.slice(0, at), 'feed', ...rest.slice(at)];
  }
  return derive({
    ...t,
    background: {
      ...t.background,
      type: (BG_TYPES as readonly string[]).includes(t.background.type) ? t.background.type : 'preset',
      uri: typeof t.background.uri === 'string' ? t.background.uri : '',
      dim: clampN(t.background.dim, 0, 0.8, d.background.dim),
    },
    glass: { blur: clampN(t.glass.blur, 0, 100, d.glass.blur) },
    language: (LANGS as readonly string[]).includes(t.language) ? t.language : d.language,
    dock: {
      ...t.dock,
      position: POSITIONS.includes(t.dock.position) ? t.dock.position : d.dock.position,
      items: items.length ? items : d.dock.items,
      mode: t.dock.mode === 'bubble' ? 'bubble' : 'bar',
      bubbleSide: t.dock.bubbleSide === 'left' ? 'left' : 'right',
    },
    miniPlayer: {
      ...t.miniPlayer,
      anchor: {
        edge: EDGES.includes(t.miniPlayer.anchor.edge) ? t.miniPlayer.anchor.edge : d.miniPlayer.anchor.edge,
        t: Number.isFinite(t.miniPlayer.anchor.t) ? Math.max(0, Math.min(1, t.miniPlayer.anchor.t)) : d.miniPlayer.anchor.t,
      },
      variant: VARIANTS.includes(t.miniPlayer.variant) ? t.miniPlayer.variant : d.miniPlayer.variant,
    },
    player: { lyricLook: (['glow', 'karaoke', 'bounce'] as const).includes(t.player.lyricLook) ? t.player.lyricLook : 'glow' },
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
      trendingRegion: (['ZZ', 'VN', 'KR', 'US'] as const).includes(t.home.trendingRegion) ? t.home.trendingRegion : d.home.trendingRegion,
    },
  });
}

interface ThemeContextValue {
  theme: Theme;
  landscape: boolean; // màn hình đang nằm ngang
  setTheme: (t: Theme) => void;
  resetTheme: () => void;
  setDockPosition: (p: Position) => void;
  setDockLabels: (on: boolean) => void;
  setDockMode: (m: Theme['dock']['mode']) => void;
  setLyricLook: (l: Theme['player']['lyricLook']) => void;
  setDockBubbleSide: (s: Theme['dock']['bubbleSide']) => void;
  setMiniPlayerAnchor: (a: MiniAnchor) => void;
  setMiniPlayerCollapsed: (c: boolean) => void;
  setMiniPlayerVariant: (v: MiniPlayerVariant) => void;
  setMerged: (merged: boolean) => void;
  setLibraryLayout: (l: LibraryLayout) => void;
  setLibraryOrder: (ids: string[]) => void;
  setHome: (patch: Partial<Theme['home']>) => void;
  setLanguage: (l: Theme['language']) => void;
  setPreset: (id: ThemePresetId, followSystem?: boolean) => void;
  setBackground: (patch: Partial<Theme['background']>) => void;
  setGlassBlur: (blur: number) => void;
  setAmbient: (preset: AmbientPresetId, on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Màn hình ngang: dock luôn đứng dọc sát cạnh phải (không nằm trên / dưới vì màn ngang thấp),
// mini player tách khỏi dock, thu thành bong bóng ở góc dưới phải. Chỉ đổi lúc hiển thị, KHÔNG ghi vào cài đặt:
// xoay dọc lại thì mọi thứ về đúng như người dùng đã chỉnh
function orient(t: Theme, landscape: boolean): Theme {
  if (!landscape) return t;
  return {
    ...t,
    dock: t.dock.mode === 'bar' ? { ...t.dock, position: 'right' } : t.dock,
    miniPlayer: { ...t.miniPlayer, merged: false, collapsed: true },
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const screen = useScreenSize();
  const landscape = screen.width > screen.height;
  // Người dùng mới (theo hệ thống): mở app lên đã đúng sáng/tối của điện thoại
  const [theme, setThemeState] = useState<Theme>(() => derive({ ...defaultTheme, preset: systemPreset(Appearance.getColorScheme()) }));
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

  // "Theo hệ thống": điện thoại đổi sáng/tối (kể cả lúc app đang mở) thì đổi Light/Dark theo
  const scheme = useColorScheme();
  useEffect(() => {
    if (!theme.followSystem) return;
    const want = systemPreset(scheme);
    if (theme.preset !== want) setThemeState((t) => derive({ ...t, preset: want }));
  }, [scheme, theme.followSystem, theme.preset]);

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
      theme: orient(theme, landscape),
      landscape,
      setTheme: setThemeState,
      resetTheme: () => setThemeState((t) => ({ ...defaultTheme, language: t.language })), // giữ ngôn ngữ đang chọn
      setDockPosition: (position) =>
        setThemeState((t) => ({ ...t, dock: { ...t.dock, position } })),
      setDockLabels: (labels) => setThemeState((t) => ({ ...t, dock: { ...t.dock, labels } })),
      // Đổi sang bubble: mini player tách khỏi dock (nếu đang gộp) để nằm ở góc đối diện
      setDockMode: (mode) => setThemeState((t) => ({ ...t, dock: { ...t.dock, mode }, miniPlayer: mode === 'bubble' ? { ...t.miniPlayer, merged: false } : t.miniPlayer })),
      setLyricLook: (lyricLook) => setThemeState((t) => ({ ...t, player: { ...t.player, lyricLook } })),
      setDockBubbleSide: (bubbleSide) => setThemeState((t) => ({ ...t, dock: { ...t.dock, bubbleSide } })),
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
      // Chọn một bộ màu cụ thể thì thôi theo hệ thống; chọn "Theo hệ thống" thì followSystem = true
      setPreset: (preset, followSystem = false) => setThemeState((t) => derive({ ...t, preset, followSystem })),
      setBackground: (patch) => setThemeState((t) => derive({ ...t, background: { ...t.background, ...patch } })),
      setGlassBlur: (blur) => setThemeState((t) => ({ ...t, glass: { blur: Math.max(0, Math.min(100, blur)) } })),
      setAmbient: (preset, on) =>
        setThemeState((t) => ({ ...t, effects: { ...t.effects, ambient: { ...t.effects.ambient, [preset]: on } } })),
    };
  }, [theme, landscape]);

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