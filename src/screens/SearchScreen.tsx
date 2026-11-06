import { SplitPane } from '../components/SplitPane';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayerPick } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { genres, type Track } from '../data/mock';
import { useLibrary, type LibraryEntry } from '../data/library';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { Card, GenreGroup, SearchKind, SearchResults, SuggestItem, Suggestions } from '../music/ytmusic';
import { cacheGet, cacheSet, kvGet, kvSet, useDbVersion } from '../data/db';
import { searchUsers, UserRow } from '../data/community';

// Lịch sử tìm kiếm: các từ khoá gần đây (mới nhất trước), hiện khi bấm vào ô tìm kiếm còn trống
const HISTORY = 'search:history';
const HISTORY_MAX = 12;
const addHistory = (q: string) => {
  const v = q.trim();
  if (!v) return;
  const list = (kvGet<string[]>(HISTORY) ?? []).filter((x) => x.toLowerCase() !== v.toLowerCase());
  kvSet(HISTORY, [v, ...list].slice(0, HISTORY_MAX));
};
const removeHistory = (q: string) => kvSet(HISTORY, (kvGet<string[]>(HISTORY) ?? []).filter((x) => x !== q));
import { warmGenres } from '../music/genreCache';
import { useFrame } from '../components/layout';
import { useSongMenu } from '../components/useSongMenu';
import { useNav } from '../nav/Nav';
import { useT } from '../i18n';

const H_PAD = 16;
const GAP = 12;
const SUGGEST_DELAY = 120; // ms sau lần gõ cuối thì lấy gợi ý
const PREFETCH_DELAY = 450; // ms ngừng gõ thì tải sẵn kết quả đầy đủ, để bấm Search là hiện ngay
const CACHE_MAX = 60;

const KINDS: SearchKind[] = ['all', 'song', 'album', 'artist'];

// Thể loại & tâm trạng thật của YouTube Music (lưu lại trên máy, mỗi ngày làm mới một lần)
const GENRES_KEY = 'genres:v1';
const GENRES_TTL = 24 * 3600 * 1000;
function useGenres() {
  const [groups, setGroups] = useState<GenreGroup[] | null>(() => cacheGet<GenreGroup[]>(GENRES_KEY)?.value ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!musicSupported) return setFailed(true);
    const c = cacheGet<GenreGroup[]>(GENRES_KEY);
    if (c && Date.now() - c.at < GENRES_TTL) return;
    let dead = false;
    ytmusic()
      .getGenres()
      .then((g) => {
        if (dead) return;
        setGroups(g);
        cacheSet(GENRES_KEY, g);
      })
      .catch((e) => {
        console.warn('[genres]', e);
        if (!dead) setFailed(true);
      });
    return () => {
      dead = true;
    };
  }, []);
  // Tải sẵn trang của vài thể loại đầu mỗi nhóm (chạy ngầm, từng cái một) để bấm vào là hiện ngay
  useEffect(() => {
    if (!groups) return;
    const id = setTimeout(() => warmGenres(groups.flatMap((g) => g.items.slice(0, 4).map((i) => i.params))), 1500);
    return () => clearTimeout(id);
  }, [groups]);
  return { groups, failed };
}

// ---------- Bộ nhớ đệm dùng chung cho cả app (sống tới khi tắt app) ----------
// Lưu Promise thay vì kết quả: gõ lại đúng chữ đang chờ thì dùng chung request, không gửi thêm.
const suggestCache = new Map<string, Promise<Suggestions>>();
const searchCache = new Map<string, Promise<SearchResults>>();

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
// Kết quả theo loại (Tất cả / Bài hát / Album / Nghệ sĩ), lưu riêng từng loại
const getResults = (q: string, kind: SearchKind) => cached(searchCache, `${kind}:${norm(q)}`, () => ytmusic().searchMusic(q.trim(), kind));

