import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Easing as REasing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from './ThemeProvider';
import type { ThemePresetId } from './presets';
import type { ThemeEffect } from './effects/EffectOverlay';

const USE_NATIVE = Platform.OS !== 'web';
const FADE_MS = 650;

// Hiệu ứng riêng của từng bộ màu (bộ chưa có thì mờ dần như cũ). Đợt sau thêm dark, light, blue, latte
const EFFECT_OF: Partial<Record<ThemePresetId, ThemeEffect>> = { snow: 'snow', green: 'leaves' };

// Skia chỉ nạp trên iOS/Android (web chưa cài CanvasKit)
const effects = Platform.OS === 'web' ? null : (require('./effects/EffectOverlay') as typeof import('./effects/EffectOverlay'));

export type Point = { x: number; y: number };
type Ctx = { changePreset: (id: ThemePresetId, origin?: Point) => void; busy: boolean };
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
export function ThemeTransition({ children }: { children: React.ReactNode }) {
  const { theme, setPreset } = useTheme();
  const { width, height } = useWindowDimensions();
  const root = useRef<React.ElementRef<typeof View>>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [holdImage, setHoldImage] = useState(true); // ảnh chụp kiểu thường che màn hình trong lúc chờ đổi theme
  const pending = useRef<ThemePresetId | null>(null);
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
      setPreset(id);
    },
    [setPreset]
  );

  const changePreset = useCallback(
    async (id: ThemePresetId, origin?: Point) => {
      const t = themeRef.current;
      if (id === t.preset || pending.current) return;
      // Nền video: ảnh chụp thường ra đen ở phần video, nên đổi thẳng (nền vẫn là video nên không thấy giật)
      const canShot = Platform.OS !== 'web' && !(t.background.type === 'video' && t.background.uri);
      if (!canShot) return setPreset(id);
      pending.current = id;
      switched.current = false;
      try {
        const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
        const uri = await captureRef(root as any, { format: 'jpg', quality: 0.92, result: 'tmpfile' });

        // Bộ có hiệu ứng riêng: nạp ảnh chụp vào Skia để shader "xoá" dần
        let effect = EFFECT_OF[id] ?? null;
        let image: Shot['image'] = null;
        if (effect && effects) {
          try {
            const { Skia } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
            const data = await Skia.Data.fromURI(uri);
            image = Skia.Image.MakeImageFromEncoded(data);
          } catch (e) {
            console.warn('[theme] load shot', e);
          }
          if (!image) effect = null;
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
        setPreset(id);
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
