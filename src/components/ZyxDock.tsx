// Dock kiểu ZYX (Cài đặt → Kiểu dock → ZYX), dựng theo trang thử "ZYX – Dock ZYX":
//  - thanh tab kính bo góc vuông (không phải viên thuốc như Apple Music), vệt chọn trượt dưới tab đang mở
//  - bên phải: bong bóng mini player cố định (ảnh bìa đúc trong khối kính — giống bong bóng của dock Bar)
//      chạm = mở player (player nở ra từ bong bóng) · giữ ~0,45s = phát / dừng (rung nhẹ)
//      chưa có bài: bong bóng kính trong suốt có nốt nhạc, chạm = mở Tìm kiếm
//  - phía trên, giữa dock: thanh "Search" nhỏ kiểu màn hình chính iOS — chạm = sang trang Tìm kiếm + bật bàn phím
//  - dock và thanh Search luôn hiện đủ, không thu khi cuộn
// Chỉ dùng khi màn hình dọc; xoay ngang thì App dùng lại dock dạng thanh dọc
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { TabId } from '../theme/types';
import { DockGlyph } from './DockIcons';
import { LABELS } from './FloatingDock';
import { ArtSlab, GlassFill, glassShadow } from './Glass';
import { usePlayerPick, ViewRef } from '../player/PlayerProvider';
import { FADE_LAND, playerOrigin, playerProgress, prewarmPlayer } from './PlayerTransition';
import { hapticSnap } from './haptics';
import { requestSearchFocus } from '../screens/searchFocus';

// M: lề hai bên · H: cao dock · R: bo góc dock · B: cỡ bong bóng · GAP: khe dock ↔ bong bóng
// SH: cao thanh Search · SGAP: khe thanh Search ↔ dock
export const ZX = { M: 14, H: 66, R: 24, B: 66, GAP: 10, SH: 34, SGAP: 16 };
export const zxBottom = (insetBottom: number) => Math.max(14, insetBottom - 8);
// Phần cuối trang cần chừa để mục cuối kéo lên được khỏi dock + thanh Search
export const zxEndPadding = (insetBottom: number) => zxBottom(insetBottom) + ZX.H + ZX.SGAP + ZX.SH + 12 - insetBottom;

const SNAP = { stiffness: 420, damping: 32, mass: 1 };
const SQUISH = { stiffness: 600, damping: 28, mass: 1 };
const HOLD_MS = 450;

type Tab = Exclude<TabId, 'player'>;

