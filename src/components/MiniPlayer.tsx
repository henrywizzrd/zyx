import React, { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerPick } from '../player/PlayerProvider';
import { useDraggable } from './useDraggable';
import type { MiniAnchor } from '../theme/types';
import { Cover } from './Cover';
import { playerOrigin } from './PlayerTransition';
import { MP_THICKNESS, resolveMini, useFrame } from './layout';

const USE_NATIVE = Platform.OS !== 'web';

export function MiniPlayer({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { theme, setMiniPlayerAnchor, setMiniPlayerCollapsed } = useTheme();
  const frame = useFrame();
  const { track, playerRef, emergeFrom, setEmergeFrom } = usePlayerPick('track', 'playerRef', 'emergeFrom', 'setEmergeFrom');
  const insets = useSafeAreaInsets();

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
  useEffect(() => flush, [flush]); // thoát màn hình thì ghi nốt phần còn chờ

  // Mini player giờ chỉ còn một "bong bóng": ảnh album tròn hoặc vuông bo góc (tuỳ chọn trong Cài đặt), không viền,
  // không nút. Bấm vào thì bong bóng nở ra thành màn player (kiểu bong bóng cửa sổ nổi của Xiaomi / OPPO).
  // Giữ lâu rồi kéo: đổi chỗ, hoặc thả vào dock để gộp (như cũ)
  const S = MP_THICKNESS; // cỡ bong bóng
  const round = theme.miniPlayer.variant === 'pill';
  const bubbleRadius = round ? S / 2 : 16;

  // Dock đang ở dạng bubble (một góc dưới): mini player luôn nằm ở góc dưới đối diện
  const bubbleDock = theme.dock.mode === 'bubble';
  const anchor: MiniAnchor = bubbleDock ? { edge: 'bottom', t: theme.dock.bubbleSide === 'right' ? 0 : 1 } : live.anchor;

  // ---- Hình học (tính trước mọi hook dùng tới nó): luôn ở dạng bong bóng
  const rect = resolveMini(theme, insets, frame.width, frame.height, anchor, true);
  const half = S / 2;
  const geom = { x: rect.x + frame.left, y: rect.y };
  const geomRef = useRef(geom);

  // Vị trí thật của bong bóng trên màn hình (tính từ hình học, không đo): player nở ra từ đây và thu về đúng đây
  useLayoutEffect(() => {
    if (hidden || theme.miniPlayer.merged) return;
    playerOrigin.current = { x: geom.x, y: geom.y, w: S, h: S, r: bubbleRadius };
  }, [geom.x, geom.y, S, bubbleRadius, hidden, theme.miniPlayer.merged]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Thả ở chỗ mới: trượt bong bóng từ chỗ ngón tay nhả tới chỗ mới
  const landing = useRef<{ dx: number; dy: number } | null>(null);
  const drop = useCallback(
    (a: MiniAnchor, dx: number, dy: number) => {
      landing.current = { dx, dy };
      setAnchor(a);
    },
    [setAnchor]
  );

  const d = useDraggable('player', {
    anchor,
    origin: () => {
      const g = geomRef.current;
      return { cx: g.x + half, cy: g.y + half };
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
    const ox = prevGeom.x + l.dx - geom.x;
    const oy = prevGeom.y + l.dy - geom.y;
    d.pan.stopAnimation();
    d.pan.setValue({ x: ox, y: oy });
    Animated.timing(d.pan, { toValue: { x: 0, y: 0 }, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [geom.x, geom.y, anchor.edge, anchor.t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bong bóng lún nhẹ khi ngón tay chạm vào
  const press = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.timing(press, { toValue: 0.9, duration: 70, useNativeDriver: USE_NATIVE }).start();
  const pressOut = () => Animated.spring(press, { toValue: 1, friction: 5, tension: 160, useNativeDriver: USE_NATIVE }).start();

  // Hiệu ứng tách ra: bay từ mục Player trên dock về vị trí của bong bóng.
  // Chạy bằng layout effect để bong bóng được ẩn trước khi kịp hiện ra ở chỗ cuối.
  useLayoutEffect(() => {
    if (theme.miniPlayer.merged || hidden) return;
    const origin = emergeFrom;
    d.pan.stopAnimation();
    d.scale.stopAnimation();
    d.opacity.stopAnimation();
    d.pan.setValue({ x: 0, y: 0 });
    // Lúc bấm mở player, hiệu ứng lún (0.9) bị ngắt giữa chừng vì bong bóng ẩn đi ngay => hiện lại phải về đúng cỡ,
    // nếu không player thu về đúng 60pt rồi bong bóng lại hiện ở 54pt (trông như giật nhỏ lại)
    press.stopAnimation();
    press.setValue(1);

    if (!origin) {
      d.scale.setValue(1);
      d.opacity.setValue(1);
      return;
    }

    d.scale.setValue(0.3);
    d.opacity.setValue(0);
    const g = geomRef.current;
    d.pan.setValue({ x: origin.cx - (g.x + half), y: origin.cy - (g.y + half) });
    Animated.parallel([
      Animated.spring(d.pan, { toValue: { x: 0, y: 0 }, friction: 6, tension: 80, useNativeDriver: USE_NATIVE }),
      Animated.spring(d.scale, { toValue: 1, friction: 6, useNativeDriver: USE_NATIVE }),
      Animated.timing(d.opacity, { toValue: 1, duration: 160, useNativeDriver: USE_NATIVE }),
    ]).start();
    setEmergeFrom(null);
  }, [theme.miniPlayer.merged, hidden]);

  if (theme.miniPlayer.merged || hidden) return null;

  // Bấm 1 lần: mở player ngay (không còn chờ xem có bấm đúp không)
  const openPlayer = () => {
    const g = geomRef.current;
    playerOrigin.current = { x: g.x, y: g.y, w: S, h: S, r: bubbleRadius };
    onOpen();
  };

  return (
    <View pointerEvents="box-none" style={[styles.layer, { left: rect.x, top: rect.y, zIndex: d.zIndex }]}>
      <View ref={playerRef} collapsable={false} pointerEvents="box-none" style={{ width: S, height: S }}>
        <Animated.View {...d.panHandlers} style={{ width: S, height: S, transform: [{ translateX: d.pan.x }, { translateY: d.pan.y }] }}>
          <Animated.View
            style={[
              { width: S, height: S, borderRadius: bubbleRadius, opacity: d.opacity, transform: [{ scale: d.scale }] },
            ]}
          >
            <Pressable
              {...d.pressProps}
              onPressIn={pressIn}
              onPressOut={() => {
                pressOut();
                d.pressProps.onPressOut();
              }}
              onPress={openPlayer}
            >
              <Animated.View style={{ transform: [{ scale: press }] }}>
                <Cover track={track} size={180} style={{ width: S, height: S, borderRadius: bubbleRadius }}>
                  <Ionicons name="musical-notes" size={22} color="rgba(255,255,255,0.85)" />
                </Cover>
              </Animated.View>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  // Bong bóng không đổ bóng (trông tự nhiên hơn); lúc giữ để kéo thì chỉ phóng to nhẹ (1.08)
});
