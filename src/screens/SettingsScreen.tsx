import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { MiniPlayerVariant } from '../theme/types';
import { LANGUAGES, useT } from '../i18n';

const PlaybackLab: React.ComponentType | null =
  Platform.OS === 'web' ? null : require('../components/PlaybackLab').PlaybackLab;
const VARIANTS: MiniPlayerVariant[] = ['pill', 'rect'];

// labels: chữ hiển thị cho từng lựa chọn (bỏ trống thì hiện chính giá trị)
function Chips<T extends string>({ options, value, onSelect, labels }: { options: readonly T[]; value: T; onSelect: (v: T) => void; labels?: Partial<Record<T, string>> }) {
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
            <Text style={{ color: on ? '#000' : theme.colors.text, fontWeight: '600' }}>{labels?.[o] ?? o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen() {
  const { theme, resetTheme, setMiniPlayerVariant, setMerged, setLanguage } = useTheme();
  const t = useT();
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
      <Text style={[styles.title, { color: theme.colors.text }]}>{t('settings.title')}</Text>
      <Text style={{ color: theme.colors.textSecondary, marginTop: 8 }}>{t('settings.hint')}</Text>

      {/* Ngôn ngữ: tên mỗi ngôn ngữ luôn viết bằng chính ngôn ngữ đó, để ai cũng tìm được */}
      <Text style={label}>{t('settings.language')}</Text>
      <Chips
        options={LANGUAGES.map((l) => l.id)}
        value={theme.language}
        onSelect={setLanguage}
        labels={Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]))}
      />

      <Text style={label}>{t('settings.miniStyle')}</Text>
      <Chips
        options={VARIANTS}
        value={theme.miniPlayer.variant}
        onSelect={setMiniPlayerVariant}
        labels={{ pill: t('settings.mini.pill'), rect: t('settings.mini.rect') }}
      />

      <Text style={label}>{t('settings.merge')}</Text>
      <Chips
        options={['on', 'off'] as const}
        value={theme.miniPlayer.merged ? 'on' : 'off'}
        onSelect={(v) => setMerged(v === 'on')}
        labels={{ on: t('common.on'), off: t('common.off') }}
      />

      <Pressable
        onPress={resetTheme}
        style={[styles.chip, { backgroundColor: theme.colors.surface, alignSelf: 'flex-start', marginTop: 32 }]}
      >
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{t('settings.reset')}</Text>
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