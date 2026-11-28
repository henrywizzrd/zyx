// Import from Spotify (28/11): paste a public playlist / album link, ZYX looks up every song in its own catalogue and
// builds a new playlist in the same order. Songs it can't find are listed so the user can look for them by hand.
// Opened from the + button on the profile (Library) and from Settings
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useT } from '../i18n';
import { useNav } from '../nav/Nav';
import { Chevron, Group, GROUP_COLORS, PageHeader, Row } from '../components/SettingsUI';
import { armTouchProbe, log } from '../data/applog';
import { addToPlaylist, createPlaylist, setPlaylistDescription } from '../data/db';
import { fetchSpotifyList, matchAll, type SpotifyList, type SpotifyTrack } from '../music/spotifyImport';
import { musicSupported } from '../music/lazy';

type Step =
  | { s: 'idle' }
  | { s: 'reading' }
  | { s: 'matching'; list: SpotifyList; done: number; found: number }
  | { s: 'done'; list: SpotifyList; playlistId: string; found: number; missing: SpotifyTrack[] }
  | { s: 'error'; msg: string };

export function ImportScreen() {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { push } = useNav();
  const { text, textSecondary, accent, onAccent, border, surface } = theme.colors;
  const pop = theme.style === 'pop';
  const [link, setLink] = useState('');
  const [step, setStep] = useState<Step>({ s: 'idle' });
  const gone = useRef(false);
  useEffect(() => {
    // Keyboard and page lifetime go to the log too: the Library felt frozen after leaving this page (28/11)
    const a = Keyboard.addListener('keyboardDidShow', () => log('ui', 'import: bàn phím hiện'));
    const b = Keyboard.addListener('keyboardDidHide', () => log('ui', 'import: bàn phím ẩn'));
    return () => {
      gone.current = true;
      a.remove();
      b.remove();
      log('ui', `import: đóng trang (bàn phím ${Keyboard.isVisible() ? 'còn hiện' : 'đã ẩn'})`);
    };
  }, []);
  const busy = step.s === 'reading' || step.s === 'matching';

  const start = async () => {
    if (busy || !link.trim()) return;
    if (!musicSupported) return setStep({ s: 'error', msg: t('import.unsupported') });
    setStep({ s: 'reading' });
    let list: SpotifyList | null = null;
    try {
      list = await fetchSpotifyList(link);
    } catch (e) {
      log('error', `spotify import: ${String(e)}`);
    }
    if (gone.current) return;
    if (!list) return setStep({ s: 'error', msg: t('import.badLink') });
    if (!list.tracks.length) return setStep({ s: 'error', msg: t('import.empty') });
    setStep({ s: 'matching', list, done: 0, found: 0 });
    const t0 = Date.now();
    const got = await matchAll(list.tracks, (done, found) => !gone.current && setStep({ s: 'matching', list: list!, done, found }), () => gone.current);
    if (gone.current) return;
    const id = createPlaylist(list.name);
    setPlaylistDescription(id, t('import.desc'));
    const missing: SpotifyTrack[] = [];
    const seen = new Set<string>();
    got.forEach((tr, i) => {
      if (!tr) missing.push(list!.tracks[i]);
      else if (!seen.has(tr.id)) {
        seen.add(tr.id);
        addToPlaylist(id, tr);
      }
    });
    log('music', `spotify import: "${list.name}" matched ${got.length - missing.length}/${got.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
    setStep({ s: 'done', list, playlistId: id, found: got.length - missing.length, missing });
    armTouchProbe(180000, 'sau khi nhập playlist Spotify');
  };

  const openPlaylist = () => step.s === 'done' && push({ type: 'collection', source: 'local', kind: 'playlist', id: step.playlistId, title: step.list.name });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16, width: '100%', maxWidth: 560, alignSelf: 'center' }}
      >
        <PageHeader title={t('import.title')} />
        <Text style={{ color: text, fontSize: 15, lineHeight: 22, marginTop: 10 }}>{t('import.body')}</Text>

        <Group label={t('import.link')} color={GROUP_COLORS.lime}>
          <View style={{ padding: 14, gap: 12 }}>
            <TextInput
              value={link}
              onChangeText={setLink}
              editable={!busy}
              placeholder="https://open.spotify.com/playlist/…"
              placeholderTextColor={textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={start}
              style={{ color: text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, borderWidth: pop ? 2 : 1, borderColor: pop ? '#111111' : border, backgroundColor: surface }}
            />
            <Pressable
              onPress={start}
              disabled={busy || !link.trim()}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: accent, opacity: busy || !link.trim() ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
                pop && { borderWidth: 2.5, borderColor: '#111111' },
              ]}
            >
              {busy ? <ActivityIndicator color={onAccent} /> : <Ionicons name="download-outline" size={18} color={onAccent} />}
              <Text style={{ color: onAccent, fontWeight: '800', fontSize: 15 }}>{t('import.go')}</Text>
            </Pressable>
          </View>
        </Group>

        {step.s === 'reading' && <Text style={{ color: textSecondary, marginTop: 16 }}>{t('import.reading')}</Text>}
        {step.s === 'error' && <Text style={{ color: '#E5484D', marginTop: 16, lineHeight: 20 }}>{step.msg}</Text>}

        {step.s === 'matching' && (
          <View style={{ marginTop: 18 }}>
            <Text style={{ color: text, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{step.list.name}</Text>
            <Text style={{ color: textSecondary, marginTop: 4 }}>{t('import.progress', { done: step.done, total: step.list.tracks.length, found: step.found })}</Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: border, marginTop: 10, overflow: 'hidden' }}>
              <View style={{ width: `${(step.done / Math.max(1, step.list.tracks.length)) * 100}%`, height: '100%', backgroundColor: accent }} />
            </View>
          </View>
        )}

        {step.s === 'done' && (
          <>
            <Group label={t('import.result')} color={GROUP_COLORS.sky}>
              <Row first title={step.list.name} hint={t('import.summary', { found: step.found, total: step.list.tracks.length })} onPress={openPlaylist} right={<Chevron />} />
              {step.list.total > step.list.tracks.length && <Row title={t('import.partial', { got: step.list.tracks.length, total: step.list.total })} />}
            </Group>
            {step.missing.length > 0 && (
              <Group label={t('import.missing', { n: step.missing.length })} color={GROUP_COLORS.pink}>
                {step.missing.map((tr, i) => (
                  <Row key={i} first={i === 0} title={tr.title} hint={tr.artists.join(', ')} />
                ))}
              </Group>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
