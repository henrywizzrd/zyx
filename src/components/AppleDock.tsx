// Dock kiểu Apple Music (Cài đặt → Kiểu dock → Apple Music), dựng theo trang thử "ZYX – Dock kiểu Apple Music":
//  - thanh tab kính hình viên thuốc + nút Tìm kiếm tròn tách riêng bên phải + mini player dạng viên thuốc nằm trên
//  - chạm tab: vệt chọn trượt sang (giãn nhẹ rồi co lại)
//  - giữ / kéo trên thanh: vệt chọn phồng thành kính lúp nổi lên, phóng to icon bên dưới, trượt theo tay, kéo nhanh thì giãn
//    ngang dẹt dọc; thả tay hít vào tab gần nhất
//  - cuộn trang xuống: thanh tab thu thành nút tròn (icon tab đang mở), mini player chui xuống nằm giữa; cuộn lên thì mở lại
// Chỉ dùng khi màn hình dọc; xoay ngang thì App dùng lại dock dạng thanh dọc
import React, { useEffect, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { TabId } from '../theme/types';
import { DockGlyph } from './DockIcons';
import { LABELS } from './FloatingDock';
import { GlassFill, glassShadow } from './Glass';
import { SmartImage } from './Cover';
import { usePlayerPick, ViewRef } from '../player/PlayerProvider';
import { PlayPauseGlyph, SkipGlyph } from './PlayerIcons';
import { playerOrigin } from './PlayerTransition';
import { dockCollapse, setDockCollapsed } from './dockCollapse';

export const AM = { M: 20, H: 62, GAP: 10, MH: 52, MGAP: 8, CH: 54 };
// Khoảng cách từ mép dưới màn hình tới dock
export const amBottom = (insetBottom: number) => Math.max(14, insetBottom - 8);
// Phần cuối trang cần chừa để mục cuối kéo lên được khỏi dock + mini player
export const amEndPadding = (insetBottom: number) => amBottom(insetBottom) + AM.H + AM.MGAP + AM.MH + 12 - insetBottom;

const SNAP = { stiffness: 420, damping: 32, mass: 1 };
const LENS = { stiffness: 600, damping: 38, mass: 1 };
const SQUISH = { stiffness: 600, damping: 28, mass: 1 };

type Tab = Exclude<TabId, 'player'>;

function Cell({ id, on, labels, width }: { id: Tab; on: boolean; labels: boolean; width: number }) {
  const { theme } = useTheme();
  const t = useT();
  const color = on ? theme.colors.accent : theme.colors.text;
  return (
    <View style={{ width, height: AM.H, alignItems: 'center', justifyContent: 'center' }}>
      <DockGlyph id={id} size={labels ? 26 : 28} color={color} />
      {labels && (
        <Text numberOfLines={1} style={{ color, fontSize: 10, fontWeight: '600', marginTop: 2 }}>
          {t(LABELS[id])}
        </Text>
      )}
    </View>
  );
}

export function AppleDock({ active, onChange, onOpenPlayer, hidden }: { active: TabId; onChange: (t: TabId) => void; onOpenPlayer: () => void; hidden: boolean }) {
  const { theme } = useTheme();
  const light = theme.colors.glassTint !== 'dark';
  const noRim = theme.dock.rimLight === false;
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const { M, H, GAP, MH, MGAP, CH } = AM;
  const bottom = amBottom(insets.bottom);
  const labels = theme.dock.labels;

  const items = theme.dock.items.filter((i): i is Tab => i !== 'player');
  const tabs: Tab[] = items.filter((i) => i !== 'search');
  const hasSearch = items.includes('search');
  const n = Math.max(1, tabs.length);
  const fullW = W - M * 2 - (hasSearch ? GAP + H : 0);
  const tw = (fullW - 8) / n;
  const idx = tabs.indexOf(active as Tab);
  const shown = idx >= 0 ? idx : (tabs.indexOf((lastRef.current ?? 'home') as Tab));

  // ---- vệt chọn + kính lúp ----
  const pillX = useSharedValue(Math.max(0, idx) * tw);
  const pillSX = useSharedValue(1);
  const lensOn = useSharedValue(0);
  const lensX = useSharedValue(0);
  const lensSX = useSharedValue(1);
  const lensSY = useSharedValue(1);
  const barPress = useSharedValue(1);
  useEffect(() => {
    if (idx >= 0) {
      pillX.value = withSpring(idx * tw, SNAP);
      lastRef.current = active;
    }
  }, [idx, tw]); // eslint-disable-line react-hooks/exhaustive-deps

  // đổi tab → mở dock lại
  useEffect(() => {
    setDockCollapsed(false);
  }, [active]);

  const select = (i: number, stretch: boolean) => {
    const id = tabs[i];
    if (!id) return;
    if (stretch && i !== idx) pillSX.value = withSequence(withTiming(1.22, { duration: 90 }), withSpring(1, SNAP));
    onChange(id);
  };

  // ---- cử chỉ trên thanh tab (dùng ref để PanResponder luôn thấy giá trị mới nhất) ----
  const live = useRef({ tw, n, idx, select, collapsed: false });
  live.current = { tw, n, idx, select, collapsed: false };
  const drag = useRef<{ lens: boolean; hold: ReturnType<typeof setTimeout> | null; lastX: number; lastT: number } | null>(null);
  const xOf = (pageX: number) => pageX - M;
  const lensTo = (x: number) => {
    const { tw: w, n: k } = live.current;
    lensX.value = withSpring(Math.max(0, Math.min((k - 1) * w, x - 4 - w / 2)), LENS);
  };
  const startLens = (x: number) => {
    if (!drag.current || drag.current.lens) return;
    drag.current.lens = true;
    lensX.value = pillX.value;
    lensOn.value = withSpring(1, LENS);
    lensTo(x);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (dockCollapse.value > 0.5) {
          setDockCollapsed(false);
          drag.current = null;
          return;
        }
        const x = xOf(e.nativeEvent.pageX);
        barPress.value = withSpring(1.03, SQUISH);
        drag.current = { lens: false, hold: setTimeout(() => startLens(x), 170), lastX: x, lastT: Date.now() };
      },
      onPanResponderMove: (e) => {
        const d = drag.current;
        if (!d) return;
        const x = xOf(e.nativeEvent.pageX);
        const now = Date.now();
        if (!d.lens && Math.abs(x - d.lastX) > 6) {
          if (d.hold) clearTimeout(d.hold);
          startLens(x);
        }
        if (d.lens) {
          lensTo(x);
          const v = (x - d.lastX) / Math.max(1, now - d.lastT);
          const st = Math.min(0.35, Math.abs(v) * 0.22); // kéo nhanh: kính giãn ngang, dẹt dọc
          lensSX.value = withSpring(1 + st, { stiffness: 420, damping: 18 });
          lensSY.value = withSpring(1 - st * 0.55, { stiffness: 420, damping: 18 });
        }
        d.lastX = x;
        d.lastT = now;
      },
      onPanResponderRelease: (e) => end(e.nativeEvent.pageX),
      onPanResponderTerminate: (e) => end(e.nativeEvent.pageX),
    })
  ).current;
  function end(pageX: number) {
    const d = drag.current;
    drag.current = null;
    barPress.value = withSpring(1, SQUISH);
    if (!d) return;
    if (d.hold) clearTimeout(d.hold);
    const { tw: w, n: k, select: sel } = live.current;
    const i = Math.max(0, Math.min(k - 1, Math.floor((xOf(pageX) - 4) / w)));
    if (d.lens) {
      pillX.value = lensX.value; // vệt chọn hiện lại đúng chỗ kính lúp vừa thả
      pillX.value = withSpring(i * w, SNAP);
      lensX.value = withSpring(i * w, LENS);
      lensOn.value = withSpring(0, LENS);
      lensSX.value = withSpring(1, LENS);
      lensSY.value = withSpring(1, LENS);
      sel(i, false);
    } else sel(i, true);
  }

  // ---- kiểu chuyển động ----
  const c = dockCollapse;
  const barStyle = useAnimatedStyle(() => ({
    width: fullW + (H - fullW) * c.value,
    transform: [{ scale: barPress.value }],
  }));
  const rowFade = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - c.value * 2.2) }));
  const iconFade = useAnimatedStyle(() => ({ opacity: Math.max(0, (c.value - 0.45) / 0.55) }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: idx >= 0 ? Math.max(0, 1 - c.value * 2.2) * (1 - lensOn.value * 0.9) : 0,
    transform: [{ translateX: pillX.value }, { scaleX: pillSX.value }],
  }));
  const lw = tw + 10;
  const lh = H + 10;
  const lensStyle = useAnimatedStyle(() => {
    const s = 0.86 + 0.14 * lensOn.value;
    return { opacity: lensOn.value, left: 4 + lensX.value - 5, transform: [{ scaleX: s * lensSX.value }, { scaleY: s * lensSY.value }] };
  });
  // hàng tab trong kính lúp: trùng đúng vị trí hàng thật, rồi phóng to quanh tâm kính
  const lensRow = useAnimatedStyle(() => {
    const k = 1 + 0.18 * lensOn.value;
    const lx = 4 + lensX.value - 5;
    return { transform: [{ translateX: lw / 2 }, { translateY: lh / 2 }, { scale: k }, { translateX: -(lx - 4 + lw / 2) }, { translateY: -(lh / 2 - 5) }] };
  });

  // ---- mini player ----
  const { track, isPlaying, togglePlay, next } = usePlayerPick('track', 'isPlaying', 'togglePlay', 'next');
  const artRef = useRef<ViewRef>(null);
  const miniPress = useSharedValue(1);
  const searchPress = useSharedValue(1);
  const colW = W - M * 2 - H * 2 - GAP * 2 + (hasSearch ? 0 : H + GAP);
  const miniStyle = useAnimatedStyle(() => ({
    left: M + (M + H + GAP - M) * c.value,
    width: W - M * 2 + (colW - (W - M * 2)) * c.value,
    bottom: bottom + H + MGAP + (bottom + (H - CH) / 2 - (bottom + H + MGAP)) * c.value - bottom,
    height: MH + (CH - MH) * c.value,
    transform: [{ scale: miniPress.value }],
  }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ scale: searchPress.value }] }));
  const openFromMini = () => {
    artRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0) playerOrigin.current = { x, y, w, h, r: 7 };
      onOpenPlayer();
    });
  };

  const glassBox = (r: number) => (
    <>
      <GlassFill radius={r} solid={0.5} slab noRim={noRim} />
    </>
  );

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, { opacity: hidden ? 0 : 1 }]}>
      <View pointerEvents="box-none" style={[styles.layer, { left: 0, right: 0, bottom, height: H + MGAP + MH + 20 }]}>
        {/* mini player */}
        {track && (
          <Animated.View style={[styles.abs, { borderRadius: MH / 2, borderCurve: 'continuous' }, glassShadow(1, light), miniStyle]}>
            {glassBox(MH / 2)}
            <Pressable
              onPress={openFromMini}
              onPressIn={() => (miniPress.value = withSpring(1.03, SQUISH))}
              onPressOut={() => (miniPress.value = withSpring(1, SQUISH))}
              style={styles.miniRow}
            >
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

        {/* thanh tab */}
        <Animated.View
          {...pan.panHandlers}
          style={[styles.abs, { left: M, bottom: 0, height: H, borderRadius: H / 2, borderCurve: 'continuous' }, glassShadow(1, light), barStyle]}
        >
          {glassBox(H / 2)}
          <Animated.View pointerEvents="none" style={[styles.pill, { width: tw, backgroundColor: light ? 'rgba(0,0,0,0.065)' : 'rgba(255,255,255,0.12)' }, pillStyle]} />
          <Animated.View pointerEvents="none" style={[styles.row, rowFade]}>
            {tabs.map((id) => (
              <Cell key={id} id={id} on={id === active} labels={labels} width={tw} />
            ))}
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lens,
              { width: lw, height: lh, backgroundColor: light ? 'rgba(250,250,252,0.93)' : 'rgba(58,58,62,0.93)', borderColor: light ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' },
              lensStyle,
            ]}
          >
            <Animated.View style={[styles.row, { left: 0, top: 0, width: fullW, height: H, transformOrigin: 'left top' }, lensRow]}>
              {tabs.map((id) => (
                <Cell key={id} id={id} on={id === active} labels={labels} width={tw} />
              ))}
            </Animated.View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, iconFade]}>
            {shown >= 0 && <DockGlyph id={tabs[shown]} size={28} color={theme.colors.accent} />}
          </Animated.View>
        </Animated.View>

        {/* nút tìm kiếm tròn tách riêng */}
        {hasSearch && (
          <Animated.View style={[styles.abs, { right: M, bottom: 0, width: H, height: H, borderRadius: H / 2 }, glassShadow(1, light), searchStyle]}>
            {glassBox(H / 2)}
            <Pressable
              onPress={() => onChange('search')}
              onPressIn={() => (searchPress.value = withSpring(1.12, SQUISH))}
              onPressOut={() => (searchPress.value = withSpring(1, SQUISH))}
              style={[StyleSheet.absoluteFill, styles.center]}
            >
              <DockGlyph id="search" size={27} color={active === 'search' ? theme.colors.accent : theme.colors.text} />
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const lastRef: { current: TabId | null } = { current: null };

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { position: 'absolute', left: 4, top: 0, bottom: 0, flexDirection: 'row' },
  pill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 999 },
  lens: { position: 'absolute', top: -5, borderRadius: 999, overflow: 'hidden', borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 6 } },
  miniRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 10 },
  miniArt: { width: 36, height: 36, borderRadius: 7, overflow: 'hidden' },
  miniBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
