import { SplitPane } from '../components/SplitPane';
import { GlassFill, glassShadow } from '../components/Glass';
import { ScalePressable } from '../components/PressScale';
import { Stagger } from '../components/Stagger';
import { loadTrendingSummed, trendingId } from '../data/trending';
import { PostCard } from '../components/PostCard';
import { feedKey, useFeed } from '../components/FeedList';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, PixelRatio, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { Easing, FadeOut, FadeInDown, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useDockCollapse } from '../components/dockCollapse';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { usePlayerPick } from '../player/PlayerProvider';
import { useSongMenu } from '../components/useSongMenu';
import { useNav } from '../nav/Nav';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { Card, Shelf } from '../music/ytmusic';
import type { HomeSection, TrendingRange, TrendingRegion } from '../theme/types';
import type { Track } from '../data/mock';
import { useT } from '../i18n';
import { SmartImage } from '../components/Cover';
import { cacheGet, cacheSet, createPlaylist, getPlaylists, getRecent, getTopArtists, RecentItem, useDbVersion } from '../data/db';

const PAD = 16;
type ScrollViewRef = React.ComponentRef<typeof ScrollView>;
const CARD = 148;


// ---------------------------------------------------------------------------
// Dữ liệu từ YouTube Music: tải một lần, dùng lại 30 phút (đổi tab qua lại không tải lại)
// ---------------------------------------------------------------------------
const TTL = 30 * 60 * 1000;
const remote = new Map<string, { at: number; p: Promise<any> }>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = remote.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = load();
  p.catch(() => remote.delete(key));
  remote.set(key, { at: Date.now(), p });
  return p;
}
const charts = (region: TrendingRegion) => once(`charts:${region}`, () => ytmusic().getChartShelves(region));
const homeFeed = () => once('home', () => ytmusic().getHomeShelves());
const explore = () => once('explore', () => ytmusic().getExploreShelves());

// Dùng chung cho các khối tải qua mạng.
// Có bản đã lưu trong máy thì hiện ngay (như Spotify), rồi tải bản mới chạy ngầm khi bản lưu đã cũ hơn `fresh`.
// Tải lỗi mà đang có bản lưu thì cứ giữ bản lưu, không báo lỗi.
function useRemote<T>(key: string, load: () => Promise<T>, enabled = true, fresh = 60 * 60 * 1000) {
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; data?: T }>(() => {
    const disk = cacheGet<T>(`home:${key}`);
    return disk ? { status: 'done', data: disk.value } : { status: 'loading' };
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const disk = cacheGet<T>(`home:${key}`);
    if (disk) setState({ status: 'done', data: disk.value });
    if (!musicSupported) return setState((s) => (s.data ? s : { status: 'error' }));
    if (disk && Date.now() - disk.at < fresh && retry === 0) return; // bản lưu còn mới: không cần tải
    let dead = false;
    if (!disk) setState({ status: 'loading' });
    const run = () =>
      load()
        .then((data) => {
          if (data != null) cacheSet(`home:${key}`, data);
          if (!dead) setState({ status: 'done', data });
        })
        .catch((e) => {
          console.warn(`[home:${key}]`, e);
          if (!dead) setState((s) => (s.data ? s : { status: 'error' }));
        });
    // Đã có bản lưu (dù cũ) thì chờ 4 giây rồi mới cập nhật ngầm, để lúc vừa mở app không có việc nặng nào làm dock bị đơ.
    // Chưa có gì để hiện thì tải ngay.
    const timer = disk && retry === 0 ? setTimeout(run, 4000) : (run(), null);
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, retry, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setRetry((r) => r + 1) };
}

