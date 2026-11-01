import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { LibraryLayout } from '../theme/types';
import { followers, libraryItems, LibraryItem, profile } from '../data/mock';
import { useFrame } from '../components/layout';
import { Reorderable } from '../components/Reorderable';
import { ReorderableScrollView } from '../components/ReorderableScrollView';

const H_PAD = 16;

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
      return <Text style={{ color: textSecondary, marginTop: 24 }}>Không có kết quả</Text>;
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
        {/* Nền (wall) của profile, sau này cho người dùng tự chọn ảnh */}
        <LinearGradient
          colors={[profile.wallColor, theme.background.color]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
        />

        {/* Header profile */}
        <View style={{ paddingTop: pad.top + 28, paddingHorizontal: H_PAD, flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
          <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
            <Ionicons name="person" size={52} color="rgba(255,255,255,0.85)" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: text, fontSize: 12, fontWeight: '600' }}>Profile</Text>
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
          {chip('Playlists', filter === 'playlist', () => toggleFilter('playlist'))}
          {chip('Albums', filter === 'album', () => toggleFilter('album'))}
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
                placeholder="Tìm trong thư viện"
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
              {sort === 'recents' ? 'Custom order' : 'A–Z'}
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
    </ReorderableScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 112, height: 112, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  followersRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  plusBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  follower: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  chipRow: { height: 56, borderRadius: 6, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
});