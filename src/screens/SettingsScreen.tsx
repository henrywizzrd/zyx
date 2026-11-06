import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { MiniPlayerVariant } from '../theme/types';
import { LANGUAGES, useT } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { useNav } from '../nav/Nav';
import { signOut, useSession } from '../data/auth';

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
            <Text style={{ color: on ? theme.colors.onAccent : theme.colors.text, fontWeight: '600' }}>{labels?.[o] ?? o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen() {
  const { theme, resetTheme, setMiniPlayerVariant, setMerged, setLanguage, setDockLabels } = useTheme();
  const t = useT();
  const { push } = useNav();
  const pad = useContentInsets();
  const label = { color: theme.colors.textSecondary, marginTop: 24, marginBottom: 12 };
  const session = useSession();

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

      {/* Giao diện: mở Theme Studio */}
      <Pressable onPress={() => push({ type: 'themeStudio' })} style={[styles.row, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.accent }]}>
          <Ionicons name="color-palette" size={20} color={theme.colors.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>{t('settings.appearance')}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>{t('settings.appearanceHint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
      </Pressable>

      {/* Ngôn ngữ: tên mỗi ngôn ngữ luôn viết bằng chính ngôn ngữ đó, để ai cũng tìm được */}
      <Text style={label}>{t('settings.language')}</Text>
      <Chips
        options={LANGUAGES.map((l) => l.id)}
        value={theme.language}
        onSelect={setLanguage}
        labels={Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]))}
      />

      <Text style={label}>{t('settings.dockLabels')}</Text>
      <Chips
        options={['on', 'off'] as const}
        value={theme.dock.labels ? 'on' : 'off'}
        onSelect={(v) => setDockLabels(v === 'on')}
        labels={{ on: t('common.on'), off: t('common.off') }}
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

      {/* Tài khoản: đang đăng nhập tên gì (hoặc Khách) + Đăng xuất (quay về màn đăng nhập) */}
      <Text style={label}>{t('settings.account')}</Text>
      <View style={[styles.row, { marginTop: 0, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.accent }]}>
          <Ionicons name={session?.mode === 'account' ? 'person' : 'person-outline'} size={20} color={theme.colors.onAccent} />
        </View>
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {session?.mode === 'account' ? t('settings.signedInAs', { name: session.username }) : t('settings.guestMode')}
        </Text>
        <Pressable onPress={signOut} hitSlop={8} style={[styles.chip, { backgroundColor: theme.colors.bg }]}>
          <Text style={{ color: '#E5484D', fontWeight: '700' }}>{t('settings.signOut')}</Text>
        </Pressable>
      </View>

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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});