// Trending: tìm playlist bảng xếp hạng hợp với khoảng thời gian trên trang Charts của YouTube Music
const RANGE_MATCH: Record<TrendingRange, RegExp> = {
  week: /week|tuần|weekly/i,
  month: /month|tháng|monthly/i,
  year: /year|năm|yearly|20\d\d/i,
};
type TrendingData = { title: string; playlistId?: string; songs: Track[]; gathering?: { have: number; need: number } };
async function loadTrending(range: TrendingRange, region: TrendingRegion): Promise<TrendingData | null> {
  if (range !== 'week') {
    const r = await loadTrendingSummed(range, region);
    return r && { title: '', playlistId: trendingId(region, range), ...r };
  }
  // Tuần: ưu tiên bảng "Top songs" của YouTube Charts server đã lưu; chưa có thì lấy từ trang Charts của YouTube Music
  try {
    const r = await loadTrendingSummed('week', region);
    if (r?.songs.length) return { title: '', playlistId: trendingId(region, 'week'), songs: r.songs };
  } catch (e) {
    console.warn('[trending] week', e);
  }
  const shelves = await charts(region);
  const cards = shelves.flatMap((s) => s.cards.map((c) => ({ ...c, shelf: s.title })));
  const lists = cards.filter((c) => c.kind === 'playlist');
  // Chọn đúng bảng BÀI HÁT (trang Charts còn có Top video, Top live performances...): bài hát được cộng điểm, video / live bị trừ
  const score = (c: (typeof lists)[number]) => {
    const txt = `${c.title} ${c.subtitle} ${c.shelf}`;
    return (/songs?|bài hát/i.test(txt) ? 3 : 0) + (RANGE_MATCH[range].test(txt) ? 1 : 0) - (/video|live|performance|shorts?|trending/i.test(txt) ? 5 : 0);
  };
  const best = [...lists].sort((a, b) => score(b) - score(a))[0];
  const pick = best && score(best) > 0 ? best : lists.find((c) => !/video|live|performance/i.test(`${c.title} ${c.shelf}`));
  if (pick) {
    const col = await ytmusic().getCollection('playlist', pick.id);
    return { title: pick.title, playlistId: pick.id, songs: col.songs.slice(0, 50).map(toTrack) };
  }
  // Có trang hiện thẳng bài hát thay vì playlist
  if (range === 'week') {
    const songs = cards.filter((c) => c.song).map((c) => toTrack(c.song!));
    if (songs.length) return { title: '', songs }; // tên hiển thị lấy từ bộ chữ (home.topWeekSongs)
  }
  return null;
}

// ---------------------------------------------------------------------------
// Thành phần giao diện
// ---------------------------------------------------------------------------
// Bảng tin: bài đăng mới nhất của mọi người (cả người mình theo dõi lẫn chưa theo dõi), mới nhất trước.
// Thích / bình luận ngay trong bảng tin, bấm tên / avatar để mở hồ sơ người đó
// Bảng tin trên Home: một khung cao vừa phải chứa khoảng 5 bài mới nhất, cuộn bên trong khung.
// Mép trên / dưới của khung mờ dần (nội dung tan dần chứ không cắt thành đường), không có thanh cuộn.
// Muốn xem bài mới: kéo xuống ở đầu khung để làm mới, hoặc bấm >> để mở bảng tin đầy đủ
const FEED_BOX_H = 460;
function Feed() {
  const { theme } = useTheme();
  const t = useT();
  const { push } = useNav();
  const { posts, error, refreshing, refresh } = useFeed(5);
  const { textSecondary, accent } = theme.colors;
  const fade = (
    <LinearGradient
      colors={['transparent', '#000', '#000', 'transparent']}
      locations={[0, 0.07, 0.9, 1]}
      style={{ flex: 1 }}
    />
  );
  return (
    <>
      <SectionTitle
        title={t('home.section.feed')}
        right={
          <Pressable onPress={() => push({ type: 'feed' })} hitSlop={10}>
            <MaterialCommunityIcons name="chevron-double-right" size={28} color={textSecondary} />
          </Pressable>
        }
      />
      {posts === null ? (
        error ? (
          <Pressable onPress={() => refresh()}>
            <Text style={{ color: textSecondary }}>{t('community.loadFailed')}</Text>
            <Text style={{ color: textSecondary, fontSize: 12, marginTop: 4, opacity: 0.7 }}>{error}</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={accent} style={{ marginVertical: 16 }} />
        )
      ) : posts.length === 0 ? (
        <Text style={{ color: textSecondary }}>{t('community.feedEmpty')}</Text>
      ) : (
        <MaskedView style={{ maxHeight: FEED_BOX_H }} maskElement={fade}>
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 14 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={accent} colors={[accent]} />}
          >
            {posts.map((p, i) => (
              <PostCard key={feedKey(p)} post={p} showDivider={i < posts.length - 1} />
            ))}
          </ScrollView>
        </MaskedView>
      )}
    </>
  );
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
      {right}
    </View>
  );
}

