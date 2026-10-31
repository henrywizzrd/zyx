import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { DockPosition } from '../theme/types';

const POSITIONS: DockPosition[] = [
  'bottom', 'top', 'left', 'right',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
];

export function SettingsScreen() {
  const { theme, setDockPosition } = useTheme();
  const pad = useContentInsets();

  return (
    <View style={{ flex: 1, paddingTop: pad.top + 16, paddingLeft: pad.left + 16, paddingRight: pad.right + 16 }}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>
      <Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>Dock position</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {POSITIONS.map((p) => {
          const on = theme.dock.position === p;
          return (
            <Pressable
              key={p}
              onPress={() => setDockPosition(p)}
              style={[styles.btn, { backgroundColor: on ? theme.colors.accent : theme.colors.surface }]}
            >
              <Text style={{ color: on ? '#000' : theme.colors.text, fontWeight: '600' }}>{p}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700', marginBottom: 24 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
});