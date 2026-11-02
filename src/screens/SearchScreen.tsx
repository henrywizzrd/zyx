import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { genres, libraryItems, Track } from '../data/mock';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { SuggestItem, Suggestions } from '../music/ytmusic';
import { useFrame } from '../components/layout';
import { useSongMenu } from '../components/useSongMenu';
import { useNav } from '../nav/Nav';
import { useT } from '../i18n';

const H_PAD = 16;
const GAP = 12;
const SUGGEST_DELAY = 120; // ms sau lần gõ cuối thì lấy gợi ý
const PREFETCH_DELAY = 450; // ms ngừng gõ thì tải sẵn kết quả đầy đủ, để bấm Search là hiện ngay
const CACHE_MAX = 60;

type LibResult = {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  kind: 'song' | 'playlist' | 'album';
};

// ---------- Bộ nhớ đệm dùng chung cho cả app (sống tới khi tắt app) ----------
// Lưu Promise thay vì kết quả: gõ lại đúng chữ đang chờ thì dùng chung request, không gửi thêm.
const suggestCache = new Map<string, Promise<Suggestions>>();
const searchCache = new Map<string, Promise<Track[]>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) {
    // Đưa lên cuối để giữ những từ hay dùng
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = load();
  p.catch(() => cache.delete(key)); // lỗi thì lần sau thử lại
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}

const norm = (q: string) => q.trim().toLowerCase();
const getSuggest = (q: string) => cached(suggestCache, norm(q), () => ytmusic().getSuggestions(q.trim()));
const getResults = (q: string) => cached(searchCache, norm(q), async () => (await ytmusic().searchSongs(q.trim())).map(toTrack));

// Tạo sẵn phiên YouTube khi mở tab Tìm kiếm (không làm lúc mở app nữa: nạp youtubei.js làm luồng JS bận ~1 giây,
// trong lúc đó dock không bấm được). Mở tab Tìm kiếm là sắp gõ, nên tạo phiên lúc này vẫn kịp cho lần tìm đầu.
let warmed = false;
function warmUp() {
  if (warmed || !musicSupported) return;
  warmed = true;
  ytmusic().getSession().catch(() => (warmed = false));
}

