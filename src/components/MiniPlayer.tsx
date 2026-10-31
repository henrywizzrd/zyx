import React, { useLayoutEffect, useRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { computeLayout, isVertical, MP_ALBUM, MP_BUTTON, MP_GAP, MP_PADDING, MP_THICKNESS } from './layout';

const USE_NATIVE = Platform.OS !== 'web';
const HOVER_PAD = 28; // kéo tới cách dock bao nhiêu px thì tính là "chạm vào dock"

type Rect = { x: number; y: number; w: number; h: number };

function isOver(r: Rect | null, px: number, py: number) {
  if (!r) return false;
  return px > r.x - HOVER_PAD && px < r.x + r.w + HOVER_PAD && py > r.y - HOVER_PAD && py < r.y + r.h + HOVER_PAD;
}

export function MiniPlayer({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { theme, setMerged } = useTheme();
  const { track, isPlaying, togglePlay, next, prev, dockRef, setHoverDock, emergeFrom, setEmergeFrom } = usePlayer();
  const insets = useSafeAreaInsets();

  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const viewRef = useRef<View>(null);
  const start = useRef({ cx: 0, cy: 0 });
  const dockRect = useRef<Rect | null>(null);

  // Hiệu ứng tách ra: bay từ mục Player trên dock về vị trí của mini player.
  // Chạy bằng layout effect để mini player được ẩn trước khi kịp hiện ra ở chỗ cuối.
  useLayoutEffect(() => {
    if (theme.miniPlayer.merged || hidden) return;
    const origin = emergeFrom;
    pan.setValue({ x: 0, y: 0 });

    if (!origin) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }

    scale.setValue(0.3);
    opacity.setValue(0);
    viewRef.current?.measureInWindow((x, y, w, h) => {
      pan.setValue({ x: origin.cx - (x + w / 2), y: origin.cy - (y + h / 2) });
      Animated.parallel([
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, tension: 80, useNativeDriver: USE_NATIVE }),
        Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: USE_NATIVE }),
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: USE_NATIVE }),
      ]).start();
      setEmergeFrom(null);
    });
  }, [theme.miniPlayer.merged, hidden]);

  const snapBack = () => {
    Animated.parallel([
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: USE_NATIVE }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: USE_NATIVE }),
    ]).start();
  };

  const responder = useRef(
    PanResponder.create({
      // Chỉ nhận cử chỉ kéo khi ngón tay di chuyển đủ xa, để các nút vẫn bấm bình thường
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 8,
      onPanResponderGrant: () => {
        viewRef.current?.measureInWindow((x, y, w, h) => {
          start.current = { cx: x + w / 2, cy: y + h / 2 };
        });
        dockRef.current?.measureInWindow((x, y, w, h) => {
          dockRect.current = { x, y, w, h };
        });
        Animated.spring(scale, { toValue: 1.06, useNativeDriver: USE_NATIVE }).start();
      },
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        setHoverDock(isOver(dockRect.current, g.moveX, g.moveY));
      },
      onPanResponderRelease: (_, g) => {
        const r = dockRect.current;
        if (r && isOver(r, g.moveX, g.moveY)) {
          // Bay vào giữa dock, nhỏ dần rồi hợp nhất
          const tx = r.x + r.w / 2 - start.current.cx;
          const ty = r.y + r.h / 2 - start.current.cy;
          Animated.parallel([
            Animated.timing(pan, { toValue: { x: tx, y: ty }, duration: 200, useNativeDriver: USE_NATIVE }),
            Animated.timing(scale, { toValue: 0.3, duration: 200, useNativeDriver: USE_NATIVE }),
            Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: USE_NATIVE }),
          ]).start(() => {
            setHoverDock(false);
            setMerged(true);
          });
        } else {
          setHoverDock(false);
          snapBack();
        }
      },
      onPanResponderTerminate: () => {
        setHoverDock(false);
        snapBack();
      },
    })
  ).current;

  if (theme.miniPlayer.merged || hidden) return null;

  const { playerStyle, playerPosition } = computeLayout(theme, insets);
  const vertical = isVertical(playerPosition);
  const pill = theme.miniPlayer.variant === 'pill';
  const radius = pill ? MP_THICKNESS / 2 : theme.miniPlayer.style.rectRadius;
  const albumRadius = pill ? MP_ALBUM / 2 : 12;

  const btn = { width: MP_BUTTON, height: MP_BUTTON, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <View pointerEvents="box-none" style={[styles.layer, playerStyle]}>
      <View ref={viewRef} collapsable={false}>
        <Animated.View
          {...responder.panHandlers}
          style={{
            flexDirection: vertical ? 'column' : 'row',
            alignItems: 'center',
            padding: MP_PADDING,
            gap: MP_GAP,
            backgroundColor: theme.miniPlayer.style.background,
            borderRadius: radius,
            opacity,
            transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }],
          }}
        >
          <Pressable onPress={onOpen}>
            <View
              style={{
                width: MP_ALBUM,
                height: MP_ALBUM,
                borderRadius: albumRadius,
                backgroundColor: track.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="musical-notes" size={20} color="rgba(255,255,255,0.85)" />
            </View>
          </Pressable>
          <Pressable onPress={prev} style={btn}>
            <Ionicons name="play-skip-back" size={20} color={theme.colors.text} />
          </Pressable>
          <Pressable onPress={togglePlay} style={btn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color={theme.colors.text} />
          </Pressable>
          <Pressable onPress={next} style={btn}>
            <Ionicons name="play-skip-forward" size={20} color={theme.colors.text} />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', zIndex: 10 },
});