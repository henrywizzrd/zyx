import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, View } from 'react-native';
import { Easing as REasing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from './ThemeProvider';
import type { ThemePresetId } from './presets';
import type { ThemeEffect } from './effects/EffectOverlay';
import { useScreenSize } from '../components/ScreenSize';

const USE_NATIVE = Platform.OS !== 'web';
const FADE_MS = 650;

// Hiệu ứng riêng của từng bộ màu (Skia lỗi hoặc web thì mờ dần)
const EFFECT_OF: Record<ThemePresetId, ThemeEffect> = {
  dark: 'ink', light: 'sun', green: 'leaves', ocean: 'ripple', latte: 'coffee', snow: 'snow', sakura: 'sun', meteor: 'ink', starry: 'ink', aurora: 'ink', rain: 'ripple', neon: 'ink', cover: 'ink',
};

// Skia chỉ nạp trên iOS/Android (web chưa cài CanvasKit)
const effects = Platform.OS === 'web' ? null : (require('./effects/EffectOverlay') as typeof import('./effects/EffectOverlay'));

export type Point = { x: number; y: number };
type Ctx = { changePreset: (id: ThemePresetId, origin?: Point, followSystem?: boolean) => void; busy: boolean };
const TransitionContext = createContext<Ctx | null>(null);
export const useThemeTransition = () => {
  const c = useContext(TransitionContext);
  if (!c) throw new Error('useThemeTransition must be used inside ThemeTransition');
  return c;
};

type Shot = {
  uri: string;
  effect: ThemeEffect | null;
  image: import('@shopify/react-native-skia').SkImage | null;
  origin: Point;
};

// Đổi bộ màu cho cả app:
//  1. Chụp lại màn hình hiện tại, đặt ảnh chụp đè lên trên cùng
//  2. Đổi theme ngay bên dưới (người dùng không thấy cú đổi vì ảnh chụp đang che)
//  3. Gỡ ảnh chụp bằng hiệu ứng của bộ màu mới: Snow = băng giá lan ra + tuyết rơi, Green = lá bay;
//     các bộ khác: ảnh chụp mờ dần. Hiệu ứng bắt đầu từ chỗ ngón tay bấm (origin)
// Lớp hiệu ứng không chặn ngón tay, nên đang chuyển vẫn bấm / đổi tab bình thường.
// Nạp ảnh chụp màn hình vào Skia. view-shot có khi trả đường dẫn không có "file://" (Skia cần có),
// nên thử lần lượt: đường dẫn đã chuẩn hoá → đọc file thành base64
async function loadSkiaImage(uri: string) {
  const { Skia } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
  const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
  try {
    const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(fileUri));
    if (img) return img;
  } catch (e) {
    console.warn('[theme] load shot (uri)', e);
  }
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const b64 = await new File(fileUri).base64();
    const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64));
    if (img) return img;
  } catch (e) {
    console.warn('[theme] load shot (base64)', e);
  }
  return null;
}

