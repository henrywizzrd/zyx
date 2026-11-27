import type { Palette } from './presets';

// Pop style (neo-brutalism, approved 27/11): flat colours, thick ink outlines, hard offset shadows, no blur.
// Pop has its own themes and options, kept apart from the glass themes (theme.pop vs theme.preset), so switching
// Default ↔ Pop in Theme Studio brings back what each side had.

export const POP_ACCENTS = {
  lime: '#D4F25A',
  lilac: '#A98BF5',
  yellow: '#FFD23F',
  coral: '#FF7A59',
  pink: '#FF9BD0',
  sky: '#7CC8F8',
  mint: '#6FE3A5',
} as const;

export type PopThemeId = 'paper' | 'lilac' | 'lemon' | 'bubblegum' | 'sky' | 'mint' | 'night' | 'grape';
export const POP_THEME_ORDER: PopThemeId[] = ['paper', 'lilac', 'lemon', 'bubblegum', 'sky', 'mint', 'night', 'grape'];
export const POP_THEME_NAMES: Record<PopThemeId, string> = {
  paper: 'Paper', lilac: 'Lilac', lemon: 'Lemon', bubblegum: 'Bubblegum', sky: 'Sky', mint: 'Mint', night: 'Night', grape: 'Grape',
};

export type PopLine = 'thin' | 'bold' | 'chunky';
export type PopShadow = 'none' | 'short' | 'long';
export type PopShadowColor = 'ink' | 'accent';
export type PopPattern = 'plain' | 'dots' | 'grid';
export interface PopSettings {
  theme: PopThemeId;
  followSystem: boolean; // Paper when the phone is light, Night when it is dark
  line: PopLine;
  shadow: PopShadow;
  shadowColor: PopShadowColor;
  pattern: PopPattern;
}
export const POP_LINES: PopLine[] = ['thin', 'bold', 'chunky'];
export const POP_SHADOWS: PopShadow[] = ['none', 'short', 'long'];
export const POP_SHADOW_COLORS: PopShadowColor[] = ['ink', 'accent'];
export const POP_PATTERNS: PopPattern[] = ['plain', 'dots', 'grid'];
export const POP_LINE_WIDTH: Record<PopLine, number> = { thin: 1.5, bold: 2.5, chunky: 3.5 };
export const POP_SHADOW_OFFSET: Record<PopShadow, number> = { none: 0, short: 4, long: 7 };

// Light themes: bright accents like lime can't be read as text on a light background, so their accentText
// (colour for text and small icons) is a darker shade or the ink colour. Contrast ≥ 4.5 checked for each theme
const light = (bg: string, textSecondary: string, accent: string, accentText: string): Palette => ({
  bg,
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#111111',
  textSecondary,
  accent,
  accentText,
  onAccent: '#111111',
  border: '#111111',
  skeleton: 'rgba(17,17,17,0.10)',
  glass: '#FFFFFF',
  glassRgb: '255,255,255',
  glassTint: 'light',
  statusBar: 'dark-content',
  switchOff: '#E4E2DA',
});
const dark = (bg: string, surface: string, text: string, textSecondary: string, accent: string): Palette => ({
  bg,
  surface,
  card: surface,
  text,
  textSecondary,
  accent,
  accentText: accent,
  onAccent: '#111111',
  border: text,
  skeleton: 'rgba(244,244,240,0.08)',
  glass: surface,
  glassRgb: '34,34,38',
  glassTint: 'dark',
  statusBar: 'light-content',
  switchOff: '#3A3A40',
});

export const POP_THEMES: Record<PopThemeId, Palette> = {
  paper: light('#FBFAF5', '#5A5A5A', POP_ACCENTS.lime, '#4D6600'),
  lilac: light('#A98BF5', '#33265A', POP_ACCENTS.lime, '#111111'),
  lemon: light('#FFD23F', '#5A4A10', POP_ACCENTS.coral, '#A8320F'),
  bubblegum: light('#FF9BD0', '#5E2445', POP_ACCENTS.yellow, '#111111'),
  sky: light('#7CC8F8', '#173F5C', POP_ACCENTS.yellow, '#111111'),
  mint: light('#6FE3A5', '#174D31', POP_ACCENTS.lilac, '#4B2BA8'),
  night: dark('#161618', '#222226', '#F4F4F0', '#A4A4A0', POP_ACCENTS.lime),
  grape: dark('#1E1530', '#2C2145', '#F4F0FF', '#B2A6D6', POP_ACCENTS.pink),
};
export const POP_DARK = POP_THEMES.night; // panels that are always dark (opened from the player)
export const popSystemTheme = (scheme: string | null | undefined): PopThemeId => (scheme === 'dark' ? 'night' : 'paper');

// glassShadow() is a plain function called from many places, so the current Pop look is kept here for it.
// ThemeProvider updates it while building the theme value (before any child renders).
export const popMode = { on: false, ink: '#111111', line: 2.5, offset: 4, shadow: '#111111' };
export function setPopMode(on: boolean, colors: Palette, pop: PopSettings) {
  popMode.on = on;
  popMode.ink = colors.border;
  popMode.line = POP_LINE_WIDTH[pop.line];
  popMode.offset = POP_SHADOW_OFFSET[pop.shadow];
  popMode.shadow = pop.shadowColor === 'accent' ? colors.accent : colors.border;
}

// Outline for small filled things (chips, pills) that don't use GlassFill: in Pop they need the same ink edge
// (and, when raised, the same hard shadow) as every card. Returns nothing in Glass style
export function popEdge(raised = false) {
  if (!popMode.on) return null;
  const o = raised && popMode.offset ? Math.max(2, Math.round(popMode.offset * 0.6)) : 0;
  return { borderWidth: Math.min(popMode.line, 2.5), borderColor: popMode.ink, borderCurve: 'circular' as const, ...(o ? { boxShadow: `${o}px ${o}px 0px ${popMode.shadow}` } : null) };
}
