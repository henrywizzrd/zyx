import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, PixelRatio, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerPick } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { SmartImage } from '../components/Cover';
import { useSongMenu } from '../components/useSongMenu';
import { ArtistPage as ArtistNavPage, useNav } from '../nav/Nav';
import { useAnimatedBack, useEntered } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { ArtistPage, Card } from '../music/ytmusic';
import { isSaved, PlayContext, setSaved, useDbVersion } from '../data/db';

const PAD = 16;
const HERO_H = 340;
const CARD = 140;

// Trang nghệ sĩ đã tải: mở lại trong cùng phiên thì hiện ngay
const pageCache = new Map<string, ArtistPage>();

// Trang nghệ sĩ: ảnh lớn + tên, nút Theo dõi (lưu vào Thư viện), phát / trộn bài,
// bài hát nổi bật, rồi các kệ Album, Đĩa đơn, Video, Nghệ sĩ tương tự lấy từ YouTube Music
export function ArtistScreen({ page }: { page: ArtistNavPage }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { width } = useWindowDimensions();
  const { push, pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  // Trượt vào xong mới dựng các kệ album / video (nhiều ảnh) để hiệu ứng mở trang không bị khựng
  const entered = useEntered();
  const { track, playTrack, shuffle, toggleShuffle } = usePlayerPick('track', 'playTrack', 'shuffle', 'toggleShuffle');
  const songMenu = useSongMenu();
  const dbv = useDbVersion();
  const { text, textSecondary, accent, onAccent, surface, border } = theme.colors;

  const [data, setData] = useState<ArtistPage | null>(pageCache.get(page.id) ?? null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>(data ? 'done' : 'loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!musicSupported) return setStatus('error');
    let dead = false;
    if (!pageCache.has(page.id)) setStatus('loading');
    ytmusic()
      .getArtist(page.id)
      .then((a) => {
        if (dead) return;
        pageCache.set(page.id, a);
        setData(a);
        setStatus('done');
      })
      .catch((e) => {
        console.warn('[artist]', e);
        if (!dead && !pageCache.has(page.id)) setStatus('error');
      });
    return () => {
      dead = true;
    };
  }, [page.id, retry]);

  const name = data?.name || page.name;
  const thumb = data?.thumb || page.thumb;
  const following = useMemo(() => isSaved('artist', page.id), [page.id, dbv]);
  const toggleFollow = () => setSaved({ kind: 'artist', id: page.id, title: name, subtitle: '', thumb }, !following);

  const songs = useMemo(() => (data?.songs ?? []).map(toTrack), [data]);
  const ctx: PlayContext = { kind: 'artist', id: page.id, title: name, thumb };
  const playAll = useCallback(
    (shuffled: boolean) => {
      if (!songs.length) return;
      if (shuffled !== shuffle) toggleShuffle();
      playTrack(shuffled ? songs[Math.floor(Math.random() * songs.length)] : songs[0], songs, ctx);
    },
    [songs, shuffle, toggleShuffle, playTrack, ctx]
  );

  const openCard = (c: Card) => {
    if (c.kind === 'album' || c.kind === 'playlist') push({ type: 'collection', source: 'yt', kind: c.kind, id: c.id, title: c.title, thumb: c.thumb });
    else if (c.kind === 'artist') push({ type: 'artist', id: c.id, name: c.title, thumb: c.thumb });
    else if (c.song) playTrack(toTrack(c.song), [toTrack(c.song)]);
  };

  // Cuối ảnh lớn mờ dần vào màu nền (nền ảnh/video thì mờ hẳn để lộ nền chung)
  const fadeTo = theme.background.type === 'preset' ? theme.colors.bg : theme.colors.bg + '00';
  const imgSize = Math.round(Math.max(width, HERO_H) * PixelRatio.get());

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView bounces={false} overScrollMode="never" contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
        {/* Ảnh lớn của nghệ sĩ, tên đè lên phần dưới ảnh */}
        <View style={{ height: HERO_H }}>
          {thumb ? (
            <SmartImage url={thumb} size={imgSize} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="person" size={96} color={textSecondary} />
            </View>
          )}
          <LinearGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0)', fadeTo]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
          <Pressable onPress={goBack} hitSlop={10} style={[styles.back, { top: pad.top + 8, left: PAD }]}>
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </Pressable>
          <Text numberOfLines={2} style={[styles.name, { color: text }]}>{name}</Text>
        </View>

        <View style={{ paddingHorizontal: PAD }}>
          {/* Theo dõi, trộn bài, phát */}
          <View style={styles.actions}>
            <Pressable onPress={toggleFollow} style={[styles.follow, { borderColor: following ? accent : border, backgroundColor: following ? accent + '22' : 'transparent' }]}>
              <Text style={{ color: following ? accent : text, fontWeight: '700', fontSize: 13 }}>{t(following ? 'artist.following' : 'artist.follow')}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => playAll(true)} hitSlop={8} disabled={!songs.length}>
              <Ionicons name="shuffle" size={28} color={shuffle ? accent : textSecondary} />
            </Pressable>
            <Pressable onPress={() => playAll(false)} disabled={!songs.length} style={[styles.play, { backgroundColor: accent, opacity: songs.length ? 1 : 0.4 }]}>
              <Ionicons name="play" size={28} color={onAccent} style={{ marginLeft: 3 }} />
            </Pressable>
          </View>

          {status === 'loading' && <ActivityIndicator color={accent} style={{ marginTop: 24 }} />}
          {status === 'error' && (
            <Pressable onPress={() => setRetry((r) => r + 1)} style={{ marginTop: 24, alignItems: 'center' }}>
              <Text style={{ color: textSecondary }}>{t('common.loadFailed')}</Text>
            </Pressable>
          )}

          {/* Bài hát nổi bật */}
          {songs.length > 0 && <Text style={[styles.section, { color: text }]}>{t('artist.topSongs')}</Text>}
          {songs.map((s, i) => (
            <Pressable key={s.id} onPress={() => playTrack(s, songs, ctx)} onLongPress={() => songMenu(s)} style={styles.row}>
              <Text style={{ width: 22, color: textSecondary, fontSize: 15, textAlign: 'center' }}>{i + 1}</Text>
              {s.thumb ? (
                <SmartImage url={s.thumb} size={156} style={[styles.thumb, { backgroundColor: surface }]} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: surface }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: s.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>{s.title}</Text>
                <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{s.album || s.artist}</Text>
              </View>
              <Pressable onPress={() => songMenu(s)} hitSlop={10}>
                <Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
              </Pressable>
            </Pressable>
          ))}
        </View>

        {/* Album, Đĩa đơn, Video, Nghệ sĩ tương tự... */}
        {(entered ? data?.shelves ?? [] : []).map((shelf, si) => (
          <View key={`${si}:${shelf.title}`}>
            <Text style={[styles.section, { color: text, paddingHorizontal: PAD }]}>{shelf.title}</Text>
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
                    <Text numberOfLines={1} style={{ color: text, fontSize: 14, fontWeight: '700', marginTop: 8, textAlign: round ? 'center' : 'left' }}>{c.title}</Text>
                    {!!c.subtitle && (
                      <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2, textAlign: round ? 'center' : 'left' }}>{c.subtitle}</Text>
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
    position: 'absolute', zIndex: 2, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  name: { position: 'absolute', left: PAD, right: PAD, bottom: 12, fontSize: 38, fontWeight: '900' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 8, marginBottom: 4 },
  follow: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 20, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  thumb: { width: 52, height: 52, borderRadius: 4 },
});
