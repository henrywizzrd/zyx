import { useEffect, useState } from 'react';
import * as Font from 'expo-font';
import { log as appLog } from '../data/applog';
import { useTheme } from './ThemeProvider';

// Display font for Pop titles: Archivo Black weight (900) at width 118, made as one static file from the
// Google Fonts variable font (SIL OFL 1.1, licence in assets/fonts/OFL-Archivo.txt). Has Vietnamese.
// Loaded once at startup without blocking; until it is ready titles use the system font.
export const DISPLAY_FONT = 'ZyxDisplay';
// Same family at width 62 (condensed), weight 900: poster headlines on the welcome screens (27/11)
export const CONDENSED_FONT = 'ZyxCondensed';

let ready = false;
const waiting = new Set<() => void>();

export function loadFonts() {
  if (ready) return;
  Font.loadAsync({
    [DISPLAY_FONT]: require('../../assets/fonts/ZyxDisplay.ttf'),
    [CONDENSED_FONT]: require('../../assets/fonts/ZyxCondensed.ttf'),
  })
    .then(() => {
      ready = true;
      waiting.forEach((f) => f());
      waiting.clear();
    })
    .catch((e) => appLog('ui', `display font failed to load: ${String(e?.message ?? e)}`));
}

// Style for big titles: the display font in Pop style, nothing in Glass style.
// fontWeight is reset because a custom family with a bold weight falls back to the system font on Android.
export function useDisplayFont(): { fontFamily?: string; fontWeight?: 'normal' } {
  const { theme } = useTheme();
  const [, bump] = useState(0);
  useEffect(() => {
    if (ready) return;
    const f = () => bump((n) => n + 1);
    waiting.add(f);
    return () => {
      waiting.delete(f);
    };
  }, []);
  return theme.style === 'pop' && ready ? { fontFamily: DISPLAY_FONT, fontWeight: 'normal' } : {};
}

// True once the fonts above are loaded (screens that must not jump from the system font wait for it)
export function useFontsReady() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (ready) return;
    const f = () => bump((n) => n + 1);
    waiting.add(f);
    return () => {
      waiting.delete(f);
    };
  }, []);
  return ready;
}
