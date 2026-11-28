import { Theme } from './types';
import { PRESETS } from './presets';

export const defaultTheme: Theme = {
  version: 1,
  name: 'Default Dark',
  language: 'en',
  preset: 'dark',
  followSystem: true, // người dùng mới: theo sáng/tối của điện thoại
  background: { type: 'preset', color: PRESETS.dark.bg, uri: '', dim: 0.25 },
  colors: PRESETS.dark,
  // Mọi trường tuỳ chọn (?:) trong Theme đều phải có giá trị ở đây: merge() khi mở app chỉ giữ các trường có trong bản mặc định
  style: 'glass',
  pop: { theme: 'paper', followSystem: false, line: 'bold', shadow: 'short', shadowColor: 'ink', pattern: 'plain' },
  glass: { blur: 15, material: 'frost', neon: '' }, // default: Frosted, thin (27/11)
  effects: { ambient: { snow: true, green: true, ocean: true, latte: true, sakura: true, meteor: true, starry: true, aurora: true, smoke: true }, meteorLevel: 1, smokeTone: 'coffee', smokeSpeed: 1 },
  dock: {
    position: 'bottom',
    items: ['home', 'search', 'library', 'settings'],
    labels: true,
    rimLight: true,
    mode: 'bar',
    style: { background: '#242424F2', radius: 28, margin: 12 },
  },
  miniPlayer: {
    anchor: { edge: 'bottom', t: 0.5 },
    collapsed: false,
    merged: false,
    style: { background: '#242424F2', rectRadius: 18 },
  },
  // look phải có sẵn ở đây: merge() chỉ giữ các trường có trong theme mặc định, thiếu là kiểu player đã chọn bị mất mỗi lần mở app
  player: { lyricLook: 'glow', look: 'classic' },
  library: { layout: 'list', order: [] },
  home: {
    sections: ['myPlaylists', 'recent', 'trending', 'recommended', 'playlistPicks'],
    hidden: [],
    trendingRange: 'week',
    trendingRegion: 'ZZ',
  },
};