import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useDrag } from '../player/PlayerProvider';
import { Position, Theme } from '../theme/types';
import { computeLayout, dockSize } from './layout';

// Ô mờ cho biết dock sẽ nằm ở đâu khi thả tay (bong bóng mini player thì không cần)
export function DropPreview() {
  const { theme } = useTheme();
  const { drag } = useDrag();
  const insets = useSafeAreaInsets();

  if (!drag || drag.target === 'merge' || drag.kind !== 'dock') return null;

  // Chỗ sẽ nằm khi thả: một vệt bóng mờ, không viền
  const box = {
    backgroundColor: theme.colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  };

  if (drag.kind === 'dock') {
    const target = drag.target as Position;
    const hypothetical: Theme = { ...theme, dock: { ...theme.dock, position: target } };
    const { dockStyle } = computeLayout(hypothetical, insets);
    const count = theme.dock.items.length + (theme.miniPlayer.merged ? 1 : 0);
    const size = dockSize(count, target, theme.dock.labels);
    return (
      <View pointerEvents="none" style={[{ position: 'absolute', zIndex: 1 }, dockStyle]}>
        <View style={{ width: size.width, height: size.height, borderRadius: Math.min(size.width, size.height) / 2, ...box }} />
      </View>
    );
  }

  // Bong bóng mini player: không hiện ô mờ (thả ở đâu bong bóng tự trượt về chỗ đó)
  return null;
}
