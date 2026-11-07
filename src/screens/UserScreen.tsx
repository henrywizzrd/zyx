import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { UserPage, useNav } from '../nav/Nav';
import { useAnimatedBack } from '../nav/SwipeBack';
import { useContentInsets } from '../components/FloatingDock';
import { useActionSheet } from '../components/ActionSheet';
import { PostCard } from '../components/PostCard';
import { applyPatch, fetchPosts, fetchSharedPlaylists, getProfileCard, NeedAccount, onPostPatch, ProfileCard, setFollow, SharedPlaylist } from '../data/community';
import { PlaylistRows } from '../components/PlaylistRows';
import { currentAccount } from '../data/auth';
import type { Post } from '../data/social';

const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
const COVER_H = 230;

// Hồ sơ của một người dùng khác: ảnh bìa, avatar, Tên#tag, số bài / người theo dõi / đang theo dõi,
// nút Theo dõi, và các bài đăng của họ (thích, bình luận được)
export function UserScreen({ page }: { page: UserPage }) {
  const { theme, landscape } = useTheme();
  const t = useT();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const pad = useContentInsets();
  const sheet = useActionSheet();
  const { text, textSecondary, accent, onAccent, surface, border } = theme.colors;
  const me = currentAccount()?.id;
  const isMe = me === page.id;
  // Màu nền để cuối ảnh bìa hoà vào (nền ảnh / video thì dùng màu nền chính, vẫn hoà đẹp)
  const bgHex = (theme.background.color || theme.colors.bg).slice(0, 7);
  const fadeEnd = theme.background.type === 'preset' ? bgHex : bgHex + '00';

  const [card, setCard] = useState<ProfileCard | null | 'missing'>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 3 tab: Bài đăng / Đăng lại / Playlist (playlist công khai của họ)
  const [tab, setTab] = useState<'posts' | 'reposts' | 'playlists'>('posts');
  const [reposts, setReposts] = useState<Post[] | null>(null);
  const [lists, setLists] = useState<SharedPlaylist[] | null>(null);
  useEffect(() => {
    if (tab === 'reposts' && reposts === null) fetchPosts(page.id, undefined, 'reposts').then(setReposts).catch(() => setReposts([]));
    if (tab === 'playlists' && lists === null) fetchSharedPlaylists(page.id).then(setLists).catch(() => setLists([]));
  }, [tab, page.id, reposts, lists]);
  useEffect(() => onPostPatch((p) => setReposts((l) => (l ? applyPatch(l, p) : l))), []);
  const { push } = useNav();

  const load = () => {
    setFailed(false);
    getProfileCard(page.id)
      .then((c) => setCard(c ?? 'missing'))
      .catch(() => setFailed(true));
    fetchPosts(page.id)
      .then(setPosts)
      .catch(() => setFailed(true));
  };
  useEffect(load, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onPostPatch((p) => setPosts((l) => (l ? applyPatch(l, p) : l))), []);

  const toggleFollow = async () => {
    if (!card || card === 'missing' || busy) return;
    const next = !card.isFollowing;
    setCard({ ...card, isFollowing: next, followers: Math.max(0, card.followers + (next ? 1 : -1)) });
    setBusy(true);
    try {
      await setFollow(card.id, next);
    } catch (e) {
      setCard(card);
      sheet.toast(t(e instanceof NeedAccount ? 'community.needAccount' : 'community.failed'));
    } finally {
      setBusy(false);
    }
  };

  const c = card && card !== 'missing' ? card : null;

  const backBtn = (
    <Pressable onPress={goBack} hitSlop={10} style={styles.roundBtn}>
      <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
    </Pressable>
  );

  // Ảnh bìa: rõ ở phía trên, mờ dần xuống dưới, rồi hoà vào nền
  const cover = (h: number | '100%') => (
    <View style={{ height: h as any, width: '100%', overflow: 'hidden' }}>
      {/* Cả khối tan dần (trong suốt) ở đáy, không phủ dải màu nền → nền có hoạ tiết (trời sao...) không lộ đường viền */}
      <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['#000', '#000', 'transparent']} locations={[0, 0.5, 1]} style={{ flex: 1 }} />}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c?.wall ?? surface }]} />
      {c?.cover ? (
        <>
          <Image source={{ uri: c.cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          {Platform.OS !== 'web' && (
            <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['transparent', '#000']} locations={[0.3, 0.8]} style={{ flex: 1 }} />}>
              <Image source={{ uri: c.cover }} resizeMode="cover" blurRadius={22} style={StyleSheet.absoluteFill} />
            </MaskedView>
          )}
        </>
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0)']} locations={[0, 0.4]} style={StyleSheet.absoluteFill} />
      </MaskedView>
    </View>
  );

  const identity = c && (
    <>
      <View style={[styles.avatar, { backgroundColor: c.color }]}>
        {c.avatar ? <Image source={{ uri: c.avatar }} style={StyleSheet.absoluteFill} /> : <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{c.name.slice(0, 1).toUpperCase()}</Text>}
      </View>
      <Text numberOfLines={1} style={{ color: text, fontSize: 26, fontWeight: '800', marginTop: 10 }}>
        {c.name}
        <Text style={{ color: textSecondary, fontWeight: '600' }}>{c.tag ? ` #${c.tag}` : ''}</Text>
      </Text>
      <View style={styles.stats}>
        {[
          [c.posts, t('community.postsCount')],
          [c.followers, t('community.followers')],
          [c.following, t('community.followingCount')],
        ].map(([n, label]) => (
          <Text key={String(label)} style={{ color: textSecondary, fontSize: 14 }}>
            <Text style={{ color: text, fontWeight: '800' }}>{n}</Text> {label}
          </Text>
        ))}
      </View>
      {!isMe && (
        <Pressable
          onPress={toggleFollow}
          style={[styles.followBtn, c.isFollowing ? { backgroundColor: 'transparent', borderColor: border, borderWidth: 1 } : { backgroundColor: accent }]}
        >
          <Text style={{ color: c.isFollowing ? text : onAccent, fontWeight: '800', fontSize: 15 }}>{t(c.isFollowing ? 'community.following' : 'community.follow')}</Text>
        </Pressable>
      )}
    </>
  );

  const tabBtn = (k: typeof tab, label: string) => {
    const on = tab === k;
    return (
      <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { borderBottomColor: on ? text : border }]}>
        <Text style={{ color: on ? text : textSecondary, fontWeight: on ? '800' : '600', fontSize: 15 }}>{label}</Text>
      </Pressable>
    );
  };
  const tabs = (
    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
      {tabBtn('posts', t('community.tabPosts'))}
      {tabBtn('reposts', t('community.tabReposts'))}
      {tabBtn('playlists', t('community.tabPlaylists'))}
    </View>
  );
  const repostList =
    reposts === null ? (
      <ActivityIndicator color={accent} style={{ marginTop: 30 }} />
    ) : reposts.length === 0 ? (
      <Text style={{ color: textSecondary, marginTop: 24 }}>{t('community.noReposts')}</Text>
    ) : (
      reposts.map((p, i) => <PostCard key={p.id} post={{ ...p, repostedBy: undefined }} showDivider={i < reposts.length - 1} />)
    );
  const playlistList =
    lists === null ? (
      <ActivityIndicator color={accent} style={{ marginTop: 30 }} />
    ) : lists.length === 0 ? (
      <Text style={{ color: textSecondary, marginTop: 24 }}>{t('community.noShared')}</Text>
    ) : (
      <PlaylistRows
        items={lists.map((l) => ({
          key: l.id,
          title: l.title,
          subtitle: t('community.songsCount', { n: l.count }),
          thumb: l.cover,
          onPress: () => push({ type: 'collection', source: 'shared', kind: 'playlist', id: l.id, title: l.title, thumb: l.cover }),
        }))}
      />
    );

  const postsOnly =
    posts === null ? (
      failed ? null : <ActivityIndicator color={accent} style={{ marginTop: 30 }} />
    ) : posts.length === 0 ? (
      <Text style={{ color: textSecondary, marginTop: 24 }}>{t('community.noUserPosts')}</Text>
    ) : (
      posts.map((p, i) => <PostCard key={p.id} post={p} showDivider={i < posts.length - 1} />)
    );
  const postList = (
    <>
      {tabs}
      {tab === 'posts' ? postsOnly : tab === 'reposts' ? repostList : playlistList}
    </>
  );

  const status =
    card === 'missing' ? (
      <Text style={{ color: textSecondary, marginTop: 30, textAlign: 'center' }}>{t('community.notFound')}</Text>
    ) : failed ? (
      <Pressable onPress={load} style={{ marginTop: 30, alignItems: 'center' }}>
        <Text style={{ color: textSecondary }}>{t('community.loadFailed')}</Text>
      </Pressable>
    ) : !c ? (
      <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
    ) : null;

  // Màn hình ngang: trái là thẻ hồ sơ (cố định), phải là các bài đăng (cuộn riêng)
  if (landscape) {
    return (
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        <ScrollView style={{ flex: 0.42 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: pad.top + 10, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16 }}>
          <View style={styles.landCard}>
            {cover('100%')}
            <View style={{ position: 'absolute', top: 10, left: 10 }}>{backBtn}</View>
          </View>
          <View style={{ marginTop: -50, paddingHorizontal: 10 }}>{identity}</View>
          {status}
        </ScrollView>
        <ScrollView style={{ flex: 0.58 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: pad.top + 10, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16 }}>
          {c && postList}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView style={StyleSheet.absoluteFill} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
      {cover(COVER_H + pad.top)}
      <View style={{ position: 'absolute', top: pad.top + 6, left: 14 }}>{backBtn}</View>
      <View style={{ marginTop: -50, paddingHorizontal: 18 }}>
        {identity}
        {status}
        <View style={{ marginTop: 18 }}>{c && postList}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  followBtn: { marginTop: 14, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, alignSelf: 'flex-start', minWidth: 150 },
  landCard: { height: 190, borderRadius: 22, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1.5 },
});
