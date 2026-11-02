export type Position =
  | 'bottom' | 'top' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DockPosition = Position;

// Mini player nằm tự do dọc viền màn hình: cạnh nào + vị trí dọc theo cạnh đó (0 = đầu cạnh, 1 = cuối cạnh)
export type Edge = 'top' | 'bottom' | 'left' | 'right';
export interface MiniAnchor { edge: Edge; t: number }

export type TabId = 'home' | 'search' | 'library' | 'settings' | 'player';
// Các khối của Home (thứ tự trong home.sections = thứ tự hiển thị)
export type HomeSection = 'myPlaylists' | 'recent' | 'trending' | 'recommended' | 'playlistPicks';
export type TrendingRange = 'week' | 'month' | 'year';
export type MiniPlayerVariant = 'pill' | 'rect';
export type LibraryLayout = 'list' | 'columns' | 'covers2' | 'covers3';

import type { Language } from '../i18n/strings';
import type { AmbientPresetId, Palette, ThemePresetId } from './presets';

// Nền của app: theo bộ màu, ảnh (cả GIF) hoặc video người dùng chọn
export type BackgroundType = 'preset' | 'image' | 'video';

export interface Theme {
  version: number;
  name: string;
  language: Language; // ngôn ngữ giao diện
  preset: ThemePresetId; // bộ màu đang dùng
  followSystem: boolean; // true: tự theo sáng/tối của điện thoại (Light ↔ Dark), preset được tính lại theo điện thoại
  // color: màu nền của bộ màu (tính tự động). uri: file ảnh/video ('' = chưa có). dim: độ tối phủ lên ảnh/video cho dễ đọc chữ (0..0.8)
  background: { type: BackgroundType; color: string; uri: string; dim: number };
  colors: Palette; // tính tự động từ preset, không tự sửa
  glass: { blur: number }; // độ mờ kính của dock, mini player, popup (0..100)
  // Hiệu ứng nền của từng bộ: tuyết rơi (Snow), lá rơi (Green), bong bóng + cá (Ocean), hạt cà phê (Latte)
  effects: { ambient: Record<AmbientPresetId, boolean> };
  dock: {
    position: Position;
    items: TabId[];
    style: { background: string; radius: number; margin: number; showLabels: boolean };
  };
  miniPlayer: {
    variant: MiniPlayerVariant;
    anchor: MiniAnchor;
    collapsed: boolean; // đang thu nhỏ thành bubble (chỉ còn ảnh album)
    merged: boolean;
    style: { background: string; rectRadius: number };
  };
  library: { layout: LibraryLayout; order: string[] };
  home: { sections: HomeSection[]; hidden: HomeSection[]; trendingRange: TrendingRange };
}