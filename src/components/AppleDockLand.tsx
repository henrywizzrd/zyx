// Dock kiểu Apple Music lúc xoay NGANG (Tyson chốt 20/11):
//  - dock đứng dọc sát cạnh phải: một viên thuốc kính dọc chứa các tab (trừ Tìm kiếm), vệt chọn trượt lên / xuống
//  - nút Tìm kiếm tròn tách riêng ở góc dưới bên phải, ngay dưới dock
//  - mini player dạng viên thuốc cỡ vừa nằm chính giữa phía dưới màn hình; chạm = player nở ra từ chính viên đó
//  - mở player: dock + nút tìm kiếm trượt ra mép phải, viên mini player mờ đi (giống bản dọc)
// Không có kính lúp và không thu nhỏ khi cuộn như bản dọc
// Dock ZYX lúc ngang dùng chung bố cục này (Tyson 21/11), chỉ đổi sang góc bo vuông vức của ZYX (`square`)
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { TabId } from '../theme/types';
import { requestSearchFocus } from '../screens/searchFocus';
import { DockGlyph } from './DockIcons';
import { GlassFill, glassShadow, hasLiquidGlass } from './Glass';
import { SmartImage } from './Cover';
import { usePlayerPick, ViewRef } from '../player/PlayerProvider';
import { PlayPauseGlyph, SkipGlyph } from './PlayerIcons';
import { playerOrigin, playerProgress, prewarmPlayer } from './PlayerTransition';
import { AM, amBottom, Cell } from './AppleDock';
import { DOCK_THICKNESS } from './layout';
import { hapticTick } from './haptics';
import { ZX } from './ZyxDock';

type Tab = Exclude<TabId, 'player'>;
const SNAP = { stiffness: 420, damping: 32, mass: 1 };
const SQUISH = { stiffness: 600, damping: 28, mass: 1 };
// bề ngang cột dock: gần bằng dải bên phải đã chừa cho dock (DOCK_THICKNESS 80). Bản đầu 62 → nhìn nhỏ, lệch với viên mini player (ảnh 20/11)
const COL = DOCK_THICKNESS - 4;
const ICON = 33; // icon tab (bản đầu 28)
const PAD = 5; // khe trong viên kính quanh các ô
const GAP = 12; // khe dock ↔ nút tìm kiếm
const MINI_W = 340; // bề ngang viên mini player (vừa phải, không kéo dài hết màn)

