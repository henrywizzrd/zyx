import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isDownloaded, setOnlyDownloaded, useDownloads, useOnlyDownloaded } from '../data/downloads';
import { getLikedTracks, getPlaylistTracks } from '../data/db';
import { Alert, Image, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { holdPortrait, releasePortrait } from '../data/images';
import RNMaskedView from '@react-native-masked-view/masked-view';
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useContentInsets } from '../components/FloatingDock';
import { LibraryLayout } from '../theme/types';
import { followers } from '../data/mock';
import { LibraryEntry, useLibrary } from '../data/library';
import { createPlaylist, getPlaylists } from '../data/db';
import { SmartImage } from '../components/Cover';
import { useNav } from '../nav/Nav';
import { checkNameTag, ensureCoverTone, ImageSlot, PickedImage, pickProfileImage, removeProfileImage, saveCroppedCover, updateProfile, useProfile } from '../data/profile';
import { CoverCropper } from '../components/CoverCropper';
import { ProfileEditSheet } from '../components/ProfileEditSheet';
import { sheet } from '../components/useSongMenu';
import { useFrame } from '../components/layout';
import { Reorderable } from '../components/Reorderable';
import { ReorderableScrollView } from '../components/ReorderableScrollView';
import { ProfileFeed } from '../components/ProfileFeed';
import { StretchyBg } from '../components/Stretchy';
import { useSharedValue } from 'react-native-reanimated';

const H_PAD = 16;
const COVER_H = 520; // chiều cao vùng ảnh bìa: phủ phần đầu trang rồi mờ dần xuống tận danh sách

// Màu "#RRGGBB" thêm độ trong suốt (0..1)
const withAlpha = (hex: string, a: number) => hex.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
// Độ sáng cảm nhận của màu "#RRGGBB" (0 = đen, 1 = trắng)
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

const LAYOUT_ORDER: LibraryLayout[] = ['list', 'columns', 'covers2', 'covers3'];
const LAYOUT_ICON: Record<LibraryLayout, keyof typeof Ionicons.glyphMap> = {
  list: 'list',
  columns: 'grid-outline',
  covers2: 'albums-outline',
  covers3: 'apps-outline',
};

// 'profile': phần Profile kiểu Threads (bài đăng, đăng lại, share) thay cho danh sách thư viện
type Filter = 'all' | 'profile' | 'playlist' | 'album' | 'artist';
type Item = LibraryEntry & { id: string }; // Reorderable cần trường id: dùng key của mục
type Sort = 'recents' | 'alpha';

// Ảnh của một mục trong thư viện: ảnh thật nếu có; Liked Songs là ô tím có trái tim; nghệ sĩ thì ảnh tròn
function CoverBox({ item, size, radius }: { item: LibraryEntry; size: number; radius: number }) {
  const { theme } = useTheme();
  const r = item.kind === 'artist' ? size / 2 : radius;
  if (item.thumb) {
    return (
      <SmartImage
        url={item.thumb}
        size={Math.round(size * PixelRatio.get())}
        style={{ width: size, height: size, borderRadius: r, backgroundColor: theme.colors.surface }}
      />
    );
  }
  const liked = item.kind === 'liked';
  const icon: keyof typeof Ionicons.glyphMap = liked ? 'heart' : item.kind === 'album' ? 'disc' : item.kind === 'artist' ? 'person' : 'musical-notes';
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: liked ? '#5B3CC4' : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={Math.max(16, size * 0.38)} color={liked ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary} />
    </View>
  );
}

