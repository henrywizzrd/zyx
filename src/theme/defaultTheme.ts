import { Theme } from './types';
import { PRESETS } from './presets';

export const defaultTheme: Theme = {
  version: 1,
  name: 'Default Dark',
  language: 'vi',
  preset: 'dark',
  background: { type: 'preset', color: PRESETS.dark.bg, uri: '', dim: 0.25 },
  colors: PRESETS.dark,
  glass: { blur: 40 },
  effects: { ambient: { snow: true, green: true, ocean: true, latte: true } },
  dock: {
    position: 'bottom',
    items: ['home', 'search', 'library', 'settings'],
    style: { background: '#242424F2', radius: 28, margin: 12, showLabels: false },
  },
  miniPlayer: {
    variant: 'pill',
    anchor: { edge: 'bottom', t: 0.5 },
    collapsed: false,
    merged: false,
    style: { background: '#242424F2', rectRadius: 18 },
  },
  library: { layout: 'list', order: [] },
  home: {
    sections: ['myPlaylists', 'recent', 'trending', 'recommended', 'playlistPicks'],
    hidden: [],
    trendingRange: 'week',
  },
};