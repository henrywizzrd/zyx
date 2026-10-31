import { Theme } from './types';

export const defaultTheme: Theme = {
  version: 1,
  name: 'Default Dark',
  background: { type: 'solid', color: '#000000' },
  colors: {
    text: '#FFFFFF',
    textSecondary: '#B3B3B3',
    accent: '#1DB954',
    surface: '#181818',
  },
  dock: {
    position: 'bottom',
    items: ['home', 'search', 'library', 'settings'],
    style: { background: '#242424F2', radius: 28, margin: 12, showLabels: false },
  },
  miniPlayer: {
    variant: 'pill',
    position: 'bottom',
    merged: false,
    style: { background: '#242424F2', rectRadius: 18 },
  },
  home: { sections: ['recentlyPlayed', 'madeForYou', 'newReleases'] },
};