import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { resetVinylFlags, setVinylFlag, useVinylFlags, VINYL_FLAGS } from '../debug/vinylFlags';
import { isStableBuild } from '../data/channel';
import { GlassLab } from '../debug/GlassLab';
import { blackBoxSnapshot } from '../data/blackbox';
import * as Sentry from '@sentry/react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useNav } from '../nav/Nav';
import { useAnimatedBack, useEntered } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { clearLog, dayOf, logToText, fmtTime, getDayLines, KEEP_DAYS, listLogDays, LogLine, LogTag, useLog, type DayMeta } from '../data/applog';
import { copyDay, sendDayFile, sendDayToDeveloper } from '../data/logShare';
import { kvGet, kvSet } from '../data/db';
import { useActionSheet } from '../components/ActionSheet';
import { LogCalendar, LogDayList, ViewToggle } from './LogOverview';

type Filter = 'all' | LogTag;
const EMPTY: LogLine[] = [];
const FILTERS: Filter[] = ['all', 'perf', 'motion', 'music', 'fx', 'error', 'jank', 'swipe', 'ui'];
const TAG_COLOR: Record<LogTag, string> = {
  motion: '#F5A524',
  perf: '#2DD4BF',
  music: '#3DB2FF',
  fx: '#A78BFA',
  error: '#E5484D',
  jank: '#F5A524',
  swipe: '#2EC27E',
  ui: '#8E8E93',
};

