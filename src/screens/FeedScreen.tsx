import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useNav } from '../nav/Nav';
import { useAnimatedBack } from '../nav/SwipeBack';
import { useContentInsets } from '../components/FloatingDock';
import { PostCard } from '../components/PostCard';
import { feedKey, useFeed } from '../components/FeedList';

// Bảng tin đầy đủ (bấm >> ở mục Bảng tin trên Home): kéo xuống ở đầu trang để làm mới,
// cuộn tới cuối tự tải thêm bài cũ hơn. Không có thanh cuộn
export function FeedScreen() {
  const { theme } = useTheme();
  const t = useT();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const pad = useContentInsets();
  const { text, textSecondary, accent, surface } = theme.colors;
  const { posts, error, refreshing, more, refresh, loadMore } = useFeed(20);

  return (
    <View style={StyleSheet.absoluteFill}>
      <FlatList
        data={posts ?? []}
        keyExtractor={feedKey}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={accent} colors={[accent]} />}
        contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16 }}
        ListHeaderComponent={
          <View style={styles.head}>
            <Pressable onPress={goBack} hitSlop={10} style={[styles.back, { backgroundColor: surface }]}>
              <Ionicons name="chevron-back" size={22} color={text} />
            </Pressable>
            <Text style={{ color: text, fontSize: 28, fontWeight: '800' }}>{t('community.feed')}</Text>
          </View>
        }
        ListEmptyComponent={
          posts === null && !error ? (
            <ActivityIndicator color={accent} style={{ marginTop: 30 }} />
          ) : error ? (
            <Pressable onPress={() => refresh()}>
              <Text style={{ color: textSecondary, marginTop: 20 }}>{t('community.loadFailed')}</Text>
            </Pressable>
          ) : (
            <Text style={{ color: textSecondary, marginTop: 20 }}>{t('community.feedEmpty')}</Text>
          )
        }
        ListFooterComponent={posts?.length && more ? <ActivityIndicator color={accent} style={{ marginVertical: 16 }} /> : undefined}
        renderItem={({ item, index }) => <PostCard post={item} showDivider={index < (posts?.length ?? 0) - 1} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
