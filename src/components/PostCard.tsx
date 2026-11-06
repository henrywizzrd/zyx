import React, { useState } from 'react';
import { Image, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useProfile } from '../data/profile';
import { usePlayerPick } from '../player/PlayerProvider';
import { useNav } from '../nav/Nav';
import { Attachment, deletePost, Post, timeAgo, toggleLikePost } from '../data/social';
import { SmartImage } from './Cover';
import { useActionSheet } from './ActionSheet';
import { CommentsSheet } from './CommentsSheet';
import { emitPostPatch, NeedAccount, setLike } from '../data/community';

const AVATAR = 38;

// Ảnh nhỏ của thứ đính kèm: ảnh thật nếu có, không thì ô màu có biểu tượng (nghệ sĩ: hình tròn)
export function AttachThumb({ a, size }: { a: Attachment; size: number }) {
  const { theme } = useTheme();
  const r = a.kind === 'artist' ? size / 2 : 6;
  if (a.thumb) {
    return <SmartImage url={a.thumb} size={Math.round(size * PixelRatio.get())} style={{ width: size, height: size, borderRadius: r, backgroundColor: theme.colors.surface }} />;
  }
  const liked = a.source === 'liked';
  const icon = liked ? 'heart' : a.kind === 'song' ? 'musical-note' : a.kind === 'album' ? 'disc' : a.kind === 'artist' ? 'person' : 'musical-notes';
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: liked ? '#5B3CC4' : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.42} color={liked ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary} />
    </View>
  );
}

// Bấm vào thứ đính kèm: bài hát thì phát, còn lại thì mở trang tương ứng
export function useOpenAttachment() {
  const { push } = useNav();
  const { playTrack } = usePlayerPick('playTrack');
  const { toast } = useActionSheet();
  const t = useT();
  return (a: Attachment) => {
    if (a.id === 'demo') return toast(t('social.demo'));
    if (a.kind === 'song') {
      if (a.track) playTrack(a.track);
      return;
    }
    if (a.kind === 'artist') return push({ type: 'artist', id: a.id, name: a.title, thumb: a.thumb });
    if (a.source === 'liked') return push({ type: 'collection', source: 'liked', kind: 'playlist', id: 'liked', title: a.title });
    if (a.source === 'local') return push({ type: 'collection', source: 'local', kind: 'playlist', id: a.id, title: a.title, thumb: a.thumb });
    push({ type: 'collection', source: 'yt', kind: a.kind, id: a.id, title: a.title, thumb: a.thumb });
  };
}

// Thẻ đính kèm trong bài đăng (và trong ô soạn bài)
export function AttachmentCard({ a, onPress, onRemove }: { a: Attachment; onPress?: () => void; onRemove?: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const { text, textSecondary, border } = theme.colors;
  const kindLabel = t(a.kind === 'song' ? 'social.kindSong' : a.kind === 'album' ? 'kind.album' : a.kind === 'artist' ? 'kind.artist' : 'kind.playlist');
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.attach, { borderColor: border }]}>
      <AttachThumb a={a} size={52} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: text, fontSize: 15, fontWeight: '700' }}>{a.title}</Text>
        <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>
          {kindLabel}
          {a.subtitle ? ` • ${a.subtitle}` : ''}
        </Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10}>
          <Ionicons name="close-circle" size={22} color={textSecondary} />
        </Pressable>
      ) : (
        <Ionicons name={a.kind === 'song' ? 'play-circle' : 'chevron-forward'} size={a.kind === 'song' ? 30 : 18} color={a.kind === 'song' ? theme.colors.accent : textSecondary} />
      )}
    </Pressable>
  );
}