function CoverCard({ title, subtitle, thumb, round, onPress, onLongPress, icon }: {
  title: string; subtitle?: string; thumb?: string; round?: boolean; icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void; onLongPress?: () => void;
}) {
  const { theme } = useTheme();
  const r = round ? CARD / 2 : 8;
  return (
    <ScalePressable onPress={onPress} onLongPress={onLongPress} style={{ width: CARD }}>
      {thumb ? (
        // Xin ảnh đúng cỡ hiển thị thật trên màn hình (CARD × mật độ điểm ảnh, iPhone là ×3).
        // Ảnh bài hát lưu từ kết quả tìm kiếm chỉ có 120px nên phóng lên 148pt sẽ bị mờ
        <SmartImage
          url={thumb}
          size={Math.round(CARD * PixelRatio.get())}
          style={{ width: CARD, height: CARD, borderRadius: r, backgroundColor: theme.colors.surface }}
        />
      ) : (
        <View style={{ width: CARD, height: CARD, borderRadius: r, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon ?? 'musical-notes'} size={40} color={theme.colors.textSecondary} />
        </View>
      )}
      <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.colors.text, textAlign: round ? 'center' : 'left' }]}>{title}</Text>
      {!!subtitle && (
        <Text numberOfLines={2} style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: round ? 'center' : 'left' }}>{subtitle}</Text>
      )}
    </ScalePressable>
  );
}

function HRow({ children, scrollRef }: { children: React.ReactNode; scrollRef?: React.RefObject<ScrollViewRef | null> }) {
  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: PAD }} style={{ marginHorizontal: -PAD }}>
      {children}
    </ScrollView>
  );
}

function Skeleton() {
  const { theme } = useTheme();
  return (
    <HRow>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: CARD }}>
          <View style={{ width: CARD, height: CARD, borderRadius: 8, backgroundColor: theme.colors.surface }} />
          <View style={{ width: CARD * 0.7, height: 12, borderRadius: 6, marginTop: 10, backgroundColor: theme.colors.surface }} />
        </View>
      ))}
    </HRow>
  );
}

