import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useDrag } from '../player/PlayerProvider';
import { MiniAnchor, Position, Theme } from '../theme/types';
import { computeLayout, dockSize, MP_THICKNESS, resolveMini, useFrame } from './layout';

// Ô mờ cho biết dock / mini player sẽ nằm ở đâu khi thả tay
export function DropPreview() {
  const { theme } = useTheme();
  const { drag } = useDrag();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useFrame();

  if (!drag || drag.target === 'merge') return null;

  // Chỗ sẽ nằm khi thả: một vệt bóng mờ, không viền
  const box = {
    backgroundColor: theme.colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  };
  const pill = theme.miniPlayer.variant === 'pill';
  const miniRadius = pill ? MP_THICKNESS / 2 : theme.miniPlayer.style.rectRadius;

  if (drag.kind === 'dock') {
    const target = drag.target as Position;
    const hypothetical: Theme = { ...theme, dock: { ...theme.dock, position: target } };
    const { dockStyle } = computeLayout(hypothetical, insets);
    const count = theme.dock.items.length + (theme.miniPlayer.merged ? 1 : 0);
    const size = dockSize(count, target);
    return (
      <View pointerEvents="none" style={[{ position: 'absolute', zIndex: 1 }, dockStyle]}>
        <View style={{ width: size.width, height: size.height, borderRadius: theme.dock.style.radius, ...box }} />
      </View>
    );
  }

  // Mini player: hiện đúng chỗ và đúng cỡ (đầy đủ hoặc bubble) mà nó sẽ nằm, đã tính cả việc tránh dock
  const rect = resolveMini(theme, insets, W, H, drag.target as MiniAnchor, theme.miniPlayer.collapsed);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', zIndex: 1, left: rect.x, top: rect.y }}>
      <View style={{ width: rect.w, height: rect.h, borderRadius: miniRadius, ...box }} />
    </View>
  );
}
