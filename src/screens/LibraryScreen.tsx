import React, { useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useContentInsets } from '../components/FloatingDock';
import { LibraryLayout } from '../theme/types';
import { followers, libraryItems, LibraryItem } from '../data/mock';
import { ImageSlot, PickedImage, pickProfileImage, removeProfileImage, saveCroppedCover, updateProfile, useProfile } from '../data/profile';
import { CoverCropper } from '../components/CoverCropper';
import { ProfileEditSheet } from '../components/ProfileEditSheet';
import { sheet } from '../components/useSongMenu';
import { useFrame } from '../components/layout';
import { Reorderable } from '../components/Reorderable';
import { ReorderableScrollView } from '../components/ReorderableScrollView';

const H_PAD = 16;
const COVER_H = 320; // chiều cao vùng ảnh bìa ở đầu trang

const LAYOUT_ORDER: LibraryLayout[] = ['list', 'columns', 'covers2', 'covers3'];
const LAYOUT_ICON: Record<LibraryLayout, keyof typeof Ionicons.glyphMap> = {
  list: 'list',
  columns: 'grid-outline',
  covers2: 'albums-outline',
  covers3: 'apps-outline',
};

type Filter = 'all' | 'playlist' | 'album';
type Sort = 'recents' | 'alpha';

function CoverBox({ item, size, radius }: { item: LibraryItem; size: number; radius: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: item.color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name={item.kind === 'album' ? 'disc' : 'musical-notes'}
        size={Math.max(16, size * 0.38)}
        color="rgba(255,255,255,0.8)"
      />
    </View>
  );
}

