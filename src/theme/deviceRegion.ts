import { I18nManager, NativeModules, Platform } from 'react-native';
import type { TrendingRegion } from './types';

// The country set on the phone (Settings → General → Language & Region), used as the first Trending region for
// people who never picked one (27/11). Read from what the system already exposes — no extra library:
//  1. Intl locale, e.g. "en-VN" (Hermes reads the device locale)
//  2. iOS AppleLocale / Android localeIdentifier, e.g. "en_VN"
// Only regions that have a Trending chart are used; anything else falls back to Global (ZZ)
const SUPPORTED: TrendingRegion[] = ['VN', 'KR', 'US'];

export function deviceCountry(): string | null {
  const tries: (() => string | undefined)[] = [
    () => Intl.DateTimeFormat().resolvedOptions().locale,
    () => (Platform.OS === 'ios' ? NativeModules.SettingsManager?.settings?.AppleLocale : undefined),
    () => (I18nManager.getConstants() as { localeIdentifier?: string }).localeIdentifier,
  ];
  for (const f of tries) {
    try {
      const loc = f();
      const m = loc?.match(/[-_]([A-Za-z]{2})(?:$|[-_@.])/);
      if (m) return m[1].toUpperCase();
    } catch {}
  }
  return null;
}

export function deviceTrendingRegion(): TrendingRegion {
  const c = deviceCountry();
  return c && (SUPPORTED as string[]).includes(c) ? (c as TrendingRegion) : 'ZZ';
}