// Nhật ký dò lỗi (Cài đặt → Nhật ký): dòng mới nhất ở trên, lọc theo loại, chép / gửi, xoá
export function LogScreen({ day = null }: { day?: string | null }) {
  const { theme } = useTheme();
  const { text, textSecondary, surface, accent, accentText, onAccent, border } = theme.colors;
  const t = useT();
  const pad = useContentInsets();
  const { pop, push } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const live = useLog(); // re-renders when new lines arrive
  const sheet = useActionSheet();
  // overview (days) ↔ one day
  const [view, setViewState] = useState<'list' | 'calendar'>(() => (kvGet<string>('log.view') === 'calendar' ? 'calendar' : 'list'));
  const setView = (v: 'list' | 'calendar') => {
    setViewState(v);
    kvSet('log.view', v);
  };
  // one day's log is its own page, so swiping back from it returns to the overview
  const setDay = (d: string) => push({ type: 'log', day: d });
  const daysList = useMemo(() => listLogDays(), [live.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = day ? daysList.find((d) => d.day === day) ?? null : null;
  const all = useMemo(() => (day ? getDayLines(day) : []), [day, day === dayOf(Date.now()) ? live.length : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // Trượt vào xong mới dựng danh sách (log mở ra khựng ~350ms vì dựng cả trăm dòng cùng lúc với hiệu ứng trượt)
  const entered = useEntered();
  const [filter, setFilter] = useState<Filter>('all');
  const vflags = useVinylFlags();
  const offCount = VINYL_FLAGS.filter(([k]) => !vflags[k]).length;
  const [debugOpen, setDebugOpen] = useState(offCount > 0);
  const [labOpen, setLabOpen] = useState(false);
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

  const dayLabel = (d: string) => {
    const today = dayOf(Date.now());
    if (d === today) return t('log.today');
    if (d === dayOf(Date.now() - 86400000)) return t('log.yesterday');
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(theme.language === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };
  // Copy / Send file / Send to developer for one day
  const openSend = (m: DayMeta) =>
    sheet.openActions({ title: t('log.sendTitle', { day: dayLabel(m.day) }), subtitle: t('log.sendSub'), icon: 'paper-plane-outline' }, [
      { label: t('log.copy'), icon: 'copy-outline', run: () => copyDay(m.day) },
      { label: t('log.sendFile'), icon: 'document-text-outline', run: () => sendDayFile(m.day) },
      {
        label: t('log.sendDev'),
        icon: 'mail-outline',
        run: async () => {
          sheet.toast(t('log.sending'));
          const r = await sendDayToDeveloper(m);
          sheet.toast(t(r === 'ok' ? 'log.sent' : r === 'limit' ? 'log.sendLimit' : r === 'offline' ? 'log.sendOffline' : 'log.sendFailed'));
        },
      },
    ]);
  const share = () => {
    if (meta) openSend(meta);
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
        <Pressable onPress={goBack} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]} accessibilityLabel={t('common.back')}>
          <Ionicons name="chevron-back" size={24} color={text} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text numberOfLines={1} style={[styles.title, { color: text }]}>{day ? dayLabel(day) : t('log.title')}</Text>
          {meta && (
            <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>
              {t('log.lines', { n: meta.lines })}
              {meta.crashes ? ` · ${t('log.crashes', { n: meta.crashes })}` : ''}
              {meta.errors ? ` · ${t('log.errors', { n: meta.errors })}` : ''}
            </Text>
          )}
        </View>
        {day ? (
          <Pressable onPress={share} hitSlop={8} style={[styles.circle, { backgroundColor: surface }]} accessibilityLabel={t('log.share')}>
            <Ionicons name="share-outline" size={20} color={text} />
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ViewToggle value={view} onChange={setView} />
            <Pressable onPress={clear} hitSlop={8} style={[styles.circle, { backgroundColor: surface }]} accessibilityLabel={t('log.clear')}>
              <Ionicons name="trash-outline" size={20} color={text} />
            </Pressable>
          </View>
        )}
      </View>
      {!day && <Text style={{ color: textSecondary, fontSize: 13, marginTop: 10 }}>{t('log.hint')}</Text>}
      {/* Dò lỗi player đĩa than: tắt từng phần rồi mở / đóng player, xem nhật ký còn "khựng" không (tạm thời, sẽ gỡ).
          Ẩn ở bản ổn định cho người dùng (kênh production) */}
      {!day && !isStableBuild() && (
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
              <Text style={{ color: accentText, fontWeight: '700' }}>Bật lại tất cả</Text>
            </Pressable>
          </View>
        )}
        {/* Glass Lab (beta): compare every glass material, dock vs in-page */}
        <Pressable onPress={() => setLabOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Ionicons name="color-filter-outline" size={18} color={text} />
          <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15 }}>Glass Lab</Text>
          <Ionicons name={labOpen ? 'chevron-up' : 'chevron-down'} size={18} color={textSecondary} />
        </Pressable>
        {labOpen && <GlassLab text={text} sub={textSecondary} />}
        {/* Black box tests (beta): send a log snapshot now, or crash the app natively to test the next-launch report */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={() => {
              blackBoxSnapshot('test', 'manual test from the Log screen');
              Alert.alert('Black box', 'Log snapshot sent to Sentry.');
            }}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: textSecondary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: text, fontWeight: '700' }}>Send log now</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert('Crash the app?', 'ZYX closes immediately. Open it again: the log before the crash is sent to Sentry.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Crash', style: 'destructive', onPress: () => Sentry.nativeCrash() },
              ])
            }
            style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#c0392b', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Simulate crash</Text>
          </Pressable>
        </View>
      </View>
      )}
      {day && (
        <View style={styles.topActions}>
          <Pressable onPress={() => copyDay(day, all)} style={[styles.barBtn, { backgroundColor: surface, borderColor: border }]}>
            <Ionicons name="copy-outline" size={18} color={text} />
            <Text style={{ color: text, fontWeight: '700', fontSize: 15 }}>{t('log.copy')}</Text>
          </Pressable>
          <Pressable onPress={share} style={[styles.barBtn, { backgroundColor: accent, borderColor: accent }]}>
            <Ionicons name="paper-plane-outline" size={18} color={onAccent} />
            <Text style={{ color: onAccent, fontWeight: '800', fontSize: 15 }}>{t('log.send')}</Text>
          </Pressable>
        </View>
      )}
      {day && meta?.crashes ? (
        <View style={[styles.crashBox, { borderColor: '#E5484D' }]}>
          <Ionicons name="warning-outline" size={18} color="#E5484D" />
          <Text style={{ flex: 1, color: text, fontSize: 13 }}>
            {t('log.crashAt', { time: (meta.crashAt ?? []).map((x) => fmtTime(x).slice(6, 14)).join(', ') })}
          </Text>
        </View>
      ) : null}
      {day && (
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
      )}
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

  const contentStyle = {
    paddingTop: pad.top + 8,
    paddingBottom: pad.bottom + pad.endPadding,
    paddingHorizontal: 16,
    width: '100%' as const,
    maxWidth: 720,
    alignSelf: 'center' as const,
  };

  if (!day) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={contentStyle}>
          {header}
          <View style={{ height: 14 }} />
          {view === 'list' ? (
            <LogDayList days={daysList} label={dayLabel} onOpen={setDay} onSend={openSend} />
          ) : (
            <LogCalendar days={daysList} label={dayLabel} onOpen={setDay} onSend={openSend} />
          )}
          <Text style={{ color: textSecondary, fontSize: 12, textAlign: 'center', marginTop: 18 }}>{t('log.keep', { n: KEEP_DAYS })}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <FlatList showsVerticalScrollIndicator={false}
        data={entered ? rows : EMPTY}
        keyExtractor={(l, i) => `${l.t}-${i}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={!entered ? undefined : <Text style={{ color: textSecondary, textAlign: 'center', marginTop: 40 }}>{t('log.empty')}</Text>}
        initialNumToRender={18}
        maxToRenderPerBatch={20}
        windowSize={5}
        contentContainerStyle={contentStyle}
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
  crashBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: 'rgba(229,72,77,0.12)' },
  topActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  barBtn: { flex: 1, height: 50, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
