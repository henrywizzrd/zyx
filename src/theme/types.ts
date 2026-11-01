export type Position =
  | 'bottom' | 'top' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DockPosition = Position;

// Mini player nằm tự do dọc viền màn hình: cạnh nào + vị trí dọc theo cạnh đó (0 = đầu cạnh, 1 = cuối cạnh)
export type Edge = 'top' | 'bottom' | 'left' | 'right';
export interface MiniAnchor { edge: Edge; t: number }

export type TabId = 'home' | 'search' | 'library' | 'settings' | 'player';
export type HomeSection = 'recentlyPlayed' | 'madeForYou' | 'newReleases';
export type MiniPlayerVariant = 'pill' | 'rect';
export type LibraryLayout = 'list' | 'columns' | 'covers2' | 'covers3';

export interface Theme {
  version: number;
  name: string;
  background: { type: 'solid'; color: string };
  colors: { text: string; textSecondary: string; accent: string; surface: string };
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
  home: { sections: HomeSection[] };
}