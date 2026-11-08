import React, { useEffect, useRef } from 'react';
import { TabIcon } from './TabIcon';
import { amEndPadding } from './AppleDock';
import { Cover } from './Cover';
import { playerOrigin } from './PlayerTransition';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import RAnimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

// Biểu tượng tab: tab đang chọn phóng to hơn một chút, chuyển tab khác thì thu về cỡ thường (êm, không nảy)
function DockIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  const sc = useSharedValue(active ? 1.16 : 1);
  useEffect(() => {
    sc.value = withTiming(active ? 1.16 : 1, { duration: 220 });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return <RAnimated.View style={[{ alignItems: 'center' }, st]}>{children}</RAnimated.View>;
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { GlassFill, glassShadow } from './Glass';
import { useT } from '../i18n';
import { usePlayerPick, ViewRef } from '../player/PlayerProvider';
import { TabId } from '../theme/types';
import { DOCK_RESIZE, useDraggable } from './useDraggable';
import {
  computeLayout, DOCK_GAP, DOCK_PADDING, DOCK_THICKNESS, DOCK_BUBBLE, dockCell,
  isVertical, MP_THICKNESS, STACK_GAP,
} from './layout';

const USE_NATIVE = Platform.OS !== 'web';
// Màu "#RRGGBB" thêm độ trong suốt (0..1)
const withAlpha = (hex: string, a: number) => hex.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, '0');

type Origin = { cx: number; cy: number };

// Icon đặc cho mọi tab (kiểu Apple Music): tab đang mở tô màu nhấn, các tab khác màu chữ chính của theme
export const ICONS: Record<Exclude<TabId, 'player'>, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  search: 'search',
  library: 'library',
  settings: 'settings',
};

// Nhãn dưới icon lấy từ bộ chữ theo ngôn ngữ
export const LABELS = { home: 'tab.home', search: 'tab.search', library: 'tab.library', settings: 'tab.settings' } as const;

// Dock và mini player nổi trên nội dung, nên chỉ trả về safe area.
// endPadding dùng để màn hình cuộn kéo được mục cuối lên khỏi các khối nổi ở đáy.
export function useContentInsets() {
  const insets = useSafeAreaInsets();
  const { theme, landscape } = useTheme();
  // Màn hình ngang (dock dạng thanh): dock đứng dọc ở cạnh phải → chừa bên phải đúng bề dày dock, cuối danh sách chỉ cần chừa ít
  if (landscape) {
    return {
      top: insets.top,
      bottom: insets.bottom,
      // vùng nội dung đã chừa sẵn tai thỏ và dock (ContentArea trong App.tsx), các màn hình không phải chừa thêm
      left: 0,
      right: 0,
      endPadding: theme.dock.mode !== 'bubble' ? MP_THICKNESS + 16 : DOCK_BUBBLE + theme.dock.style.margin * 2 + insets.bottom,
    };
  }
  if (theme.dock.mode === 'apple') return { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right, endPadding: amEndPadding(insets.bottom) };
  return {
    top: insets.top,
    bottom: insets.bottom,
    left: insets.left,
    right: insets.right,
    endPadding: DOCK_THICKNESS + MP_THICKNESS + STACK_GAP + theme.dock.style.margin * 2,
  };
}

function PlayerItem({
  active,
  cellW,
  cellH,
  onPress,
  onDetach,
}: {
  active: boolean;
  cellW: number;
  cellH: number;
  onPress: () => void;
  onDetach: (origin: Origin | null) => void;
}) {
  const { theme } = useTheme();
  const { track } = usePlayerPick('track');
  const appear = useRef(new Animated.Value(0)).current;
  const ref = useRef<ViewRef>(null);

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [appear]);

  // Đo vị trí của mục này để mini player bay ra từ đúng chỗ đó
  const detach = () => {
    if (!ref.current) return onDetach(null);
    ref.current.measureInWindow((x, y, w, h) => onDetach({ cx: x + w / 2, cy: y + h / 2 }));
  };

  const open = () => {
    if (!ref.current) return onPress();
    ref.current.measureInWindow((x, y, w, h) => {
      playerOrigin.current = { x, y, w, h, r: 16 };
      onPress();
    });
  };

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={open}
      onLongPress={detach}
      delayLongPress={350}
      style={{ width: cellW, height: cellH, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={{
          opacity: appear,
          transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          width: 40,
          height: 40,
          borderRadius: 12,
          borderWidth: 2,
          padding: 2,
          borderColor: active ? theme.colors.accent : 'transparent',
        }}
      >
        <Cover track={track} style={{ flex: 1, borderRadius: 9 }}>
          <Ionicons name="musical-notes" size={16} color="#FFFFFF" />
        </Cover>
      </Animated.View>
    </Pressable>
  );
}