function Failed({ onRetry, text }: { onRetry: () => void; text?: string }) {
  const { theme } = useTheme();
  const t = useT();
  return (
    <Pressable onPress={onRetry} style={{ paddingVertical: 10 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{text ?? t('common.loadFailed')}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Các khối
// ---------------------------------------------------------------------------
function MyPlaylists() {
  const { theme } = useTheme();
  const t = useT();
  const { push } = useNav();
  const dbv = useDbVersion();
  const lists = useMemo(() => getPlaylists().slice(0, 7), [dbv]);
  const chip = (key: string, title: string, onPress: () => void, cover: React.ReactNode) => (
    <ScalePressable key={key} onPress={onPress} outerStyle={{ width: '48.8%' }} style={[styles.chip, { width: '100%' }, glassShadow(0.8, theme.colors.glassTint !== 'dark')]}>
      <GlassFill radius={CHIP_R} solid={0.5} slab />
      {cover}
      <Text numberOfLines={2} style={[styles.chipTitle, { color: theme.colors.text }]}>{title}</Text>
    </ScalePressable>
  );
  const iconCover = (name: keyof typeof Ionicons.glyphMap, bg: string, fg = '#FFFFFF') => (
    <View style={[styles.chipCover, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name={name} size={22} color={fg} />
    </View>
  );
  return (
    <View style={styles.grid}>
      {chip('liked', t('home.liked'), () => push({ type: 'collection', source: 'liked', kind: 'playlist', id: 'liked', title: t('home.liked') }), iconCover('heart', '#5B3CC4'))}
      {lists.map((p) =>
        chip(
          p.id,
          p.title,
          () => push({ type: 'collection', source: 'local', kind: 'playlist', id: p.id, title: p.title, thumb: p.thumb }),
          p.thumb ? <Image source={{ uri: p.thumb }} style={styles.chipCover} /> : iconCover('musical-notes', theme.colors.skeleton, theme.colors.textSecondary)
        )
      )}
      {lists.length < 7 &&
        chip(
          'new',
          t('home.createPlaylist'),
          () => {
            const name = t('home.newPlaylistName', { n: getPlaylists().length + 1 });
            const id = createPlaylist(name);
            push({ type: 'collection', source: 'local', kind: 'playlist', id, title: name });
          },
          iconCover('add', theme.colors.accent, theme.colors.onAccent)
        )}
    </View>
  );
}

// Bấm một mục "vừa nghe" / gợi ý: mở trang hoặc phát ngay
function useOpenContext() {
  const t = useT();
  const { push } = useNav();
  const { playTrack } = usePlayerPick('playTrack');
  const startMix = (seed: Track, title: string) => {
    if (!musicSupported) return;
    // Phát bài gốc ngay, phần còn lại của mix nối vào khi tải xong
    ytmusic()
      .getUpNext(seed.id)
      .then((songs) => {
        const list = songs.map(toTrack);
        const first = list[0] ?? seed;
        playTrack(first, list.length ? list : [seed], { kind: 'mix', id: seed.id, title, thumb: seed.thumb });
      })
      .catch(() => playTrack(seed, [seed], { kind: 'mix', id: seed.id, title, thumb: seed.thumb }));
  };
  const open = (r: RecentItem) => {
    if (r.kind === 'search' && r.track) return playTrack(r.track);
    if (r.kind === 'liked') return push({ type: 'collection', source: 'liked', kind: 'playlist', id: 'liked', title: t('home.liked') });
    if (r.kind === 'local') return push({ type: 'collection', source: 'local', kind: 'playlist', id: r.id, title: r.title, thumb: r.thumb });
    if (r.kind === 'shared') return push({ type: 'collection', source: 'shared', kind: 'playlist', id: r.id, title: r.title, thumb: r.thumb });
    if (r.kind === 'album') return push({ type: 'collection', source: 'yt', kind: 'album', id: r.id, title: r.title, thumb: r.thumb });
    if (r.kind === 'chart' && r.id.startsWith('trending:')) return push({ type: 'collection', source: 'trending', kind: 'playlist', id: r.id, title: r.title });
    if (r.kind === 'chart' && r.id === 'chart') return; // danh sách cũ không mở lại được
    if (r.kind === 'playlist' || r.kind === 'chart') return push({ type: 'collection', source: 'yt', kind: 'playlist', id: r.id, title: r.title, thumb: r.thumb });
    if (r.kind === 'artist') return push({ type: 'artist', id: r.id, name: r.title, thumb: r.thumb });
    if (r.kind === 'mix') return startMix({ id: r.id, title: r.title, artist: '', color: '#2A2A2A', duration: 0, thumb: r.thumb }, r.title);
  };
  return { open, startMix };
}

// list: màn hình ngang — xếp dọc thành các ô giống "Playlist của tôi" thay vì hàng trượt ngang
// Danh sách ĐỨNG YÊN trong lúc dùng app: bấm một mục cũ (mục đó được đưa lên đầu trong dữ liệu) thì hàng không bị
// xếp lại, không bị giật về đầu nữa. Chỉ làm mới khi bấm nút ↻ cạnh tiêu đề, hoặc lần mở app sau.
// Có mục mới chưa hiện thì nút ↻ sáng màu nhấn
function Recent({ list }: { list?: boolean }) {
  const { theme } = useTheme();
  const t = useT();
  const dbv = useDbVersion();
  const [ver, setVer] = useState(0);
  const items = useMemo(() => getRecent(12), [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useMemo(() => getRecent(12), [dbv]);
  const sig = (l: RecentItem[]) => l.map((r) => `${r.kind}:${r.id}`).join('|');
  const stale = sig(latest) !== sig(items);
  // Chưa có mục nào thì hiện ngay khi có (không bắt bấm ↻ cho lần đầu)
  useEffect(() => {
    if (!items.length && latest.length) setVer((v) => v + 1);
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowRef = useRef<ScrollViewRef>(null);
  const spin = useSharedValue(0);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const reload = () => {
    spin.value = 0;
    spin.value = withTiming(1, { duration: 500 });
    setVer((v) => v + 1);
    rowRef.current?.scrollTo({ x: 0, animated: true });
  };
  const { open } = useOpenContext();
  const head = (
    <SectionTitle
      title={t('home.section.recent')}
      right={
        items.length ? (
          <Pressable onPress={reload} hitSlop={10} style={styles.editBtn}>
            <GlassFill radius={19} solid={0.35} slab />
            <Animated.View style={spinStyle}>
              <Ionicons name="refresh" size={20} color={theme.colors.text} />
            </Animated.View>
            {stale && <View style={[styles.staleDot, { backgroundColor: theme.colors.accent }]} />}
          </Pressable>
        ) : undefined
      }
    />
  );
  if (!items.length) {
    return (
      <>
        {head}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{t('home.recentEmpty')}</Text>
      </>
    );
  }
  const label: Record<string, string> = {
    search: t('kind.song'), liked: t('kind.playlist'), local: t('kind.playlist'), shared: t('kind.playlist'), playlist: t('kind.playlist'),
    album: t('kind.album'), chart: t('kind.chart'), mix: t('kind.mix'), artist: t('kind.artist'),
  };
  // Màn hình ngang: ảnh bìa to, 2 cột, trải dọc xuống (giống lưới trong Thư viện)
  if (list) {
    return (
      <>
      {head}
      <View style={styles.grid}>
        {items.map((r) => (
          <Pressable key={`${r.kind}:${r.id}`} onPress={() => open(r)} style={({ pressed }) => [styles.bigItem, pressed && { opacity: 0.7 }]}>
            {r.kind !== 'liked' && r.thumb ? (
              // Ảnh nét theo cỡ ô to (ảnh nhỏ của hàng trượt ngang phóng lên bị mờ)
              <SmartImage url={r.thumb} size={600} style={[styles.bigCover, r.kind === 'artist' && { borderRadius: 999 }]} />
            ) : (
              <View style={[styles.bigCover, { backgroundColor: r.kind === 'liked' ? '#5B3CC4' : theme.colors.skeleton, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name={r.kind === 'liked' ? 'heart' : 'musical-notes'} size={44} color={r.kind === 'liked' ? '#FFFFFF' : theme.colors.textSecondary} />
              </View>
            )}
            <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', marginTop: 8 }}>{r.kind === 'liked' ? t('home.liked') : r.title}</Text>
            <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              {r.kind === 'search' ? r.track?.artist ?? label[r.kind] : label[r.kind]}
            </Text>
          </Pressable>
        ))}
      </View>
      </>
    );
  }
  return (
    <>
    {head}
    <HRow scrollRef={rowRef}>
      {items.map((r) => (
        <CoverCard
          key={`${r.kind}:${r.id}`}
          title={r.kind === 'liked' ? t('home.liked') : r.title}
          subtitle={r.kind === 'search' ? `${label[r.kind]} • ${r.track?.artist ?? ''}` : label[r.kind]}
          thumb={r.thumb}
          icon={r.kind === 'liked' ? 'heart' : 'musical-notes'}
          onPress={() => open(r)}
        />
      ))}
    </HRow>
    </>
  );
}

function Trending() {
  const { theme, setHome } = useTheme();
  const t = useT();
  const { track, playTrack } = usePlayerPick('track', 'playTrack');
  const songMenu = useSongMenu();
  const { push } = useNav();
  const range = theme.home.trendingRange;
  const region = theme.home.trendingRegion;
  const key = `trending:${region}:${range}`;
  const r = useRemote(key, () => once(key, () => loadTrending(range, region)), true, 6 * 60 * 60 * 1000);
  const { text, textSecondary, accent, surface, border } = theme.colors;
  const regionName = (k: TrendingRegion) => t(`home.region.${k}`);
  // Ô chọn khu vực: bấm vào thì trải xuống danh sách (Toàn cầu / Việt Nam / Hàn Quốc / Mỹ)
  const [regionOpen, setRegionOpen] = useState(false);
  const regionBox = (
    <Pressable onPress={() => setRegionOpen((v) => !v)} style={[styles.regionBox, { backgroundColor: surface, borderColor: border }]}>
      <Ionicons name="globe-outline" size={14} color={textSecondary} />
      <Text style={{ color: text, fontSize: 13, fontWeight: '700' }}>{regionName(region)}</Text>
      <Ionicons name={regionOpen ? 'chevron-up' : 'chevron-down'} size={14} color={textSecondary} />
    </Pressable>
  );
  const regionList = regionOpen && (
    // Nổi lên trên danh sách (không đẩy danh sách xuống): mọc ra từ góc của ô chọn, tấm kính có bóng đổ
    <Animated.View entering={popIn} exiting={FadeOut.duration(120)} style={[styles.regionList, { backgroundColor: theme.colors.surface, borderColor: border, borderWidth: StyleSheet.hairlineWidth }, glassShadow(1, theme.colors.glassTint !== 'dark')]}>
      {/* nền đặc (không trong suốt): bảng chọn nằm đè lên danh sách, trong suốt thì chữ hai lớp chồng lên nhau */}
      {(['ZZ', 'VN', 'KR', 'US'] as TrendingRegion[]).map((k) => (
        <Pressable
          key={k}
          onPress={() => {
            setHome({ trendingRegion: k });
            setRegionOpen(false);
          }}
          style={({ pressed }) => [styles.regionRow, pressed && { backgroundColor: border }]}
        >
          <Text style={{ flex: 1, color: k === region ? accent : text, fontSize: 15, fontWeight: k === region ? '800' : '600' }}>{regionName(k)}</Text>
          {k === region && <Ionicons name="checkmark" size={18} color={accent} />}
        </Pressable>
      ))}
    </Animated.View>
  );

  const chips = (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {(['week', 'month', 'year'] as TrendingRange[]).map((k) => (
        <Pressable key={k} onPress={() => setHome({ trendingRange: k })} style={[styles.pill, { backgroundColor: k === range ? accent : surface }]}>
          <Text style={{ color: k === range ? theme.colors.onAccent : text, fontSize: 12, fontWeight: '700' }}>{t(`home.range.${k}`)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const data = r.data;
  const chartTitle = data ? data.title || t(range === 'month' ? 'home.topMonthSongs' : range === 'year' ? 'home.topYearSongs' : 'home.topWeekSongs') : '';
  const ctx = data ? { kind: 'chart' as const, id: data.playlistId ?? 'chart', title: chartTitle } : null;
  return (
    <View>
      <SectionTitle title={t('home.section.trending')} right={chips} />
      <View style={{ alignItems: 'flex-start', marginBottom: 8, zIndex: 20, elevation: 20 }}>
        {regionBox}
        {regionList}
      </View>
      {r.status === 'loading' &&
        // Khung chờ đúng hình dạng danh sách, đỡ trống trơn
        [0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.rankRow}>
            <View style={{ width: 26 }} />
            <View style={[styles.rankThumb, { backgroundColor: surface }]} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ height: 12, width: '65%', borderRadius: 6, backgroundColor: surface }} />
              <View style={{ height: 10, width: '40%', borderRadius: 5, backgroundColor: surface }} />
            </View>
          </View>
        ))}
      {r.status === 'error' && <Failed onRetry={r.retry} />}
      {r.status === 'done' && !data && (
        <Text style={{ color: textSecondary, fontSize: 14 }}>
          {t('home.trendingNone', { range: t(range === 'month' ? 'home.rangeWord.month' : 'home.rangeWord.year'), region: regionName(region) })}
        </Text>
      )}
      {data && (
        <>
          <Text style={{ color: textSecondary, fontSize: 13, marginBottom: 6 }}>
            {range === 'week'
              ? t('home.trendingSource', { title: chartTitle, region: regionName(region) })
              : t('home.trendingSummed', { title: chartTitle, region: regionName(region) })}
            {data.gathering ? ` • ${t('home.trendingGathering', { have: data.gathering.have, need: data.gathering.need })}` : ''}
          </Text>
          {data.songs.slice(0, 10).map((s, i) => (
            <Stagger key={`${s.id}:${i}:${region}:${range}`} i={i}>
            <Pressable
              testID={`trending-${i}`}
              onPress={() => playTrack(s, data.songs, ctx!)}
              onLongPress={() => songMenu(s)}
              style={styles.rankRow}
            >
              <Text style={{ width: 26, color: i < 3 ? accent : textSecondary, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>{i + 1}</Text>
              {s.thumb ? <Image source={{ uri: s.thumb }} style={styles.rankThumb} /> : <View style={[styles.rankThumb, { backgroundColor: surface }]} />}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: s.id === track.id ? accent : text, fontSize: 15, fontWeight: '600' }}>{s.title}</Text>
                <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13 }}>{s.artist}</Text>
              </View>
              <Pressable onPress={() => songMenu(s)} hitSlop={12} style={{ paddingLeft: 6 }}>
                <Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
              </Pressable>
            </Pressable>
            </Stagger>
          ))}
          {data.playlistId && (
            <Pressable
              onPress={() =>
                push({ type: 'collection', source: data.playlistId!.startsWith('trending:') ? 'trending' : 'yt', kind: 'playlist', id: data.playlistId!, title: chartTitle })
              }
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ color: textSecondary, fontSize: 14, fontWeight: '700' }}>{t('home.seeAll')}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

function Recommended() {
  const { theme } = useTheme();
  const t = useT();
  const dbv = useDbVersion();
  const tops = useMemo(() => getTopArtists(30, 6), [dbv]);
  const { startMix } = useOpenContext();
  const { playTrack } = usePlayerPick('playTrack');
  // Chưa có lịch sử nghe: dùng gợi ý chung của YouTube Music
  const fallback = useRemote('home', homeFeed, tops.length === 0, 3 * 60 * 60 * 1000);

  if (tops.length) {
    return (
      <HRow>
        {tops.map((a) => (
          <CoverCard
            key={a.artist}
            title={t('home.mixTitle', { artist: a.artist.split(',')[0] })}
            subtitle={t('home.mixBecause', { artist: a.artist.split(',')[0] })}
            thumb={a.seed.thumb}
            onPress={() => startMix(a.seed, t('home.mixTitle', { artist: a.artist.split(',')[0] }))}
          />
        ))}
      </HRow>
    );
  }
  if (fallback.status === 'loading') return <Skeleton />;
  if (fallback.status === 'error') return <Failed onRetry={fallback.retry} />;
  const songs = (fallback.data as Shelf[] | undefined)?.flatMap((s) => s.cards).filter((c) => c.song).slice(0, 12) ?? [];
  if (!songs.length) return <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{t('home.recommendEmpty')}</Text>;
  const list = songs.map((c) => toTrack(c.song!));
  return (
    <HRow>
      {songs.map((c, i) => (
        <CoverCard key={`${c.id}:${i}`} title={c.title} subtitle={c.subtitle} thumb={c.thumb} onPress={() => playTrack(list[i], list)} />
      ))}
    </HRow>
  );
}

function PlaylistPicks() {
  const { theme } = useTheme();
  const t = useT();
  const { push } = useNav();
  // Chưa có tài khoản nên chưa có playlist của người dùng khác: tạm lấy playlist nổi bật của YouTube Music
  const r = useRemote('picks', () => Promise.all([homeFeed().catch(() => []), explore().catch(() => [])]), true, 6 * 60 * 60 * 1000);
  const cards = useMemo(() => {
    const all = ((r.data ?? []) as Shelf[][]).flat().flatMap((s) => s.cards);
    const seen = new Set<string>();
    return all.filter((c: Card) => (c.kind === 'playlist' || c.kind === 'album') && !seen.has(c.id) && !!seen.add(c.id)).slice(0, 12);
  }, [r.data]);
  if (r.status === 'loading') return <Skeleton />;
  if (r.status === 'error') return <Failed onRetry={r.retry} />;
  if (!cards.length) return <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{t('home.picksEmpty')}</Text>;
  return (
    <>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: -6, marginBottom: 10 }}>
        {t('home.picksNote')}
      </Text>
      <HRow>
        {cards.map((c) => (
          <CoverCard
            key={c.id}
            title={c.title}
            subtitle={c.subtitle}
            thumb={c.thumb}
            onPress={() => push({ type: 'collection', source: 'yt', kind: c.kind === 'album' ? 'album' : 'playlist', id: c.id, title: c.title, thumb: c.thumb })}
          />
        ))}
      </HRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Chỉnh Home: bật/tắt khối và đổi thứ tự
// ---------------------------------------------------------------------------
function EditHome({ onClose }: { onClose: () => void }) {
  const { theme, setHome } = useTheme();
  const t = useT();
  const { sections, hidden } = theme.home;
  const { text, textSecondary, accent, surface } = theme.colors;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setHome({ sections: next });
  };
  const toggle = (s: HomeSection, on: boolean) => setHome({ hidden: on ? hidden.filter((h) => h !== s) : [...hidden, s] });
  return (
    <View style={[styles.editBox, { backgroundColor: surface }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ flex: 1, color: text, fontSize: 17, fontWeight: '800' }}>{t('home.edit.title')}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: accent, fontSize: 15, fontWeight: '700' }}>{t('common.done')}</Text>
        </Pressable>
      </View>
      <Text style={{ color: textSecondary, fontSize: 13, marginBottom: 8 }}>{t('home.edit.hint')}</Text>
      {sections.map((s, i) => (
        <View key={s} style={styles.editRow}>
          <Switch value={!hidden.includes(s)} onValueChange={(v) => toggle(s, v)} trackColor={{ true: accent, false: theme.colors.switchOff }} />
          <Text style={{ flex: 1, color: text, fontSize: 15, fontWeight: '600' }}>{t(`home.section.${s}`)}</Text>
          <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}>
            <Ionicons name="chevron-up" size={22} color={text} />
          </Pressable>
          <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === sections.length - 1} style={{ opacity: i === sections.length - 1 ? 0.3 : 1 }}>
            <Ionicons name="chevron-down" size={22} color={text} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function greetingKey() {
  const h = new Date().getHours();
  if (h < 11) return 'home.greet.morning' as const;
  if (h < 14) return 'home.greet.noon' as const;
  if (h < 18) return 'home.greet.afternoon' as const;
  return 'home.greet.evening' as const;
}

export function HomeScreen() {
  const { theme, landscape } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { push } = useNav();
  const [editing, setEditing] = useState(false);
  // dock Apple Music: cuộn xuống thì thu dock, cuộn lên thì mở lại
  const homeY = useSharedValue(0);
  const dockScroll = useAnimatedScrollHandler((e) => {
    homeY.value = e.contentOffset.y;
  });
  useDockCollapse(homeY);
  const visible = theme.home.sections.filter((s) => !theme.home.hidden.includes(s));

  const render = (s: HomeSection) => {
    switch (s) {
      case 'myPlaylists':
        return <MyPlaylists />;
      case 'recent':
        return <Recent list={landscape} />;
      case 'feed':
        return <Feed />;
      case 'trending':
        return <Trending />;
      case 'recommended':
        return (
          <>
            <SectionTitle title={t('home.section.recommended')} />
            <Recommended />
          </>
        );
      case 'playlistPicks':
        return (
          <>
            <SectionTitle title={t('home.section.playlistPicks')} />
            <PlaylistPicks />
          </>
        );
    }
  };

  const header = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <Text style={[styles.greeting, { color: theme.colors.text }]}>{t(greetingKey())}</Text>
        {/* Thống kê nghe nhạc */}
        <Pressable onPress={() => push({ type: 'stats' })} hitSlop={10} style={[styles.editBtn, { marginRight: 10 }]} accessibilityLabel={t('stats.title')}>
          <GlassFill radius={19} solid={0.35} slab />
          <Ionicons name="stats-chart" size={17} color={theme.colors.text} />
        </Pressable>
        <Pressable onPress={() => setEditing((v) => !v)} hitSlop={10} style={styles.editBtn}>
            <GlassFill radius={19} solid={0.35} slab />
          <Ionicons name="options-outline" size={20} color={theme.colors.text} />
        </Pressable>
      </View>
      {editing && <EditHome onClose={() => setEditing(false)} />}
    </>
  );
  const blocks = (list: HomeSection[]) =>
    list.map((s, i) => (
      <View key={s} style={{ marginTop: i === 0 ? 0 : 30 }}>
        {render(s)}
      </View>
    ));

  // Màn hình ngang: trái = lời chào + Playlist của tôi + Nghe gần đây (xếp dọc), phải = các mục còn lại. Mỗi bên cuộn riêng
  if (landscape) {
    const LEFT: HomeSection[] = ['myPlaylists', 'recent'];
    const leftList = visible.filter((s) => LEFT.includes(s));
    const rightList = visible.filter((s) => !LEFT.includes(s));
    return (
      <SplitPane
        ratio={0.46}
        left={
          <>
            {header}
            {blocks(leftList)}
            {visible.length === 0 && <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{t('home.allHidden')}</Text>}
          </>
        }
        right={<View style={{ paddingTop: 4 }}>{blocks(rightList)}</View>}
      />
    );
  }

  return (
    <Animated.ScrollView
      onScroll={dockScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingTop: pad.top + 16,
        paddingBottom: pad.bottom + pad.endPadding,
        paddingLeft: pad.left + PAD,
        paddingRight: pad.right + PAD,
      }}
    >
      {header}

      {visible.map((s, i) => (
        <View key={s} style={{ marginTop: i === 0 ? 0 : 30 }}>
          {render(s)}
        </View>
      ))}
      {visible.length === 0 && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{t('home.allHidden')}</Text>
      )}
    </Animated.ScrollView>
  );
}

const CHIP_R = 16;
// Bảng chọn nổi: hiện từ 95% + mờ → rõ (không mọc từ 0), đường cong ease-out mạnh, 160ms
const popIn = () => {
  'worklet';
  const ease = Easing.bezier(0.23, 1, 0.32, 1);
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.95 }] },
    animations: { opacity: withTiming(1, { duration: 160, easing: ease }), transform: [{ scale: withTiming(1, { duration: 160, easing: ease }) }] },
  };
};
const styles = StyleSheet.create({
  greeting: { flex: 1, fontSize: 26, fontWeight: '800' },
  editBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  editBox: { borderRadius: 12, padding: 14, marginBottom: 24 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  // space-between + rowGap thay cho gap: 2 ô 48.8% luôn vừa một hàng ở mọi bề rộng (cột trái lúc ngang hẹp → trước đây rớt còn 1 cột)
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  bigItem: { width: '48.4%', marginBottom: 14 },
  bigCover: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  // Ô playlist = tấm kính nhỏ (giống dock): ảnh bìa nằm lọt bên trong, cách mép kính 6px
  chip: { width: '48.8%', height: 62, borderRadius: CHIP_R, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', padding: 6 },
  chipCover: { width: 50, height: 50, borderRadius: CHIP_R - 6, borderCurve: 'continuous', overflow: 'hidden' },
  chipTitle: { flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '700' },
  cardTitle: { marginTop: 8, fontSize: 14, fontWeight: '700' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  staleDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4 },
  regionBox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  regionList: { position: 'absolute', top: '100%', left: 0, marginTop: 6, minWidth: 190, borderRadius: 14, borderCurve: 'continuous', paddingVertical: 4, transformOrigin: 'left top' },
  regionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 42 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rankThumb: { width: 46, height: 46, borderRadius: 4 },
});
