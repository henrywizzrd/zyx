import React, { useEffect, useState } from 'react';
import { ActivityIndicator, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { SmartImage } from '../components/Cover';
import { useActionSheet } from '../components/ActionSheet';
import { GenrePage, useNav } from '../nav/Nav';
import { useAnimatedBack } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { Card, Shelf } from '../music/ytmusic';
import { cachedGenre, GENRE_CARD, loadGenre } from '../music/genreCache';

const PAD = 16;
const CARD = GENRE_CARD;
const HERO_H = 230;

// Trang một thể loại / tâm trạng (Pop, Lo-fi, Chill, Workout...):
//  - phần đầu: màu của ô thể loại tan dần vào nền, tên thể loại thật to, nút Phát (trộn bài từ playlist nổi bật)
//  - bên dưới: các kệ playlist của thể loại đó lấy từ YouTube Music (nổi bật, cộng đồng...)
export function GenreScreen({ page }: { page: GenrePage }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { push, pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const { playTrack, shuffle, toggleShuffle } = usePlayer();
  const sheet = useActionSheet();
  const { text, textSecondary, accent, surface, bg } = theme.colors;

  // Có sẵn trên máy (đã mở hoặc đã tải trước): hiện ngay, cũ quá thì làm mới ngầm
  const [shelves, setShelves] = useState<Shelf[] | null>(() => cachedGenre(page.params)?.shelves ?? null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>(shelves ? 'done' : 'loading');
  const [retry, setRetry] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!musicSupported) return setStatus('error');
    const c = cachedGenre(page.params);
    if (c?.fresh && retry === 0) return;
    let dead = false;
    if (!c) setStatus('loading');
    loadGenre(page.params)
      .then((s) => {
        if (dead) return;
        setShelves(s);
        setStatus('done');
      })
      .catch((e) => {
        console.warn('[genre]', e);
        if (!dead && !c) setStatus('error');
      });
    return () => {
      dead = true;
    };
  }, [page.params, retry]);

  const openCard = (c: Card) => {
    if (c.kind === 'album' || c.kind === 'playlist') push({ type: 'collection', source: 'yt', kind: c.kind, id: c.id, title: c.title, thumb: c.thumb });
    else if (c.kind === 'artist') push({ type: 'artist', id: c.id, name: c.title, thumb: c.thumb });
    else if (c.song) playTrack(toTrack(c.song), [toTrack(c.song)]);
  };

  // Nút Phát: lấy bài từ playlist đầu tiên của trang rồi phát trộn
  const playGenre = async () => {
    const first = shelves?.flatMap((s) => s.cards).find((c) => c.kind === 'playlist' || c.kind === 'album');
    if (!first || starting) return;
    setStarting(true);
    try {
      const col = await ytmusic().getCollection(first.kind as 'playlist' | 'album', first.id);
      const songs = col.songs.map(toTrack);
      if (!songs.length) throw new Error('empty');
      if (!shuffle) toggleShuffle();
      playTrack(songs[Math.floor(Math.random() * songs.length)], songs, { kind: 'playlist', id: first.id, title: col.title || first.title, thumb: col.thumb ?? first.thumb });
    } catch {
      sheet.toast(t('common.loadFailed'));
    } finally {
      setStarting(false);
    }
  };

  const fadeTo = theme.background.type === 'preset' ? bg : bg + '00';

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView bounces={false} overScrollMode="never" contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
        {/* Màu của ô thể loại tan dần vào nền, tên thể loại đè lên */}
        <View style={{ height: HERO_H + pad.top }}>
          <LinearGradient colors={[page.color, page.color + 'AA', fadeTo]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          <Pressable onPress={goBack} hitSlop={10} style={[styles.back, { top: pad.top + 6, left: PAD }]}>
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </Pressable>
          <View style={styles.heroBottom}>
            <Text numberOfLines={2} style={[styles.title, { color: text }]}>{page.title}</Text>
            <Pressable
              onPress={playGenre}
              disabled={!shelves || starting}
              style={[styles.play, { backgroundColor: accent, opacity: shelves ? 1 : 0.4 }]}
            >
              {starting ? (
                <ActivityIndicator color={theme.colors.onAccent} />
              ) : (
                <Ionicons name="shuffle" size={26} color={theme.colors.onAccent} />
              )}
            </Pressable>
          </View>
        </View>

        {status === 'loading' && <ActivityIndicator color={accent} style={{ marginTop: 24 }} />}
        {status === 'error' && (
          <Pressable onPress={() => setRetry((r) => r + 1)} style={{ marginTop: 24, alignItems: 'center' }}>
            <Text style={{ color: textSecondary }}>{t('common.loadFailed')}</Text>
          </Pressable>
        )}

        {(shelves ?? []).map((shelf, si) => (
          <View key={`${si}:${shelf.title}`}>
            {!!shelf.title && <Text style={[styles.section, { color: text }]}>{shelf.title}</Text>}
            <ScrollView horizontal bounces={false} overScrollMode="never" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: PAD }}>
              {shelf.cards.map((c) => {
                const round = c.kind === 'artist';
                return (
                  <Pressable key={`${c.kind}:${c.id}`} onPress={() => openCard(c)} style={{ width: CARD }}>
                    {c.thumb ? (
                      <SmartImage url={c.thumb} size={Math.round(CARD * PixelRatio.get())} style={{ width: CARD, height: CARD, borderRadius: round ? CARD / 2 : 8, backgroundColor: surface }} />
                    ) : (
                      <View style={{ width: CARD, height: CARD, borderRadius: round ? CARD / 2 : 8, backgroundColor: surface }} />
                    )}
                    <Text numberOfLines={2} style={{ color: text, fontSize: 14, fontWeight: '700', marginTop: 8 }}>{c.title}</Text>
                    {!!c.subtitle && (
                      <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>{c.subtitle}</Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    position: 'absolute', zIndex: 2, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  heroBottom: { position: 'absolute', left: PAD, right: PAD, bottom: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  title: { flex: 1, fontSize: 40, fontWeight: '900' },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 20, fontWeight: '800', marginTop: 22, marginBottom: 10, paddingHorizontal: PAD },
});
