import { SplitPane } from '../components/SplitPane';
import { syncProfile, useProfile, useProfileSyncError } from '../data/profile';
import React from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRotateEnter } from '../components/rotateEnter';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { LANGUAGES, useT } from '../i18n';
import { useNav } from '../nav/Nav';
import { signOut, useSession } from '../data/auth';
import { setCrossfade, useCrossfade } from '../player/crossfade';
import { setCrashReports, useCrashReports } from '../data/crashReports';
import { GlassFill, glassShadow, solidShadow } from '../components/Glass';
import { useRenderProbe } from '../components/JankMonitor';
import { useDisplayFont } from '../theme/fonts';
import { Chevron, Group, GROUP_COLORS, Row, Seg, Toggle } from '../components/SettingsUI';
import { POP_THEME_NAMES } from '../theme/pop';
import { useIsAdmin } from './AdminScreen';

// Settings, grouped like the approved 27/11 mockup: Appearance / Playback / Account / Help.
// Dock options moved to their own page (DockSettingsScreen); Glass vs Pop is chosen in Theme Studio.
export function SettingsScreen() {
  const df = useDisplayFont();
  const { theme, landscape, resetTheme, setLanguage, setPlayerLook } = useTheme();
  const t = useT();
  const { push } = useNav();
  const pad = useContentInsets();
  const session = useSession();
  const profile = useProfile();
  const syncErr = useProfileSyncError();
  const crashReports = useCrashReports();
  const crossfade = useCrossfade();
  const isAdmin = useIsAdmin();
  const enter = useRotateEnter();
  useRenderProbe('Cài đặt', { theme, landscape, t, push, pad, session, profile, syncErr, crossfade });
  const pop = theme.style === 'pop';
  const { text, textSecondary } = theme.colors;

  const themeValue = pop ? `Pop · ${POP_THEME_NAMES[theme.pop.theme]}` : `${t('studio.kind.default')} · ${t(`preset.${theme.preset}`)}`;
  const confirmReset = () =>
    Alert.alert(t('settings.reset'), t('settings.resetConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.reset'), style: 'destructive', onPress: resetTheme },
    ]);

  const avatar = profile.avatar ? (
    <Image source={{ uri: profile.avatar }} style={styles.avatar} />
  ) : (
    <View style={[styles.avatar, { backgroundColor: profile.avatarColor, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{(profile.name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );

  const appearance = (
    <Group label={t('settings.group.appearance')} color={GROUP_COLORS.yellow}>
      <Row first title={t('settings.theme')} hint={t('settings.themeHint')} right={<Chevron value={themeValue} />} onPress={() => push({ type: 'themeStudio' })} />
      <Row
        title={t('settings.playerLook')}
        right={
          <Seg
            options={['classic', 'vinyl'] as const}
            value={theme.player.look ?? 'classic'}
            onSelect={setPlayerLook}
            labels={{ classic: t('settings.playerClassic'), vinyl: t('settings.playerVinyl') }}
          />
        }
      />
      <Row title={t('settings.dock')} hint={t('settings.dockHint')} right={<Chevron />} onPress={() => push({ type: 'dock' })} />
      {/* Language names are always written in their own language, so everyone can find theirs */}
      <Row
        title={t('settings.language')}
        right={<Seg options={LANGUAGES.map((l) => l.id)} value={theme.language} onSelect={setLanguage} labels={Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]))} />}
      />
    </Group>
  );

  const playback = (
    <Group label={t('settings.group.playback')} color={GROUP_COLORS.sky}>
      {/* Crossfade: the old song fades out while the next one fades in over 6 seconds */}
      <Row first title={t('settings.crossfade')} hint={t('settings.crossfadeHint')} right={<Toggle value={crossfade} onChange={setCrossfade} />} />
    </Group>
  );

  const account = (
    <Group label={t('settings.group.account')} color={GROUP_COLORS.lime}>
      <Row
        first
        left={avatar}
        title={profile.name || (session?.mode === 'account' ? session.username : t('settings.guestMode'))}
        hint={session?.mode === 'account' ? t('settings.signedInAs', { name: session.username }) : t('settings.guestMode')}
      />
      {/* Profile not synced: show why + retry */}
      {!!syncErr && <Row title={t('settings.syncRetry')} hint={t('settings.syncError', { msg: syncErr })} onPress={() => syncProfile()} right={<Chevron />} />}
      <Row title={t('settings.reset')} hint={t('settings.resetHint')} onPress={confirmReset} right={<Chevron />} />
    </Group>
  );

  const help = (
    <Group label={t('settings.group.help')} color={GROUP_COLORS.pink}>
      <Row first title={t('settings.log')} hint={t('settings.logHint')} onPress={() => push({ type: 'log' })} right={<Chevron />} />
      {/* Crash reports (on by default): crash + black-box log go to the developer automatically */}
      <Row title={t('settings.crashReports')} hint={t('settings.crashReportsHint')} right={<Toggle value={crashReports} onChange={setCrashReports} />} />
      {/* Only the admin account sees this (the server also refuses everyone else) */}
      {isAdmin && <Row title="Admin" hint="Devices, health, logs" onPress={() => push({ type: 'admin' })} right={<Chevron />} />}
    </Group>
  );

  const signOutButton = (
    <Pressable
      onPress={signOut}
      style={({ pressed }) => [
        styles.signOut,
        pop ? solidShadow(1) : glassShadow(0.6, theme.colors.glassTint !== 'dark'),
        pop ? { backgroundColor: GROUP_COLORS.coral } : null,
        pressed && { opacity: 0.7 },
      ]}
    >
      {pop ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 14, borderWidth: 2.5, borderColor: '#111111' }]} />
      ) : (
        <GlassFill radius={14} solid={0.45} slab />
      )}
      <Text style={{ color: pop ? '#111111' : '#E5484D', fontWeight: '900', fontSize: 15 }}>{t('settings.signOut')}</Text>
    </Pressable>
  );

  const title = (
    <>
      <Text style={[styles.title, { color: text }, df]}>{t('settings.title')}</Text>
      <Text style={{ color: textSecondary, marginTop: 6 }}>{t('settings.hint')}</Text>
    </>
  );

  // Landscape: left = Appearance + Playback, right = Account + Help. Each side scrolls on its own
  if (landscape) {
    return (
      <SplitPane
        ratio={0.55}
        left={
          <>
            {title}
            {appearance}
            {playback}
          </>
        }
        right={
          <>
            {account}
            {help}
            {signOutButton}
          </>
        }
      />
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingTop: pad.top + 16,
        paddingBottom: pad.bottom + pad.endPadding,
        paddingLeft: pad.left + 16,
        paddingRight: pad.right + 16,
      }}
    >
      {/* just rotated back to portrait: slide up into place (rotateEnter.ts) */}
      <Animated.View entering={enter(0, 'up')}>
        {title}
        {appearance}
        {playback}
        {account}
        {help}
        {signOutButton}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '800' },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  signOut: { marginTop: 26, paddingVertical: 15, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center' },
});