export function AppleDockLand({ active, onChange, onOpenPlayer, hidden, square }: { active: TabId; onChange: (t: TabId) => void; onOpenPlayer: () => void; hidden: boolean; square?: boolean }) {
  const { theme } = useTheme();
  const light = theme.colors.glassTint !== 'dark';
  // Rim light only with real Liquid Glass (iOS 26+), which draws its own edge light; self-drawn glass has none (27/11: setting removed)
  const noRim = !hasLiquidGlass;
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const reduced = useReducedMotion();
  const labels = theme.dock.labels;
  const bottom = amBottom(insets.bottom);
  // nằm giữa dải bên phải mà vùng nội dung đã chừa cho dock (ContentArea trong App.tsx)
  const right = insets.right + theme.dock.style.margin + (DOCK_THICKNESS - COL) / 2;

  const items = theme.dock.items.filter((i): i is Tab => i !== 'player');
  const tabs: Tab[] = items.filter((i) => i !== 'search');
  const hasSearch = items.includes('search');
  const cellH = labels ? 74 : 68;
  const colH = tabs.length * cellH + PAD * 2;
  const idx = tabs.indexOf(active as Tab);

  // ---- vệt chọn trượt dọc
  const pillY = useSharedValue(Math.max(0, idx) * cellH);
  useEffect(() => {
    if (idx >= 0) pillY.value = reduced ? idx * cellH : withSpring(idx * cellH, SNAP);
  }, [idx, cellH]); // eslint-disable-line react-hooks/exhaustive-deps
  const pillStyle = useAnimatedStyle(() => ({ opacity: idx >= 0 ? 1 : 0, transform: [{ translateY: pillY.value }] }));

  // ---- mở player: dock + nút tìm kiếm trượt ra mép phải, viên mini player mờ đi
  const pp = playerProgress;
  const sink = right + COL + 24;
  const barsOut = useAnimatedStyle(() => ({
    opacity: interpolate(pp.value, [0, 0.7], [1, 0], 'clamp'),
    transform: [{ translateX: interpolate(pp.value, [0, 1], [0, sink]) }],
  }));
  const miniOut = useAnimatedStyle(() => ({ opacity: interpolate(pp.value, [0, 0.22], [1, 0], 'clamp') }));

  // ---- nhấn: phản hồi ngay lúc chạm
  const miniPress = useSharedValue(1);
  const searchPress = useSharedValue(1);
  const squish = (sv: typeof miniPress, k: number, onIn?: () => void) => ({
    onPressIn: () => {
      onIn?.();
      sv.value = withSpring(reduced ? 1 : k, SQUISH);
    },
    onPressOut: () => (sv.value = withSpring(1, SQUISH)),
  });
  const miniStyle = useAnimatedStyle(() => ({ transform: [{ scale: miniPress.value }] }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ scale: searchPress.value }] }));

  // ---- mini player: player nở ra từ cả viên thuốc, ảnh bìa bay riêng (giống bản dọc)
  const { track, isPlaying, togglePlay, next } = usePlayerPick('track', 'isPlaying', 'togglePlay', 'next');
  const artRef = useRef<ViewRef>(null);
  const pillRef = useRef<ViewRef>(null);
  const openFromMini = () => {
    artRef.current?.measureInWindow((ax, ay, aw, ah) => {
      pillRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && aw > 0) playerOrigin.current = { x, y, w, h, r: h / 2, art: { x: ax, y: ay, w: aw, h: ah, r: 9 } };
        else if (aw > 0) playerOrigin.current = { x: ax, y: ay, w: aw, h: ah, r: 9 };
        onOpenPlayer();
      });
    });
  };
  const miniW = Math.min(MINI_W, W * 0.42);
  // góc bo: Apple = viên thuốc / tròn; ZYX = góc vuông vức (ZX.R của dock ZYX dọc)
  const colR = square ? ZX.R : COL / 2;
  const miniR = square ? ZX.R - 6 : AM.MH / 2;
  const pillR = square ? ZX.R - PAD : 999;

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
      {/* mini player: viên thuốc giữa đáy màn hình */}
      {track && (
        <Animated.View
          ref={pillRef}
          style={[styles.abs, { left: (W - miniW) / 2, bottom, width: miniW, height: AM.MH, borderRadius: miniR, borderCurve: 'continuous' }, glassShadow(1, light), miniStyle, miniOut]}
        >
          <GlassFill radius={miniR} solid={0.5} slab noRim={noRim} />
          <Pressable testID="mini-pill" onPress={openFromMini} {...squish(miniPress, 1.03, prewarmPlayer)} style={styles.miniRow}>
            <View ref={artRef} collapsable={false} style={[styles.miniArt, { backgroundColor: track.color }]}>
              {track.thumb ? <SmartImage url={track.thumb} size={96} style={StyleSheet.absoluteFill} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 1 }}>
                {track.artist}
              </Text>
            </View>
            <Pressable onPress={togglePlay} hitSlop={6} style={styles.miniBtn}>
              <PlayPauseGlyph playing={isPlaying} size={22} color={theme.colors.text} />
            </Pressable>
            <Pressable onPress={next} hitSlop={6} style={styles.miniBtn}>
              <SkipGlyph dir="forward" size={26} color={theme.colors.text} />
            </Pressable>
          </Pressable>
        </Animated.View>
      )}

      {/* dock dọc bên phải, đứng ngay trên nút tìm kiếm */}
      <Animated.View
        style={[
          styles.abs,
          { right, bottom: bottom + (hasSearch ? COL + GAP : 0), width: COL, height: colH, borderRadius: colR, borderCurve: 'continuous' },
          glassShadow(1, light),
          barsOut,
        ]}
      >
        <GlassFill radius={colR} solid={0.5} slab noRim={noRim} />
        <Animated.View
          pointerEvents="none"
          style={[styles.abs, { left: PAD, top: PAD, width: COL - PAD * 2, height: cellH, borderRadius: pillR, borderCurve: 'continuous', backgroundColor: light ? 'rgba(0,0,0,0.065)' : 'rgba(255,255,255,0.12)' }, pillStyle]}
        />
        <View style={{ paddingVertical: PAD }}>
          {tabs.map((id) => (
            <Pressable
              key={id}
              testID={`tab-${id}`}
              onPress={() => {
                if (id !== active) hapticTick();
                onChange(id);
              }}
            >
              <Cell id={id} on={id === active} labels={labels} width={COL} height={cellH} icon={labels ? ICON - 3 : ICON} />
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* nút tìm kiếm tròn: góc dưới bên phải */}
      {hasSearch && (
        <Animated.View style={[styles.abs, { right, bottom, width: COL, height: COL, borderRadius: colR, borderCurve: 'continuous' }, glassShadow(1, light), barsOut]}>
          <Animated.View style={[StyleSheet.absoluteFill, searchStyle]}>
            <GlassFill radius={colR} solid={0.5} slab noRim={noRim} />
            <Pressable
              testID="dock-search"
              onPress={() => {
                onChange('search');
                requestSearchFocus();
              }}
              {...squish(searchPress, 1.12)}
              style={[StyleSheet.absoluteFill, styles.center]}
            >
              <DockGlyph id="search" size={32} color={active === 'search' ? theme.colors.accentText : theme.colors.text} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  miniRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingRight: 6, gap: 10 },
  miniArt: { width: 36, height: 36, borderRadius: 9, overflow: 'hidden' },
  miniBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