export function ThemeTransition({ children }: { children: React.ReactNode }) {
  const { theme, setPreset } = useTheme();
  const { width, height } = useScreenSize();
  const root = useRef<React.ElementRef<typeof View>>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [holdImage, setHoldImage] = useState(true); // ảnh chụp kiểu thường che màn hình trong lúc chờ đổi theme
  const pending = useRef<ThemePresetId | null>(null);
  const pendingFollow = useRef(false); // bộ mới được chọn qua thẻ "Theo hệ thống"
  const switched = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;
  const progress = useSharedValue(0);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const finish = useCallback(() => {
    pending.current = null;
    setShot((s) => {
      s?.image?.dispose?.();
      return null;
    });
  }, []);

  const applyPreset = useCallback(
    (id: ThemePresetId) => {
      switched.current = true;
      // đo cả app vẽ lại theo theme mới mất bao lâu (log 13/11: đổi theme → luồng JS đứng 5–9 giây, chưa rõ phần nào)
      const t0 = Date.now();
      setPreset(id, pendingFollow.current);
      requestAnimationFrame(() => {
        const { log } = require('../data/applog') as typeof import('../data/applog');
        log('jank', `đổi theme: cả app vẽ lại theo theme mới ${Date.now() - t0}ms`);
      });
    },
    [setPreset]
  );

  const changePreset = useCallback(
    async (id: ThemePresetId, origin?: Point, followSystem = false) => {
      const t = themeRef.current;
      if (pending.current) return;
      // Cùng bộ màu (ví dụ đang Dark, bấm "Theo hệ thống" khi điện thoại cũng đang tối): chỉ đổi cờ, không cần hiệu ứng
      if (id === t.preset) {
        if (followSystem !== t.followSystem) setPreset(id, followSystem);
        return;
      }
      pendingFollow.current = followSystem;
      // Nền video: ảnh chụp thường ra đen ở phần video, nên đổi thẳng (nền vẫn là video nên không thấy giật)
      const canShot = Platform.OS !== 'web' && !(t.background.type === 'video' && t.background.uri);
      if (!canShot) return setPreset(id, followSystem);
      pending.current = id;
      switched.current = false;
      try {
        const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
        // Player đang đóng: gỡ tạm khỏi khung hình rồi mới chụp (log 13/11: đổi sang Trời sao trong Theme Studio làm app đơ 7–9 giây
        // ngay lúc chụp; player đĩa than ẩn bên dưới có ảnh to, khói Skia và kính mờ)
        const { playerShotHide, playerProgress } = require('../components/PlayerTransition') as typeof import('../components/PlayerTransition');
        const hide = playerProgress.value < 0.003;
        if (hide) {
          playerShotHide.value = 1;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
        const t0 = Date.now();
        let uri: string;
        try {
          uri = await captureRef(root as any, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
        } finally {
          if (hide) playerShotHide.value = 0;
        }
        const { log } = require('../data/applog') as typeof import('../data/applog');
        log('jank', `đổi theme: chụp màn hình ${Date.now() - t0}ms`);

        // Bộ có hiệu ứng riêng: nạp ảnh chụp vào Skia để shader "xoá" dần
        let effect: ThemeEffect | null = EFFECT_OF[id];
        let image: Shot['image'] = null;
        if (effect && effects && !effects.effectReady(effect)) {
          console.warn('[theme] effect skipped: shader not available');
          effect = null;
        }
        if (effect && effects) {
          image = await loadSkiaImage(uri);
          if (!image) {
            console.warn('[theme] effect skipped: could not load screenshot into Skia');
            effect = null;
          }
        } else effect = null;

        fade.setValue(1);
        progress.value = 0;
        setHoldImage(true);
        setShot({ uri, effect, image, origin: origin ?? { x: width / 2, y: height / 2 } });
        // Lưới an toàn: quá 1,5 giây mà theme vẫn chưa đổi (ảnh chụp không hiện được...) thì đổi thẳng và gỡ ảnh chụp
        setTimeout(() => {
          if (pending.current !== id || switched.current) return;
          applyPreset(id);
          finish();
        }, 1500);
      } catch (e) {
        console.warn('[theme] capture', e);
        pending.current = null;
        setPreset(id, followSystem);
      }
    },
    [setPreset, applyPreset, finish, fade, progress, width, height]
  );

  // Ảnh chụp đã hiện lên trên cùng (chờ thêm một khung hình cho chắc): lúc này mới đổi theme bên dưới
  const onShotShown = () => {
    const id = pending.current;
    if (id) requestAnimationFrame(() => applyPreset(id));
  };

  // Theme mới đã vẽ xong bên dưới: chạy hiệu ứng gỡ ảnh chụp
  useEffect(() => {
    if (!shot || !pending.current || theme.preset !== pending.current) return;
    const raf = requestAnimationFrame(() => {
      if (shot.effect && effects) {
        // Lớp Skia (đã vẽ sẵn ảnh chụp ở progress 0) thay chỗ ảnh chụp thường, rồi chạy hiệu ứng
        setHoldImage(false);
        progress.value = withTiming(1, { duration: effects.EFFECT_MS[shot.effect], easing: REasing.linear }, (done) => {
          if (done) runOnJS(finish)();
        });
      } else {
        Animated.timing(fade, { toValue: 0, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: USE_NATIVE }).start(finish);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [theme.preset, shot, fade, progress, finish]);

  const Overlay = effects?.EffectOverlay;
  return (
    <TransitionContext.Provider value={{ changePreset, busy: !!shot }}>
      <View ref={root} collapsable={false} style={{ flex: 1 }}>
        {children}
      </View>
      {shot && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
          {shot.effect && shot.image && Overlay && (
            <Overlay effect={shot.effect} image={shot.image} origin={shot.origin} progress={progress} width={width} height={height} />
          )}
          {(!shot.effect || holdImage) && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
              <Image
                source={{ uri: shot.uri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onLoad={onShotShown}
                onError={() => {
                  const id = pending.current;
                  finish();
                  if (id) applyPreset(id);
                }}
                fadeDuration={0}
              />
            </Animated.View>
          )}
        </View>
      )}
    </TransitionContext.Provider>
  );
}
