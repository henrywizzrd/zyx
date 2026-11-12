import { SplitPane } from '../components/SplitPane';
import { syncProfile, useProfile, useProfileSyncError } from '../data/profile';
import React from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { LANGUAGES, useT } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { useNav } from '../nav/Nav';
import { signOut, useSession } from '../data/auth';
import { setCrossfade, useCrossfade } from '../player/crossfade';
import { GlassFill, glassShadow } from '../components/Glass';
import { useRenderProbe } from '../components/JankMonitor';

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
            style={[styles.chip, on ? { backgroundColor: theme.colors.accent } : glassShadow(0.5, theme.colors.glassTint !== 'dark')]}
          >
            {!on && <GlassFill radius={20} solid={0.45} slab />}
            <Text style={{ color: on ? theme.colors.onAccent : theme.colors.text, fontWeight: '600' }}>{labels?.[o] ?? o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen() {
  const { theme, landscape, resetTheme, setMerged, setLanguage, setDockLabels, setDockRimLight, setDockMode, setPlayerLook } = useTheme();
  const t = useT();
  const { push } = useNav();
  const pad = useContentInsets();
  const label = { color: theme.colors.textSecondary, marginTop: 24, marginBottom: 12 };
  const session = useSession();
  const profile = useProfile();
  const syncErr = useProfileSyncError();
  const crossfade = useCrossfade();
  useRenderProbe('Cài đặt', { theme, landscape, t, push, pad, session, profile, syncErr, crossfade });
  // Thẻ trong Cài đặt là tấm kính giống dock (cùng kiểu với ô playlist ở Home)
  const gs = glassShadow(0.8, theme.colors.glassTint !== 'dark');

  const settingsPart = (
    <>
      <Text style={[styles.title, { color: theme.colors.text }]}>{t('settings.title')}</Text>
      <Text style={{ color: theme.colors.textSecondary, marginTop: 8 }}>{t('settings.hint')}</Text>

      {/* Giao diện: mở Theme Studio */}
      <Pressable onPress={() => push({ type: 'themeStudio' })} style={[styles.row, gs]}>
        <GlassFill radius={16} solid={0.5} slab />
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

      {/* Kiểu màn player: thường (ảnh bìa lớn) hoặc đĩa than */}
      <Text style={label}>{t('settings.playerLook')}</Text>
      <Chips
        options={['classic', 'vinyl'] as const}
        value={theme.player.look ?? 'classic'}
        onSelect={setPlayerLook}
        labels={{ classic: t('settings.playerClassic'), vinyl: t('settings.playerVinyl') }}
      />

      {/* Kiểu dock: Apple Music hoặc dạng thanh */}
      <Text style={label}>{t('settings.dockMode')}</Text>
      <Chips
        options={['apple', 'zyx', 'bar'] as const}
        value={theme.dock.mode}
        onSelect={setDockMode}
        labels={{ bar: t('settings.dockBar'), apple: 'Apple Music', zyx: 'ZYX' }}
      />
      <Text style={label}>{t('settings.dockLabels')}</Text>
      <Chips
        options={['on', 'off'] as const}
        value={theme.dock.labels ? 'on' : 'off'}
        onSelect={(v) => setDockLabels(v === 'on')}
        labels={{ on: t('common.on'), off: t('common.off') }}
      />

      {/* Ánh sáng viền trên / dưới của tấm kính dock */}
      <Text style={label}>{t('settings.dockRim')}</Text>
      <Chips
        options={['on', 'off'] as const}
        value={theme.dock.rimLight === false ? 'off' : 'on'}
        onSelect={(v) => setDockRimLight(v === 'on')}
        labels={{ on: t('common.on'), off: t('common.off') }}
      />

      {theme.dock.mode === 'bar' && (
        <>
          <Text style={label}>{t('settings.merge')}</Text>
          <Chips
            options={['on', 'off'] as const}
            value={theme.miniPlayer.merged ? 'on' : 'off'}
            onSelect={(v) => setMerged(v === 'on')}
            labels={{ on: t('common.on'), off: t('common.off') }}
          />
        </>
      )}

      {/* Chuyển bài mượt: bài cũ nhỏ dần, bài mới to dần trong 6 giây */}
      <Text style={[label, { marginBottom: 4 }]}>{t('settings.crossfade')}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12, opacity: 0.8 }}>{t('settings.crossfadeHint')}</Text>
      <Chips
        options={['on', 'off'] as const}
        value={crossfade ? 'on' : 'off'}
        onSelect={(v) => setCrossfade(v === 'on')}
        labels={{ on: t('common.on'), off: t('common.off') }}
      />

    </>
  );
  const accountPart = (
    <>
      {/* Tài khoản: đang đăng nhập tên gì (hoặc Khách) + Đăng xuất (quay về màn đăng nhập) */}
      <Text style={label}>{t('settings.account')}</Text>
      <View style={[styles.row, { marginTop: 0 }, gs]}>
        <GlassFill radius={16} solid={0.5} slab />
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
      {/* Hồ sơ chưa đồng bộ được: hiện lý do + nút thử lại */}
      {!!syncErr && (
        <Pressable onPress={() => syncProfile()} style={[{ marginTop: 8, padding: 12, borderRadius: 16, borderCurve: 'continuous' }, gs]}>
          <GlassFill radius={16} solid={0.5} slab />
          <Text style={{ color: '#E5484D', fontSize: 13, lineHeight: 18 }}>{t('settings.syncError', { msg: syncErr })}</Text>
          <Text style={{ color: theme.colors.accent, fontWeight: '700', marginTop: 6 }}>{t('settings.syncRetry')}</Text>
        </Pressable>
      )}
    </>
  );
  const extraPart = (
    <>
      <Pressable
        onPress={resetTheme}
        style={[styles.chip, { alignSelf: 'flex-start', marginTop: 32 }, glassShadow(0.5, theme.colors.glassTint !== 'dark')]}
      >
        <GlassFill radius={20} solid={0.45} slab />
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{t('settings.reset')}</Text>
      </Pressable>
      {/* Nhật ký dò lỗi (thay cho Playback lab) */}
      <Pressable onPress={() => push({ type: 'log' })} style={[styles.row, gs]}>
        <GlassFill radius={16} solid={0.5} slab />
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.bg }]}>
          <Ionicons name="document-text-outline" size={20} color={theme.colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>{t('settings.log')}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>{t('settings.logHint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
      </Pressable>
    </>
  );

  // Màn hình ngang: trái = các cài đặt, phải = tài khoản (thẻ hồ sơ + đăng xuất) và phần còn lại. Mỗi bên cuộn riêng
  if (landscape) {
    return (
      <SplitPane
        ratio={0.55}
        left={settingsPart}
        right={
          <>
            <Text style={[styles.title, { color: theme.colors.text }]}>{t('settings.account')}</Text>
            <View style={[styles.profileCard, gs]}>
              <GlassFill radius={18} solid={0.5} slab />
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: profile.avatarColor, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800' }}>{(profile.name || '?').slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>{profile.name}</Text>
                <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                  {session?.mode === 'account' ? `@${session.username}` : t('settings.guestMode')}
                </Text>
                {session?.mode === 'account' && !!session.email && (
                  <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>{session.email}</Text>
                )}
              </View>
            </View>
            {accountPart}
            {extraPart}
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
      {settingsPart}
      {accountPart}
      {extraPart}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderCurve: 'continuous' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, padding: 12, borderRadius: 16, borderCurve: 'continuous' },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, padding: 14, borderRadius: 18, borderCurve: 'continuous' },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  rowIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});