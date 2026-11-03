import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, PixelRatio, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useSongMenu } from '../components/useSongMenu';
import { SheetAction, useActionSheet } from '../components/ActionSheet';
import { SmartImage } from '../components/Cover';
import { CollectionPage, useNav } from '../nav/Nav';
import { Translate, useT } from '../i18n';
import { useAnimatedBack, useEntered } from '../nav/SwipeBack';
import type { Track } from '../data/mock';
import type { Collection } from '../music/ytmusic';
import { musicSupported, toTrack, ytmusic } from '../music/lazy';
import {
  deletePlaylist, getLikedTracks, getPlaylist, getPlaylistTracks, isSaved, PlayContext, removeFromPlaylist,
  renamePlaylist, setPlaylistPublic, setSaved, useDbVersion,
} from '../data/db';

type Row = Track & { position?: number };
type Info = { title: string; subtitle: string; thumb?: string; owner?: Collection['owner'] };

const fmtTotal = (sec: number, t: Translate) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? t('col.hours', { h: Math.floor(m / 60), m: m % 60 }) : t('col.minutes', { m });
};

// Trang danh sách bài (kiểu trang album của Spotify):
//  - ảnh bìa lớn tràn ngang ở trên, cạnh dưới tan dần vào nền; tên album ở giữa, nghệ sĩ (ảnh tròn nhỏ + tên), loại • năm
//  - hàng nút: trộn bài | Phát | lưu vào Thư viện
//  - danh sách bài: tên + nghệ sĩ, dấu tích xanh nếu đã thích, nút ... mở bảng thao tác
//  - cuối trang: số bài • tổng thời lượng
// Dùng cho: playlist / album trên YouTube Music, Liked Songs, playlist tự tạo
export function CollectionScreen({ page }: { page: CollectionPage }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const { width } = useWindowDimensions();
  const { push, pop } = useNav();
  const goBack = useAnimatedBack() ?? pop; // trượt ra rồi mới đóng
  // Trượt vào xong mới dựng hết danh sách (trước đó chỉ vài bài đầu) để hiệu ứng mở trang không bị khựng
  const entered = useEntered();
  const { track, playTrack, shuffle, toggleShuffle, liked, addToQueue } = usePlayer();
  const songMenu = useSongMenu();
  const sheet = useActionSheet();
  const dbv = useDbVersion();
  const { text, textSecondary, accent, surface, border, bg } = theme.colors;

  const [rows, setRows] = useState<Row[]>([]);
  const [info, setInfo] = useState<Info>({ title: page.title, subtitle: '', thumb: page.thumb });
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [isPublic, setIsPublic] = useState(false);
  const [retry, setRetry] = useState(0);

  // Playlist / album YouTube: tải qua mạng (một lần)
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
        setInfo({ title: c.title || page.title, subtitle: c.subtitle, thumb: c.thumb ?? page.thumb, owner: c.owner });
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
      setRows(getPlaylistTracks(page.id));
      setInfo({ title: p.title, subtitle: t(p.isPublic ? 'col.public' : 'col.private'), thumb: p.thumb });
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

  const local = page.source === 'local';
  const yt = page.source === 'yt';
  const isAlbum = yt && page.kind === 'album';

  // Album / playlist YouTube: lưu vào Thư viện
  const saved = useMemo(() => yt && isSaved(page.kind, page.id), [page, dbv, yt]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSaved = () => {
    setSaved({ kind: page.kind, id: page.id, title: info.title, subtitle: info.subtitle, thumb: info.thumb }, !saved);
    sheet.toast(t(saved ? 'toast.unsaved' : 'toast.saved'));
  };

  const openOwner = () => {
    if (info.owner?.id) push({ type: 'artist', id: info.owner.id, name: info.owner.name, thumb: info.owner.thumb });
  };
  const rename = () =>
    sheet.openInput({ title: t('col.renameTitle'), initial: info.title, submit: t('sheet.save'), onSubmit: (v) => v.trim() && renamePlaylist(page.id, v.trim()) });
  const confirmDelete = () =>
    sheet.openActions({ title: t('col.deleteTitle'), subtitle: t('col.deleteMsg', { title: info.title }), thumb: info.thumb, icon: 'trash-outline' }, [
      { label: t('col.deleteAction'), icon: 'trash-outline', destructive: true, run: () => { deletePlaylist(page.id); pop(); } },
    ]);

  // Nút ... góc trên phải: các việc với cả album / playlist
  const openMore = () => {
    const actions: SheetAction[] = [];
    if (yt) {
      actions.push({ label: t(saved ? 'sheet.removeLibrary' : 'sheet.addLibrary'), icon: saved ? 'checkmark-circle' : 'add-circle-outline', on: saved, run: toggleSaved });
    }
    if (rows.length) {
      actions.push({
        label: t('col.addAllQueue'),
        icon: 'list-outline',
        run: () => {
          rows.forEach((r) => addToQueue(r));
          sheet.toast(t('toast.queued'));
        },
      });
    }
    if (yt) {
      const url = page.kind === 'album' ? `https://music.youtube.com/browse/${page.id}` : `https://music.youtube.com/playlist?list=${page.id}`;
      actions.push({ label: t('sheet.share'), icon: 'share-outline', run: () => void Share.share({ message: `${info.title}\n${url}` }).catch(() => {}) });
      if (info.owner?.id) actions.push({ label: t('sheet.goArtist'), icon: 'person-outline', run: openOwner });
    }
    if (local) {
      actions.push({ label: t('col.rename'), icon: 'pencil-outline', keepOpen: true, run: rename });
      actions.push({
        label: t(isPublic ? 'col.makePrivate' : 'col.makePublic'),
        icon: isPublic ? 'lock-closed-outline' : 'globe-outline',
        run: () => setPlaylistPublic(page.id, !isPublic),
      });
      actions.push({ label: t('col.deleteAction'), icon: 'trash-outline', destructive: true, keepOpen: true, run: confirmDelete });
    }
    sheet.openActions(
      { title: info.title, subtitle: info.owner?.name || info.subtitle, thumb: info.thumb, icon: page.source === 'liked' ? 'heart' : 'musical-notes' },
      actions
    );
  };

  // ---- Phần đầu trang
  const heroH = Math.min(Math.round(width * 1.05), 480);
  const fadeTo = theme.background.type === 'preset' ? bg : bg + '00';
  const imgSize = Math.round(width * PixelRatio.get());
  const meta = [info.subtitle].filter(Boolean).join(' • ');

  const Header = (
    <View>
      <View style={{ height: heroH, marginHorizontal: -(pad.left + 16) }}>
        {info.thumb ? (
          <SmartImage url={info.thumb} size={imgSize} style={StyleSheet.absoluteFill} />
        ) : page.source === 'liked' ? (
          <LinearGradient colors={['#5B3CC4', '#8E6CF0']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="heart" size={120} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="musical-notes" size={96} color={textSecondary} />
          </View>
        )}
        {/* Tối nhẹ ở đỉnh cho nút back dễ thấy, cạnh dưới tan dần vào nền */}
        <LinearGradient colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0)', fadeTo]} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.topBar, { top: pad.top + 6, left: pad.left + 16, right: pad.right + 16 }]}>
          <Pressable onPress={goBack} hitSlop={10} style={styles.glassBtn}>
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={openMore} hitSlop={10} style={styles.glassBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Tên, nghệ sĩ, loại • năm: nằm đè lên phần ảnh đã tan vào nền */}
      <View style={{ alignItems: 'center', marginTop: -96, paddingHorizontal: 8 }}>
        <Text numberOfLines={2} style={[styles.title, { color: text }]}>{info.title}</Text>
        {!!info.owner && (
          <Pressable onPress={openOwner} disabled={!info.owner.id} style={styles.owner}>
            {!!info.owner.thumb && <Image source={{ uri: info.owner.thumb }} style={styles.ownerThumb} />}
            <Text numberOfLines={1} style={{ color: text, fontSize: 17, fontWeight: '600', opacity: 0.9 }}>{info.owner.name}</Text>
          </Pressable>
        )}
        {!!meta && <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 14, marginTop: 6 }}>{meta}</Text>}
      </View>

      {/* Trộn bài | Phát | Lưu */}
      <View style={styles.actions}>
        <Pressable onPress={() => playAll(true)} disabled={!rows.length} style={[styles.roundBtn, { backgroundColor: border }]}>
          <Ionicons name="shuffle" size={24} color={shuffle ? accent : text} />
        </Pressable>
        <Pressable onPress={() => playAll(false)} disabled={!rows.length} style={[styles.playBtn, { backgroundColor: text, opacity: rows.length ? 1 : 0.4 }]}>
          <Ionicons name="play" size={22} color={bg} />
          <Text style={{ color: bg, fontSize: 18, fontWeight: '800' }}>{t('col.play')}</Text>
        </Pressable>
        {yt ? (
          <Pressable onPress={toggleSaved} style={[styles.roundBtn, { backgroundColor: border }]}>
            <Ionicons name={saved ? 'checkmark' : 'add'} size={28} color={saved ? accent : text} />
          </Pressable>
        ) : local ? (
          <Pressable onPress={rename} style={[styles.roundBtn, { backgroundColor: border }]}>
            <Ionicons name="pencil" size={20} color={text} />
          </Pressable>
        ) : (
          <View style={styles.roundBtn} />
        )}
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

  const Footer =
    rows.length > 0 ? (
      <Text style={{ color: textSecondary, fontSize: 14, marginTop: 18 }}>
        {t('col.songs', { n: rows.length })}
        {total > 0 ? ` • ${fmtTotal(total, t)}` : ''}
      </Text>
    ) : undefined;

  const menuFor = (item: Row) =>
    songMenu(
      item,
      local && item.position != null
        ? [{ label: t('col.removeFromPlaylist'), icon: 'remove-circle-outline', destructive: true, run: () => removeFromPlaylist(page.id, item.position!) }]
        : []
    );

  // Mỗi dòng là component riêng (memo): trạng thái nhạc đổi (bấm trộn bài, phát / dừng...) thì chỉ dòng nào thật sự đổi
  // (bài đang phát, dấu tích thích) mới vẽ lại, không vẽ lại cả danh sách như trước
  const handlers = useRef({ play: (_r: Row) => {}, menu: (_r: Row) => {} });
  handlers.current.play = (r: Row) => playTrack(r, rows, ctx);
  handlers.current.menu = menuFor;
  const rowExtra = `${track.id}:${liked.size}:${text}`;
  const renderRow = useCallback(
    ({ item }: { item: Row }) => (
      <SongRow item={item} playing={item.id === track.id} isLiked={liked.has(item.id)} showThumb={!isAlbum} handlers={handlers} colors={theme.colors} />
    ),
    [track.id, liked, isAlbum, theme.colors]
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <FlatList
        data={entered ? rows : rows.slice(0, 6)}
        keyExtractor={(r, i) => `${r.id}:${r.position ?? i}`}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        bounces={false}
        overScrollMode="never"
        initialNumToRender={14}
        contentContainerStyle={{ paddingHorizontal: pad.left + 16, paddingBottom: pad.bottom + pad.endPadding }}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: border }} />}
        extraData={rowExtra}
        renderItem={renderRow}
      />
    </View>
  );
}

