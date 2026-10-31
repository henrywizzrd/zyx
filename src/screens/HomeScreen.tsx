import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { Item, madeForYou, newReleases, recentlyPlayed } from '../data/mock';

function RecentGrid({ items }: { items: Item[] }) {
  const { theme } = useTheme();
  return (
    <View style={styles.grid}>
      {items.map((it) => (
        <View key={it.id} style={[styles.chip, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.chipCover, { backgroundColor: it.color }]} />
          <Text numberOfLines={1} style={[styles.chipTitle, { color: theme.colors.text }]}>
            {it.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Row({ title, items }: { title: string; items: Item[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginTop: 28 }}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
        {items.map((it) => (
          <View key={it.id} style={{ width: 140 }}>
            <View style={[styles.cover, { backgroundColor: it.color }]} />
            <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.colors.text }]}>
              {it.title}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              {it.subtitle}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function HomeScreen() {
  const { theme } = useTheme();
  const pad = useContentInsets();

  return (
    <ScrollView
        contentContainerStyle={{
        paddingTop: pad.top + 16,
        paddingBottom: pad.bottom + pad.endPadding,
        paddingLeft: pad.left + 16,
        paddingRight: pad.right + 16,
        }}
    >
      <Text style={[styles.greeting, { color: theme.colors.text }]}>Good evening</Text>
      {theme.home.sections.map((s) => {
        if (s === 'recentlyPlayed') return <RecentGrid key={s} items={recentlyPlayed} />;
        if (s === 'madeForYou') return <Row key={s} title="Made for you" items={madeForYou} />;
        return <Row key={s} title="New releases" items={newReleases} />;
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 26, fontWeight: '700', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { width: '48.5%', height: 56, borderRadius: 6, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  chipCover: { width: 56, height: 56 },
  chipTitle: { flex: 1, marginHorizontal: 10, fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  cover: { width: 140, height: 140, borderRadius: 6 },
  cardTitle: { marginTop: 8, fontSize: 14, fontWeight: '600' },
});