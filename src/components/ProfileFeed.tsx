import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useProfile } from '../data/profile';
import { sampleReposts, useMyPosts } from '../data/social';
import { PostCard } from './PostCard';
import { currentAccount } from '../data/auth';
import { fetchPosts, onPostPatch } from '../data/community';
import type { Post } from '../data/social';

type Counts = Record<string, Pick<Post, 'likes' | 'liked' | 'comments'>>;
import { PostComposer } from './PostComposer';

type Tab = 'home' | 'reposts' | 'share';

// Phần Profile trong Thư viện (kiểu Threads): 3 tab Trang chủ / Đăng lại / Share
//  - Trang chủ: ô "Có gì mới?" để đăng bài (chữ, tối đa 500 ký tự, đính kèm nhạc) + các bài mình đã đăng
//  - Đăng lại: bài của người khác mình đăng lại (hiện là bài mẫu, chờ có server)
//  - Share: chỗ chia sẻ playlist, bàn thêm sau
export function ProfileFeed() {
  const { theme } = useTheme();
  const t = useT();
  const profile = useProfile();
  const local = useMyPosts();
  // Tài khoản: lấy số lượt thích / bình luận thật trên server ghép vào bài trong máy (người khác thích bài mình cũng thấy)
  const [counts, setCounts] = useState<Counts>({});
  const accId = currentAccount()?.id;
  useEffect(() => {
    if (!accId) return;
    fetchPosts(accId)
      .then((l) => setCounts(Object.fromEntries(l.map((p) => [p.id, { likes: p.likes, liked: p.liked, comments: p.comments }]))))
      .catch(() => {});
  }, [accId, local.length]);
  useEffect(
    () =>
      onPostPatch((p) => {
        if (p.deleted) return;
        setCounts((c) => (c[p.id] ? { ...c, [p.id]: { ...c[p.id], ...p } } : c));
      }),
    []
  );
  const posts = useMemo(() => local.map((p) => (counts[p.id] ? { ...p, ...counts[p.id], remote: true } : p)), [local, counts]);
  const reposts = useMemo(() => sampleReposts(), []);
  const [tab, setTab] = useState<Tab>('home');
  const [composing, setComposing] = useState(false);
  const { text, textSecondary, border, surface } = theme.colors;

  const tabBtn = (k: Tab, label: string) => {
    const on = tab === k;
    return (
      <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { borderBottomColor: on ? text : border }]}>
        <Text style={{ color: on ? text : textSecondary, fontWeight: on ? '800' : '600', fontSize: 15 }}>{label}</Text>
      </Pressable>
    );
  };

  const empty = (icon: React.ComponentProps<typeof Ionicons>['name'], msg: string) => (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={textSecondary} />
      <Text style={{ color: textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>{msg}</Text>
    </View>
  );

  return (
    <View>
      <View style={styles.tabs}>
        {tabBtn('home', t('social.tabHome'))}
        {tabBtn('reposts', t('social.tabReposts'))}
        {tabBtn('share', t('social.tabShare'))}
      </View>

      {tab === 'home' && (
        <View>
          {/* Ô "Có gì mới?": bấm để mở khung soạn bài */}
          <Pressable onPress={() => setComposing(true)} style={[styles.compose, { borderBottomColor: border }]}>
            <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} style={StyleSheet.absoluteFill} />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '800' }}>{profile.name.slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: text, fontWeight: '700' }}>{profile.name}</Text>
              <Text style={{ color: textSecondary, marginTop: 2 }}>{t('social.whatsNew')}</Text>
            </View>
            <View style={[styles.postPill, { backgroundColor: surface }]}>
              <Text style={{ color: text, fontWeight: '700', fontSize: 13 }}>{t('social.publish')}</Text>
            </View>
          </Pressable>
          {posts.length === 0
            ? empty('chatbubbles-outline', t('social.noPosts'))
            : posts.map((p, i) => <PostCard key={p.id} post={p} showDivider={i < posts.length - 1} />)}
        </View>
      )}

      {tab === 'reposts' && (
        <View>
          <Text style={{ color: textSecondary, fontSize: 12, marginTop: 10 }}>{t('social.sampleNote')}</Text>
          {reposts.map((p, i) => (
            <View key={p.id}>
              <View style={styles.repostLabel}>
                <Ionicons name="repeat" size={14} color={textSecondary} />
                <Text style={{ color: textSecondary, fontSize: 12, fontWeight: '600' }}>{t('social.youReposted')}</Text>
              </View>
              <PostCard post={p} showDivider={i < reposts.length - 1} />
            </View>
          ))}
        </View>
      )}

      {tab === 'share' && empty('share-social-outline', t('social.shareSoon'))}

      <PostComposer visible={composing} onClose={() => setComposing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1.5 },
  compose: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  postPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  repostLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginLeft: 50 },
});