// Tạo sẵn phiên YouTube khi mở tab Tìm kiếm (không làm lúc mở app nữa: nạp youtubei.js làm luồng JS bận ~1 giây,
// trong lúc đó dock không bấm được). Mở tab Tìm kiếm là sắp gõ, nên tạo phiên lúc này vẫn kịp cho lần tìm đầu.
let warmed = false;
function warmUp() {
  if (warmed || !musicSupported) return;
  warmed = true;
  ytmusic().getBrowseSession().catch(() => (warmed = false));
}

export function SearchScreen() {
  const { theme, landscape } = useTheme();
  useEffect(() => {
    const id = setTimeout(warmUp, 250); // để màn hình Tìm kiếm hiện ra trước rồi mới làm
    return () => clearTimeout(id);
  }, []);
  const { track, playTrack } = usePlayerPick('track', 'playTrack');
  const tr = useT(); // chữ theo ngôn ngữ (đặt tên tr vì biến t đang dùng cho bài hát)
  const songMenu = useSongMenu(); // nhấn giữ một bài: phát tiếp, hàng đợi, thích, thêm vào playlist
  const { push } = useNav();
  const pad = useContentInsets();
  const { width } = useFrame();
  const genreList = useGenres();

  const [query, setQuery] = useState('');
  // 'typing': đang gõ, hiện gợi ý. 'results': đã bấm Search hoặc chọn một gợi ý, hiện kết quả đầy đủ.
  const [mode, setMode] = useState<'typing' | 'results'>('typing');
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [kind, setKind] = useState<SearchKind>('all'); // đang lọc theo loại nào
  const [results, setResults] = useState<SearchResults | null>(null);
  const [resultsFor, setResultsFor] = useState<string | null>(null); // kết quả đang hiện là của từ khoá + loại nào ("all:abc")
  const [resultsBusy, setResultsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mục "Người dùng": chỉ tìm người dùng khi bấm vào mục này
  const [userMode, setUserMode] = useState(false);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [usersFor, setUsersFor] = useState<string | null>(null);
  const [usersFailed, setUsersFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const dbv = useDbVersion();
  const history = useMemo(() => kvGet<string[]>(HISTORY) ?? [], [dbv]); // eslint-disable-line react-hooks/exhaustive-deps

  // Từ khoá mới nhất: kết quả về muộn của từ khoá cũ thì bỏ qua.
  // Tách riêng cho gợi ý (lúc gõ) và kết quả (sau khi bấm Search): trước đây dùng chung một biến,
  // lúc chuyển sang xem kết quả thì phần gợi ý ghi đè lên, kết quả về bị bỏ qua → quay mãi không xong
  const latest = useRef('');
  const latestSearch = useRef('');

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
      getResults(q, kind).catch(() => {});
    }, PREFETCH_DELAY);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [query, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // music = true: luôn tìm nhạc (bấm một mục nhạc khi đang ở mục Người dùng)
  const runSearch = (raw: string, k: SearchKind = kind, music = false) => {
    const q = raw.trim();
    const key = `${k}:${q}`;
    if (!q) return;
    if (userMode && !music) return runUsers(q); // đang ở mục Người dùng: bấm Tìm là tìm người dùng
    if (!musicSupported) return;
    setUserMode(false);
    addHistory(q);
    Keyboard.dismiss(); // đã chọn xong từ khoá thì cất bàn phím đi để thấy hết danh sách
    latestSearch.current = key;
    setQuery(q);
    setKind(k);
    setMode('results');
    setError(null);
    setResultsBusy(true);
    getResults(q, k)
      .then((r) => {
        if (latestSearch.current !== key) return;
        setResults(r);
        setResultsFor(key);
      })
      .catch((e) => {
        if (latestSearch.current === key) setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (latestSearch.current === key) setResultsBusy(false);
      });
  };

  const runUsers = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    Keyboard.dismiss();
    addHistory(q);
    setQuery(q);
    setUserMode(true);
    setMode('results');
    setUsersFailed(false);
    latestSearch.current = `users:${q}`;
    searchUsers(q)
      .then((l) => {
        if (latestSearch.current !== `users:${q}`) return;
        setUsers(l);
        setUsersFor(q);
      })
      .catch(() => {
        if (latestSearch.current === `users:${q}`) setUsersFailed(true);
      });
  };

  const onChangeText = (t: string) => {
    setQuery(t);
    setMode('typing');
    setError(null);
  };

  const clear = () => {
    latest.current = '';
    latestSearch.current = '';
    setQuery('');
    setMode('typing');
    setSuggest(null);
    setResults(null);
    setResultsFor(null);
    setKind('all');
    setError(null);
    setUserMode(false);
    setUsers(null);
    setUsersFor(null);
  };

  // Bấm vào một gợi ý: bài hát thì phát luôn, album/playlist/nghệ sĩ thì mở trang của nó
  const onSuggestItem = (it: SuggestItem) => {
    Keyboard.dismiss();
    if (it.song) {
      const playable = (suggest?.items ?? []).filter((x) => x.song).map((x) => toTrack(x.song!));
      playTrack(toTrack(it.song), playable);
      return;
    }
    // Album / playlist: mở trang danh sách bài. Nghệ sĩ: mở trang nghệ sĩ
    if (it.kind === 'album' || it.kind === 'playlist') {
      push({ type: 'collection', source: 'yt', kind: it.kind, id: it.id, title: it.title, thumb: it.thumb });
      return;
    }
    if (it.kind === 'artist') {
      push({ type: 'artist', id: it.id, name: it.title, thumb: it.thumb });
      return;
    }
    runSearch(it.title);
  };

  const { text, textSecondary, accent } = theme.colors;
  // Màn hình ngang: thể loại nằm ở cột phải (khoảng 58% bề rộng)
  // Màn hình ngang: thể loại nằm ở cột phải của SplitPane (58% phần còn lại sau khe 8px), trừ lề 2 bên.
  // Tính đúng từng điểm ảnh (trước đây tính dư vài điểm nên ô thứ hai bị đẩy xuống dòng → chỉ còn 1 cột)
  // Màn hình ngang: đo bề rộng thật của cột phải rồi chia ô theo đó (tính ước lượng dễ lệch vài điểm → ô thứ hai rớt dòng)
  const [rightW, setRightW] = useState(0);
  const innerW = landscape && rightW > 0 ? Math.floor(rightW) - 1 : Math.floor((landscape ? (width - 8) * 0.64 : width) - H_PAD * 2) - 1;
  const cols = landscape ? Math.max(2, Math.floor(innerW / 200)) : Math.max(2, Math.floor(innerW / 180));
  const tileW = Math.floor((innerW - GAP * (cols - 1)) / cols);
  const tileH = landscape ? 78 : 96;

  // Mục trong Thư viện khớp từ khoá (hiện ở cuối khi xem Tất cả)
  const library = useLibrary();
  const libResults = useMemo<LibraryEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return library.filter((i) => (i.kind === 'liked' ? tr('lib.liked') : i.title).toLowerCase().includes(q)).slice(0, 6);
  }, [query, library, tr]);
  const openLib = (i: LibraryEntry) => {
    if (i.kind === 'liked') push({ type: 'collection', source: 'liked', kind: 'playlist', id: 'liked', title: tr('home.liked') });
    else if (i.kind === 'local') push({ type: 'collection', source: 'local', kind: 'playlist', id: i.id, title: i.title, thumb: i.thumb });
    else if (i.kind === 'artist') push({ type: 'artist', id: i.id, name: i.title, thumb: i.thumb });
    else push({ type: 'collection', source: 'yt', kind: i.kind, id: i.id, title: i.title, thumb: i.thumb });
  };
  const openCard = (c: Card) => {
    if (c.kind === 'artist') push({ type: 'artist', id: c.id, name: c.title, thumb: c.thumb });
    else if (c.kind === 'album' || c.kind === 'playlist') push({ type: 'collection', source: 'yt', kind: c.kind, id: c.id, title: c.title, thumb: c.thumb });
  };

  const searching = query.trim().length > 0;
  // Gợi ý đang hiện có khớp chữ đang gõ không (gợi ý cũ vẫn để đó cho đỡ nháy cho tới khi có cái mới)
  const showResults = mode === 'results';
  const resultsReady = showResults && resultsFor === `${kind}:${query.trim()}` && !resultsBusy && !!results;

  const kindLabel: Record<SuggestItem['kind'], string> = {
    song: tr('kind.song'),
    video: tr('kind.video'),
    artist: tr('kind.artist'),
    album: tr('kind.album'),
    playlist: tr('kind.playlist'),
  };

  // Kết quả hàng đầu: thẻ lớn
  const renderTop = (top: Card, playable: Track[]) => (
                    <Pressable
                      onPress={() => (top.song ? playTrack(toTrack(top.song), [toTrack(top.song), ...playable]) : openCard(top))}
                      onLongPress={top.song ? () => songMenu(toTrack(top.song!)) : undefined}
                      style={[styles.topCard, { backgroundColor: theme.colors.surface }]}
                    >
                      {top.thumb ? (
                        <Image source={{ uri: top.thumb }} style={{ width: 84, height: 84, borderRadius: top.kind === 'artist' ? 42 : 6 }} />
                      ) : (
                        <View style={{ width: 84, height: 84, borderRadius: 6, backgroundColor: theme.colors.skeleton }} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={2} style={{ color: top.song?.id === track.id ? accent : text, fontSize: 20, fontWeight: '800' }}>{top.title}</Text>
                        <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 4 }}>{top.subtitle}</Text>
                      </View>
                      {top.song && (
                        <View style={[styles.topPlay, { backgroundColor: accent }]}>
                          <Ionicons name="play" size={20} color={theme.colors.onAccent} style={{ marginLeft: 2 }} />
                        </View>
                      )}
                    </Pressable>
                  );

  const searchBox = (
    <>
        {/* Ô tìm kiếm kiểu Spotify */}
        <View style={[styles.searchBox, { backgroundColor: text }]}>
          <Ionicons name="search" size={20} color={theme.background.color} />
          <TextInput
            value={query}
            onChangeText={onChangeText}
            onSubmitEditing={() => (userMode ? runUsers(query) : runSearch(query))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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

    </>
  );
  const browse = (
    <>
          <>
            {/* Thể loại & tâm trạng của YouTube Music: bấm vào mở trang thể loại (các playlist đúng thể loại đó) */}
            {genreList.groups ? (
              genreList.groups.map((grp, gi) => (
                <View key={`${gi}:${grp.title}`}>
                  <Text style={{ color: text, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 14 }}>
                    {grp.title || tr('search.browseAll')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                    {grp.items.map((g) => (
                      <Pressable
                        key={g.params}
                        onPress={() => push({ type: 'genre', title: g.title, params: g.params, color: g.color })}
                        style={({ pressed }) => [styles.tile, { width: tileW, height: tileH, backgroundColor: g.color, opacity: pressed ? 0.8 : 1 }]}
                      >
                        <Text numberOfLines={2} style={styles.tileTitle}>{g.title}</Text>
                        <View style={styles.tileDeco} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            ) : genreList.failed ? (
              // Không tải được (mất mạng...): ô cố định, bấm vào thì tìm theo tên
              <>
                <Text style={{ color: text, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 14 }}>{tr('search.browseAll')}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                  {genres.map((g) => (
                    <Pressable key={g.id} onPress={() => runSearch(g.title)} style={[styles.tile, { width: tileW, height: tileH, backgroundColor: g.color }]}>
                      <Text style={styles.tileTitle}>{g.title}</Text>
                      <View style={styles.tileDeco} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: text, fontSize: 18, fontWeight: '700', marginTop: 28, marginBottom: 14 }}>{tr('search.browseAll')}</Text>
                <ActivityIndicator color={textSecondary} style={{ marginTop: 12 }} />
              </>
            )}
          </>
    </>
  );
  const suggestions = (
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
                {it.song && (
                  <Pressable onPress={() => songMenu(toTrack(it.song!))} hitSlop={12} style={{ paddingLeft: 6 }}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
                  </Pressable>
                )}
              </Pressable>
            ))}
          </View>
  );
  const chipRow = (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
              {KINDS.map((k) => {
                const on = !userMode && k === kind;
                return (
                  <Pressable
                    key={k}
                    onPress={() => {
                      if (on) return;
                      setUserMode(false);
                      runSearch(query, k, true);
                    }}
                    style={[styles.chip, { backgroundColor: on ? accent : theme.colors.surface }]}
                  >
                    <Text style={{ color: on ? theme.colors.onAccent : text, fontWeight: '700', fontSize: 13 }}>{tr(`search.filter.${k}`)}</Text>
                  </Pressable>
                );
              })}
              {/* Người dùng: chỉ khi bấm vào mục này mới tìm các tài khoản khớp với từ khoá */}
              <Pressable onPress={() => !userMode && runUsers(query)} style={[styles.chip, { backgroundColor: userMode ? accent : theme.colors.surface }]}>
                <Text style={{ color: userMode ? theme.colors.onAccent : text, fontWeight: '700', fontSize: 13 }}>{tr('search.filter.users')}</Text>
              </Pressable>
            </ScrollView>
  );
  // Kết quả mục Người dùng: avatar, tên #tag, @username · số người theo dõi. Bấm vào để mở hồ sơ
  const usersBody = (
    <View style={{ marginTop: 6 }}>
      {usersFailed ? (
        <Pressable onPress={() => runUsers(query)}>
          <Text style={{ color: textSecondary }}>{tr('community.loadFailed')}</Text>
        </Pressable>
      ) : usersFor !== query.trim() || !users ? (
        <ActivityIndicator color={accent} style={{ marginTop: 20 }} />
      ) : users.length === 0 ? (
        <Text style={{ color: textSecondary, marginTop: 10 }}>{tr('community.noUsers')}</Text>
      ) : (
        users.map((u) => (
          <Pressable key={u.id} onPress={() => push({ type: 'user', id: u.id })} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            <View style={[styles.cover, { borderRadius: 28, backgroundColor: u.color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
              {u.avatar ? <Image source={{ uri: u.avatar }} style={StyleSheet.absoluteFill} /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20 }}>{u.name.slice(0, 1).toUpperCase()}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '700' }}>
                {u.name}
                <Text style={{ color: textSecondary, fontWeight: '500' }}> #{u.tag}</Text>
              </Text>
              <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                @{u.username} · {u.followers} {tr('community.followers')}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );

  // Lịch sử tìm kiếm (bấm vào ô tìm kiếm còn trống)
  const historyList = (
    <View style={{ marginTop: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '700' }}>{tr('search.recent')}</Text>
        <Pressable onPress={() => kvSet(HISTORY, [])} hitSlop={8}>
          <Text style={{ color: accent, fontWeight: '700', fontSize: 14 }}>{tr('search.clearHistory')}</Text>
        </Pressable>
      </View>
      {history.map((h) => (
        <Pressable key={h} onPress={() => runSearch(h)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }, pressed && { opacity: 0.6 }]}>
          <Ionicons name="time-outline" size={20} color={textSecondary} />
          <Text numberOfLines={1} style={{ flex: 1, color: text, fontSize: 16 }}>{h}</Text>
          <Pressable onPress={() => removeHistory(h)} hitSlop={10}>
            <Ionicons name="close" size={18} color={textSecondary} />
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
  const showHistory = focused && !searching && history.length > 0;

  const musicBody = (
    <>
          {/* ---------- Đã bấm Search: kết quả đầy đủ, lọc theo loại ---------- */}
          <View style={{ marginTop: 14, gap: 4 }}>
            {error && <Text style={{ color: textSecondary }}>{tr('search.error', { msg: error })}</Text>}
            {!resultsReady && !error &&
              // Khung chờ: giữ chỗ đúng hình dạng kết quả để màn hình không bị trống
              Array.from({ length: 6 }).map((_, i) => (
                <View key={`sk-${i}`} style={styles.row}>
                  <View style={[styles.cover, { borderRadius: kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.skeleton }]} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <View style={{ height: 12, width: '70%', borderRadius: 6, backgroundColor: theme.colors.skeleton }} />
                    <View style={{ height: 10, width: '45%', borderRadius: 5, backgroundColor: theme.colors.skeleton }} />
                  </View>
                </View>
              ))}
            {resultsReady && results && (() => {
              const all = kind === 'all';
              // Tất cả: vài nghệ sĩ, vài bài, vài album. Lọc theo loại: chỉ loại đó, hiện hết
              const withSongs = kind === 'all' || kind === 'song';
              const artists = kind === 'all' || kind === 'artist' ? results.artists.slice(0, all ? 3 : 40) : [];
              // Bài trong gợi ý lúc gõ mà kết quả không có (YouTube xếp loại khác nhau ở hai chỗ) thì vẫn đưa vào, để không bị "mất bài"
              const seen = new Set([...results.songs, ...results.videos].map((x) => x.id));
              if (results.top?.song) seen.add(results.top.song.id);
              const fromSuggest = withSongs && suggest ? suggest.items.filter((x) => x.song && !seen.has(x.id)).map((x) => x.song!) : [];
              const songs = (withSongs ? [...fromSuggest, ...results.songs] : []).slice(0, all ? 6 : 80).map(toTrack);
              const videos = (withSongs ? results.videos : []).slice(0, all ? 4 : 40).map(toTrack);
              const albums = kind === 'all' || kind === 'album' ? results.albums.slice(0, all ? 6 : 40) : [];
              const libs = all ? libResults : [];
              const top = all ? results.top : undefined;
              const playable = [...songs, ...videos];
              if (!top && !artists.length && !songs.length && !videos.length && !albums.length && !libs.length) {
                return <Text style={{ color: textSecondary }}>{tr('search.nothing', { q: query.trim() })}</Text>;
              }
              // Tiêu đề nhóm: ở Tất cả thì nhóm nào cũng có; ở Bài hát chỉ cần tiêu đề "Video" để tách khỏi bài hát
              const head = (label: string, force = false) => (all || force) && <Text style={[styles.sectionHead, { color: text }]}>{label}</Text>;
              const songRow = (t: Track, label: string) => (
                <Pressable key={`yt-${t.id}`} onPress={() => playTrack(t, playable)} onLongPress={() => songMenu(t)} style={styles.row}>
                  <Image source={{ uri: t.thumb }} style={[styles.cover, { backgroundColor: theme.colors.surface, borderRadius: 4 }]} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>
                      {t.title}
                    </Text>
                    <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                      {label} • {t.artist}
                    </Text>
                  </View>
                  {/* Nút ... : mở bảng thao tác của bài */}
                  <Pressable onPress={() => songMenu(t)} hitSlop={12} style={{ paddingLeft: 6 }}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
                  </Pressable>
                </Pressable>
              );
              const cardRow = (c: Card) => (
                <Pressable key={`${c.kind}-${c.id}`} onPress={() => openCard(c)} style={styles.row}>
                  {c.thumb ? (
                    <Image source={{ uri: c.thumb }} style={[styles.cover, { borderRadius: c.kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.surface }]} />
                  ) : (
                    <View style={[styles.cover, { borderRadius: c.kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.surface }]}>
                      <Ionicons name={c.kind === 'artist' ? 'person' : 'disc'} size={22} color={textSecondary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{c.title}</Text>
                    <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                      {kindLabel[c.kind as SuggestItem['kind']] ?? ''}
                      {c.subtitle ? ` • ${c.subtitle}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSecondary} />
                </Pressable>
              );
              return (
                <>
                  {!landscape && top && renderTop(top, playable)}
                  {artists.length > 0 && head(tr('search.filter.artist'))}
                  {artists.map(cardRow)}
                  {songs.length > 0 && head(tr('search.filter.song'))}
                  {songs.map((t) => songRow(t, tr('kind.song')))}
                  {videos.length > 0 && head(tr('kind.video'), true)}
                  {videos.map((t) => songRow(t, tr('kind.video')))}
                  {albums.length > 0 && head(tr('search.filter.album'))}
                  {albums.map(cardRow)}
                  {libs.length > 0 && head(tr('search.inLibrary'))}
                  {libs.map((r) => (
                    <Pressable key={`lib-${r.key}`} onPress={() => openLib(r)} style={styles.row}>
                      {r.thumb ? (
                        <Image source={{ uri: r.thumb }} style={[styles.cover, { borderRadius: r.kind === 'artist' ? 28 : 4, backgroundColor: theme.colors.surface }]} />
                      ) : (
                        <View style={[styles.cover, { borderRadius: r.kind === 'artist' ? 28 : 4, backgroundColor: r.kind === 'liked' ? '#5B3CC4' : theme.colors.surface }]}>
                          <Ionicons name={r.kind === 'liked' ? 'heart' : r.kind === 'album' ? 'disc' : r.kind === 'artist' ? 'person' : 'musical-notes'} size={22} color={r.kind === 'liked' ? 'rgba(255,255,255,0.85)' : textSecondary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{r.kind === 'liked' ? tr('lib.liked') : r.title}</Text>
                        <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
                          {r.kind === 'artist' ? tr('kind.artist') : r.kind === 'album' ? tr('kind.album') : tr('kind.playlist')}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              );
            })()}
          </View>
    </>
  );

  const resultsBody = userMode ? usersBody : musicBody;

  // Màn hình ngang: trái = tiêu đề + ô tìm kiếm (+ các mục lọc Tất cả / Bài hát... và kết quả hàng đầu khi đã tìm),
  // phải = phần còn lại (thể loại, gợi ý khi đang gõ, danh sách kết quả). Mỗi bên cuộn riêng
  if (landscape) {
    const topCard = !userMode && showResults && resultsReady && results && kind === 'all' && results.top
      ? renderTop(results.top, [...results.songs, ...results.videos].map(toTrack))
      : null;
    return (
      <SplitPane
        ratio={0.36}
        topExtra={16}
        left={
          <>
        <Text style={{ color: text, fontSize: 26, fontWeight: '700', marginTop: 0 }}>{tr('search.title')}</Text>
            {searchBox}
            {showResults && <View style={{ marginTop: 14 }}>{chipRow}</View>}
            {topCard && <View style={{ marginTop: 6 }}>{topCard}</View>}
          </>
        }
        right={
          showHistory ? <View style={{ marginTop: -22 }}>{historyList}</View> : !searching ? <View style={{ marginTop: -28 }} onLayout={(e) => setRightW(e.nativeEvent.layout.width)}>{browse}</View> : !showResults ? <View style={{ marginTop: -12 }}>{suggestions}</View> : <View style={{ gap: 4 }}>{resultsBody}</View>
        }
      />
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}
    >
      <View style={{ width: '100%', paddingHorizontal: H_PAD }}>
        <Text style={{ color: text, fontSize: 26, fontWeight: '700', marginTop: pad.top + 16 }}>{tr('search.title')}</Text>

        {searchBox}

        {showHistory ? historyList : !searching ? browse : !showResults ? suggestions : (
          <View style={{ marginTop: 14, gap: 4 }}>
            {chipRow}
            {resultsBody}
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
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  sectionHead: { fontSize: 18, fontWeight: '800', marginTop: 14, marginBottom: 4 },
  topCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 10, marginBottom: 4 },
  topPlay: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  cover: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
