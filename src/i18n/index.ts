import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { en, Language, StringKey, vi } from './strings';

export type { Language, StringKey } from './strings';
export { LANGUAGES } from './strings';

const TABLES: Record<Language, Record<StringKey, string>> = { vi, en };

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: Language): Translate {
  const table = TABLES[lang] ?? vi;
  return (key, vars) => {
    let s = table[key] ?? vi[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };
}

// Dùng trong màn hình: const t = useT(); t('home.seeAll')
export function useT(): Translate {
  const { theme } = useTheme();
  return useMemo(() => makeT(theme.language), [theme.language]);
}
