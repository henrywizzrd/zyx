import React, { useEffect, useRef } from 'react';
import { Cover } from './Cover';
import { playerOrigin } from './PlayerTransition';
import { Animated, Easing, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { GlassFill } from './Glass';
import { useT } from '../i18n';
import { usePlayerPick, ViewRef } from '../player/PlayerProvider';
import { TabId } from '../theme/types';
import { useDraggable } from './useDraggable';
import {
  computeLayout, DOCK_GAP, DOCK_PADDING, DOCK_THICKNESS, dockCell,
  isVertical, MP_THICKNESS, STACK_GAP,
} from './layout';

const USE_NATIVE = Platform.OS !== 'web';
// Màu "#RRGGBB" thêm độ trong suốt (0..1)
const withAlpha = (hex: string, a: number) => hex.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, '0');

type Origin = { cx: number; cy: number };

// Icon đặc cho mọi tab (kiểu Apple Music): tab đang mở tô màu nhấn, các tab khác màu chữ chính của theme
const ICONS: Record<Exclude<TabId, 'player'>, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  search: 'search',
  library: 'library',
  settings: 'settings',
};

// Nhãn dưới icon lấy từ bộ chữ theo ngôn ngữ
const LABELS = { home: 'tab.home', search: 'tab.search', library: 'tab.library', settings: 'tab.settings' } as const;

// Dock và mini player nổi trên nội dung, nên chỉ trả về safe area.
// endPadding dùng để màn hình cuộn kéo được mục cuối lên khỏi các khối nổi ở đáy.
export function useContentInsets() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
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
    Animated.spring(appear, { toValue: 1, friction: 5, useNativeDriver: USE_NATIVE }).start();
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
          transform: [{ scale: appear }],
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
      Animated.spring(slide, { toValue: 0, friction: 8, tension: 70, useNativeDriver: USE_NATIVE }).start();
    }
  }, [hidden, slide]);
  const OUT = 180; // đủ xa để dock ra khỏi màn hình hoàn toàn
  const toX = position === 'top' || position === 'bottom' ? 0 : position.endsWith('left') || position === 'left' ? -OUT : OUT;
  const toY = position === 'top' ? -OUT : position === 'bottom' ? OUT : 0;
  const slideX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, toX] });
  const slideY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, toY] });

  // Hiệu ứng co lại khi dock mất một mục (mini player được tách ra)
  const squash = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(ids.length);
  useEffect(() => {
    if (ids.length < prevCount.current) {
      squash.setValue(1.12);
      Animated.spring(squash, { toValue: 1, friction: 4, useNativeDriver: USE_NATIVE }).start();
    }
    prevCount.current = ids.length;
  }, [ids.length, squash]);

  // Ô sáng phía sau tab đang mở: trượt mượt sang tab mới khi đổi tab
  const activeIndex = ids.indexOf(active);
  const hi = useRef(new Animated.Value(Math.max(0, activeIndex))).current;
  useEffect(() => {
    if (activeIndex < 0) return;
    Animated.spring(hi, { toValue: activeIndex, friction: 8, tension: 90, useNativeDriver: USE_NATIVE }).start();
  }, [activeIndex, hi]);
  const cell = dockCell(position, labels);
  const cellW = vertical ? cell.cross : cell.main;
  const cellH = vertical ? cell.main : cell.cross;
  const step = cell.main + DOCK_GAP;
  const hiMove = hi.interpolate({ inputRange: [0, 10], outputRange: [0, step * 10] });
  const radius = (cell.cross + DOCK_PADDING * 2) / 2; // dạng viên thuốc bo tròn hẳn hai đầu
  const hiColor = withAlpha(theme.colors.text, theme.colors.glassTint === 'dark' ? 0.12 : 0.08);

  const detachPlayer = (origin: Origin | null) => {
    setEmergeFrom(origin);
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    setMerged(false);
  };

  // Bóng đổ nhẹ để dock tách khỏi nội dung phía sau; đang kéo thì nổi cao hơn
  const glow = lit
    ? { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 14 }
    : { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 };

  return (
    <View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.layer, dockStyle, { zIndex: d.zIndex }]}>
      <View ref={dockRef} collapsable={false}>
        <Animated.View
          {...d.panHandlers}
          style={{
            borderRadius: radius,
            opacity: d.opacity,
            transform: [
              { translateX: slideX },
              { translateY: slideY },
              { translateX: d.pan.x },
              { translateY: d.pan.y },
              { scale: d.scale },
              { scale: squash },
            ],
            ...glow,
          }}
        >
          {/* Nền kính mờ theo theme, đậm hơn các chỗ khác để dock luôn rõ */}
          <GlassFill radius={radius} solid={0.72} />
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
                borderRadius: Math.min(cellW, cellH) / 2,
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
                  <Ionicons name={ICONS[id]} size={labels ? 23 : 25} color={color} />
                  {labels && <Text numberOfLines={1} style={{ color, fontSize: 10, fontWeight: '600', marginTop: 3 }}>{t(LABELS[id])}</Text>}
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