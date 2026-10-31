import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { LibraryLayout } from '../theme/types';
import { followers, libraryItems, LibraryItem, profile } from '../data/mock';

const MAX_W = 600; // giữ bố cục giống điện thoại khi xem trên web
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
  const { theme, setLibraryLayout } = useTheme();
  const pad = useContentInsets();
  const { width } = useWindowDimensions();

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recents');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const layout = theme.library.layout;
  const innerW = Math.min(width, MAX_W) - H_PAD * 2;
  const { text, textSecondary, accent, surface } = theme.colors;

  const items = useMemo(() => {
    let list = libraryItems.filter((i) => filter === 'all' || i.kind === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => i.title.toLowerCase().includes(q));
    if (sort === 'alpha') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [filter, query, sort]);

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

    if (layout === 'list') {
      return items.map((it) => (
        <Pressable key={it.id} style={styles.listRow}>
          <CoverBox item={it} size={56} radius={4} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{it.title}</Text>
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{it.subtitle}</Text>
          </View>
        </Pressable>
      ));
    }

    if (layout === 'columns') {
      const w = (innerW - 8) / 2;
      return (
        <View style={styles.wrap8}>
          {items.map((it) => (
            <Pressable key={it.id} style={[styles.chipRow, { width: w, backgroundColor: surface }]}>
              <CoverBox item={it} size={56} radius={0} />
              <Text numberOfLines={2} style={{ color: text, flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '600' }}>
                {it.title}
              </Text>
            </Pressable>
          ))}
        </View>
      );
    }

    const cols = layout === 'covers2' ? 2 : 3;
    const gap = 14;
    const w = (innerW - gap * (cols - 1)) / cols;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {items.map((it) => (
          <Pressable key={it.id} style={{ width: w }}>
            <CoverBox item={it} size={w} radius={6} />
            <Text numberOfLines={1} style={{ color: text, fontSize: 14, fontWeight: '600', marginTop: 8 }}>{it.title}</Text>
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>{it.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <ScrollView 
    bounces={false}
    overScrollMode="never"
    contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}
    >
      <View style={{ width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
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
              {sort === 'recents' ? 'Recents' : 'A–Z'}
            </Text>
          </Pressable>
          <Pressable onPress={cycleLayout} hitSlop={8}>
            <Ionicons name={LAYOUT_ICON[layout]} size={20} color={text} />
          </Pressable>
        </View>

        {/* Danh sách */}
        <View style={{ paddingHorizontal: H_PAD, marginTop: 16, gap: layout === 'list' ? 4 : 0 }}>
          {renderItems()}
        </View>
      </View>
    </ScrollView>
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
  wrap8: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { height: 56, borderRadius: 6, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
});