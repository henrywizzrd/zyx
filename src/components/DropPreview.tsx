import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { computeLayout, dockSize, MP_THICKNESS, playerSize } from './layout';

export function DropPreview() {
  const { theme } = useTheme();
  const { drag } = usePlayer();
  const insets = useSafeAreaInsets();

  if (!drag || drag.target === 'merge') return null;

  const hypothetical =
    drag.kind === 'dock'
      ? { ...theme, dock: { ...theme.dock, position: drag.target } }
      : { ...theme, miniPlayer: { ...theme.miniPlayer, position: drag.target } };
  const { dockStyle, playerStyle, playerPosition } = computeLayout(hypothetical, insets);

  const isDock = drag.kind === 'dock';
  const count = theme.dock.items.length + (theme.miniPlayer.merged ? 1 : 0);
  const size = isDock ? dockSize(count, drag.target) : playerSize(playerPosition);
  const pill = theme.miniPlayer.variant === 'pill';
  const radius = isDock ? theme.dock.style.radius : pill ? MP_THICKNESS / 2 : theme.miniPlayer.style.rectRadius;

  return (
    <View pointerEvents="none" style={[{ position: 'absolute', zIndex: 1 }, isDock ? dockStyle : playerStyle]}>
      <View
        style={{
          width: size.width,
          height: size.height,
          borderRadius: radius,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: theme.colors.accent,
          backgroundColor: 'rgba(29,185,84,0.12)',
        }}
      />
    </View>
  );
}