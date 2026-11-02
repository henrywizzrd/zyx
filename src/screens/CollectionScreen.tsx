import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useSongMenu } from '../components/useSongMenu';
import { CollectionPage, useNav } from '../nav/Nav';
import { Translate, useT } from '../i18n';
import { useAnimatedBack } from '../nav/SwipeBack';
import { PageBackground } from '../components/AppBackground';
import type { Track } from '../data/mock';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import {
  deletePlaylist, getLikedTracks, getPlaylist, getPlaylistTracks, PlayContext, removeFromPlaylist,
  renamePlaylist, setPlaylistPublic, useDbVersion,
} from '../data/db';

type Row = Track & { position?: number };
const fmtTotal = (sec: number, t: Translate) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? t('col.hours', { h: Math.floor(m / 60), m: m % 60 }) : t('col.minutes', { m });
};

// Trang danh sách bài: playlist / album trên YouTube Music, Liked Songs, hoặc playlist tự tạo
export function CollectionScreen({ page }: { page: CollectionPage }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop; // trượt ra rồi mới đóng
  const { track, playTrack, shuffle, toggleShuffle } = usePlayer();
  const songMenu = useSongMenu();
  const dbv = useDbVersion();
  const { text, textSecondary, accent, surface } = theme.colors;

  const [rows, setRows] = useState<Row[]>([]);
  const [info, setInfo] = useState<{ title: string; subtitle: string; thumb?: string }>({ title: page.title, subtitle: '', thumb: page.thumb });
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [isPublic, setIsPublic] = useState(false);
  const [retry, setRetry] = useState(0);

  // Playlist YouTube: tải qua mạng (một lần)
  useEffect(() => {
    if (page.source !== 'yt') return;
    if (!musicSupported) return setStatus('error');
    let dead = false;
    setStatus('loading');
    ytmusic()
      .getCollection(page.kind, page.id)
      .then((c) => {
        if (dead) return;
        setRows(c.songs.map(toTrack));
        setInfo({ title: c.title || page.title, subtitle: c.subtitle, thumb: c.thumb ?? page.thumb });
        setStatus('done');
      })
      .catch((e) => {
        console.warn('[collection]', e);
        if (!dead) setStatus('error');
      });
    return () => {
      dead = true;
    };
  }, [page, retry]);

  // Liked Songs / playlist tự tạo: đọc từ máy, tự cập nhật khi dữ liệu đổi
  useEffect(() => {
    if (page.source === 'liked') {
      const list = getLikedTracks();
      setRows(list);
      setInfo({ title: t('home.liked'), subtitle: t('col.songs', { n: list.length }), thumb: undefined });
      setStatus('done');
    } else if (page.source === 'local') {
      const p = getPlaylist(page.id);
      if (!p) return pop(); // playlist đã bị xoá
      const list = getPlaylistTracks(page.id);
      setRows(list);
      setInfo({ title: p.title, subtitle: `${t('col.songs', { n: p.count })} • ${t(p.isPublic ? 'col.public' : 'col.private')}`, thumb: p.thumb });
      setIsPublic(p.isPublic);
      setStatus('done');
    }
  }, [page, dbv, pop, t]);

  const ctx = useMemo<PlayContext>(() => {
    if (page.source === 'liked') return { kind: 'liked', id: 'liked', title: t('home.liked') };
    if (page.source === 'local') return { kind: 'local', id: page.id, title: info.title, thumb: info.thumb };
    return { kind: page.kind, id: page.id, title: info.title, thumb: info.thumb };
  }, [page, info.title, info.thumb, t]);

  const total = rows.reduce((s, r) => s + (r.duration || 0), 0);
  const playAll = useCallback(
    (shuffled: boolean) => {
      if (!rows.length) return;
      if (shuffled !== shuffle) toggleShuffle();
      const first = shuffled ? rows[Math.floor(Math.random() * rows.length)] : rows[0];
      playTrack(first, rows, ctx);
    },
    [rows, shuffle, toggleShuffle, playTrack, ctx]
  );

  // Các việc riêng của playlist tự tạo
  const local = page.source === 'local';
  const rename = () => {
    if (Platform.OS !== 'ios') return Alert.alert(t('col.rename'), t('col.renameAndroid'));
    Alert.prompt(t('col.renameTitle'), undefined, (name) => name && renamePlaylist(page.id, name), 'plain-text', info.title);
  };
  const remove = () =>
    Alert.alert(t('col.deleteTitle'), t('col.deleteMsg', { title: info.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { deletePlaylist(page.id); pop(); } },
    ]);

  const Header = (
    <View style={{ paddingTop: pad.top + 8 }}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]}>
          <Ionicons name="chevron-back" size={24} color={text} />
        </Pressable>
        {local && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={rename} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]}>
              <Ionicons name="pencil" size={18} color={text} />
            </Pressable>
            <Pressable onPress={remove} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]}>
              <Ionicons name="trash-outline" size={18} color={text} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={{ alignItems: 'center', marginTop: 8 }}>
        {info.thumb ? (
          <Image source={{ uri: info.thumb }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, { backgroundColor: page.source === 'liked' ? '#5B3CC4' : surface, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name={page.source === 'liked' ? 'heart' : 'musical-notes'} size={64} color={page.source === 'liked' ? 'rgba(255,255,255,0.85)' : textSecondary} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: text }]}>{info.title}</Text>
      {!!info.subtitle && <Text numberOfLines={2} style={{ color: textSecondary, fontSize: 14, marginTop: 4 }}>{info.subtitle}</Text>}
      {rows.length > 0 && (
        <Text style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>
          {t('col.songs', { n: rows.length })}{total > 0 ? ` • ${fmtTotal(total, t)}` : ''}
        </Text>
      )}

      {local && (
        // Cờ công khai: sau này người khác vào profile của cậu sẽ thấy playlist công khai
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 }}>
          <Ionicons name={isPublic ? 'globe-outline' : 'lock-closed-outline'} size={18} color={textSecondary} />
          <Text style={{ color: textSecondary, fontSize: 14, flex: 1 }}>{t(isPublic ? 'col.publicOnProfile' : 'col.onlyMe')}</Text>
          <Switch value={isPublic} onValueChange={(v) => setPlaylistPublic(page.id, v)} trackColor={{ true: accent, false: theme.colors.switchOff }} />
        </View>
      )}

      <View style={styles.actions}>
        <Pressable onPress={() => playAll(true)} hitSlop={8} disabled={!rows.length}>
          <Ionicons name="shuffle" size={28} color={shuffle ? accent : textSecondary} />
        </Pressable>
        <Pressable onPress={() => playAll(false)} disabled={!rows.length} style={[styles.play, { backgroundColor: accent, opacity: rows.length ? 1 : 0.4 }]}>
          <Ionicons name="play" size={28} color={theme.colors.onAccent} style={{ marginLeft: 3 }} />
        </Pressable>
      </View>

      {status === 'loading' && <ActivityIndicator color={accent} style={{ marginTop: 24 }} />}
      {status === 'error' && (
        <Pressable onPress={() => setRetry((r) => r + 1)} style={{ marginTop: 24, alignItems: 'center' }}>
          <Text style={{ color: textSecondary }}>{t('common.loadFailed')}</Text>
        </Pressable>
      )}
      {status === 'done' && rows.length === 0 && (
        <Text style={{ color: textSecondary, marginTop: 24, textAlign: 'center' }}>
          {t(local ? 'col.emptyLocal' : page.source === 'liked' ? 'col.emptyLiked' : 'col.empty')}
        </Text>
      )}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <PageBackground />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.id}:${r.position ?? i}`}
        ListHeaderComponent={Header}
        bounces={false}
        overScrollMode="never"
        initialNumToRender={14}
        contentContainerStyle={{ paddingHorizontal: pad.left + 16, paddingBottom: pad.bottom + pad.endPadding }}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => playTrack(item, rows, ctx)}
            onLongPress={() =>
              songMenu(
                item,
                local && item.position != null
                  ? [{ label: t('col.removeFromPlaylist'), destructive: true, run: () => removeFromPlaylist(page.id, item.position!) }]
                  : []
              )
            }
            style={styles.row}
          >
            {page.kind === 'album' && page.source === 'yt' ? (
              <Text style={{ width: 28, color: textSecondary, fontSize: 15, textAlign: 'center' }}>{index + 1}</Text>
            ) : item.thumb ? (
              <Image source={{ uri: item.thumb }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: surface }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: item.id === track.id ? accent : text, fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{item.artist}</Text>
            </View>
            <Pressable onPress={() => songMenu(item)} hitSlop={10}>
              <Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cover: { width: 220, height: 220, borderRadius: 8 },
  title: { fontSize: 26, fontWeight: '800', marginTop: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 22, marginTop: 10, marginBottom: 8 },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  thumb: { width: 52, height: 52, borderRadius: 4 },
});
