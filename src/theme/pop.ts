import type { Palette } from './presets';

// Pop style (neo-brutalism, approved mockup 27/11): flat colours, thick ink outlines, hard offset shadows, no blur.
// Light or dark follows the chosen preset (its glassTint), so "follow system" keeps working.

export const POP_ACCENTS = {
  lime: '#D4F25A',
  lilac: '#A98BF5',
  yellow: '#FFD23F',
  coral: '#FF7A59',
  pink: '#FF9BD0',
  sky: '#7CC8F8',
  mint: '#6FE3A5',
} as const;

// Outline width used by every Pop surface
export const POP_LINE = 2.5;

export const POP_LIGHT: Palette = {
  bg: '#FBFAF5',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#111111',
  textSecondary: '#5A5A5A',
  accent: POP_ACCENTS.lime,
  onAccent: '#111111',
  border: '#111111',
  skeleton: 'rgba(17,17,17,0.08)',
  glass: '#FFFFFF',
  glassRgb: '255,255,255',
  glassTint: 'light',
  statusBar: 'dark-content',
  switchOff: '#E4E2DA',
};

export const POP_DARK: Palette = {
  bg: '#161618',
  surface: '#222226',
  card: '#222226',
  text: '#F4F4F0',
  textSecondary: '#A4A4A0',
  accent: POP_ACCENTS.lime,
  onAccent: '#111111',
  border: '#F4F4F0',
  skeleton: 'rgba(244,244,240,0.08)',
  glass: '#222226',
  glassRgb: '34,34,38',
  glassTint: 'dark',
  statusBar: 'light-content',
  switchOff: '#3A3A40',
};

export const popPalette = (dark: boolean): Palette => (dark ? POP_DARK : POP_LIGHT);

// glassShadow() is a plain function called from many places, so the current style is kept here for it.
// ThemeProvider updates it while building the theme value (before any child renders).
export const popMode = { on: false, ink: '#111111' };
export function setPopMode(on: boolean, ink: string) {
  popMode.on = on;
  popMode.ink = ink;
}
