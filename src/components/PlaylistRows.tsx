import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { SmartImage } from './Cover';

export type PlaylistRowItem = { key: string; title: string; subtitle: string; thumb?: string; onPress: () => void };

// Danh sách playlist dạng hàng: ảnh bìa, tên, số bài (tab Share / Playlist trong hồ sơ)
export function PlaylistRows({ items }: { items: PlaylistRowItem[] }) {
  const { theme } = useTheme();
  const { text, textSecondary, surface } = theme.colors;
  return (
    <View style={{ marginTop: 6 }}>
      {items.map((p) => (
        <Pressable key={p.key} onPress={p.onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
          {p.thumb ? (
            <SmartImage url={p.thumb} size={180} style={[styles.cover, { backgroundColor: surface }]} />
          ) : (
            <View style={[styles.cover, { backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="musical-notes" size={24} color={textSecondary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '700' }}>{p.title}</Text>
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{p.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={textSecondary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  cover: { width: 60, height: 60, borderRadius: 6 },
});