export function ZyxDock({ active, onChange, onOpenPlayer, hidden }: { active: TabId; onChange: (t: TabId) => void; onOpenPlayer: () => void; hidden: boolean }) {
  const { theme } = useTheme();
  const t = useT();
  const light = theme.colors.glassTint !== 'dark';
  const noRim = theme.dock.rimLight === false;
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { M, H, R, B, GAP, SH, SGAP } = ZX;
  const bottom = zxBottom(insets.bottom);
  const labels = theme.dock.labels;
  const { text, accent } = theme.colors;

  const tabs = theme.dock.items.filter((i): i is Tab => i !== 'player' && i !== 'search');
  const n = Math.max(1, tabs.length);
  const dockW = W - M * 2 - GAP - B;
  const PAD = 6;
  const tw = (dockW - PAD * 2) / n;
  const idx = tabs.indexOf(active as Tab);

  // ---- vệt chọn trượt dưới tab đang mở (mở player / tìm kiếm thì giữ chỗ tab cũ)
  const lastIdx = useRef(Math.max(0, idx));
  if (idx >= 0) lastIdx.current = idx;
  const pillX = useSharedValue(lastIdx.current * tw);
  useEffect(() => {
    pillX.value = reduced ? lastIdx.current * tw : withSpring(lastIdx.current * tw, SNAP);
  }, [idx, tw]); // eslint-disable-line react-hooks/exhaustive-deps
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  // ---- nhấn: phản hồi ngay lúc chạm
  const bubblePress = useSharedValue(1);
  const searchPress = useSharedValue(1);
  const squish = (sv: typeof bubblePress, k: number) => ({
    in: () => (sv.value = withSpring(reduced ? 1 : k, SQUISH)),
    out: () => (sv.value = withSpring(1, SQUISH)),
  });
  const bubbleSq = squish(bubblePress, 0.93);
  const searchSq = squish(searchPress, 0.95);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ scale: bubblePress.value }] }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ scale: searchPress.value }] }));

  // ---- theo độ mở của player: dock + thanh Search trượt xuống, bong bóng mờ đi ngay (player nở ra từ chính nó)
  const pp = playerProgress;
  const sink = bottom + H + SGAP + SH + 24;
  const barsOut = useAnimatedStyle(() => ({
    opacity: interpolate(pp.value, [0, 0.7], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(pp.value, [0, 1], [0, sink]) }],
  }));
  // Bong bóng thật tắt hẳn ngay khi player bắt đầu mở và chỉ hiện lại khi ảnh bìa đã đáp đúng chỗ (pp ≈ 0):
  // trước đây nó hiện dần từ pp 0,22 trong lúc ảnh bìa còn đang bay → thấy hai ảnh cùng lúc ("dư ảnh")
  // ...và trong đoạn cuối (pp < FADE_LAND) bong bóng thật đã nằm sẵn bên dưới để lớp hiệu ứng mờ dần lộ nó ra (Rect.fade)
  const bubbleOut = useAnimatedStyle(() => ({ opacity: pp.value < FADE_LAND ? 1 : 0 }));

  // ---- bong bóng mini player
  const { track, togglePlay } = usePlayerPick('track', 'togglePlay');
  const bubbleRef = useRef<ViewRef>(null);
  const BR = Math.round(B * 0.3);
  const held = useRef(false);
  const openPlayer = () => {
    bubbleRef.current?.measureInWindow((x, y, w, h) => {
      // sized: player thu về đúng khung bong bóng rồi lớp hiệu ứng tắt ngay, bong bóng thật hiện lên đúng chỗ đó
      // (trước đây lớp hiệu ứng còn đọng lại ~0,6s: thấy ảnh bìa trơn không viền đè lên bong bóng, rồi giật một cái)
      if (w > 0) playerOrigin.current = { x, y, w, h, r: BR, sized: true, fade: true, art: { x, y, w, h, r: BR } };
      onOpenPlayer();
    });
  };
  const onBubblePress = () => {
    if (held.current) return; // vừa giữ để phát / dừng → không mở player
    if (track) openPlayer();
    else goSearch();
  };
  const onBubbleHold = () => {
    if (!track) return;
    held.current = true;
    hapticSnap();
    togglePlay();
  };

  const goSearch = () => {
    onChange('search');
    requestSearchFocus();
  };

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.abs, { left: 0, right: 0, bottom, height: H + SGAP + SH + 12 }]}>
        {/* thanh Search nhỏ, giữa phía trên dock */}
        <Animated.View pointerEvents="box-none" style={[styles.abs, { left: M, width: dockW, bottom: H + SGAP, height: SH, alignItems: 'center' }, barsOut]}>
          <Animated.View style={[{ height: SH, borderRadius: SH / 2, borderCurve: 'continuous' }, glassShadow(0.6, light), searchStyle]}>
            <GlassFill radius={SH / 2} solid={0.35} slab noRim={noRim} />
            <Pressable
              testID="zyx-search"
              accessibilityRole="search"
              onPress={goSearch}
              onPressIn={searchSq.in}
              onPressOut={searchSq.out}
              hitSlop={8}
              style={styles.searchRow}
            >
              <Ionicons name="search" size={15} color={text} />
              <Text style={{ color: text, fontSize: 15, fontWeight: '700' }}>{t('tab.search')}</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>

        {/* thanh tab bo góc vuông */}
        <Animated.View style={[styles.abs, { left: M, bottom: 0, width: dockW, height: H, borderRadius: R, borderCurve: 'continuous' }, glassShadow(1, light), barsOut]}>
          <GlassFill radius={R} solid={0.5} slab noRim={noRim} />
          {idx >= 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.abs,
                { left: PAD, top: PAD, width: tw, height: H - PAD * 2, borderRadius: R - PAD, borderCurve: 'continuous', backgroundColor: light ? 'rgba(0,0,0,0.065)' : 'rgba(255,255,255,0.12)' },
                pillStyle,
              ]}
            />
          )}
          <View style={[styles.row, { left: PAD, right: PAD }]}>
            {tabs.map((id) => {
              const on = id === active;
              const color = on ? accent : text;
              return (
                <Pressable key={id} testID={`zyx-tab-${id}`} onPress={() => onChange(id)} style={[styles.cell, { width: tw }]}>
                  <DockGlyph id={id} size={labels ? 26 : 28} color={color} />
                  {labels && (
                    <Text numberOfLines={1} style={{ color, fontSize: 10, fontWeight: '600', marginTop: 2 }}>
                      {t(LABELS[id])}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* bong bóng mini player cố định ở góc phải */}
        {/* đo vị trí ở khung NGOÀI (không co khi nhấn): đo khung đang co thì player nở ra / thu về sai cỡ (62 thay vì 66) */}
        <Animated.View ref={bubbleRef} collapsable={false} style={[styles.abs, { right: M, bottom: (H - B) / 2, width: B, height: B }, track ? bubbleOut : null]}>
          <Animated.View style={[{ width: B, height: B, borderRadius: BR, borderCurve: 'continuous' }, glassShadow(track ? 1.15 : 1, light), bubbleStyle]}>
            <Pressable
              testID="zyx-bubble"
              accessibilityLabel={track ? `${track.title} — ${track.artist}` : t('tab.search')}
              onPress={onBubblePress}
              onLongPress={onBubbleHold}
              delayLongPress={HOLD_MS}
              onPressIn={() => {
                held.current = false;
                bubbleSq.in();
                if (track) prewarmPlayer(); // dựng sẵn player trong lúc ngón tay còn đặt trên bong bóng
              }}
              onPressOut={bubbleSq.out}
              style={StyleSheet.absoluteFill}
            >
              {track ? (
                <ArtSlab track={track} size={B} radius={BR} />
              ) : (
                <>
                  {/* chưa có bài: kính trong suốt + nốt nhạc */}
                  <GlassFill radius={BR} solid={0} slab noRim={noRim} />
                  <View style={[StyleSheet.absoluteFill, styles.center]}>
                    <Ionicons name="musical-note" size={28} color={text} style={{ opacity: 0.85 }} />
                  </View>
                </>
              )}
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' },
  cell: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  searchRow: { height: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
});