export function LibraryScreen() {
  const { theme, landscape, setLibraryLayout, setLibraryOrder } = useTheme();
  const t = useT();
  const profile = useProfile();
  // Cuối dải ảnh bìa: nền màu thì hoà vào màu nền, nền ảnh/video thì mờ hẳn để lộ nền chung
  const [cropImg, setCropImg] = useState<PickedImage | null>(null); // ảnh bìa đang chờ cắt
  const [editOpen, setEditOpen] = useState(false); // popup sửa tên / hashtag
  const cropping = useRef(false);
  // Đóng màn cắt ảnh bìa: mở lại tự xoay
  useEffect(() => {
    if (cropImg) return;
    if (cropping.current) {
      cropping.current = false;
      releasePortrait();
    }
  }, [cropImg]);

  // Bấm avatar / nút đổi ảnh bìa: chọn ảnh, chụp ảnh, hoặc xoá
  const editImage = (slot: ImageSlot) => {
    // iOS: chờ menu đóng hẳn rồi mới mở trình chọn ảnh, mở ngay dễ bị hệ thống chặn
    // Tạm khoá màn hình dọc trong lúc chọn / cắt ảnh (màn cắt ảnh nằm ngang bị khuất), xong thì mở lại tự xoay
    const run = (source: 'library' | 'camera') =>
      new Promise((ok) => setTimeout(ok, Platform.OS === 'ios' ? 350 : 0)).then(() => holdPortrait()).then(() => pickProfileImage(slot, source, (img) => { cropping.current = !!img; setCropImg(img); })).then((r) => {
        if (!cropping.current) releasePortrait();
        if (r === 'denied') Alert.alert(t('profile.takePhoto'), t('profile.cameraDenied'));
        else if (r === 'failed') Alert.alert(t(slot === 'avatar' ? 'profile.avatar' : 'profile.cover'), t('profile.failed'));
      });
    sheet(t, t(slot === 'avatar' ? 'profile.avatar' : 'profile.cover'), undefined, [
      { label: t('profile.fromLibrary'), run: () => run('library') },
      { label: t('profile.takePhoto'), run: () => run('camera') },
      ...(profile[slot] ? [{ label: t('profile.remove'), destructive: true, run: () => removeProfileImage(slot) }] : []),
    ]);
  };
  const pad = useContentInsets();
  const { width, height } = useFrame();
  const scrollY = useSharedValue(0); // để ảnh bìa giãn ra khi kéo quá đầu trang

  const [filter, setFilter] = useState<Filter>('playlist'); // mở Thư viện: mặc định ở mục Playlists (chip sáng)
  const [sort, setSort] = useState<Sort>('recents');
  const library = useLibrary();
  const { push } = useNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const layout = theme.library.layout;
  const innerW = (landscape ? width * 0.6 : width) - H_PAD * 2; // ngang: danh sách nằm ở cột phải 
  const { text, textSecondary, accent, surface } = theme.colors;

  // Màu chữ trên ảnh bìa: tự đổi theo độ sáng của ảnh (ảnh tối → chữ trắng, ảnh sáng → chữ đậm).
  // Chưa có ảnh bìa thì dùng màu chữ của theme như mọi chỗ khác.
  useEffect(() => {
    ensureCoverTone();
  }, [profile.cover]);
  const hasCover = !!profile.cover;
  const lightCover = hasCover && profile.coverTone === 'light';
  // Lấy đúng hai màu của theme: màu sáng và màu tối (chữ và nền của bộ màu, cái nào sáng hơn là "sáng").
  // Ảnh bìa tối → chữ màu sáng của theme; ảnh bìa sáng → chữ màu tối của theme
  const [themeLight, themeDark] = lum(theme.colors.text) > lum(theme.colors.bg) ? [theme.colors.text, theme.colors.bg] : [theme.colors.bg, theme.colors.text];
  const onCover = lightCover ? themeDark : themeLight; // màu chữ trên ảnh
  const underCover = lightCover ? themeLight : themeDark; // màu phủ nhẹ lên ảnh và bóng chữ
  const hero = !hasCover
    ? { text, sub: textSecondary, shadow: 'transparent' }
    : { text: onCover, sub: withAlpha(onCover, 0.75), shadow: withAlpha(underCover, 0.5) };
  const heroShadow = hasCover ? { textShadowColor: hero.shadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 } : null;

  // Áp dụng thứ tự do người dùng tự sắp xếp. Mục mới (chưa có trong thứ tự: vừa lưu, vừa tạo) xếp lên đầu
  const ordered = useMemo<Item[]>(() => {
    const order = theme.library.order;
    const pos = new Map(order.map((id, i) => [id, i] as const));
    return library
      .map((it, i) => ({ it: { ...it, id: it.key }, rank: pos.get(it.key) ?? i - library.length }))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.it);
  }, [theme.library.order, library]);

  const matches = (i: Item) =>
    filter === 'all' ||
    (filter === 'playlist' ? i.kind === 'liked' || i.kind === 'local' || i.kind === 'playlist' : i.kind === filter);

  // Dòng phụ của từng mục: loại + số bài / người tạo
  const subtitleOf = (i: Item) => {
    if (i.kind === 'liked' || i.kind === 'local') return `${t('kind.playlist')} • ${t('col.songs', { n: Number(i.subtitle) || 0 })}`;
    if (i.kind === 'artist') return t('kind.artist');
    const kind = t(i.kind === 'album' ? 'kind.album' : 'kind.playlist');
    return i.subtitle && !i.subtitle.startsWith(kind) ? `${kind} • ${i.subtitle}` : i.subtitle || kind;
  };
  const titleOf = (i: Item) => (i.kind === 'liked' ? t('lib.liked') : i.title);

  const open = (i: Item) => {
    if (i.kind === 'liked') push({ type: 'collection', source: 'liked', kind: 'playlist', id: 'liked', title: t('home.liked') });
    else if (i.kind === 'local') push({ type: 'collection', source: 'local', kind: 'playlist', id: i.id.replace(/^local:/, ''), title: i.title, thumb: i.thumb });
    else if (i.kind === 'artist') push({ type: 'artist', id: i.id.replace(/^artist:/, ''), name: i.title, thumb: i.thumb });
    else push({ type: 'collection', source: 'yt', kind: i.kind, id: i.id.replace(/^(album|playlist):/, ''), title: i.title, thumb: i.thumb });
  };

  const newPlaylist = () => {
    const name = t('home.newPlaylistName', { n: getPlaylists().length + 1 });
    const id = createPlaylist(name);
    push({ type: 'collection', source: 'local', kind: 'playlist', id, title: name });
  };

  // Nút "Đã tải": chỉ giữ Bài hát đã thích / playlist của mình có ít nhất một bài đã tải
  // (album / playlist YouTube đã lưu và nghệ sĩ không có bài nào nằm trong máy nên ẩn đi)
  const onlyDl = useOnlyDownloaded();
  useDownloads(); // tải xong / xoá bài thì vẽ lại, danh sách lọc theo trạng thái mới
  const hasDownloads = (i: Item) => {
    if (i.kind === 'liked') return getLikedTracks().some((x) => isDownloaded(x.id));
    if (i.kind === 'local') return getPlaylistTracks(i.id.replace(/^local:/, '')).some((x) => isDownloaded(x.id));
    return false;
  };
  const baseItems = useMemo(() => {
    let list = ordered.filter(matches);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => titleOf(i).toLowerCase().includes(q));
    if (sort === 'alpha') list = [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    return list;
  }, [ordered, filter, query, sort, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = onlyDl ? baseItems.filter(hasDownloads) : baseItems;

  // Chỉ cho kéo đổi thứ tự khi đang xem đủ danh sách theo thứ tự của mình
  const reorderable = (filter === 'all' || filter === 'playlist') && query.trim() === '' && sort === 'recents' && !onlyDl;

  const cycleLayout = () => {
    const next = LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(layout) + 1) % LAYOUT_ORDER.length];
    setLibraryLayout(next);
  };

  // Kéo đổi thứ tự khi đang lọc (vd chỉ Playlists): đặt lại thứ tự các mục đang hiện vào đúng các chỗ của chúng
  // trong thứ tự chung, các mục bị ẩn (album, nghệ sĩ) giữ nguyên chỗ cũ
  const reorderSubset = (ids: string[]) => {
    const full = ordered.map((x) => x.id);
    const shown = new Set(ids);
    let k = 0;
    setLibraryOrder(full.map((id) => (shown.has(id) ? ids[k++] : id)));
  };
  const toggleFilter = (f: Exclude<Filter, 'all'>) => setFilter((cur) => (cur === f ? 'all' : f));

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? accent : surface }]}
    >
      <Text style={{ color: on ? theme.colors.onAccent : text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  // ----- Các kiểu hiển thị -----
  const renderItems = () => {
    if (items.length === 0) {
      return <Text style={{ color: textSecondary, marginTop: 24 }}>{t(library.length <= 1 && filter === 'all' && !query.trim() ? 'lib.empty' : 'lib.noResults')}</Text>;
    }
    // Bấm nhanh: mở mục. Giữ lâu: nhấc lên để kéo đổi thứ tự (onLongPress rỗng để thả tay sau khi kéo không bị tính là bấm)
    const tap = (it: Item, node: React.ReactNode) => (
      <Pressable onPress={() => open(it)} onLongPress={() => {}} delayLongPress={300}>
        {node}
      </Pressable>
    );

    // Mô tả lưới cho Reorderable (columns = 1 là dạng danh sách)
    let grid: { columns: number; cellWidth: number; gapX: number; gapY: number };
    let renderItem: (it: Item) => React.ReactNode;

    if (layout === 'list') {
      grid = { columns: 1, cellWidth: innerW, gapX: 0, gapY: 4 };
      renderItem = (it) =>
        tap(
          it,
          <View style={styles.listRow}>
            <CoverBox item={it} size={56} radius={4} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{titleOf(it)}</Text>
              <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{subtitleOf(it)}</Text>
            </View>
          </View>
        );
    } else if (layout === 'columns') {
      const cols = Math.max(2, Math.floor(innerW / 220));
      const w = (innerW - 8 * (cols - 1)) / cols;
      grid = { columns: cols, cellWidth: w, gapX: 8, gapY: 8 };
      renderItem = (it) =>
        tap(
          it,
          <View style={[styles.chipRow, { backgroundColor: surface }]}>
            <CoverBox item={it} size={56} radius={0} />
            <Text numberOfLines={2} style={{ color: text, flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '600' }}>
              {titleOf(it)}
            </Text>
          </View>
        );
    } else {
      const base = layout === 'covers2' ? 2 : 3;
      const targetW = layout === 'covers2' ? 200 : 140;
      const cols = Math.max(base, Math.floor(innerW / targetW));
      const gap = 14;
      const w = (innerW - gap * (cols - 1)) / cols;
      grid = { columns: cols, cellWidth: w, gapX: gap, gapY: gap };
      renderItem = (it) =>
        tap(
          it,
          <View>
            <CoverBox item={it} size={w} radius={6} />
            <Text numberOfLines={1} style={{ color: text, fontSize: 14, fontWeight: '600', marginTop: 8, textAlign: it.kind === 'artist' ? 'center' : 'left' }}>
              {titleOf(it)}
            </Text>
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2, textAlign: it.kind === 'artist' ? 'center' : 'left' }}>
              {subtitleOf(it)}
            </Text>
          </View>
        );
    }

    return (
      <Reorderable
        // Đổi kiểu hiển thị hoặc bề rộng thì dựng lại để đo chiều cao ô từ đầu
        key={`${layout}:${Math.round(grid.cellWidth)}`}
        data={items}
        enabled={reorderable}
        columns={grid.columns}
        cellWidth={grid.cellWidth}
        gapX={grid.gapX}
        gapY={grid.gapY}
        renderItem={renderItem}
        onReorder={reorderSubset}
      />
    );
  };

  const listControls = (
    <>
        {/* Tìm kiếm, sắp xếp, đổi kiểu hiển thị */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {searchOpen ? (
            <View style={[styles.searchBox, { backgroundColor: surface }]}>
              <Ionicons name="search" size={16} color={textSecondary} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={t('lib.searchPlaceholder')}
                placeholderTextColor={textSecondary}
                style={{ color: text, flex: 1, paddingVertical: 8, marginLeft: 8 }}
              />
              <Pressable
                onPress={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              >
                <Ionicons name="close" size={18} color={textSecondary} />
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable onPress={() => setSearchOpen(true)} hitSlop={8}>
                <Ionicons name="search" size={20} color={text} />
              </Pressable>
              <View style={{ flex: 1 }} />
            </>
          )}
          <Pressable onPress={() => setSort((s) => (s === 'recents' ? 'alpha' : 'recents'))}>
            <Text style={{ color: textSecondary, fontSize: 13, fontWeight: '600' }}>
              {t(sort === 'recents' ? 'lib.customOrder' : 'lib.az')}
            </Text>
          </Pressable>
          {/* Tạo playlist mới */}
          <Pressable onPress={newPlaylist} hitSlop={8} accessibilityLabel={t('lib.create')}>
            <Ionicons name="add" size={24} color={text} />
          </Pressable>
          {/* Chỉ hiện bài đã tải */}
          <Pressable onPress={() => setOnlyDownloaded(!onlyDl)} hitSlop={8} accessibilityLabel={t('lib.onlyDownloaded')}>
            <Ionicons name={onlyDl ? 'arrow-down-circle' : 'arrow-down-circle-outline'} size={23} color={onlyDl ? accent : text} />
          </Pressable>
          <Pressable onPress={cycleLayout} hitSlop={8}>
            <Ionicons name={LAYOUT_ICON[layout]} size={20} color={text} />
          </Pressable>
        </View>

    </>
  );
  const overlays = (
    <>
      {cropImg && (
        <CoverCropper
          uri={cropImg.uri}
          imageWidth={cropImg.width}
          imageHeight={cropImg.height}
          aspect={Math.min(width, height) / COVER_H}
          onCancel={() => setCropImg(null)}
          onDone={async (rect) => {
            const r = await saveCroppedCover(cropImg, rect);
            setCropImg(null);
            if (r === 'failed') Alert.alert(t('profile.cover'), t('profile.failed'));
          }}
        />
      )}
      <ProfileEditSheet
        visible={editOpen}
        name={profile.name}
        tag={profile.tag}
        onClose={() => setEditOpen(false)}
        onSave={async (name, tag) => {
          // Cặp Tên#tag phải chưa ai dùng (kiểu Discord): trùng thì báo, giữ popup để đổi tag khác
          if ((await checkNameTag(name, tag)) === 'taken') return Alert.alert(t('profile.nameTagTaken'));
          updateProfile({ name, tag });
          setEditOpen(false);
        }}
      />
    </>
  );

  // ================= Màn hình ngang =================
  // Trái: thẻ hồ sơ (ảnh bìa làm nền, phủ kính mờ) với avatar, tên, #tag, người theo dõi; bên dưới là các mục
  // (Hồ sơ, Playlist, Album, Nghệ sĩ) xếp dọc. Phải: nội dung của mục đang chọn. Mỗi bên cuộn riêng
  if (landscape) {
    const leftW = Math.round(width * 0.4);
    const menu: { id: Exclude<Filter, 'all'>; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
      { id: 'profile', label: t('lib.profile'), icon: 'person-circle-outline' },
      { id: 'playlist', label: t('lib.playlists'), icon: 'list-outline' },
      { id: 'album', label: t('lib.albums'), icon: 'disc-outline' },
      { id: 'artist', label: t('lib.artists'), icon: 'mic-outline' },
    ];
    const lightText = '#FFFFFF'; // thẻ luôn có lớp tối phủ lên nên chữ trắng
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ width: leftW, flexGrow: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: pad.top + 12, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: H_PAD }}>
          <View style={[styles.landCard, { backgroundColor: profile.wallColor }]}>
            {profile.cover ? (
              <>
                {/* Ảnh bìa: rõ ở nửa trên, mờ dần xuống dưới (bản mờ chồng lên, lộ dần theo dải chuyển từ trong suốt → đặc) */}
                <Image source={{ uri: profile.cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />
                <MaskedView
                  style={StyleSheet.absoluteFill}
                  maskElement={<LinearGradient colors={['transparent', '#000']} locations={[0.3, 0.75]} style={{ flex: 1 }} />}
                >
                  <Image source={{ uri: profile.cover }} resizeMode="cover" blurRadius={22} style={StyleSheet.absoluteFill} />
                </MaskedView>
              </>
            ) : null}
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
            <Pressable onPress={() => editImage('cover')} hitSlop={8} style={[styles.coverBtn, { top: 10, right: 10 }]}>
              <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => editImage('avatar')} style={[styles.avatar, { width: 84, height: 84, backgroundColor: profile.avatarColor }]}>
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              ) : (
                <Ionicons name="person" size={40} color="rgba(255,255,255,0.85)" />
              )}
            </Pressable>
            <Text numberOfLines={1} style={{ color: lightText, fontSize: 24, fontWeight: '800', marginTop: 12 }}>
              {profile.name}
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontWeight: '600' }}> #{profile.tag}</Text>
            </Text>
            <View style={styles.followersRow}>
              <View style={{ flexDirection: 'row' }}>
                {followers.map((f, i) => (
                  <View key={f.id} style={[styles.follower, { backgroundColor: f.color, borderColor: 'rgba(0,0,0,0.3)', marginLeft: i === 0 ? 0 : -8 }]}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{f.initial}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={styles.penBtn}>
                <Ionicons name="pencil-outline" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
          <View style={{ marginTop: 14, gap: 4 }}>
            {menu.map((m) => {
              const on = filter === m.id;
              return (
                <Pressable key={m.id} onPress={() => toggleFilter(m.id)} style={[styles.menuRow, { backgroundColor: on ? theme.colors.accent : 'transparent' }]}>
                  <Ionicons name={m.icon} size={22} color={on ? theme.colors.onAccent : text} />
                  <Text style={{ flex: 1, color: on ? theme.colors.onAccent : text, fontSize: 16, fontWeight: '700' }}>{m.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={on ? theme.colors.onAccent : textSecondary} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={{ flex: 1 }}>
          <ReorderableScrollView bounces contentContainerStyle={{ paddingTop: pad.top + 4, paddingBottom: pad.bottom + pad.endPadding }}>
            {filter === 'profile' ? (
              <View style={{ paddingHorizontal: H_PAD, marginTop: 8 }}>
                <ProfileFeed />
              </View>
            ) : (
              <>
                {listControls}
                <View style={{ paddingHorizontal: H_PAD, marginTop: 16 }}>{renderItems()}</View>
              </>
            )}
          </ReorderableScrollView>
        </View>
        {overlays}
      </View>
    );
  }

  return (
    <ReorderableScrollView bounces scrollYOut={scrollY} contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
      <View style={{ width: '100%' }}>
        {/* Ảnh bìa (wall) của profile: ảnh người dùng chọn, mờ dần xuống màu nền. Chưa có ảnh thì là dải màu như cũ */}
        {profile.cover ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: COVER_H }}>
            <StretchyBg scrollY={scrollY} height={COVER_H}>
            {/* Ảnh bìa: rõ ở trên, nhoè dần xuống dưới, rồi TAN hẳn (mặt nạ làm trong suốt dần) vào nền phía sau.
                Trước đây phủ một dải màu nền lên đáy ảnh: nền có hoạ tiết (trời sao, ảnh, video) thì lộ thành một đường viền */}
            <MaskedView
              style={StyleSheet.absoluteFill}
              maskElement={<LinearGradient colors={['#000', '#000', 'transparent']} locations={[0, 0.55, 1]} style={{ flex: 1 }} />}
            >
              <Image source={{ uri: profile.cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['transparent', '#000']} locations={[0.3, 0.75]} style={{ flex: 1 }} />}>
                <Image source={{ uri: profile.cover }} resizeMode="cover" blurRadius={22} style={StyleSheet.absoluteFill} />
              </MaskedView>
              <LinearGradient
                // Phủ nhẹ màu tối/sáng của theme (ngược với màu chữ) cho chữ nổi
                colors={[withAlpha(underCover, 0.12), withAlpha(underCover, 0.3), withAlpha(underCover, 0.35)]}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
            </MaskedView>
            </StretchyBg>
          </View>
        ) : (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}>
            <StretchyBg scrollY={scrollY} height={320}>
              <LinearGradient
                colors={[theme.colors.glassTint === 'dark' ? profile.wallColor : profile.wallColor + '55', withAlpha(profile.wallColor, 0)]}
                style={StyleSheet.absoluteFill}
              />
            </StretchyBg>
          </View>
        )}
        {/* Nút đổi ảnh bìa */}
        <Pressable
          onPress={() => editImage('cover')}
          hitSlop={8}
          style={[styles.coverBtn, { top: pad.top + 10, right: pad.right + H_PAD }]}
        >
          <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
        </Pressable>

        {/* Header profile: cả cụm (avatar, tên, các tab, danh sách) nằm thấp xuống khoảng 1/3 màn hình,
            phần trên để trống cho ảnh bìa hiện rõ. Ảnh bìa vẫn giữ nguyên vị trí và chiều cao */}
        <View style={{ paddingTop: Math.max(pad.top + 28, Math.round(Math.min(height * 0.3, COVER_H * 0.56))), paddingHorizontal: H_PAD, flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
          <Pressable onPress={() => editImage('avatar')} style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
            {profile.avatar ? (
              <Image source={{ uri: profile.avatar }} resizeMode="cover" style={StyleSheet.absoluteFill} />
            ) : (
              <Ionicons name="person" size={52} color="rgba(255,255,255,0.85)" />
            )}
            {/* Biểu tượng nhỏ cho biết bấm vào để đổi ảnh */}
            <View style={styles.avatarEdit}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[{ color: hero.text, fontSize: 30, fontWeight: '800', marginTop: 2 }, heroShadow]}>
              {profile.name}
              <Text style={{ color: hero.sub, fontWeight: '600' }}> #{profile.tag}</Text>
            </Text>
            <View style={styles.followersRow}>
              <Pressable style={[styles.plusBtn, { borderColor: hero.sub }]}>
                <Ionicons name="add" size={18} color={hero.text} />
              </Pressable>
              <View style={{ flexDirection: 'row', marginLeft: 10 }}>
                {followers.map((f, i) => (
                  <View
                    key={f.id}
                    style={[
                      styles.follower,
                      { backgroundColor: f.color, borderColor: theme.background.color, marginLeft: i === 0 ? 0 : -8 },
                    ]}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{f.initial}</Text>
                  </View>
                ))}
              </View>
              {/* Nút bút (cùng cỡ với nút đổi ảnh bìa): mở popup sửa tên và hashtag */}
              <Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={[styles.penBtn, { marginLeft: 10 }]}>
                <Ionicons name="pencil-outline" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Chip lọc */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 28, flexDirection: 'row', gap: 8 }}>
          {chip(t('lib.profile'), filter === 'profile', () => toggleFilter('profile'))}
          {chip(t('lib.playlists'), filter === 'playlist', () => toggleFilter('playlist'))}
          {chip(t('lib.albums'), filter === 'album', () => toggleFilter('album'))}
          {chip(t('lib.artists'), filter === 'artist', () => toggleFilter('artist'))}
        </View>

        {/* Mục Profile: bài đăng / đăng lại / share thay cho danh sách thư viện */}
        {filter === 'profile' ? (
          <View style={{ paddingHorizontal: H_PAD, marginTop: 12 }}>
            <ProfileFeed />
          </View>
        ) : (
        <>
        {listControls}
        {/* Danh sách */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 16 }}>
          {renderItems()}
        </View>
        </>
        )}
      </View>
      {overlays}
    </ReorderableScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 112, height: 112, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarEdit: {
    position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  // Cùng cỡ và kiểu với nút đổi ảnh bìa (coverBtn)
  penBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  coverBtn: {
    position: 'absolute', zIndex: 2, width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  landCard: { borderRadius: 22, overflow: 'hidden', padding: 16, paddingTop: 22 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14 },
  followersRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  plusBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  follower: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  chipRow: { height: 56, borderRadius: 6, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
});