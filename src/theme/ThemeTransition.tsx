import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';
import { useTheme } from './ThemeProvider';
import type { ThemePresetId } from './presets';

const USE_NATIVE = Platform.OS !== 'web';
const FADE_MS = 650;

type Ctx = { changePreset: (id: ThemePresetId) => void; busy: boolean };
const TransitionContext = createContext<Ctx | null>(null);
export const useThemeTransition = () => {
  const c = useContext(TransitionContext);
  if (!c) throw new Error('useThemeTransition must be used inside ThemeTransition');
  return c;
};

// Đổi bộ màu mượt cho cả app:
//  1. Chụp lại màn hình hiện tại, đặt ảnh chụp đè lên trên cùng
//  2. Đổi theme ngay bên dưới (người dùng không thấy cú đổi vì ảnh chụp đang che)
//  3. Ảnh chụp mờ dần: mắt thấy mọi thứ (chữ, nền, dock, thẻ) tự chuyển màu từ từ
// Ảnh chụp không chặn ngón tay, nên đang chuyển vẫn bấm / đổi tab bình thường.
// Đợt sau: hiệu ứng riêng cho từng bộ màu (tuyết rơi, lá bay, gợn sóng...) sẽ chạy ở lớp này.
export function ThemeTransition({ children }: { children: React.ReactNode }) {
  const { theme, setPreset } = useTheme();
  const root = useRef<React.ElementRef<typeof View>>(null);
  const [shot, setShot] = useState<string | null>(null);
  const pending = useRef<ThemePresetId | null>(null);
  const fade = useRef(new Animated.Value(1)).current;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const changePreset = useCallback(
    async (id: ThemePresetId) => {
      const t = themeRef.current;
      if (id === t.preset || pending.current) return;
      // Nền video: ảnh chụp thường ra đen ở phần video, nên đổi thẳng (nền vẫn là video nên không thấy giật)
      const canShot = Platform.OS !== 'web' && !(t.background.type === 'video' && t.background.uri);
      if (!canShot) return setPreset(id);
      try {
        const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
        const uri = await captureRef(root as any, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
        pending.current = id;
        fade.setValue(1);
        setShot(uri);
        // Lưới an toàn: quá 1,5 giây vẫn chưa chạy xong (ảnh chụp không hiện được...) thì đổi thẳng và gỡ ảnh chụp
        setTimeout(() => {
          if (pending.current !== id) return;
          setPreset(id);
          pending.current = null;
          setShot(null);
        }, 1500);
      } catch (e) {
        console.warn('[theme] capture', e);
        setPreset(id);
      }
    },
    [setPreset, fade]
  );

  // Ảnh chụp đã hiện lên trên cùng (chờ thêm một khung hình cho chắc): lúc này mới đổi theme bên dưới
  const onShotShown = () => {
    const id = pending.current;
    if (id) requestAnimationFrame(() => setPreset(id));
  };

  // Theme mới đã vẽ xong bên dưới: cho ảnh chụp tan dần
  useEffect(() => {
    if (!shot || !pending.current || theme.preset !== pending.current) return;
    const raf = requestAnimationFrame(() =>
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: USE_NATIVE }).start(() => {
        pending.current = null;
        setShot(null);
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [theme.preset, shot, fade]);

  return (
    <TransitionContext.Provider value={{ changePreset, busy: !!shot }}>
      <View ref={root} collapsable={false} style={{ flex: 1 }}>
        {children}
      </View>
      {shot && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade, zIndex: 999 }]}>
          <Image source={{ uri: shot }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={onShotShown}
            onError={() => {
              const id = pending.current;
              pending.current = null;
              setShot(null);
              if (id) setPreset(id);
            }}
            fadeDuration={0}
          />
        </Animated.View>
      )}
    </TransitionContext.Provider>
  );
}
