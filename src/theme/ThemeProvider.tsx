import React, { createContext, useContext, useMemo, useState } from 'react';
import { defaultTheme } from './defaultTheme';
import { DockPosition, Theme } from './types';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  setDockPosition: (p: DockPosition) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      setDockPosition: (position) =>
        setTheme((t) => ({ ...t, dock: { ...t.dock, position } })),
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}