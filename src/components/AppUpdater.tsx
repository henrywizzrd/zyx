import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useT } from '../i18n';

const CHECK_EVERY = 30 * 60 * 1000; // quay lại app thì kiểm tra lại, nhưng không quá 30 phút một lần

// Cập nhật app không cần cài lại (EAS Update): code JS + ảnh mới được tải về từ máy chủ của Expo.
//  - mở app (và mỗi lần quay lại app, cách nhau ít nhất 30 phút): hỏi xem có bản mới không
//  - có thì tải ngầm, tải xong hỏi người dùng "Khởi động lại để cập nhật?"; chọn Để sau thì lần mở app sau tự dùng bản mới
// Không làm gì trong Expo Go / lúc đang phát triển (expo-updates tắt ở đó) và trên web
export function AppUpdater() {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__) return;
    // Nạp lúc chạy để môi trường không có expo-updates (web) không lỗi
    const Updates = require('expo-updates') as typeof import('expo-updates');
    if (!Updates.isEnabled) return;

    let last = 0;
    let busy = false;
    let asked = false;
    const check = async () => {
      if (busy || asked || Date.now() - last < CHECK_EVERY) return;
      busy = true;
      last = Date.now();
      try {
        const r = await Updates.checkForUpdateAsync();
        if (!r.isAvailable) return;
        const f = await Updates.fetchUpdateAsync();
        if (!f.isNew) return;
        asked = true;
        const tt = tRef.current;
        Alert.alert(tt('update.title'), tt('update.body'), [
          { text: tt('update.later'), style: 'cancel' },
          { text: tt('update.now'), onPress: () => Updates.reloadAsync().catch(() => {}) },
        ]);
      } catch (e) {
        console.warn('[update]', e); // mất mạng, máy chủ lỗi...: lần sau thử lại
      } finally {
        busy = false;
      }
    };

    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  return null;
}
