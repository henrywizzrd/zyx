import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useProfile } from '../data/profile';
import { useLibrary, LibraryEntry } from '../data/library';
import { getLikedTracks, getPlaylists, getPlaylistTracks } from '../data/db';
import { Attachment, createPost, POST_MAX } from '../data/social';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import type { Track } from '../data/mock';
import { AttachmentCard, AttachThumb } from './PostCard';

// Ô soạn bài mới cho tab Trang chủ của Profile:
//  - chữ thuần, tối đa 500 ký tự (không đăng ảnh để bảng tin gọn, đỡ rối)
//  - đính kèm được 1 thứ: bài hát (trong playlist của mình hoặc tìm trên YouTube Music), playlist, album hoặc nghệ sĩ
// Mở dạng tấm trượt lên từ dưới (iOS: tấm bo góc, phía sau lùi lại như app Threads)

const entryToAttach = (e: LibraryEntry, likedTitle: string): Attachment => {
  if (e.kind === 'liked') return { kind: 'playlist', id: 'liked', title: likedTitle, subtitle: e.subtitle, source: 'liked' };
  if (e.kind === 'local') return { kind: 'playlist', id: e.id, title: e.title, subtitle: e.subtitle, thumb: e.thumb, source: 'local' };
  return { kind: e.kind, id: e.id, title: e.title, subtitle: e.subtitle, thumb: e.thumb, source: 'yt' };
};
const trackToAttach = (tr: Track): Attachment => ({ kind: 'song', id: tr.id, title: tr.title, subtitle: tr.artist, thumb: tr.thumb, source: 'yt', track: tr });

// Mọi bài hát mình có trong máy: Liked Songs + các playlist tự tạo (không trùng)
function myTracks(): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  const add = (tr: Track) => {
    if (!seen.has(tr.id)) {
      seen.add(tr.id);
      out.push(tr);
    }
  };
  getLikedTracks().forEach(add);
  for (const p of getPlaylists()) getPlaylistTracks(p.id).forEach(add);
  return out;
}

