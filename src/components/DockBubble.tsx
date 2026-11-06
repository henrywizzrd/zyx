import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { usePlayerPick } from '../player/PlayerProvider';
import { TabId } from '../theme/types';
import { GlassFill } from './Glass';
import { Cover } from './Cover';
import { ICONS, LABELS } from './FloatingDock';
import { DOCK_BUBBLE } from './layout';

// Dock dạng BUBBLE: một hình tròn ở góc dưới (trái hoặc phải, chọn trong Cài đặt), hiện icon của trang đang mở.
//  - Bấm nhẹ: mở 1/4 vòng tròn các tab quanh bubble, bấm vào tab để chuyển; bấm bubble / bấm ra ngoài để đóng
//  - Giữ rồi vuốt: vòng tab mở ra ngay dưới ngón tay; vuốt qua tab nào thì tab đó sáng lên và phóng to, thả tay là chuyển tới tab đó
// Toàn bộ chuyển động và việc dò tab dưới ngón tay chạy trên UI thread (Reanimated + Gesture Handler).

const S = DOCK_BUBBLE;
const ITEM = 54;
const SPRING = { damping: 16, stiffness: 220, mass: 0.8 };

export function DockBubble({ active, onChange, hidden = false }: { active: TabId; onChange: (t: TabId) => void; hidden?: boolean }) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { track } = usePlayerPick('track');
  const { items, bubbleSide, style } = theme.dock;
  const ids: TabId[] = theme.miniPlayer.merged ? [...items, 'player'] : items;
  const right = bubbleSide === 'right';
  const m = style.margin;
  const { accent, text } = theme.colors;

  // Vị trí từng tab trên 1/4 vòng tròn quanh tâm bubble: bubble bên phải thì vòng xoè từ thẳng lên tới ngang sang trái,
  // bên trái thì xoè từ thẳng lên tới ngang sang phải. Nhiều tab thì vòng rộng hơn cho khỏi chật
  const R = ids.length > 4 ? 132 : 116;
  const spots = useMemo(
    () =>
      ids.map((_, i) => {
        const a = ((90 + (ids.length === 1 ? 0 : (i * 90) / (ids.length - 1))) * Math.PI) / 180; // 90° → 180°
        const dx = Math.cos(a) * R * (right ? 1 : -1);
        const dy = -Math.sin(a) * R;
        return { dx, dy };
      }),
    [ids.length, R, right] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const spotsX = useSharedValue<number[]>(spots.map((s) => s.dx));
  const spotsY = useSharedValue<number[]>(spots.map((s) => s.dy));
  useEffect(() => {
    spotsX.value = spots.map((s) => s.dx);
    spotsY.value = spots.map((s) => s.dy);
  }, [spots, spotsX, spotsY]);

  const [open, setOpen] = useState(false);
  const p = useSharedValue(0); // 0 = đóng, 1 = mở vòng
  const hover = useSharedValue(-1); // tab đang ở dưới ngón tay (giữ - vuốt)
  const [hoverIdx, setHoverIdx] = useState(-1);
  const press = useSharedValue(1);

  const show = useCallback(() => {
    setOpen(true);
    p.value = withSpring(1, SPRING);
  }, [p]);
  const hide = useCallback(() => {
    p.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(setOpen, false);
    });
    hover.value = -1;
    setHoverIdx(-1);
  }, [p, hover]);
  const choose = useCallback(
    (i: number) => {
      const id = ids[i];
      hide();
      if (id) onChange(id);
    },
    [ids, onChange, hide]
  );
  const toggle = useCallback(() => (open ? hide() : show()), [open, hide, show]);

  // Ẩn bubble khi đang mở player
  const hideV = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    hideV.value = withTiming(hidden ? 1 : 0, { duration: 240 });
    if (hidden && open) hide();
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Cử chỉ
  const tap = useTapGesture({
    onBegin: () => {
      'worklet';
      press.value = withTiming(0.9, { duration: 90 });
    },
    onFinalize: () => {
      'worklet';
      press.value = withSpring(1, SPRING);
    },
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled) scheduleOnRN(toggle);
    },
  });
  const pickAt = (x: number, y: number) => {
    'worklet';
    // x, y: toạ độ ngón tay trong bubble. Tìm tab gần ngón tay nhất (trong bán kính 44px)
    const cx = S / 2;
    let best = -1;
    let bestD = 44 * 44;
    const xs = spotsX.value;
    const ys = spotsY.value;
    for (let i = 0; i < xs.length; i++) {
      const ddx = x - (cx + xs[i]);
      const ddy = y - (cx + ys[i]);
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best !== hover.value) {
      hover.value = best;
      scheduleOnRN(setHoverIdx, best);
    }
  };
  const hold = usePanGesture({
    activateAfterLongPress: 220,
    onActivate: () => {
      'worklet';
      press.value = withSpring(1.08, SPRING);
      p.value = withSpring(1, SPRING);
      scheduleOnRN(setOpen, true);
    },
    onUpdate: (e) => {
      'worklet';
      pickAt(e.x, e.y);
    },
    onDeactivate: () => {
      'worklet';
      press.value = withSpring(1, SPRING);
      const i = hover.value;
      if (i >= 0) scheduleOnRN(choose, i);
      // không vuốt vào tab nào: vòng vẫn mở để bấm chọn
    },
  });
  const gesture = useExclusiveGestures(hold, tap);

  // ---- Style
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: 1 - hideV.value,
    transform: [{ translateY: hideV.value * 120 }, { scale: press.value }],
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: p.value }));
  const activeId = active === 'player' ? null : active;
  const label = hoverIdx >= 0 ? ids[hoverIdx] : null;

  const pos = right ? { right: insets.right + m } : { left: insets.left + m };
  // Khung chứa đủ rộng để bao cả vòng tab (nút nằm ngoài khung cha thì không bấm được), phần trống cho chạm xuyên qua
  const BOX = R + S / 2 + ITEM / 2 + 16;
  const cx = right ? BOX - S / 2 : S / 2; // tâm bubble trong khung
  const cy = BOX - S / 2;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Nền tối mờ phía sau vòng tab: bấm ra ngoài để đóng */}
      {open && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={hide} />
        </Animated.View>
      )}

      <View pointerEvents="box-none" style={[styles.anchor, pos, { width: BOX, height: BOX, bottom: insets.bottom + m }]}>
        {/* Các tab trên 1/4 vòng tròn */}
        {open &&
          ids.map((id, i) => (
            <RingItem
              key={id}
              index={i}
              dx={spots[i].dx}
              dy={spots[i].dy}
              cx={cx}
              cy={cy}
              p={p}
              hover={hover}
              total={ids.length}
              active={id === active}
              accent={accent}
              color={text}
              onPress={() => choose(i)}
            >
              {id === 'player' ? (
                <Cover track={track} style={{ width: 30, height: 30, borderRadius: 8 }}>
                  <Ionicons name="musical-notes" size={14} color="#FFFFFF" />
                </Cover>
              ) : (
                <Ionicons name={ICONS[id]} size={24} color={id === active ? accent : text} />
              )}
            </RingItem>
          ))}

        {/* Tên tab đang vuốt tới */}
        {open && label && label !== 'player' && (
          <View pointerEvents="none" style={[styles.label, { top: 0 }, right ? { right: 0 } : { left: 0 }]}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t(LABELS[label])}</Text>
          </View>
        )}

        {/* Bubble */}
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.bubble, { position: 'absolute', bottom: 0 }, right ? { right: 0 } : { left: 0 }, bubbleStyle]}>
            <GlassFill radius={S / 2} solid={0.5} slab />
            {open ? (
              <Ionicons name="close" size={26} color={text} />
            ) : activeId ? (
              <Ionicons name={ICONS[activeId]} size={26} color={accent} />
            ) : (
              <Ionicons name="apps" size={24} color={text} />
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

function RingItem({
  index, dx, dy, cx, cy, p, hover, total, active, accent, color, onPress, children,
}: {
  index: number; dx: number; dy: number; cx: number; cy: number; p: SharedValue<number>; hover: SharedValue<number>; total: number;
  active: boolean; accent: string; color: string; onPress: () => void; children: React.ReactNode;
}) {
  // Mỗi tab bay ra từ tâm bubble, tab sau trễ hơn tab trước một chút (xoè như quạt)
  const style = useAnimatedStyle(() => {
    const delay = (index / Math.max(1, total)) * 0.35;
    const k = interpolate(p.value, [delay, Math.min(1, delay + 0.65)], [0, 1], 'clamp');
    const on = hover.value === index;
    return {
      opacity: k,
      transform: [
        { translateX: dx * k },
        { translateY: dy * k },
        { scale: (0.4 + 0.6 * k) * (on ? 1.22 : 1) },
      ],
    };
  });
  const glow = useAnimatedStyle(() => ({ opacity: withTiming(hover.value === index ? 1 : 0, { duration: 120 }) }));
  return (
    <Animated.View style={[styles.item, { left: cx - ITEM / 2, top: cy - ITEM / 2 }, style]}>
      <Pressable onPress={onPress} style={styles.itemPress}>
        <GlassFill radius={ITEM / 2} solid={0.55} slab />
        {/* Sáng lên khi ngón tay vuốt tới */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: ITEM / 2, backgroundColor: accent + '55', borderWidth: 2, borderColor: accent }, glow]} />
        {active && <View pointerEvents="none" style={[styles.dot, { backgroundColor: accent }]} />}
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.28)' },
  anchor: { position: 'absolute' },
  bubble: {
    width: S, height: S, borderRadius: S / 2, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  item: {
    position: 'absolute', width: ITEM, height: ITEM,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  itemPress: { width: ITEM, height: ITEM, borderRadius: ITEM / 2, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 7, width: 5, height: 5, borderRadius: 2.5 },
  label: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
});