type Handlers = React.MutableRefObject<{ play: (r: Row) => void; menu: (r: Row) => void }>;
const SongRow = React.memo(function SongRow({
  item, playing, isLiked, showThumb, handlers, colors,
}: { item: Row; playing: boolean; isLiked: boolean; showThumb: boolean; handlers: Handlers; colors: { text: string; textSecondary: string; accent: string; surface: string } }) {
  return (
    <Pressable onPress={() => handlers.current.play(item)} onLongPress={() => handlers.current.menu(item)} style={styles.row}>
      {/* Album: các bài cùng ảnh bìa nên bỏ ảnh đi (giống Spotify); playlist thì giữ ảnh từng bài */}
      {showThumb &&
        (item.thumb ? (
          <Image source={{ uri: item.thumb }} style={[styles.thumb, { backgroundColor: colors.surface }]} />
        ) : (
          <View style={[styles.thumb, { backgroundColor: colors.surface }]} />
        ))}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: playing ? colors.accent : colors.text, fontSize: 17, fontWeight: '600' }}>{item.title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 14, marginTop: 3 }}>{item.artist}</Text>
      </View>
      {isLiked && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
      <Pressable onPress={() => handlers.current.menu(item)} hitSlop={12} style={styles.more}>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  topBar: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  glassBtn: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)',
  },
  title: { fontSize: 28, fontWeight: '900', textAlign: 'center' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  ownerThumb: { width: 26, height: 26, borderRadius: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 20, marginBottom: 14 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  playBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: 160, height: 52, borderRadius: 26 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  thumb: { width: 48, height: 48, borderRadius: 4 },
  more: { width: 32, alignItems: 'flex-end' },
});