export function PostComposer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const profile = useProfile();
  const { text, textSecondary, accent, onAccent, border, surface, bg } = theme.colors;

  const [body, setBody] = useState('');
  const [attach, setAttach] = useState<Attachment | undefined>();
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (visible) {
      setBody('');
      setAttach(undefined);
      setPicking(false);
    }
  }, [visible]);

  const canPost = body.trim().length > 0 || !!attach;
  const post = () => {
    if (!canPost) return;
    createPost(body, attach);
    onClose();
  };
  const left = POST_MAX - body.length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: bg }}>
        {/* Thanh trên: Huỷ | Bài mới | Đăng */}
        <View style={[styles.top, { borderBottomColor: border, paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10 }]}>
          <Pressable onPress={picking ? () => setPicking(false) : onClose} hitSlop={10}>
            <Text style={{ color: text, fontSize: 16 }}>{picking ? t('social.back') : t('common.cancel')}</Text>
          </Pressable>
          <Text style={{ color: text, fontSize: 16, fontWeight: '800' }}>{picking ? t('social.attachTitle') : t('social.newPost')}</Text>
          {picking ? (
            <View style={{ width: 50 }} />
          ) : (
            <Pressable onPress={post} disabled={!canPost} style={[styles.postBtn, { backgroundColor: accent, opacity: canPost ? 1 : 0.35 }]}>
              <Text style={{ color: onAccent, fontWeight: '800' }}>{t('social.publish')}</Text>
            </Pressable>
          )}
        </View>

        {picking ? (
          <AttachPicker
            onPick={(a) => {
              setAttach(a);
              setPicking(false);
            }}
          />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
                {profile.avatar ? (
                  <Image source={{ uri: profile.avatar }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{profile.name.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: text, fontWeight: '700', fontSize: 15 }}>
                  {profile.name}
                  <Text style={{ color: textSecondary, fontWeight: '500' }}> #{profile.tag}</Text>
                </Text>
                <TextInput
                  value={body}
                  onChangeText={(v) => setBody(v.slice(0, POST_MAX))}
                  placeholder={t('social.placeholder')}
                  placeholderTextColor={textSecondary}
                  multiline
                  autoFocus
                  maxLength={POST_MAX}
                  style={{ color: text, fontSize: 16, lineHeight: 22, marginTop: 4, minHeight: 80, textAlignVertical: 'top' }}
                />
                {attach ? (
                  <View style={{ marginTop: 10 }}>
                    <AttachmentCard a={attach} onRemove={() => setAttach(undefined)} />
                  </View>
                ) : (
                  <Pressable onPress={() => setPicking(true)} style={[styles.attachBtn, { backgroundColor: surface }]}>
                    <Ionicons name="musical-notes" size={16} color={text} />
                    <Text style={{ color: text, fontWeight: '600' }}>{t('social.attach')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        )}

        {!picking && (
          <View style={[styles.bottom, { borderTopColor: border, paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Text style={{ color: textSecondary, fontSize: 13 }}>{t('social.textOnly')}</Text>
            <Text style={{ color: left < 50 ? '#E5484D' : textSecondary, fontSize: 13, fontWeight: '600' }}>{left}</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Chọn thứ để đính kèm: thư viện của mình + bài hát của mình, gõ chữ thì tìm thêm trên YouTube Music
function AttachPicker({ onPick }: { onPick: (a: Attachment) => void }) {
  const { theme } = useTheme();
  const t = useT();
  const { text, textSecondary, surface, accent } = theme.colors;
  const library = useLibrary();
  const mine = useMemo(() => myTracks(), []);
  const [q, setQ] = useState('');
  const [online, setOnline] = useState<Attachment[]>([]);
  const [searching, setSearching] = useState(false);

  const query = q.trim().toLowerCase();
  const has = (s: string) => s.toLowerCase().includes(query);
  const libItems = library
    .map((e) => entryToAttach(e, t('lib.liked')))
    .filter((a) => !query || has(a.title));
  const songItems = mine.filter((tr) => !query || has(tr.title) || has(tr.artist)).slice(0, query ? 30 : 15).map(trackToAttach);

  // Tìm trên YouTube Music (đợi ngừng gõ một chút)
  useEffect(() => {
    if (!musicSupported || query.length < 2) {
      setOnline([]);
      return;
    }
    let dead = false;
    const id = setTimeout(() => {
      setSearching(true);
      ytmusic()
        .searchMusic(q.trim(), 'all')
        .then((r) => {
          if (dead) return;
          const out: Attachment[] = [
            ...r.songs.slice(0, 8).map((s) => trackToAttach(toTrack(s))),
            ...r.albums.slice(0, 4).map((c) => ({ kind: 'album' as const, id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb, source: 'yt' as const })),
            ...r.artists.slice(0, 4).map((c) => ({ kind: 'artist' as const, id: c.id, title: c.title, subtitle: c.subtitle, thumb: c.thumb, source: 'yt' as const })),
          ];
          setOnline(out);
        })
        .catch(() => !dead && setOnline([]))
        .finally(() => !dead && setSearching(false));
    }, 350);
    return () => {
      dead = true;
      clearTimeout(id);
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (a: Attachment, key: string) => (
    <Pressable key={key} onPress={() => onPick(a)} style={styles.row}>
      <AttachThumb a={a} size={46} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: text, fontSize: 15, fontWeight: '600' }}>{a.title}</Text>
        <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>
          {t(a.kind === 'song' ? 'social.kindSong' : a.kind === 'album' ? 'kind.album' : a.kind === 'artist' ? 'kind.artist' : 'kind.playlist')}
          {a.subtitle ? ` • ${a.subtitle}` : ''}
        </Text>
      </View>
      <Ionicons name="add-circle-outline" size={22} color={accent} />
    </Pressable>
  );
  const section = (title: string) => <Text style={[styles.section, { color: text }]}>{title}</Text>;

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.search, { backgroundColor: surface }]}>
        <Ionicons name="search" size={16} color={textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder={t('social.searchAttach')}
          placeholderTextColor={textSecondary}
          style={{ flex: 1, color: text, paddingVertical: 10, marginLeft: 8 }}
        />
        {searching && <ActivityIndicator size="small" color={textSecondary} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        {libItems.length > 0 && section(t('social.fromLibrary'))}
        {libItems.map((a) => row(a, `lib:${a.source}:${a.kind}:${a.id}`))}
        {songItems.length > 0 && section(t('social.mySongs'))}
        {songItems.map((a) => row(a, `my:${a.id}`))}
        {online.length > 0 && section(t('social.onYouTube'))}
        {online.map((a) => row(a, `yt:${a.kind}:${a.id}`))}
        {libItems.length + songItems.length + online.length === 0 && !searching && (
          <Text style={{ color: textSecondary, marginTop: 24, textAlign: 'center' }}>{t(query ? 'lib.noResults' : 'social.attachHint')}</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  postBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16 },
  avatar: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginTop: 12 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 12, margin: 16, marginBottom: 4 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 18, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
});
