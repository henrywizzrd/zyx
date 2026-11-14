import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { resetVinylFlags, setVinylFlag, useVinylFlags, VINYL_FLAGS } from '../debug/vinylFlags';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useNav } from '../nav/Nav';
import { useAnimatedBack, useEntered } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { clearLog, fmtTime, LogLine, LogTag, logToText, useLog } from '../data/applog';

type Filter = 'all' | LogTag;
const EMPTY: LogLine[] = [];
const FILTERS: Filter[] = ['all', 'motion', 'music', 'fx', 'error', 'jank', 'swipe', 'ui'];
const TAG_COLOR: Record<LogTag, string> = {
  motion: '#F5A524',
  music: '#3DB2FF',
  fx: '#A78BFA',
  error: '#E5484D',
  jank: '#F5A524',
  swipe: '#2EC27E',
  ui: '#8E8E93',
};

// Nhật ký dò lỗi (Cài đặt → Nhật ký): dòng mới nhất ở trên, lọc theo loại, chép / gửi, xoá
export function LogScreen() {
  const { theme } = useTheme();
  const { text, textSecondary, surface, accent, onAccent, border } = theme.colors;
  const t = useT();
  const pad = useContentInsets();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const all = useLog();
  // Trượt vào xong mới dựng danh sách (log mở ra khựng ~350ms vì dựng cả trăm dòng cùng lúc với hiệu ứng trượt)
  const entered = useEntered();
  const [filter, setFilter] = useState<Filter>('all');
  const vflags = useVinylFlags();
  const offCount = VINYL_FLAGS.filter(([k]) => !vflags[k]).length;
  const [debugOpen, setDebugOpen] = useState(offCount > 0);
  const n = all.length;
  const rows = useMemo(() => {
    const src = filter === 'all' ? all : all.filter((l) => l.tag === filter);
    return src.slice().reverse();
  }, [all, n, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = { all: all.length };
    for (const l of all) c[l.tag] = (c[l.tag] ?? 0) + 1;
    return c;
  }, [all, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = () => {
    const src = filter === 'all' ? all : all.filter((l) => l.tag === filter);
    Share.share({ message: logToText(src) || '(trống)' }).catch(() => {});
  };
  const clear = () =>
    Alert.alert(t('log.clear'), t('log.clearAsk'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('log.clear'), style: 'destructive', onPress: clearLog },
    ]);

  const label = (f: Filter) => t(`log.f.${f}` as any);

  const header = (
    <View>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]}>
          <Ionicons name="chevron-back" size={24} color={text} />
        </Pressable>
        <Text style={[styles.title, { color: text }]}>{t('log.title')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={share} hitSlop={8} style={[styles.circle, { backgroundColor: surface }]} accessibilityLabel={t('log.share')}>
            <Ionicons name="share-outline" size={20} color={text} />
          </Pressable>
          <Pressable onPress={clear} hitSlop={8} style={[styles.circle, { backgroundColor: surface }]} accessibilityLabel={t('log.clear')}>
            <Ionicons name="trash-outline" size={20} color={text} />
          </Pressable>
        </View>
      </View>
      <Text style={{ color: textSecondary, fontSize: 13, marginTop: 10 }}>{t('log.hint')}</Text>
      {/* Dò lỗi player đĩa than: tắt từng phần rồi mở / đóng player, xem nhật ký còn "khựng" không (tạm thời, sẽ gỡ) */}
      <View style={[styles.debugBox, { borderColor: border, backgroundColor: surface }]}>
        <Pressable onPress={() => setDebugOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="bug-outline" size={18} color={text} />
          <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15 }}>Dò lỗi player đĩa than</Text>
          <Text style={{ color: textSecondary, fontSize: 12 }}>{offCount ? `tắt ${offCount}` : 'đủ'}</Text>
          <Ionicons name={debugOpen ? 'chevron-up' : 'chevron-down'} size={18} color={textSecondary} />
        </Pressable>
        {debugOpen && (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: textSecondary, fontSize: 12, marginBottom: 6 }}>
              Tắt một phần → mở / đóng player 3–4 lần → xem "luồng JS khựng" / "giao diện khựng" còn không. Mỗi lần bật / tắt đều ghi vào nhật ký.
            </Text>
            {VINYL_FLAGS.map(([k, name]) => (
              // Chạm cả dòng để bật / tắt. (Trước dùng Switch của iOS nhưng gạt không ăn trên màn này — log không có dòng
              // "dò lỗi: TẮT" nào; nút Pressable "Bật lại tất cả" thì ăn → dùng Pressable cho chắc)
              <Pressable key={k} onPress={() => setVinylFlag(k, !vflags[k])} style={styles.debugRow} hitSlop={4}>
                <Text style={{ flex: 1, color: vflags[k] ? text : textSecondary, fontSize: 14 }}>{name}</Text>
                <View style={[styles.pill, { backgroundColor: vflags[k] ? accent : border }]}>
                  <Text style={{ color: vflags[k] ? onAccent : text, fontWeight: '800', fontSize: 12 }}>{vflags[k] ? 'BẬT' : 'TẮT'}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable onPress={resetVinylFlags} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
              <Text style={{ color: accent, fontWeight: '700' }}>Bật lại tất cả</Text>
            </Pressable>
          </View>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 14 }}>
        {FILTERS.map((f) => {
          const on = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, { backgroundColor: on ? accent : surface, borderColor: border }]}>
              {f !== 'all' && <View style={[styles.dot, { backgroundColor: TAG_COLOR[f] }]} />}
              <Text style={{ color: on ? onAccent : text, fontWeight: '700', fontSize: 13 }}>
                {label(f)} {counts[f] ? `· ${counts[f]}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderItem = ({ item }: { item: LogLine }) => (
    <Pressable
      onLongPress={() => Share.share({ message: logToText([item]) }).catch(() => {})}
      style={[styles.row, { borderColor: border }]}
    >
      <View style={styles.rowHead}>
        <View style={[styles.dot, { backgroundColor: TAG_COLOR[item.tag] }]} />
        <Text style={[styles.mono, { color: textSecondary }]}>{fmtTime(item.t)}</Text>
        <Text style={[styles.mono, { color: TAG_COLOR[item.tag], fontWeight: '700' }]}>{item.tag}</Text>
        {item.bg && <Text style={[styles.mono, { color: textSecondary }]}>{t('log.bg')}</Text>}
      </View>
      <Text style={[styles.msg, { color: item.tag === 'error' ? TAG_COLOR.error : text }]} selectable>
        {item.msg}
      </Text>
    </Pressable>
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <FlatList
        data={entered ? rows : EMPTY}
        keyExtractor={(l, i) => `${l.t}-${i}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={!entered ? undefined : <Text style={{ color: textSecondary, textAlign: 'center', marginTop: 40 }}>{t('log.empty')}</Text>}
        initialNumToRender={18}
        maxToRenderPerBatch={20}
        windowSize={5}
        contentContainerStyle={{
          paddingTop: pad.top + 8,
          paddingBottom: pad.bottom + pad.endPadding,
          paddingHorizontal: 16,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  debugBox: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  debugRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pill: { minWidth: 48, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mono: { fontSize: 11, fontVariant: ['tabular-nums'] },
  msg: { fontSize: 13, lineHeight: 18, marginTop: 3 },
});
