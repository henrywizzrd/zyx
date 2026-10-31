import React, { useEffect, useRef } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer, ViewRef } from '../player/PlayerProvider';
import { TabId } from '../theme/types';
import { useDraggable } from './useDraggable';
import {
  computeLayout, DOCK_GAP, DOCK_PADDING, DOCK_THICKNESS, ITEM_SIZE,
  isVertical, MP_THICKNESS, STACK_GAP,
} from './layout';

const USE_NATIVE = Platform.OS !== 'web';

type Origin = { cx: number; cy: number };

const ICONS: Record<Exclude<TabId, 'player'>, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  home: { on: 'home', off: 'home-outline' },
  search: { on: 'search', off: 'search-outline' },
  library: { on: 'library', off: 'library-outline' },
  settings: { on: 'settings', off: 'settings-outline' },
};

const LABELS: Record<Exclude<TabId, 'player'>, string> = {
  home: 'Home',
  search: 'Search',
  library: 'Library',
  settings: 'Settings',
};

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
  onPress,
  onDetach,
}: {
  active: boolean;
  onPress: () => void;
  onDetach: (origin: Origin | null) => void;
}) {
  const { theme } = useTheme();
  const { track } = usePlayer();
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

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={onPress}
      onLongPress={detach}
      delayLongPress={350}
      style={{ width: ITEM_SIZE, height: ITEM_SIZE, alignItems: 'center', justifyContent: 'center' }}
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
        <View style={{ flex: 1, borderRadius: 9, backgroundColor: track.color, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="musical-notes" size={16} color="#FFFFFF" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function FloatingDock({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const { theme, setMerged } = useTheme();
  const { dockRef, setEmergeFrom } = usePlayer();
  const insets = useSafeAreaInsets();
  const d = useDraggable('dock');
  const { dockStyle } = computeLayout(theme, insets);
  const { position, items, style } = theme.dock;

  const ids: TabId[] = theme.miniPlayer.merged ? [...items, 'player'] : items;
  const vertical = isVertical(position);
  const lit = d.active || d.merging;

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

  const detachPlayer = (origin: Origin | null) => {
    setEmergeFrom(origin);
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    setMerged(false);
  };

  const glow = lit
    ? {
        shadowColor: theme.colors.accent,
        shadowOpacity: 0.9,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 0 },
        elevation: 14,
      }
    : null;

  return (
    <View pointerEvents="box-none" style={[styles.layer, dockStyle, { zIndex: d.zIndex }]}>
      <View ref={dockRef} collapsable={false}>
        <Animated.View
          {...d.panHandlers}
          style={{
            backgroundColor: style.background,
            borderRadius: style.radius,
            opacity: d.opacity,
            transform: [
              { translateX: d.pan.x },
              { translateY: d.pan.y },
              { scale: d.scale },
              { scale: squash },
            ],
            ...glow,
          }}
        >
          {/* Giữ lâu vào khoảng trống giữa các nút cũng kéo được dock */}
          <Pressable
            {...d.pressProps}
            style={{ flexDirection: vertical ? 'column' : 'row', padding: DOCK_PADDING, gap: DOCK_GAP }}
          >
            {ids.map((id) => {
              const isActive = id === active;
              if (id === 'player') {
                return (
                  <PlayerItem
                    key={id}
                    active={isActive}
                    onPress={() => onChange('player')}
                    onDetach={detachPlayer} // giữ lâu để tách player ra khỏi dock
                  />
                );
              }
              const color = isActive ? theme.colors.accent : theme.colors.textSecondary;
              return (
                <Pressable
                  key={id}
                  {...d.pressProps}
                  onPress={() => onChange(id)}
                  style={{ width: ITEM_SIZE, height: ITEM_SIZE, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name={isActive ? ICONS[id].on : ICONS[id].off} size={24} color={color} />
                  {style.showLabels && <Text style={{ color, fontSize: 10, marginTop: 2 }}>{LABELS[id]}</Text>}
                </Pressable>
              );
            })}
          </Pressable>
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: style.radius, borderWidth: 2, borderColor: theme.colors.accent, opacity: lit ? 1 : 0 },
            ]}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});