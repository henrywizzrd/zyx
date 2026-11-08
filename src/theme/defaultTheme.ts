import { Theme } from './types';
import { PRESETS } from './presets';

export const defaultTheme: Theme = {
  version: 1,
  name: 'Default Dark',
  language: 'vi',
  preset: 'dark',
  followSystem: true, // người dùng mới: theo sáng/tối của điện thoại
  background: { type: 'preset', color: PRESETS.dark.bg, uri: '', dim: 0.25 },
  colors: PRESETS.dark,
  glass: { blur: 40 },
  effects: { ambient: { snow: true, green: true, ocean: true, latte: true, sakura: true, meteor: true, aurora: true, rain: true, neon: true } },
  dock: {
    position: 'bottom',
    items: ['home', 'search', 'library', 'settings'],
    labels: true,
    mode: 'bar',
    bubbleSide: 'right',
    style: { background: '#242424F2', radius: 28, margin: 12 },
  },
  miniPlayer: {
    variant: 'pill',
    anchor: { edge: 'bottom', t: 0.5 },
    collapsed: false,
    merged: false,
    style: { background: '#242424F2', rectRadius: 18 },
  },
  player: { lyricLook: 'glow' },
  library: { layout: 'list', order: [] },
  home: {
    sections: ['myPlaylists', 'recent', 'feed', 'trending', 'recommended', 'playlistPicks'],
    hidden: [],
    trendingRange: 'week',
    trendingRegion: 'ZZ',
  },
};