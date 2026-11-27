import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOffline } from '../data/net';
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
import { FollowerStack } from '../components/FollowerStack';
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
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useRotateEnter } from '../components/rotateEnter';
import { useDockCollapse } from '../components/dockCollapse';
import { useRenderProbe } from '../components/JankMonitor';
import { GlassFill, glassShadow, solidShadow } from '../components/Glass';
import { useDisplayFont } from '../theme/fonts';
import { POP_ACCENTS, popEdge, popMode, popRow, popThumb } from '../theme/pop';

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
// Pop folder tab colour: picked from the Pop accents by the item's id, so a playlist keeps its colour
const FOLDER_COLORS = [POP_ACCENTS.lilac, POP_ACCENTS.mint, POP_ACCENTS.coral, POP_ACCENTS.yellow, POP_ACCENTS.sky, POP_ACCENTS.pink];
function folderColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return FOLDER_COLORS[Math.abs(h) % FOLDER_COLORS.length];
}

function CoverBox({ item, size, radius }: { item: LibraryEntry; size: number; radius: number }) {
  const { theme } = useTheme();
  const r = item.kind === 'artist' ? size / 2 : radius;
  if (item.thumb) {
    return (
      <SmartImage
        url={item.thumb}
        size={Math.round(size * PixelRatio.get())}
        style={[{ width: size, height: size, borderRadius: r, backgroundColor: theme.colors.surface }, popThumb(r)]}
      />
    );
  }
  const liked = item.kind === 'liked';
  const icon: keyof typeof Ionicons.glyphMap = liked ? 'heart' : item.kind === 'album' ? 'disc' : item.kind === 'artist' ? 'person' : 'musical-notes';
  return (
    <View style={[{ width: size, height: size, borderRadius: r, backgroundColor: liked ? '#5B3CC4' : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }, popThumb(r)]}>
      <Ionicons name={icon} size={Math.max(16, size * 0.38)} color={liked ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary} />
    </View>
  );
}