// Một bài đăng kiểu Threads: avatar bên trái, tên #tag · thời gian, nội dung, thứ đính kèm, hàng nút
export function PostCard({ post, showDivider = true }: { post: Post; showDivider?: boolean }) {
  const { theme } = useTheme();
  const t = useT();
  const profile = useProfile();
  const sheet = useActionSheet();
  const openAttach = useOpenAttachment();
  const { text, textSecondary, border, accent } = theme.colors;
  const { push } = useNav();
  const mine = !post.author;
  const author = post.author ?? { name: profile.name, tag: profile.tag, color: profile.avatarColor, avatar: profile.avatar ?? undefined };
  const soon = () => sheet.toast(t('social.soon'));
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Bấm avatar / tên người khác: mở hồ sơ của họ
  const openUser = (id?: string) => id && push({ type: 'user', id });

  const menu = () =>
    sheet.openActions({ title: t('social.post'), subtitle: post.text.slice(0, 60) || undefined, icon: 'chatbubble-ellipses-outline' }, [
      {
        label: t('social.delete'),
        icon: 'trash-outline',
        destructive: true,
        run: () => {
          deletePost(post.id);
          emitPostPatch({ id: post.id, deleted: true });
        },
      },
    ]);

  // Thích: bài trên server thì lưu trên server (ai cũng thấy số lượt thích), đổi ngay trên màn hình rồi mới gửi
  const like = () => {
    if (!post.remote) return mine ? toggleLikePost(post.id) : soon();
    const liked = !post.liked;
    const likes = Math.max(0, post.likes + (liked ? 1 : -1));
    emitPostPatch({ id: post.id, liked, likes });
    setLike(post.id, liked).catch((e) => {
      emitPostPatch({ id: post.id, liked: post.liked, likes: post.likes });
      sheet.toast(t(e instanceof NeedAccount ? 'community.needAccount' : 'community.failed'));
    });
  };
  const comment = () => (post.remote ? setCommentsOpen(true) : soon());

  return (
    <View style={[styles.post, showDivider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
      <Pressable onPress={() => openUser(post.author?.id)} disabled={!post.author?.id} style={[styles.avatar, { backgroundColor: author.color }]}>
        {author.avatar ? (
          <Image source={{ uri: author.avatar }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{author.name.slice(0, 1).toUpperCase()}</Text>
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} onPress={post.author?.id ? () => openUser(post.author?.id) : undefined} style={{ color: text, fontWeight: '700', fontSize: 15, flexShrink: 1 }}>
            {author.name}
            <Text style={{ color: textSecondary, fontWeight: '500' }}> #{author.tag}</Text>
          </Text>
          <Text style={{ color: textSecondary, fontSize: 13, marginLeft: 6 }}>· {timeAgo(post.createdAt, theme.language)}</Text>
          <View style={{ flex: 1 }} />
          {mine && (
            <Pressable onPress={menu} hitSlop={10}>
              <Ionicons name="ellipsis-horizontal" size={18} color={textSecondary} />
            </Pressable>
          )}
        </View>
        {!!post.text && <Text style={{ color: text, fontSize: 15, lineHeight: 21, marginTop: 4 }}>{post.text}</Text>}
        {post.attach && (
          <View style={{ marginTop: 10 }}>
            <AttachmentCard a={post.attach} onPress={() => openAttach(post.attach!)} />
          </View>
        )}
        <View style={styles.actions}>
          <Pressable onPress={like} hitSlop={8} style={styles.action}>
            <Ionicons name={post.liked ? 'heart' : 'heart-outline'} size={20} color={post.liked ? '#E5484D' : textSecondary} />
            {post.likes > 0 && <Text style={{ color: textSecondary, fontSize: 13 }}>{post.likes}</Text>}
          </Pressable>
          <Pressable onPress={comment} hitSlop={8} style={styles.action}>
            <Ionicons name="chatbubble-outline" size={19} color={textSecondary} />
            {!!post.comments && <Text style={{ color: textSecondary, fontSize: 13 }}>{post.comments}</Text>}
          </Pressable>
          <Pressable onPress={soon} hitSlop={8} style={styles.action}>
            <Ionicons name="repeat" size={21} color={post.author ? accent : textSecondary} />
          </Pressable>
          <Pressable onPress={soon} hitSlop={8} style={styles.action}>
            <Ionicons name="paper-plane-outline" size={19} color={textSecondary} />
          </Pressable>
        </View>
      </View>
      {commentsOpen && (
        <CommentsSheet
          postId={post.id}
          postMine={mine}
          visible
          onClose={() => setCommentsOpen(false)}
          onOpenUser={(id) => {
            setCommentsOpen(false);
            openUser(id);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  post: { flexDirection: 'row', gap: 12, paddingVertical: 14 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 10 },
  actions: { flexDirection: 'row', gap: 22, marginTop: 12, alignItems: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