export function FloatingDock({ active, onChange, hidden = false }: { active: TabId; onChange: (t: TabId) => void; hidden?: boolean }) {
  const { theme, setMerged } = useTheme();
  const t = useT();
  const { dockRef, setEmergeFrom } = usePlayerPick('dockRef', 'setEmergeFrom');
  const insets = useSafeAreaInsets();
  const d = useDraggable('dock');
  const { dockStyle } = computeLayout(theme, insets);
  const { position, items, labels } = theme.dock;

  const ids: TabId[] = theme.miniPlayer.merged ? [...items, 'player'] : items;
  const vertical = isVertical(position);
  const lit = d.active || d.merging;

  // Thụt vào cạnh màn hình mà dock đang đứng (dock ở dưới thì thụt xuống, bên trái thì thụt qua trái...). hidden=true là thụt vào.
  const slide = useRef(new Animated.Value(hidden ? 1 : 0)).current;
  useEffect(() => {
    if (hidden) {
      Animated.timing(slide, { toValue: 1, duration: 260, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: USE_NATIVE }).start();
    } else {
      Animated.timing(slide, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
    }
  }, [hidden, slide]);
  const OUT = 180; // đủ xa để dock ra khỏi màn hình hoàn toàn
  const toX = position === 'top' || position === 'bottom' ? 0 : position.endsWith('left') || position === 'left' ? -OUT : OUT;
  const toY = position === 'top' ? -OUT : position === 'bottom' ? OUT : 0;
  const slideX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, toX] });
  const slideY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, toY] });

  // Ô sáng phía sau tab đang mở: trượt mượt sang tab mới khi đổi tab
  const activeIndex = ids.indexOf(active);
  const hi = useRef(new Animated.Value(Math.max(0, activeIndex))).current;
  useEffect(() => {
    if (activeIndex < 0) return;
    Animated.timing(hi, { toValue: activeIndex, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE }).start();
  }, [activeIndex, hi]);
  const cell = dockCell(position, labels);
  const cellW = vertical ? cell.cross : cell.main;
  const cellH = vertical ? cell.main : cell.cross;
  const step = cell.main + DOCK_GAP;
  const hiMove = hi.interpolate({ inputRange: [0, 10], outputRange: [0, step * 10] });
  // Tấm kính chữ nhật bo góc liền (squircle) như tấm kính mài cạnh, không còn dạng viên thuốc
  const radius = Math.round((cell.cross + DOCK_PADDING * 2) * 0.36);
  const hiColor = withAlpha(theme.colors.text, theme.colors.glassTint === 'dark' ? 0.16 : 0.1);

  const detachPlayer = (origin: Origin | null) => {
    setEmergeFrom(origin);
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(DOCK_RESIZE);
    setMerged(false);
  };

  // Bóng đổ nhẹ để dock tách khỏi nội dung phía sau; đang kéo thì nổi cao hơn
  // Bộ Neon: dock phát sáng hồng neon thay cho bóng đen
  const neon = theme.preset === 'neon';
  // Kính đặt nổi trên mặt bàn: bóng hai lớp (sát chân + lan); cầm lên để kéo thì nổi cao hơn
  const glow = neon
    ? { shadowColor: theme.colors.accent, shadowOpacity: lit ? 0.85 : 0.6, shadowRadius: lit ? 24 : 18, shadowOffset: { width: 0, height: 0 }, elevation: 12 }
    : glassShadow(lit ? 1.7 : 1, theme.colors.glassTint !== 'dark');

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.layer, dockStyle, { zIndex: d.zIndex }]}>
      <View ref={dockRef} collapsable={false}>
        <Animated.View
          {...d.panHandlers}
          style={{
            borderRadius: radius,
            borderCurve: 'continuous',
            opacity: d.opacity,
            transform: [
              { translateX: slideX },
              { translateY: slideY },
              { translateX: d.pan.x },
              { translateY: d.pan.y },
              { scale: d.scale },
            ],
            ...glow,
          }}
        >
          {/* Tấm kính nổi kiểu Apple Music: mờ phần phía sau + vệt sáng + cạnh kính */}
          <GlassFill radius={radius} solid={0.5} slab noRim={theme.dock.rimLight === false} />
          {/* Giữ lâu vào khoảng trống giữa các nút cũng kéo được dock */}
          <Pressable
            {...d.pressProps}
            style={{ flexDirection: vertical ? 'column' : 'row', padding: DOCK_PADDING, gap: DOCK_GAP }}
          >
            {/* Ô sáng của tab đang mở */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: DOCK_PADDING,
                top: DOCK_PADDING,
                width: cellW,
                height: cellH,
                borderRadius: Math.max(8, radius - DOCK_PADDING),
                borderCurve: 'continuous',
                backgroundColor: hiColor,
                opacity: activeIndex < 0 ? 0 : 1,
                transform: vertical ? [{ translateY: hiMove }] : [{ translateX: hiMove }],
              }}
            />
            {ids.map((id) => {
              const isActive = id === active;
              if (id === 'player') {
                return (
                  <PlayerItem
                    key={id}
                    active={isActive}
                    cellW={cellW}
                    cellH={cellH}
                    onPress={() => onChange('player')}
                    onDetach={detachPlayer} // giữ lâu để tách player ra khỏi dock
                  />
                );
              }
              const color = isActive ? theme.colors.accent : theme.colors.text;
              return (
                <Pressable
                  key={id}
                  {...d.pressProps}
                  onPress={() => onChange(id)}
                  style={{ width: cellW, height: cellH, alignItems: 'center', justifyContent: 'center' }}
                >
                  <DockIcon active={isActive}>
                    <TabIcon id={id} size={labels ? 25 : 27} color={color} />
                  </DockIcon>
                  {labels && <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: '600', marginTop: 3 }}>{t(LABELS[id])}</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});