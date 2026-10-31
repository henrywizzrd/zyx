import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EdgeInsets, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { DockPosition, TabId } from '../theme/types';

const ITEM_SIZE = 52;
const PADDING = 8;
const DOCK_THICKNESS = ITEM_SIZE + PADDING * 2;

const ICONS: Record<TabId, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  home: { on: 'home', off: 'home-outline' },
  search: { on: 'search', off: 'search-outline' },
  library: { on: 'library', off: 'library-outline' },
  settings: { on: 'settings', off: 'settings-outline' },
};

const LABELS: Record<TabId, string> = {
  home: 'Home',
  search: 'Search',
  library: 'Library',
  settings: 'Settings',
};

// Dock không còn đẩy nội dung. Hook này chỉ trả về safe area,
// kèm endPadding để màn hình cuộn có thể kéo mục cuối lên khỏi dock.
export function useContentInsets() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  return {
    top: insets.top,
    bottom: insets.bottom,
    left: insets.left,
    right: insets.right,
    endPadding: DOCK_THICKNESS + theme.dock.style.margin * 2,
  };
}

function placement(position: DockPosition, insets: EdgeInsets, m: number): ViewStyle {
  const top = insets.top + m;
  const bottom = insets.bottom + m;
  const left = insets.left + m;
  const right = insets.right + m;

  switch (position) {
    case 'bottom':
      return { left: 0, right: 0, bottom, alignItems: 'center' };
    case 'top':
      return { left: 0, right: 0, top, alignItems: 'center' };
    case 'left':
      return { top: 0, bottom: 0, left, justifyContent: 'center' };
    case 'right':
      return { top: 0, bottom: 0, right, justifyContent: 'center' };
    case 'top-left':
      return { top, left };
    case 'top-right':
      return { top, right };
    case 'bottom-left':
      return { bottom, left };
    case 'bottom-right':
      return { bottom, right };
  }
}

export function FloatingDock({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { position, items, style } = theme.dock;

  const vertical = position !== 'top' && position !== 'bottom';
  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, placement(position, insets, style.margin)]}
    >
      <View
        style={{
          flexDirection: vertical ? 'column' : 'row',
          padding: PADDING,
          gap: 6,
          backgroundColor: style.background,
          borderRadius: style.radius,
        }}
      >
        {items.map((id) => {
          const isActive = id === active;
          const color = isActive ? theme.colors.accent : theme.colors.textSecondary;
          return (
            <Pressable
              key={id}
              onPress={() => onChange(id)}
              style={{ width: ITEM_SIZE, height: ITEM_SIZE, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={isActive ? ICONS[id].on : ICONS[id].off} size={24} color={color} />
              {style.showLabels && <Text style={{ color, fontSize: 10, marginTop: 2 }}>{LABELS[id]}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});