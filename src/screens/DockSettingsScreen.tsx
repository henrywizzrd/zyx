import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useT } from '../i18n';
import { Group, GROUP_COLORS, PageHeader, Row, Seg, Toggle } from '../components/SettingsUI';

// Dock options, moved out of Settings (27/11) so Settings stays short: dock style, labels,
// and (bar dock only) merging the mini player into the dock
export function DockSettingsScreen() {
  const { theme, setDockMode, setDockLabels, setMerged } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16, width: '100%', maxWidth: 560, alignSelf: 'center' }}
      >
        <PageHeader title={t('settings.dock')} />
        <Group label={t('settings.dock')} color={GROUP_COLORS.yellow}>
          <Row
            first
            title={t('settings.dockMode')}
            right={<Seg options={['apple', 'zyx', 'bar'] as const} value={theme.dock.mode} onSelect={setDockMode} labels={{ bar: t('settings.dockBar'), apple: 'Apple', zyx: 'ZYX' }} />}
          />
          <Row title={t('settings.dockLabels')} right={<Toggle value={theme.dock.labels} onChange={setDockLabels} />} />
          {theme.dock.mode === 'bar' && <Row title={t('settings.merge')} right={<Toggle value={theme.miniPlayer.merged} onChange={setMerged} />} />}
        </Group>
      </ScrollView>
    </View>
  );
}
