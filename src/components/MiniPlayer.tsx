import React, { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useDraggable } from './useDraggable';
import type { MiniAnchor } from '../theme/types';
import { Cover } from './Cover';
import { playerOrigin } from './PlayerTransition';
import type { ViewRef } from '../player/PlayerProvider';
import { FULL_LENGTH, MP_ALBUM, MP_BUTTON, MP_GAP, MP_PADDING, MP_THICKNESS, resolveMini, useFrame } from './layout';

const USE_NATIVE = Platform.OS !== 'web';

export function MiniPlayer({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { theme, setMiniPlayerAnchor, setMiniPlayerCollapsed } = useTheme();
  const frame = useFrame();
  const { track, isPlaying, togglePlay, next, prev, playerRef, emergeFrom, setEmergeFrom } = usePlayer();
  const insets = useSafeAreaInsets();
  const albumRef = useRef<ViewRef>(null);

  // Vị trí và trạng thái bubble đang hiển thị nằm ở state cục bộ: đổi là mini player đổi ngay, chỉ nó vẽ lại.
  // Theme (làm 10 nơi vẽ lại + stringify + ghi ổ đĩa) được cập nhật muộn, sau khi animation đã xong.
  const [live, setLive] = useState({ anchor: theme.miniPlayer.anchor, collapsed: theme.miniPlayer.collapsed });
  useEffect(() => {
    // Theme đổi từ nơi khác (đọc từ ổ đĩa, đặt lại mặc định...) thì theo theme
    setLive((l) => (l.anchor === theme.miniPlayer.anchor && l.collapsed === theme.miniPlayer.collapsed ? l : { anchor: theme.miniPlayer.anchor, collapsed: theme.miniPlayer.collapsed }));
  }, [theme.miniPlayer.anchor, theme.miniPlayer.collapsed]);

  const setters = useRef({ setMiniPlayerAnchor, setMiniPlayerCollapsed });
  setters.current = { setMiniPlayerAnchor, setMiniPlayerCollapsed };
  const pending = useRef<{ anchor?: MiniAnchor; collapsed?: boolean }>({});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    const p = pending.current;
    pending.current = {};
    if (p.anchor === undefined && p.collapsed === undefined) return;
    startTransition(() => {
      if (p.anchor) setters.current.setMiniPlayerAnchor(p.anchor);
      if (p.collapsed !== undefined) setters.current.setMiniPlayerCollapsed(p.collapsed);
    });
  }, []);
  const busy = useRef(false);
  const persist = useCallback(
    (patch: { anchor?: MiniAnchor; collapsed?: boolean }) => {
      Object.assign(pending.current, patch);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => (busy.current ? persist({}) : flush()), 1500);
    },
    [flush]
  );
  const setAnchor = useCallback(
    (a: MiniAnchor) => {
      setLive((l) => ({ ...l, anchor: a }));
      persist({ anchor: a });
    },
    [persist]
  );
  const setCollapsed = useCallback(
    (c: boolean) => {
      setLive((l) => ({ ...l, collapsed: c }));
      persist({ collapsed: c });
    },
    [persist]
  );
  useEffect(() => flush, [flush]); // thoát màn hình thì ghi nốt phần còn chờ

  const collapsed = live.collapsed; // đang thu nhỏ thành bubble, chỉ còn ảnh album
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // ---- Hình học (tính trước mọi hook dùng tới nó)
  const rect = resolveMini(theme, insets, frame.width, frame.height, live.anchor, collapsed);
  const vertical = rect.vertical; // đứng dọc hay nằm ngang (đã tính cả việc đứng dọc cạnh dock ở góc)
  // Đứng dọc ở nửa dưới màn hình thì ảnh album nằm dưới cùng, ở nửa trên thì nằm trên cùng
  const albumAtEnd = vertical && rect.y + rect.h / 2 > frame.height / 2;
  // Tâm ảnh album tính từ góc trên trái của mini player. Ảnh luôn đứng yên khi khung co/giãn.
  const half = MP_THICKNESS / 2;
  const albumCY = albumAtEnd ? rect.h - half : half;
  const geom = { x: rect.x + frame.left, y: rect.y, cy: albumCY };
  const geomRef = useRef(geom);

  // ---- Thả ở chỗ mới / đổi bubble: trượt ảnh album từ chỗ cũ tới chỗ mới
  const landing = useRef<{ dx: number; dy: number } | null>(null);
  const drop = useCallback(
    (a: MiniAnchor, dx: number, dy: number) => {
      landing.current = { dx, dy };
      setAnchor(a);
    },
    [setAnchor]
  );

  const d = useDraggable('player', {
    anchor: live.anchor,
    origin: () => {
      const g = geomRef.current;
      return { cx: g.x + half, cy: g.y + g.cy };
    },
    drop,
  });
  busy.current = d.active;

  useLayoutEffect(() => {
    const prevGeom = geomRef.current;
    geomRef.current = geom;
    const l = landing.current;
    landing.current = null;
    if (!l) return;
    // Ngay sau khi đổi chỗ, đặt pan sao cho ảnh album vẫn ở đúng chỗ cũ (chỗ ngón tay vừa nhả), rồi trượt về 0.
    // Chỉ dùng hình học: không đo, không ẩn hiện.
    const ox = prevGeom.x + half + l.dx - (geom.x + half);
    const oy = prevGeom.y + prevGeom.cy + l.dy - (geom.y + geom.cy);
    d.pan.stopAnimation();
    d.pan.setValue({ x: ox, y: oy });
    Animated.timing(d.pan, { toValue: { x: 0, y: 0 }, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [geom.x, geom.y, geom.cy, live.anchor, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  // Giữ lâu thì co lại thành hình tròn (pill) hoặc hình vuông bo góc (rect), chỉ còn ảnh album. Thả ra thì dãn lại.
  // Dùng giá trị riêng chạy bằng JS vì đổi width/height không dùng được native driver.
  const shrink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const to = d.active || collapsed ? 1 : 0;
    // Thu lại thì êm, dãn ra thì nảy nhẹ cho có cảm giác kéo giãn
    Animated.spring(shrink, { toValue: to, friction: to ? 9 : 6, tension: 120, useNativeDriver: false }).start();
  }, [d.active, collapsed, shrink]);

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

  const pill = theme.miniPlayer.variant === 'pill';
  const radius = pill ? MP_THICKNESS / 2 : theme.miniPlayer.style.rectRadius;
  const albumRadius = pill ? MP_ALBUM / 2 : 12;
  const lit = d.active || d.merging;

  const btn = { width: MP_BUTTON, height: MP_BUTTON, alignItems: 'center' as const, justifyContent: 'center' as const };

  // Đang kéo: nổi lên với bóng đổ mờ, không viền
  const glow = lit
    ? {
        shadowColor: '#000',
        shadowOpacity: 0.45,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 14,
      }
    : null;

  const size = vertical ? { width: MP_THICKNESS, height: FULL_LENGTH } : { width: FULL_LENGTH, height: MP_THICKNESS };

  // Bấm 1 lần vào ảnh: mở player. Bấm 2 lần: thu thành bubble (hoặc dãn lại thành mini player nếu đang là bubble).
  // Phải đợi một chút sau lần bấm đầu để biết có lần bấm thứ hai không.
  const openPlayer = () => {
    if (!albumRef.current) return onOpen();
    albumRef.current.measureInWindow((x, y, w, h) => {
      playerOrigin.current = { x, y, w, h, r: albumRadius };
      onOpen();
    });
  };
  const onAlbumPress = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      landing.current = { dx: 0, dy: 0 };
      setCollapsed(!collapsedRef.current);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      openPlayer();
    }, 230);
  };

  // Ba nút bị hút vào giữa ảnh album khi thu nhỏ
  const btnLen = 3 * MP_BUTTON + 2 * MP_GAP;
  const pull = (albumAtEnd ? 1 : -1) * (MP_ALBUM / 2 + MP_GAP + btnLen / 2);
  const pullAnim = shrink.interpolate({ inputRange: [0, 1], outputRange: [0, pull] });
  const btnScale = shrink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2], extrapolate: 'clamp' });
  const wAnim = shrink.interpolate({ inputRange: [0, 1], outputRange: [size.width, MP_THICKNESS] });
  const hAnim = shrink.interpolate({ inputRange: [0, 1], outputRange: [size.height, MP_THICKNESS] });
  const btnOpacity = shrink.interpolate({ inputRange: [0, 0.7], outputRange: [1, 0], extrapolate: 'clamp' });

  // QUAN TRỌNG: hai lớp mang hiệu ứng native (pan, scale/opacity) có kích thước CỐ ĐỊNH = rect.
  // iOS (RN Fabric) áp lại transform từ props cũ mỗi khi view có transform đổi kích thước,
  // nên nếu chúng co giãn theo khung (shrink chạy bằng JS) thì mini player bị giựt về chỗ cũ.
  // Khung co giãn nằm bên trong, dính vào phía ảnh album.
  const box = { width: rect.w, height: rect.h };

  return (
    <View pointerEvents="box-none" style={[styles.layer, { left: rect.x, top: rect.y, zIndex: d.zIndex }]}>
      <View ref={playerRef} collapsable={false} pointerEvents="box-none" style={box}>
        <Animated.View
          {...d.panHandlers}
          pointerEvents="box-none"
          style={[box, { transform: [{ translateX: d.pan.x }, { translateY: d.pan.y }] }]}
        >
          <Animated.View
            pointerEvents="box-none"
            style={[
              box,
              {
                justifyContent: albumAtEnd ? 'flex-end' : 'flex-start',
                alignItems: 'flex-start',
                opacity: d.opacity,
                transform: [{ scale: d.scale }],
                transformOrigin: [half, albumCY, 0],
              },
              glow,
            ]}
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
                  ...(albumAtEnd ? { bottom: 0 } : { top: 0 }),
                  width: size.width,
                  height: size.height,
                  flexDirection: vertical ? (albumAtEnd ? 'column-reverse' : 'column') : 'row',
                  alignItems: 'center',
                  padding: MP_PADDING,
                  gap: MP_GAP,
                }}
              >
                <Pressable ref={albumRef} collapsable={false} {...d.pressProps} onPress={onAlbumPress} style={{ zIndex: 2 }}>
                  <Cover track={track} style={{ width: MP_ALBUM, height: MP_ALBUM, borderRadius: albumRadius }}>
                    <Ionicons name="musical-notes" size={20} color="rgba(255,255,255,0.85)" />
                  </Cover>
                </Pressable>
                <Animated.View
                  pointerEvents={collapsed ? 'none' : 'auto'}
                  style={{
                    zIndex: 1,
                    flexDirection: vertical ? 'column' : 'row',
                    alignItems: 'center',
                    gap: MP_GAP,
                    opacity: btnOpacity,
                    transform: [vertical ? { translateY: pullAnim } : { translateX: pullAnim }, { scale: btnScale }],
                  }}
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
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});