export function SearchScreen() {
  const { theme } = useTheme();
  useEffect(() => {
    const id = setTimeout(warmUp, 250); // để màn hình Tìm kiếm hiện ra trước rồi mới làm
    return () => clearTimeout(id);
  }, []);
  const { track, playTrack } = usePlayer();
  const tr = useT(); // chữ theo ngôn ngữ (đặt tên tr vì biến t đang dùng cho bài hát)
  const songMenu = useSongMenu(); // nhấn giữ một bài: phát tiếp, hàng đợi, thích, thêm vào playlist
  const { push } = useNav();
  const pad = useContentInsets();
  const { width } = useFrame();

  const [query, setQuery] = useState('');
  // 'typing': đang gõ, hiện gợi ý. 'results': đã bấm Search hoặc chọn một gợi ý, hiện kết quả đầy đủ.
  const [mode, setMode] = useState<'typing' | 'results'>('typing');
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [resultsFor, setResultsFor] = useState<string | null>(null); // kết quả đang hiện là của từ khoá nào
  const [resultsBusy, setResultsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Từ khoá mới nhất: kết quả về muộn của từ khoá cũ thì bỏ qua
  const latest = useRef('');

  // Đang gõ: lấy gợi ý sau một nhịp ngắn, và tải sẵn kết quả đầy đủ khi ngừng gõ lâu hơn
  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q || !musicSupported || mode !== 'typing') {
      setSuggestBusy(false);
      return;
    }
    setSuggestBusy(true);
    const t1 = setTimeout(() => {
      getSuggest(q)
        .then((s) => {
          if (latest.current === q) setSuggest(s);
        })
        .catch(() => {})
        .finally(() => {
          if (latest.current === q) setSuggestBusy(false);
        });
    }, SUGGEST_DELAY);
    const t2 = setTimeout(() => {
      getResults(q).catch(() => {});
    }, PREFETCH_DELAY);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [query, mode]);

  const runSearch = (raw: string) => {
    const q = raw.trim();
    if (!q || !musicSupported) return;
    Keyboard.dismiss(); // đã chọn xong từ khoá thì cất bàn phím đi để thấy hết danh sách
    latest.current = q;
    setQuery(q);
    setMode('results');
    setError(null);
    setResultsBusy(true);
    getResults(q)
      .then((list) => {
        if (latest.current !== q) return;
        setResults(list);
        setResultsFor(q);
      })
      .catch((e) => {
        if (latest.current === q) setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (latest.current === q) setResultsBusy(false);
      });
  };

  const onChangeText = (t: string) => {
    setQuery(t);
    setMode('typing');
    setError(null);
  };

  const clear = () => {
    latest.current = '';
    setQuery('');
    setMode('typing');
    setSuggest(null);
    setResults([]);
    setResultsFor(null);
    setError(null);
  };

  // Bấm vào một gợi ý: bài hát thì phát luôn, nghệ sĩ/album thì tìm theo tên (chưa có trang nghệ sĩ/album)
  const onSuggestItem = (it: SuggestItem) => {
    Keyboard.dismiss();
    if (it.song) {
      const playable = (suggest?.items ?? []).filter((x) => x.song).map((x) => toTrack(x.song!));
      playTrack(toTrack(it.song), playable);
      return;
    }
    // Album / playlist: mở trang danh sách bài. Nghệ sĩ: tạm tìm theo tên (trang nghệ sĩ làm sau)
    if (it.kind === 'album' || it.kind === 'playlist') {
      push({ type: 'collection', source: 'yt', kind: it.kind, id: it.id, title: it.title, thumb: it.thumb });
      return;
    }
    runSearch(it.title);
  };

  const { text, textSecondary, accent } = theme.colors;
  const innerW = width - H_PAD * 2;
  const cols = Math.max(2, Math.floor(innerW / 180));
  const tileW = (innerW - GAP * (cols - 1)) / cols;

  const libResults = useMemo<LibResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return libraryItems
      .filter((i) => i.title.toLowerCase().includes(q))
      .map((i) => ({ id: i.id, title: i.title, subtitle: i.subtitle, color: i.color, kind: i.kind }));
  }, [query]);

  const searching = query.trim().length > 0;
  // Gợi ý đang hiện có khớp chữ đang gõ không (gợi ý cũ vẫn để đó cho đỡ nháy cho tới khi có cái mới)
  const showResults = mode === 'results';
  const resultsReady = showResults && resultsFor === query.trim() && !resultsBusy;

  const kindLabel: Record<SuggestItem['kind'], string> = {
    song: tr('kind.song'),
    video: tr('kind.video'),
    artist: tr('kind.artist'),
    album: tr('kind.album'),
    playlist: tr('kind.playlist'),
  };

  return (
    <ScrollView
      bounces={false}
      overScrollMode="never"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}
    >
      <View style={{ width: '100%', paddingHorizontal: H_PAD }}>
        <Text style={{ color: text, fontSize: 26, fontWeight: '700', marginTop: pad.top + 16 }}>{tr('search.title')}</Text>

        {/* Ô tìm kiếm kiểu Spotify */}
        <View style={[styles.searchBox, { backgroundColor: text }]}>
          <Ionicons name="search" size={20} color={theme.background.color} />
          <TextInput
            value={query}
            onChangeText={onChangeText}
            onSubmitEditing={() => runSearch(query)}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            placeholder={tr('search.placeholder')}
            placeholderTextColor={theme.background.color + '99'}
            style={[styles.input, { color: theme.background.color }]}
          />
          {(suggestBusy || resultsBusy) && searching && <ActivityIndicator size="small" color={theme.background.color} />}
          {searching && (
            <Pressable onPress={clear} hitSlop={8}>
              <Ionicons name="close" size={20} color={theme.background.color} />
            </Pressable>
          )}
        </View>

        {!searching ? (
          <>
            <Text style={{ color: text, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 14 }}>
              {tr('search.browseAll')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {genres.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => runSearch(g.title)}
                  style={[styles.tile, { width: tileW, backgroundColor: g.color }]}
                >
                  <Text style={styles.tileTitle}>{g.title}</Text>
                  <View style={styles.tileDeco} />
                </Pressable>
              ))}
            </View>
          </>
        ) : !showResults ? (
          // ---------- Đang gõ: gợi ý ----------
          <View style={{ marginTop: 12 }}>
            {!musicSupported && <Text style={{ color: textSecondary }}>{tr('search.phoneOnly')}</Text>}
            {(suggest?.queries ?? []).slice(0, 6).map((q) => (
              <Pressable key={`q-${q}`} onPress={() => runSearch(q)} style={styles.queryRow}>
                <Ionicons name="search" size={18} color={textSecondary} />
                <Text numberOfLines={1} style={{ flex: 1, color: text, fontSize: 15 }}>
                  {q}
                </Text>
                {/* Chép từ khoá lên ô tìm kiếm để gõ tiếp */}
                <Pressable onPress={() => onChangeText(q + ' ')} hitSlop={10}>
                  <Ionicons name="arrow-up" size={18} color={textSecondary} style={{ transform: [{ rotate: '-45deg' }] }} />
                </Pressable>
              </Pressable>
            ))}
            {(suggest?.items ?? []).map((it) => (
              <Pressable
                key={`s-${it.kind}-${it.id}`}
                onPress={() => onSuggestItem(it)}
                onLongPress={it.song ? () => songMenu(toTrack(it.song!)) : undefined}
                style={styles.row}
              >
                {it.thumb ? (
                  <Image source={{ uri: it.thumb }} style={[styles.cover, { borderRadius: it.kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.surface }]} />
                ) : (
                  <View style={[styles.cover, { borderRadius: it.kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.surface }]}>
                    <Ionicons name={it.kind === 'artist' ? 'person' : 'musical-notes'} size={22} color={textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: it.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>
                    {it.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                    {kindLabel[it.kind]}
                    {it.subtitle ? ` • ${it.subtitle}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          // ---------- Đã bấm Search: kết quả đầy đủ ----------
          <View style={{ marginTop: 20, gap: 4 }}>
            {error && <Text style={{ color: textSecondary }}>{tr('search.error', { msg: error })}</Text>}
            {!resultsReady && !error &&
              // Khung chờ: giữ chỗ đúng hình dạng kết quả để màn hình không bị trống
              Array.from({ length: 6 }).map((_, i) => (
                <View key={`sk-${i}`} style={styles.row}>
                  <View style={[styles.cover, { borderRadius: 4, backgroundColor: theme.colors.skeleton }]} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <View style={{ height: 12, width: '70%', borderRadius: 6, backgroundColor: theme.colors.skeleton }} />
                    <View style={{ height: 10, width: '45%', borderRadius: 5, backgroundColor: theme.colors.skeleton }} />
                  </View>
                </View>
              ))}
            {resultsReady && results.length === 0 && (
              <Text style={{ color: textSecondary }}>{tr('search.noResults', { q: resultsFor ?? '' })}</Text>
            )}
            {resultsReady &&
              results.map((t) => (
                <Pressable key={`yt-${t.id}`} onPress={() => playTrack(t, results)} onLongPress={() => songMenu(t)} style={styles.row}>
                  <Image source={{ uri: t.thumb }} style={[styles.cover, { backgroundColor: t.color, borderRadius: 4 }]} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>
                      {t.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                      {tr('kind.song')} • {t.artist}
                    </Text>
                  </View>
                </Pressable>
              ))}
            {resultsReady &&
              libResults.map((r) => (
                <View key={`${r.kind}-${r.id}`} style={styles.row}>
                  <View style={[styles.cover, { backgroundColor: r.color, borderRadius: r.kind === 'album' ? 28 : 4 }]}>
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
  queryRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  cover: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
