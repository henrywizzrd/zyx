import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { MiniPlayerVariant } from '../theme/types';

const PlaybackLab: React.ComponentType | null =
  Platform.OS === 'web' ? null : require('../components/PlaybackLab').PlaybackLab;
const VARIANTS: MiniPlayerVariant[] = ['pill', 'rect'];

function Chips<T extends string>({ options, value, onSelect }: { options: T[]; value: T; onSelect: (v: T) => void }) {
  const { theme } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onSelect(o)}
            style={[styles.chip, { backgroundColor: on ? theme.colors.accent : theme.colors.surface }]}
          >
            <Text style={{ color: on ? '#000' : theme.colors.text, fontWeight: '600' }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen() {
  const { theme, resetTheme, setMiniPlayerVariant, setMerged } = useTheme();
  const pad = useContentInsets();
  const label = { color: theme.colors.textSecondary, marginTop: 24, marginBottom: 12 };

  return (
    <ScrollView
    bounces={false}
    overScrollMode="never"
      contentContainerStyle={{
        paddingTop: pad.top + 16,
        paddingBottom: pad.bottom + pad.endPadding,
        paddingLeft: pad.left + 16,
        paddingRight: pad.right + 16,
      }}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>
      <Text style={{ color: theme.colors.textSecondary, marginTop: 8 }}>
        Giữ lâu vào dock hoặc mini player rồi kéo để đổi vị trí.
      </Text>

      <Text style={label}>Mini player style</Text>
      <Chips options={VARIANTS} value={theme.miniPlayer.variant} onSelect={setMiniPlayerVariant} />

      <Text style={label}>Merge mini player into dock</Text>
      <Chips
        options={['on', 'off'] as const}
        value={theme.miniPlayer.merged ? 'on' : 'off'}
        onSelect={(v) => setMerged(v === 'on')}
      />

      <Pressable
        onPress={resetTheme}
        style={[styles.chip, { backgroundColor: theme.colors.surface, alignSelf: 'flex-start', marginTop: 32 }]}
      >
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>Reset to default</Text>
      </Pressable>
      {PlaybackLab && <PlaybackLab />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
});