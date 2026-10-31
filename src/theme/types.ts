export type Position =
  | 'bottom' | 'top' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DockPosition = Position;

export type TabId = 'home' | 'search' | 'library' | 'settings' | 'player';
export type HomeSection = 'recentlyPlayed' | 'madeForYou' | 'newReleases';
export type MiniPlayerVariant = 'pill' | 'rect';

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
    position: Position;
    merged: boolean;
    style: { background: string; rectRadius: number };
  };
  home: { sections: HomeSection[] };
}