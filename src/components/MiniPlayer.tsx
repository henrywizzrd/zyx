import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useDraggable } from './useDraggable';
import { Cover } from './Cover';
import { playerOrigin } from './PlayerTransition';
import type { ViewRef } from '../player/PlayerProvider';
import { computeLayout, isVertical, MP_ALBUM, MP_BUTTON, MP_GAP, MP_PADDING, MP_THICKNESS, playerSize } from './layout';

const USE_NATIVE = Platform.OS !== 'web';

export function MiniPlayer({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { theme } = useTheme();
  const { track, isPlaying, togglePlay, next, prev, playerRef, emergeFrom, setEmergeFrom } = usePlayer();
  const insets = useSafeAreaInsets();
  const d = useDraggable('player');
  const albumRef = useRef<ViewRef>(null);

  // Giữ lâu thì co lại thành hình tròn (pill) hoặc hình vuông bo góc (rect), chỉ còn ảnh album. Thả ra thì dãn lại.
  // Dùng giá trị riêng chạy bằng JS vì đổi width/height không dùng được native driver.
  const shrink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(shrink, { toValue: d.active ? 1 : 0, friction: 8, tension: 120, useNativeDriver: false }).start();
  }, [d.active, shrink]);

  // Cho hiệu ứng đóng player đo lại vị trí thật của ảnh album ở chỗ mini player hiện tại
  useEffect(() => {
    playerOrigin.measureLive = (cb) => {
      requestAnimationFrame(() => {
        if (!albumRef.current) return cb(null);
        const r = theme.miniPlayer.variant === 'pill' ? MP_ALBUM / 2 : 12;
        albumRef.current.measureInWindow((x, y, w, h) => cb({ x, y, w, h, r }));
      });
    };
  });

  // Hiệu ứng tách ra: bay từ mục Player trên dock về vị trí của mini player.
  // Chạy bằng layout effect để mini player được ẩn trước khi kịp hiện ra ở chỗ cuối.
  useLayoutEffect(() => {
    if (theme.miniPlayer.merged || hidden) return;
    const origin = emergeFrom;
    d.pan.stopAnimation();
    d.scale.stopAnimation();
    d.opacity.stopAnimation();
    d.pan.setValue({ x: 0, y: 0 });

    if (!origin) {
      d.scale.setValue(1);
      d.opacity.setValue(1);
      return;
    }

    d.scale.setValue(0.3);
    d.opacity.setValue(0);
    playerRef.current?.measureInWindow((x, y, w, h) => {
      d.pan.setValue({ x: origin.cx - (x + w / 2), y: origin.cy - (y + h / 2) });
      Animated.parallel([
        Animated.spring(d.pan, { toValue: { x: 0, y: 0 }, friction: 6, tension: 80, useNativeDriver: USE_NATIVE }),
        Animated.spring(d.scale, { toValue: 1, friction: 6, useNativeDriver: USE_NATIVE }),
        Animated.timing(d.opacity, { toValue: 1, duration: 160, useNativeDriver: USE_NATIVE }),
      ]).start();
      setEmergeFrom(null);
    });
  }, [theme.miniPlayer.merged, hidden]);

  if (theme.miniPlayer.merged || hidden) return null;

  const { playerStyle, playerPosition } = computeLayout(theme, insets);
  const vertical = isVertical(playerPosition);
  const pill = theme.miniPlayer.variant === 'pill';
  const radius = pill ? MP_THICKNESS / 2 : theme.miniPlayer.style.rectRadius;
  const albumRadius = pill ? MP_ALBUM / 2 : 12;
  const lit = d.active || d.merging;

  const btn = { width: MP_BUTTON, height: MP_BUTTON, alignItems: 'center' as const, justifyContent: 'center' as const };

  const glow = lit
    ? {
        shadowColor: theme.colors.accent,
        shadowOpacity: 0.9,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 0 },
        elevation: 14,
      }
    : null;

  const size = playerSize(playerPosition);
  const wAnim = shrink.interpolate({ inputRange: [0, 1], outputRange: [size.width, MP_THICKNESS] });
  const hAnim = shrink.interpolate({ inputRange: [0, 1], outputRange: [size.height, MP_THICKNESS] });
  const btnOpacity = shrink.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View pointerEvents="box-none" style={[styles.layer, playerStyle, { zIndex: d.zIndex }]}>
      <View ref={playerRef} collapsable={false}>
        <Animated.View
          {...d.panHandlers}
          style={{
            opacity: d.opacity,
            transform: [{ translateX: d.pan.x }, { translateY: d.pan.y }, { scale: d.scale }],
            ...glow,
          }}
        >
          {/* Khung co giãn: nền và bo góc nằm ở đây, nội dung bên trong giữ nguyên cỡ và bị cắt khi khung co lại */}
          <Animated.View
            style={{
              width: wAnim,
              height: hAnim,
              borderRadius: radius,
              backgroundColor: theme.miniPlayer.style.background,
              overflow: 'hidden',
            }}
          >
            <Pressable
              {...d.pressProps}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: size.width,
                height: size.height,
                flexDirection: vertical ? 'column' : 'row',
                alignItems: 'center',
                padding: MP_PADDING,
                gap: MP_GAP,
              }}
            >
              <Pressable
                ref={albumRef}
                collapsable={false}
                {...d.pressProps}
                onPress={() => {
                  if (!albumRef.current) return onOpen();
                  albumRef.current.measureInWindow((x, y, w, h) => {
                    playerOrigin.current = { x, y, w, h, r: albumRadius };
                    onOpen();
                  });
                }}
              >
                <Cover track={track} style={{ width: MP_ALBUM, height: MP_ALBUM, borderRadius: albumRadius }}>
                  <Ionicons name="musical-notes" size={20} color="rgba(255,255,255,0.85)" />
                </Cover>
              </Pressable>
              <Animated.View
                style={{ flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: MP_GAP, opacity: btnOpacity }}
              >
                <Pressable {...d.pressProps} onPress={prev} style={btn}>
                  <Ionicons name="play-skip-back" size={20} color={theme.colors.text} />
                </Pressable>
                <Pressable {...d.pressProps} onPress={togglePlay} style={btn}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color={theme.colors.text} />
                </Pressable>
                <Pressable {...d.pressProps} onPress={next} style={btn}>
                  <Ionicons name="play-skip-forward" size={20} color={theme.colors.text} />
                </Pressable>
              </Animated.View>
            </Pressable>
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { borderRadius: radius, borderWidth: 2, borderColor: theme.colors.accent, opacity: lit ? 1 : 0 },
              ]}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});