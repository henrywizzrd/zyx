// Dock kiểu Apple Music (Cài đặt → Kiểu dock → Apple Music), dựng theo trang thử "ZYX – Dock kiểu Apple Music":
//  - thanh tab kính hình viên thuốc + nút Tìm kiếm tròn tách riêng bên phải + mini player dạng viên thuốc nằm trên
//  - chạm tab: vệt chọn trượt sang (giãn nhẹ rồi co lại)
//  - giữ / kéo trên thanh: vệt chọn phồng thành kính lúp nổi lên, phóng to icon bên dưới, trượt theo tay, kéo nhanh thì giãn
//    ngang dẹt dọc; thả tay hít vào tab gần nhất
//  - cuộn trang xuống: thanh tab thu thành nút tròn (icon tab đang mở), mini player chui xuống nằm giữa; cuộn lên thì mở lại
// Chỉ dùng khi màn hình dọc; xoay ngang thì App dùng lại dock dạng thanh dọc
import React, { useEffect, useRef } from 'react';
import { GestureDetector, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { hapticSnap, hapticTick } from './haptics';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { interpolate, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
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
import { playerOrigin, playerProgress } from './PlayerTransition';
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

// Ô tab của hàng thật: ô nằm dưới kính lúp mờ đi (kính lúp đã hiện bản phóng to của nó) → kính trong suốt được mà
// không bị thấy hai icon chồng nhau
function BaseCell({ i, tw, lensX, lensOn, children }: { i: number; tw: number; lensX: SharedValue<number>; lensOn: SharedValue<number>; children: React.ReactNode }) {
  const st = useAnimatedStyle(() => {
    const d = Math.abs(i * tw - lensX.value) / (tw * 0.8);
    return { opacity: 1 - lensOn.value * Math.max(0, 1 - d) };
  });
  return <Animated.View style={st}>{children}</Animated.View>;
}

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
  const reduced = useReducedMotion(); // iPhone bật "Giảm chuyển động": không giãn, không phồng, chỉ đổi vị trí / mờ
  const { M, H, GAP, MH, MGAP } = AM;
  const bottom = amBottom(insets.bottom);
  const labels = theme.dock.labels;

  const items = theme.dock.items.filter((i): i is Tab => i !== 'player');
  const tabs: Tab[] = items.filter((i) => i !== 'search');
  const hasSearch = items.includes('search');
  const n = Math.max(1, tabs.length);
  const fullW = W - M * 2 - (hasSearch ? GAP + H : 0);
  const tw = (fullW - 8) / n;
  const idx = tabs.indexOf(active as Tab);
  const shown = idx >= 0 ? idx : tabs.indexOf((lastRef.current ?? 'home') as Tab);

  // ---- vệt chọn + kính lúp (mọi giá trị chạy trên luồng giao diện)
  const pillX = useSharedValue(Math.max(0, idx) * tw);
  const pillSX = useSharedValue(1);
  const lensOn = useSharedValue(0);
  const lensX = useSharedValue(0);
  const lensSX = useSharedValue(1);
  const lensSY = useSharedValue(1);
  const lensIdx = useSharedValue(-1);
  const barPress = useSharedValue(1);
  const down = useSharedValue(0); // ngón tay đang đặt trên thanh (1) — để "giữ yên" cũng bật kính lúp
  const startX = useSharedValue(0);
  const twV = useSharedValue(tw);
  const nV = useSharedValue(n);
  useEffect(() => {
    twV.value = tw;
    nV.value = n;
  }, [tw, n]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const choose = (i: number, stretch: boolean) => {
    const id = tabs[i];
    if (!id) return;
    if (stretch && i !== idx && !reduced) pillSX.value = withSequence(withTiming(1.22, { duration: 90 }), withSpring(1, SNAP));
    onChange(id);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const pick = (i: number, stretch: boolean) => chooseRef.current(i, stretch);

  // Giữ yên ~170ms (không di ngón) cũng bật kính lúp: hẹn giờ một lần ở luồng JS, rồi bật trên luồng giao diện
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      if (down.value === 1 && lensOn.value < 0.5) startLensUI(startX.value);
    }, 170);
  };
  function startLensUI(x: number) {
    'worklet';
    if (lensOn.value > 0.5 || dockCollapse.value > 0.5) return;
    const w = twV.value;
    lensX.value = pillX.value;
    lensOn.value = withSpring(1, LENS);
    lensX.value = withSpring(Math.max(0, Math.min((nV.value - 1) * w, x - 4 - w / 2)), LENS);
  }

  // Cử chỉ trên thanh tab (luồng giao diện):
  //  - chạm rồi nhấc = chọn tab (tap)
  //  - kéo ngang quá 6px = kính lúp theo tay (pan); giữ yên ~170ms cũng bật kính lúp
  //  - thả = hít vào tab gần nhất
  // tapOk: lần chạm này là một cú chạm (không kéo) → được chọn tab dưới ngón tay
  function release(x: number, tapOk: boolean) {
    'worklet';
    if (down.value !== 1) return;
    down.value = 0;
    barPress.value = withSpring(1, SQUISH);
    const w = twV.value;
    const i = Math.max(0, Math.min(nV.value - 1, Math.floor((x - 4) / w)));
    if (lensOn.value > 0.01) {
      pillX.value = lensX.value; // vệt chọn hiện lại đúng chỗ kính lúp vừa thả
      pillX.value = withSpring(i * w, SNAP);
      lensX.value = withSpring(i * w, LENS);
      lensOn.value = withSpring(0, LENS);
      lensSX.value = withSpring(1, LENS);
      lensSY.value = withSpring(1, LENS);
      scheduleOnRN(hapticSnap);
      scheduleOnRN(pick, i, false);
    } else if (tapOk) scheduleOnRN(pick, i, true);
  }
  const begin = (x: number) => {
    'worklet';
    if (dockCollapse.value > 0.5) {
      setDockCollapsed(false); // đang thu: chạm là mở dock ra
      down.value = 2; // bỏ qua phần còn lại của lần chạm này
      return;
    }
    if (down.value === 1) return;
    down.value = 1;
    startX.value = x;
    lensIdx.value = -1;
    barPress.value = withSpring(reduced ? 1 : 1.03, SQUISH);
    scheduleOnRN(armHold);
  };
  const drag = usePanGesture({
    activeOffsetX: [-6, 6],
    activeOffsetY: [-12, 12], // kéo dọc ra khỏi thanh cũng nhận (để thả tay còn dọn dẹp), nhưng không bật kính lúp
    onBegin: (e) => {
      'worklet';
      begin(e.x);
    },
    onActivate: (e) => {
      'worklet';
      if (down.value === 1 && Math.abs(e.translationX) >= Math.abs(e.translationY)) startLensUI(e.x);
    },
    onUpdate: (e) => {
      'worklet';
      if (down.value !== 1 || lensOn.value < 0.01) return;
      const w = twV.value;
      lensX.value = withSpring(Math.max(0, Math.min((nV.value - 1) * w, e.x - 4 - w / 2)), LENS);
      if (!reduced) {
        const st = Math.min(0.35, (Math.abs(e.velocityX) / 1000) * 0.22); // kéo nhanh: giãn ngang, dẹt dọc
        lensSX.value = withSpring(1 + st, { stiffness: 420, damping: 18 });
        lensSY.value = withSpring(1 - st * 0.55, { stiffness: 420, damping: 18 });
      }
      // lướt qua tab khác: tách nhẹ một cái (chỉ lúc đổi ô, không phải mỗi khung hình)
      const i = Math.max(0, Math.min(nV.value - 1, Math.floor((e.x - 4) / w)));
      if (i !== lensIdx.value) {
        if (lensIdx.value !== -1) scheduleOnRN(hapticTick);
        lensIdx.value = i;
      }
    },
    onDeactivate: (e) => {
      'worklet';
      release(e.x, false);
    },
  });
  const tap = useTapGesture({
    maxDuration: 1500, // giữ yên rồi nhấc (kính lúp đã bật) vẫn tính là chọn
    onBegin: (e) => {
      'worklet';
      begin(e.x);
    },
    onDeactivate: (e) => {
      'worklet';
      release(e.x, true);
    },
    onFinalize: () => {
      'worklet';
      // chạm bị huỷ (kéo đi chỗ khác / bị cử chỉ khác giành): trả thanh về như cũ
      if (down.value === 2) down.value = 0;
    },
  });
  const gesture = useSimultaneousGestures(drag, tap);

  // ---- kiểu chuyển động
  // Thu / mở dock khi cuộn: KHÔNG đổi kích thước hay vị trí của cả khối (bắt tính lại bố cục mỗi khung hình) —
  // chỉ lớp kính nền (không có nội dung bên trong) đổi bề rộng, hàng tab chỉ mờ đi, mini player chỉ dịch chuyển
  const c = dockCollapse;
  const glassW = useAnimatedStyle(() => ({ width: fullW + (H - fullW) * c.value, transform: [{ scale: barPress.value }] }));
  const rowFade = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - c.value * 2.2), transform: [{ scale: barPress.value }] }));
  const iconFade = useAnimatedStyle(() => ({ opacity: Math.max(0, (c.value - 0.45) / 0.55) }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: idx >= 0 ? Math.max(0, 1 - c.value * 2.2) * (1 - lensOn.value * 0.9) : 0,
    transform: [{ translateX: pillX.value }, { scaleX: pillSX.value }],
  }));
  const lw = tw + 10;
  const lh = H + 10;
  const lensStyle = useAnimatedStyle(() => {
    const s = 0.86 + 0.14 * lensOn.value;
    return { opacity: lensOn.value, transform: [{ translateX: lensX.value }, { scaleX: s * lensSX.value }, { scaleY: s * lensSY.value }] };
  });
  // hàng tab trong kính lúp: trùng đúng vị trí hàng thật, rồi phóng to quanh tâm kính
  const lensRow = useAnimatedStyle(() => {
    const k = 1 + (reduced ? 0 : 0.18) * lensOn.value;
    const lx = 4 + lensX.value - 5;
    return { transform: [{ translateX: lw / 2 }, { translateY: lh / 2 }, { scale: k }, { translateX: -(lx - 4 + lw / 2) }, { translateY: -(lh / 2 - 5) }] };
  });

  // ---- mini player
  const { track, isPlaying, togglePlay, next } = usePlayerPick('track', 'isPlaying', 'togglePlay', 'next');
  const artRef = useRef<ViewRef>(null);
  const miniPress = useSharedValue(1);
  const searchPress = useSharedValue(1);
  const fullMW = W - M * 2;
  const colW = W - M * 2 - H * 2 - GAP * 2 + (hasSearch ? 0 : H + GAP);
  const dropY = H + MGAP - (H - MH) / 2; // đầy đủ: nằm trên thanh; thu: hạ xuống ngang hàng thanh
  const miniStyle = useAnimatedStyle(() => ({
    // bề rộng vẫn phải đổi (chữ tên bài co lại), nhưng chỉ trong khối nhỏ này; vị trí đi bằng transform
    width: fullMW + (colW - fullMW) * c.value,
    transform: [{ translateX: (H + GAP) * c.value }, { translateY: dropY * c.value }, { scale: miniPress.value }],
  }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ scale: searchPress.value }] }));
  // Theo độ mở của player (0 → 1): thanh tab + nút tìm kiếm trượt xuống khỏi màn hình, đóng thì trượt lên từ từ;
  // viên mini player mờ đi ngay lúc đầu (ảnh bìa của nó chính là chỗ player nở ra), lúc thu về thì hiện lại ở đoạn cuối
  const pp = playerProgress;
  const sink = bottom + H + 24;
  const barsOut = useAnimatedStyle(() => ({
    opacity: interpolate(pp.value, [0, 0.7], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(pp.value, [0, 1], [0, sink]) }],
  }));
  const miniOut = useAnimatedStyle(() => ({ opacity: interpolate(pp.value, [0, 0.14], [1, 0], 'clamp') }));
  const openFromMini = () => {
    artRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0) playerOrigin.current = { x, y, w, h, r: 9 };
      onOpenPlayer();
    });
  };
  // nhấn: phản hồi ngay lúc chạm (không đợi nhấc tay)
  const squish = (sv: typeof miniPress, k: number) => ({
    onPressIn: () => (sv.value = withSpring(reduced ? 1 : k, SQUISH)),
    onPressOut: () => (sv.value = withSpring(1, SQUISH)),
  });

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={[styles.layer, { left: 0, right: 0, bottom, height: H + MGAP + MH + 20 }]}>
        {/* mini player */}
        {track && (
          <Animated.View style={[styles.abs, { left: M, bottom: H + MGAP, height: MH, borderRadius: MH / 2, borderCurve: 'continuous' }, glassShadow(1, light), miniStyle, miniOut]}>
            <GlassFill radius={MH / 2} solid={0.5} slab noRim={noRim} />
            <Pressable onPress={openFromMini} {...squish(miniPress, 1.03)} style={styles.miniRow}>
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

        {/* thanh tab: lớp kính nền đổi bề rộng (nhận cử chỉ), nội dung nằm trên, cố định chỗ */}
        <Animated.View pointerEvents="box-none" style={[styles.abs, { left: M, bottom: 0, width: fullW, height: H }, barsOut]}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.abs, { left: 0, top: 0, height: H, borderRadius: H / 2, borderCurve: 'continuous' }, glassShadow(1, light), glassW]}>
              <GlassFill radius={H / 2} solid={0.5} slab noRim={noRim} />
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, iconFade]}>
                {shown >= 0 && <DockGlyph id={tabs[shown]} size={28} color={theme.colors.accent} />}
              </Animated.View>
            </Animated.View>
          </GestureDetector>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, rowFade]}>
            <Animated.View style={[styles.pill, { width: tw, backgroundColor: light ? 'rgba(0,0,0,0.065)' : 'rgba(255,255,255,0.12)' }, pillStyle]} />
            <View style={styles.row}>
              {tabs.map((id, i) => (
                <BaseCell key={id} i={i} tw={tw} lensX={lensX} lensOn={lensOn}>
                  <Cell id={id} on={id === active} labels={labels} width={tw} />
                </BaseCell>
              ))}
            </View>
            <Animated.View
              style={[
                styles.lens,
                { left: -1, width: lw, height: lh, borderColor: light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)' },
                lensStyle,
              ]}
            >
              {/* kính lúp là kính trong thật (Liquid Glass trong), không phủ màu đục */}
              <GlassFill radius={lh / 2} solid={0} slab noRim={noRim} />
              <Animated.View style={[styles.row, { left: 0, top: 0, width: fullW, height: H, transformOrigin: 'left top' }, lensRow]}>
                {tabs.map((id) => (
                  <Cell key={id} id={id} on={id === active} labels={labels} width={tw} />
                ))}
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </Animated.View>

        {/* nút tìm kiếm tròn tách riêng */}
        {hasSearch && (
          <Animated.View pointerEvents="box-none" style={[styles.abs, { right: M, bottom: 0, width: H, height: H }, barsOut]}>
          <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: H / 2 }, glassShadow(1, light), searchStyle]}>
            <GlassFill radius={H / 2} solid={0.5} slab noRim={noRim} />
            <Pressable onPress={() => onChange('search')} {...squish(searchPress, 1.12)} style={[StyleSheet.absoluteFill, styles.center]}>
              <DockGlyph id="search" size={27} color={active === 'search' ? theme.colors.accent : theme.colors.text} />
            </Pressable>
          </Animated.View>
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
  lens: { position: 'absolute', top: -5, borderRadius: 999, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  // ảnh bìa lùi vào trong: mép trái viên thuốc là nửa vòng tròn, sát quá thì góc ảnh chạm vào đường cong
  miniRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingRight: 6, gap: 10 },
  miniArt: { width: 36, height: 36, borderRadius: 9, overflow: 'hidden' },
  miniBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
