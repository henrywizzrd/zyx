export type DockPosition =
  | 'bottom' | 'top' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';export type TabId = 'home' | 'search' | 'library' | 'settings';
export type HomeSection = 'recentlyPlayed' | 'madeForYou' | 'newReleases';

export interface Theme {
  version: number;
  name: string;
  background: { type: 'solid'; color: string };
  colors: { text: string; textSecondary: string; accent: string; surface: string };
  dock: {
    position: DockPosition;
    items: TabId[];
    style: { background: string; radius: number; margin: number; showLabels: boolean };
  };
  home: { sections: HomeSection[] };
}