export function LibraryScreen() {
  const { theme, setLibraryLayout, setLibraryOrder } = useTheme();
  const t = useT();
  const profile = useProfile();
  const [cropImg, setCropImg] = useState<PickedImage | null>(null); // ảnh bìa đang chờ cắt
  const [editOpen, setEditOpen] = useState(false); // popup sửa tên / hashtag

  // Bấm avatar / nút đổi ảnh bìa: chọn ảnh, chụp ảnh, hoặc xoá
  const editImage = (slot: ImageSlot) => {
    // iOS: chờ menu đóng hẳn rồi mới mở trình chọn ảnh, mở ngay dễ bị hệ thống chặn
    const run = (source: 'library' | 'camera') =>
      new Promise((ok) => setTimeout(ok, Platform.OS === 'ios' ? 350 : 0)).then(() => pickProfileImage(slot, source, setCropImg)).then((r) => {
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
  const { width } = useFrame();

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recents');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const layout = theme.library.layout;
  const innerW = width - H_PAD * 2; 
  const { text, textSecondary, accent, surface } = theme.colors;

  // Áp dụng thứ tự do người dùng tự sắp xếp (mục chưa có trong thứ tự thì xếp sau, giữ nguyên vị trí cũ)
  const ordered = useMemo(() => {
    const order = theme.library.order;
    const pos = new Map(order.map((id, i) => [id, i] as const));
    return libraryItems
      .map((it, i) => ({ it, key: pos.get(it.id) ?? order.length + i }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.it);
  }, [theme.library.order]);

  const items = useMemo(() => {
    let list = ordered.filter((i) => filter === 'all' || i.kind === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => i.title.toLowerCase().includes(q));
    if (sort === 'alpha') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [ordered, filter, query, sort]);

  // Chỉ cho kéo đổi thứ tự khi đang xem đủ danh sách theo thứ tự của mình
  const reorderable = filter === 'all' && query.trim() === '' && sort === 'recents';

  const cycleLayout = () => {
    const next = LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(layout) + 1) % LAYOUT_ORDER.length];
    setLibraryLayout(next);
  };

  const toggleFilter = (f: Exclude<Filter, 'all'>) => setFilter((cur) => (cur === f ? 'all' : f));

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? accent : surface }]}
    >
      <Text style={{ color: on ? '#000' : text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  // ----- Các kiểu hiển thị -----
  const renderItems = () => {
    if (items.length === 0) {
      return <Text style={{ color: textSecondary, marginTop: 24 }}>{t('lib.noResults')}</Text>;
    }

    // Mô tả lưới cho Reorderable (columns = 1 là dạng danh sách)
    let grid: { columns: number; cellWidth: number; gapX: number; gapY: number };
    let renderItem: (it: LibraryItem) => React.ReactNode;

    if (layout === 'list') {
      grid = { columns: 1, cellWidth: innerW, gapX: 0, gapY: 4 };
      renderItem = (it) => (
        <View style={styles.listRow}>
          <CoverBox item={it} size={56} radius={4} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{it.title}</Text>
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{it.subtitle}</Text>
          </View>
        </View>
      );
    } else if (layout === 'columns') {
      const cols = Math.max(2, Math.floor(innerW / 220));
      const w = (innerW - 8 * (cols - 1)) / cols;
      grid = { columns: cols, cellWidth: w, gapX: 8, gapY: 8 };
      renderItem = (it) => (
        <View style={[styles.chipRow, { backgroundColor: surface }]}>
          <CoverBox item={it} size={56} radius={0} />
          <Text numberOfLines={2} style={{ color: text, flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '600' }}>
            {it.title}
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
      renderItem = (it) => (
        <View>
          <CoverBox item={it} size={w} radius={6} />
          <Text numberOfLines={1} style={{ color: text, fontSize: 14, fontWeight: '600', marginTop: 8 }}>{it.title}</Text>
          <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>{it.subtitle}</Text>
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
        onReorder={setLibraryOrder}
      />
    );
  };

  return (
    <ReorderableScrollView contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
      <View style={{ width: '100%' }}>
        {/* Ảnh bìa (wall) của profile: ảnh người dùng chọn, mờ dần xuống màu nền. Chưa có ảnh thì là dải màu như cũ */}
        {profile.cover ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: COVER_H }}>
            <Image source={{ uri: profile.cover }} resizeMode="cover" style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.35)', theme.background.color]}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : (
          <LinearGradient
            colors={[profile.wallColor, theme.background.color]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
          />
        )}
        {/* Nút đổi ảnh bìa */}
        <Pressable
          onPress={() => editImage('cover')}
          hitSlop={8}
          style={[styles.coverBtn, { top: pad.top + 10, right: pad.right + H_PAD }]}
        >
          <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
        </Pressable>

        {/* Header profile */}
        <View style={{ paddingTop: pad.top + 28, paddingHorizontal: H_PAD, flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: text, fontSize: 12, fontWeight: '600' }}>{t('lib.profile')}</Text>
              {/* Nút bút: mở popup sửa tên và hashtag */}
              <Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={styles.penBtn}>
                <Ionicons name="pencil" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text numberOfLines={1} style={{ color: text, fontSize: 30, fontWeight: '800', marginTop: 2 }}>
              {profile.name}
              <Text style={{ color: textSecondary, fontWeight: '600' }}> #{profile.tag}</Text>
            </Text>
            <View style={styles.followersRow}>
              <Pressable style={[styles.plusBtn, { borderColor: textSecondary }]}>
                <Ionicons name="add" size={18} color={text} />
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
            </View>
          </View>
        </View>

        {/* Chip lọc */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 28, flexDirection: 'row', gap: 8 }}>
          {chip(t('lib.playlists'), filter === 'playlist', () => toggleFilter('playlist'))}
          {chip(t('lib.albums'), filter === 'album', () => toggleFilter('album'))}
        </View>

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
          <Pressable onPress={cycleLayout} hitSlop={8}>
            <Ionicons name={LAYOUT_ICON[layout]} size={20} color={text} />
          </Pressable>
        </View>

        {/* Danh sách */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 16 }}>
          {renderItems()}
        </View>
      </View>
      {cropImg && (
        <CoverCropper
          uri={cropImg.uri}
          imageWidth={cropImg.width}
          imageHeight={cropImg.height}
          aspect={width / COVER_H}
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
        onSave={(name, tag) => {
          updateProfile({ name, tag });
          setEditOpen(false);
        }}
      />
    </ReorderableScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 112, height: 112, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarEdit: {
    position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  penBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  coverBtn: {
    position: 'absolute', zIndex: 2, width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  followersRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  plusBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  follower: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  chipRow: { height: 56, borderRadius: 6, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
});