export function LibraryScreen() {
  const df = useDisplayFont();
  const pop = useTheme().theme.style === 'pop';
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
  useDockCollapse(scrollY); // dock Apple Music: cuộn xuống thì thu dock

  const [filter, setFilter] = useState<Filter>('playlist'); // mở Thư viện: mặc định ở mục Playlists (chip sáng)
  const [sort, setSort] = useState<Sort>('recents');
  const library = useLibrary();
  const { push } = useNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const layout = theme.library.layout;
  const innerW = (landscape ? width * 0.6 : width) - H_PAD * 2; // ngang: danh sách nằm ở cột phải 
  const { text, textSecondary, accent, accentText, surface } = theme.colors;

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
  // Offline: tự chỉ hiện bài đã tải (không đổi lựa chọn đã lưu của nút "Đã tải")
  const offlineNow = useOffline();
  const onlyDl = useOnlyDownloaded() || offlineNow;
  const enter = useRotateEnter();
  useRenderProbe('Thư viện', { theme, landscape, t, profile, pad, width, height, library, push, onlyDl });
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
      style={[styles.chip, on ? [{ backgroundColor: accent }, popEdge(true)] : glassShadow(0.5, theme.colors.glassTint !== 'dark')]}
    >
      {!on && <GlassFill radius={18} solid={0.45} slab />}
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
          <View style={[styles.listRow, popRow()]}>
            <CoverBox item={it} size={pop ? 50 : 56} radius={pop ? 9 : 4} />
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
          <View style={[styles.chipRow, glassShadow(0.6, theme.colors.glassTint !== 'dark')]}>
            <GlassFill radius={14} solid={0.5} slab />
            <CoverBox item={it} size={48} radius={9} />
            <Text numberOfLines={2} style={{ color: text, flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '600' }}>
              {titleOf(it)}
            </Text>
          </View>
        );
    } else if (pop) {
      // Pop (approved cards mockup 27/11): playlists as folder cards — a coloured tab on top, the cover in the corner,
      // the count top-right and the name at the bottom. Covers 3 just makes the folders smaller
      const base = layout === 'covers2' ? 2 : 3;
      const cols = Math.max(base, Math.floor(innerW / (layout === 'covers2' ? 200 : 140)));
      const gapX = 12;
      const w = (innerW - gapX * (cols - 1)) / cols;
      const small = cols >= 3;
      grid = { columns: cols, cellWidth: w, gapX, gapY: 16 };
      renderItem = (it) =>
        tap(
          it,
          <View style={{ paddingTop: 12 }}>
            <View style={[styles.folderTab, { backgroundColor: folderColor(it.id), borderColor: theme.colors.border, borderWidth: Math.min(popMode.line, 2.5) }]} />
            <View style={[styles.folderCard, { minHeight: small ? 104 : 124, padding: small ? 8 : 10 }, glassShadow(1)]}>
              <GlassFill radius={14} solid={0.5} slab />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <CoverBox item={it} size={small ? 38 : 46} radius={9} />
                {!small && (
                  <Text numberOfLines={2} style={{ color: textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'right', flexShrink: 1, marginLeft: 6 }}>
                    {subtitleOf(it)}
                  </Text>
                )}
              </View>
              <Text numberOfLines={2} style={{ color: text, fontSize: small ? 13 : 14.5, fontWeight: '800', marginTop: 10 }}>
                {titleOf(it)}
              </Text>
            </View>
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
            <View style={[styles.searchBox, glassShadow(0.5, theme.colors.glassTint !== 'dark')]}>
              <GlassFill radius={14} solid={0.5} slab />
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
            <Ionicons name={onlyDl ? 'arrow-down-circle' : 'arrow-down-circle-outline'} size={23} color={onlyDl ? accentText : text} />
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

  // ================= Pop profile header (27/11) =================
  // Pop is flat, so the cover doesn't fade into the page: it sits in an outlined card with a hard shadow,
  // the avatar overlaps its bottom-left corner, and the name is set in the title font on the page colour
  const popBtn = [styles.popBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: Math.min(popMode.line, 2.5) }, solidShadow(0.6)];
  const popHero = (
    <View style={{ paddingTop: pad.top + 10, paddingHorizontal: H_PAD }}>
      <View style={[styles.popCover, solidShadow(1), { backgroundColor: profile.wallColor, borderColor: theme.colors.border, borderWidth: popMode.line }]}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: 18, overflow: 'hidden' }]}>
          {!!profile.cover && <Image source={{ uri: profile.cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
        </View>
        <Pressable onPress={() => editImage('cover')} hitSlop={8} style={[popBtn, { position: 'absolute', top: 10, right: 10 }]}>
          <Ionicons name="camera-outline" size={18} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: -46, paddingLeft: 14 }}>
        <Pressable
          onPress={() => editImage('avatar')}
          style={[styles.avatar, solidShadow(1), { width: 96, height: 96, overflow: 'visible', backgroundColor: profile.avatarColor, borderColor: theme.colors.border, borderWidth: popMode.line }]}
        >
          <View style={[StyleSheet.absoluteFill, { borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }]}>
            {profile.avatar ? (
              <Image source={{ uri: profile.avatar }} resizeMode="cover" style={StyleSheet.absoluteFill} />
            ) : (
              <Ionicons name="person" size={46} color="rgba(255,255,255,0.85)" />
            )}
          </View>
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
          <View style={{ flex: 1 }} />
          <FollowerStack size={30} ring={theme.colors.border} textColor="#FFFFFF" />
          <Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={popBtn}>
            <Ionicons name="pencil-outline" size={18} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>
      <Text numberOfLines={1} style={[{ color: theme.colors.text, fontSize: 30, fontWeight: '800', marginTop: 14 }, df]}>
        {profile.name}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 20 }}> #{profile.tag}</Text>
      </Text>
    </View>
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
          {/* vừa xoay sang ngang: cột trái trượt vào từ trái, cột phải từ phải (rotateEnter.ts) */}
          <Animated.View entering={enter(0, 'left')}>
          <View style={[styles.landCard, pop && solidShadow(1), { backgroundColor: profile.wallColor }, pop && { borderWidth: popMode.line, borderColor: theme.colors.border }]}>
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
              <FollowerStack size={28} ring="rgba(0,0,0,0.3)" />
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
                <Pressable key={m.id} onPress={() => toggleFilter(m.id)} style={[styles.menuRow, { backgroundColor: on ? theme.colors.accent : 'transparent' }, on && popEdge(true)]}>
                  <Ionicons name={m.icon} size={22} color={on ? theme.colors.onAccent : text} />
                  <Text style={{ flex: 1, color: on ? theme.colors.onAccent : text, fontSize: 16, fontWeight: '700' }}>{m.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={on ? theme.colors.onAccent : textSecondary} />
                </Pressable>
              );
            })}
          </View>
          </Animated.View>
        </ScrollView>
        <Animated.View entering={enter(1, 'right')} style={{ flex: 1 }}>
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
        </Animated.View>
        {overlays}
      </View>
    );
  }

  return (
    <ReorderableScrollView bounces scrollYOut={scrollY} contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
      {/* vừa xoay về dọc: trượt từ dưới lên vào chỗ (rotateEnter.ts) */}
      <Animated.View entering={enter(0, 'up')} style={{ width: '100%' }}>
        {pop ? popHero : (
        <>
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
            <Text numberOfLines={1} style={[{ color: hero.text, fontSize: 30, fontWeight: '800', marginTop: 2 }, heroShadow, df]}>
              {profile.name}
              <Text style={{ color: hero.sub, fontWeight: '600' }}> #{profile.tag}</Text>
            </Text>
            <View style={styles.followersRow}>
              <Pressable style={[styles.plusBtn, { borderColor: hero.sub }]}>
                <Ionicons name="add" size={18} color={hero.text} />
              </Pressable>
              <View style={{ marginLeft: 10 }}>
                <FollowerStack ring={theme.background.color} />
              </View>
              {/* Nút bút (cùng cỡ với nút đổi ảnh bìa): mở popup sửa tên và hashtag */}
              <Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={[styles.penBtn, { marginLeft: 10 }]}>
                <Ionicons name="pencil-outline" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>

        </>
        )}

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
      </Animated.View>
      {overlays}
    </ReorderableScrollView>
  );
}

const styles = StyleSheet.create({
  popCover: { height: 180, borderRadius: 18, borderCurve: 'continuous' },
  popBtn: { width: 36, height: 36, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
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
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderCurve: 'continuous' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  folderTab: { position: 'absolute', top: 0, left: 8, width: '58%', height: 24, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 14 },
  folderCard: { borderRadius: 14, justifyContent: 'space-between' },
  chipRow: { height: 60, borderRadius: 14, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', paddingLeft: 6 },
});