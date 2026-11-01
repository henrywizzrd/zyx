import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { genres, libraryItems, Track } from '../data/mock';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import { useFrame } from '../components/layout';

const H_PAD = 16;
const GAP = 12;

type Result = {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  kind: 'song' | 'playlist' | 'album';
};

export function SearchScreen() {
  const { theme } = useTheme();
  const { track, playTrack } = usePlayer();
  const pad = useContentInsets();
  const { width } = useFrame();
  const [query, setQuery] = useState('');
  const [yt, setYt] = useState<Track[]>([]);
  const [ytBusy, setYtBusy] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q || !musicSupported || ytBusy) return;
    setYtBusy(true);
    setYtError(null);
    try {
      setYt((await ytmusic().searchSongs(q)).map(toTrack));
    } catch (e) {
      setYtError(String((e as Error)?.message ?? e));
    } finally {
      setYtBusy(false);
    }
  };

  const { text, textSecondary, accent } = theme.colors;
  const innerW = width - H_PAD * 2;
  const cols = Math.max(2, Math.floor(innerW / 180));
  const tileW = (innerW - GAP * (cols - 1)) / cols;

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const lib = libraryItems
      .filter((i) => i.title.toLowerCase().includes(q))
      .map((i) => ({ id: i.id, title: i.title, subtitle: i.subtitle, color: i.color, kind: i.kind }));
    return lib;
  }, [query]);

  const searching = query.trim().length > 0;

  return (
    <ScrollView
      bounces={false}
      overScrollMode="never"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}
    >
      <View style={{ width: '100%', paddingHorizontal: H_PAD }}>
        <Text style={{ color: text, fontSize: 26, fontWeight: '700', marginTop: pad.top + 16 }}>Search</Text>

        {/* Ô tìm kiếm kiểu Spotify */}
        <View style={[styles.searchBox, { backgroundColor: text }]}>
          <Ionicons name="search" size={20} color={theme.background.color} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder="What do you want to listen to?"
            placeholderTextColor="#6B6B6B"
            style={[styles.input, { color: theme.background.color }]}
          />
          {searching && (
            <Pressable onPress={() => { setQuery(''); setYt([]); setYtError(null); }} hitSlop={8}>
              <Ionicons name="close" size={20} color={theme.background.color} />
            </Pressable>
          )}
        </View>

        {!searching ? (
          <>
            <Text style={{ color: text, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 14 }}>
              Browse all
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {genres.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => setQuery(g.title)}
                  style={[styles.tile, { width: tileW, backgroundColor: g.color }]}
                >
                  <Text style={styles.tileTitle}>{g.title}</Text>
                  <View style={styles.tileDeco} />
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={{ marginTop: 20, gap: 4 }}>
            {ytBusy && <ActivityIndicator color={accent} style={{ marginVertical: 12 }} />}
            {ytError && <Text style={{ color: textSecondary }}>Lỗi tìm kiếm: {ytError}</Text>}
            {musicSupported && !ytBusy && !ytError && yt.length === 0 && (
              <Text style={{ color: textSecondary }}>Nhấn Search trên bàn phím để tìm trên YouTube Music</Text>
            )}
            {yt.map((t) => (
              <Pressable key={`yt-${t.id}`} onPress={() => playTrack(t, yt)} style={styles.row}>
                <Image source={{ uri: t.thumb }} style={[styles.cover, { backgroundColor: t.color, borderRadius: 4 }]} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: t.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>
                    {t.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                    Song • {t.artist}
                  </Text>
                </View>
              </Pressable>
            ))}
            {results.map((r) => (
              <View key={`${r.kind}-${r.id}`} style={styles.row}>
                <View style={[styles.cover, { backgroundColor: r.color, borderRadius: r.kind === 'album' ? 28 : 4, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name={r.kind === 'album' ? 'disc' : 'musical-notes'} size={22} color="rgba(255,255,255,0.8)" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{r.title}</Text>
                  <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{r.subtitle}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 14,
    marginTop: 16,
  },
  input: { flex: 1, fontSize: 15, fontWeight: '500', paddingVertical: 0 },
  tile: { height: 96, borderRadius: 8, padding: 12, overflow: 'hidden' },
  tileTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  tileDeco: {
    position: 'absolute',
    right: -14,
    bottom: -6,
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.22)',
    transform: [{ rotate: '25deg' }],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  cover: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});