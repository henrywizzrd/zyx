import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useT } from '../i18n';
import { log } from '../data/applog';

// One-off popup for Android users still on the 1.1.0 APK: that build crashes when skipping songs with
// lock-screen controls (Sentry REACT-NATIVE-2) and only a new APK fixes it — an OTA update cannot.
// OK opens the newest release page (v1.1.2, which has the fix too), Cancel hides the popup for a day.
const FIXED_IN = '1.1.2';
const AFFECTED = ['1.1.0'];
const RELEASE_URL = 'https://github.com/henrywizzrd/zyx/releases/tag/v1.1.2';
const SNOOZE_KEY = 'zyx.updateNotice.snoozedUntil';

async function installedNativeVersion(): Promise<string | null> {
  try {
    // Sentry's native wrapper reads versionName from the installed APK (internal API, so guarded)
    const { NATIVE } = require('@sentry/react-native/dist/js/wrapper');
    const rel = await NATIVE.fetchNativeRelease();
    return rel?.version ?? null;
  } catch {
    return null;
  }
}

export function UpdateNotice() {
  const t = useT();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const version = await installedNativeVersion();
      log('ui', `update notice: installed ${version ?? 'unknown'}`);
      if (cancelled || !version || !AFFECTED.includes(version)) return;
      const until = Number((await AsyncStorage.getItem(SNOOZE_KEY)) ?? 0);
      if (Date.now() < until) return;
      Alert.alert(t('crashfix.title', { v: FIXED_IN }), t('crashfix.body', { v: FIXED_IN }), [
        { text: t('crashfix.cancel'), style: 'cancel', onPress: () => void AsyncStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 3600 * 1000)) },
        { text: t('crashfix.ok'), onPress: () => void Linking.openURL(RELEASE_URL) },
      ]);
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [t]);
  return null;
}
