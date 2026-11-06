import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useScreenSize } from './ScreenSize';
import { addComment, Comment, deleteComment, emitPostPatch, fetchComments } from '../data/community';
import { currentAccount } from '../data/auth';
import { timeAgo } from '../data/social';
import { useProfile } from '../data/profile';

// Bảng bình luận của một bài đăng (nổi lên từ dưới). Ai cũng đọc được, có tài khoản mới viết được.
// Người viết xoá được bình luận của mình; chủ bài xoá được mọi bình luận trong bài của mình
export function CommentsSheet({ postId, postMine, visible, onClose, onOpenUser }: {
  postId: string;
  postMine: boolean;
  visible: boolean;
  onClose: () => void;
  onOpenUser?: (id: string) => void;
}) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useScreenSize();
  const me = currentAccount();
  const profile = useProfile();
  const { text, textSecondary, border, accent, surface, onAccent } = theme.colors;
  const [list, setList] = useState<Comment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => {
    setFailed(false);
    fetchComments(postId)
      .then((l) => {
        setList(l);
        emitPostPatch({ id: postId, comments: l.length });
      })
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    if (visible) load();
  }, [visible, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addComment(postId, body);
      setDraft('');
      load();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };
  const remove = async (c: Comment) => {
    setList((l) => (l ? l.filter((x) => x.id !== c.id) : l));
    try {
      await deleteComment(c.id);
      load();
    } catch {
      load();
    }
  };

  const cardW = Math.min(width - 16, 620);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1 }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <View style={[styles.card, { width: cardW, maxHeight: height * 0.78, backgroundColor: theme.colors.bg, borderColor: border, paddingBottom: Math.max(10, insets.bottom) }]}>
            <View style={[styles.grab, { backgroundColor: textSecondary }]} />
            <View style={styles.head}>
              <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '800' }}>{t('community.comments')}</Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={textSecondary} />
              </Pressable>
            </View>
            {list === null && !failed ? (
              <ActivityIndicator color={accent} style={{ marginVertical: 30 }} />
            ) : failed && !list ? (
              <Pressable onPress={load} style={{ padding: 30, alignItems: 'center' }}>
                <Text style={{ color: textSecondary }}>{t('community.loadFailed')}</Text>
              </Pressable>
            ) : (
              <FlatList
                data={list ?? []}
                keyExtractor={(c) => c.id}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
                ListEmptyComponent={<Text style={{ color: textSecondary, textAlign: 'center', marginVertical: 26 }}>{t('community.noComments')}</Text>}
                renderItem={({ item: c }) => {
                  const canDelete = !!me && (c.userId === me.id || postMine);
                  return (
                    <View style={styles.row}>
                      <Pressable onPress={() => c.userId !== me?.id && onOpenUser?.(c.userId)} style={[styles.avatar, { backgroundColor: c.author.color }]}>
                        {c.author.avatar ? (
                          <Image source={{ uri: c.author.avatar }} style={StyleSheet.absoluteFill} />
                        ) : (
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{c.author.name.slice(0, 1).toUpperCase()}</Text>
                        )}
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: text, fontWeight: '700', fontSize: 14 }}>
                          {c.author.name}
                          <Text style={{ color: textSecondary, fontWeight: '500' }}> #{c.author.tag} · {timeAgo(c.createdAt, theme.language)}</Text>
                        </Text>
                        <Text style={{ color: text, fontSize: 15, lineHeight: 20, marginTop: 2 }}>{c.text}</Text>
                      </View>
                      {canDelete && (
                        <Pressable onPress={() => remove(c)} hitSlop={10}>
                          <Ionicons name="trash-outline" size={17} color={textSecondary} />
                        </Pressable>
                      )}
                    </View>
                  );
                }}
              />
            )}
            {me ? (
              <View style={[styles.inputRow, { borderTopColor: border }]}>
                <View style={[styles.avatar, { width: 32, height: 32, backgroundColor: profile.avatarColor }]}>
                  {profile.avatar ? <Image source={{ uri: profile.avatar }} style={StyleSheet.absoluteFill} /> : null}
                </View>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t('community.writeComment')}
                  placeholderTextColor={textSecondary}
                  maxLength={500}
                  multiline
                  style={[styles.input, { color: text, backgroundColor: surface }]}
                />
                <Pressable onPress={send} disabled={!draft.trim() || sending} style={[styles.send, { backgroundColor: accent, opacity: draft.trim() ? 1 : 0.4 }]}>
                  {sending ? <ActivityIndicator color={onAccent} size="small" /> : <Ionicons name="arrow-up" size={20} color={onAccent} />}
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: textSecondary, textAlign: 'center', paddingVertical: 12 }}>{t('community.needAccount')}</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, opacity: 0.5, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, alignItems: 'flex-start' },
  avatar: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 38, maxHeight: 110, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 15 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
