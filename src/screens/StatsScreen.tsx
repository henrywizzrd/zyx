// Thống kê nghe nhạc (Home → nút biểu đồ): tổng thời gian nghe, nghe theo ngày / tháng, giờ hay nghe,
// top bài và top nghệ sĩ trong Tuần / Tháng / Năm. Tính từ lịch sử nghe trong máy (được sao lưu theo tài khoản).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useNav } from '../nav/Nav';
import { useAnimatedBack, useEntered } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { GlassFill, glassShadow, SQUIRCLE } from '../components/Glass';
import { SmartImage } from '../components/Cover';
import { usePlayerPick } from '../player/PlayerProvider';
import { getListenStats, ListenStats } from '../data/db';

type Range = 'week' | 'month' | 'year';
const DAY = 86400000;

function rangeSpec(r: Range) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = today.getTime() + DAY;
  if (r === 'week') return { since: end - 7 * DAY, buckets: 7, bucketMs: DAY };
  if (r === 'month') return { since: end - 30 * DAY, buckets: 30, bucketMs: DAY };
  const ms = (365 * DAY) / 12;
  return { since: end - 365 * DAY, buckets: 12, bucketMs: ms };
}

const fmtNum = (n: number, lang: string) => Math.round(n).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');

export function StatsScreen() {
  const { theme } = useTheme();
  const { text, textSecondary, accent, onAccent } = theme.colors;
  const light = theme.colors.glassTint !== 'dark';
  const t = useT();
  const pad = useContentInsets();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const entered = useEntered();
  const { playTrack } = usePlayerPick('playTrack');
  const [range, setRange] = useState<Range>('week');
  const lang = theme.language;
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';

  const spec = useMemo(() => rangeSpec(range), [range]);
  const stats: ListenStats | null = useMemo(() => (entered ? getListenStats(spec.since, spec.buckets, spec.bucketMs) : null), [entered, spec]);

  const minutes = (stats?.seconds ?? 0) / 60;
  const maxDay = Math.max(1, ...(stats?.byDay ?? [0]));
  const maxHour = Math.max(1, ...(stats?.byHour ?? [0]));
  const peakHour = stats && stats.seconds > 0 ? stats.byHour.indexOf(Math.max(...stats.byHour)) : -1;

  const barLabel = (i: number) => {
    const d = new Date(spec.since + i * spec.bucketMs + (range === 'year' ? spec.bucketMs / 2 : 0));
    if (range === 'week') return d.toLocaleDateString(locale, { weekday: 'short' });
    if (range === 'month') return i % 5 === 4 || i === spec.buckets - 1 ? String(d.getDate()) : '';
    return d.toLocaleDateString(locale, { month: 'narrow' });
  };

  const card = (children: React.ReactNode, style?: object) => (
    <View style={[styles.card, glassShadow(0.9, light), style]}>
      <GlassFill radius={R} solid={0.45} slab />
      {children}
    </View>
  );

  const empty = !!stats && stats.plays === 0;

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: pad.top + 8,
          paddingBottom: pad.bottom + pad.endPadding,
          paddingHorizontal: 16,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        <View style={styles.topBar}>
          <Pressable onPress={goBack} hitSlop={10} style={styles.circle}>
            <GlassFill radius={19} solid={0.35} slab />
            <Ionicons name="chevron-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>{t('stats.title')}</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.ranges}>
          {(['week', 'month', 'year'] as const).map((r) => {
            const on = r === range;
            return (
              <Pressable key={r} onPress={() => setRange(r)} style={[styles.range, on && { backgroundColor: accent }]}>
                {!on && <GlassFill radius={18} solid={0.35} slab />}
                <Text style={{ color: on ? onAccent : text, fontWeight: '700', fontSize: 14 }}>{t(`stats.${r}` as any)}</Text>
              </Pressable>
            );
          })}
        </View>

        {!stats ? null : empty ? (
          card(
            <View style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
              <Ionicons name="headset-outline" size={34} color={textSecondary} />
              <Text style={{ color: textSecondary, fontSize: 15, textAlign: 'center' }}>{t('stats.empty')}</Text>
            </View>
          )
        ) : (
          <>
            {/* Tổng thời gian nghe + nghe theo ngày / tháng */}
            {card(
              <>
                <Text style={{ color: textSecondary, fontSize: 14, fontWeight: '600' }}>{t(`stats.listened.${range}` as any)}</Text>
                <Text style={{ color: text, fontSize: 44, fontWeight: '800', letterSpacing: -1, marginTop: 2 }}>
                  {fmtNum(minutes, lang)} <Text style={{ fontSize: 20, fontWeight: '700', color: textSecondary }}>{t('stats.minutes')}</Text>
                </Text>
                <Text style={{ color: textSecondary, fontSize: 13, marginTop: 4 }}>
                  {t('stats.counts', { plays: fmtNum(stats.plays, lang), songs: fmtNum(stats.songs, lang), artists: fmtNum(stats.artists, lang) })}
                </Text>
                <View style={styles.bars}>
                  {stats.byDay.map((s, i) => (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${Math.max(s > 0 ? 4 : 0, (s / maxDay) * 100)}%`,
                              backgroundColor: accent,
                              opacity: i === stats.byDay.length - 1 ? 1 : 0.75,
                              borderRadius: range === 'month' ? 2 : 5,
                            },
                          ]}
                        />
                      </View>
                      <Text numberOfLines={1} style={[styles.barLabel, { color: textSecondary }]}>
                        {barLabel(i)}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Giờ hay nghe trong ngày */}
            {card(
              <>
                <Text style={[styles.cardTitle, { color: text }]}>{t('stats.hours')}</Text>
                {peakHour >= 0 && (
                  <Text style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{t('stats.peak', { h: `${String(peakHour).padStart(2, '0')}:00` })}</Text>
                )}
                <View style={[styles.bars, { height: 64, gap: 2 }]}>
                  {stats.byHour.map((s, h) => (
                    <View key={h} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, { height: `${Math.max(s > 0 ? 6 : 0, (s / maxHour) * 100)}%`, backgroundColor: accent, opacity: h === peakHour ? 1 : 0.55, borderRadius: 2 }]} />
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.hourAxis}>
                  {['0', '6', '12', '18', '24'].map((x) => (
                    <Text key={x} style={[styles.barLabel, { color: textSecondary }]}>
                      {x}h
                    </Text>
                  ))}
                </View>
              </>
            )}

            {/* Top bài */}
            {card(
              <>
                <Text style={[styles.cardTitle, { color: text, marginBottom: 6 }]}>{t('stats.topSongs')}</Text>
                {stats.topSongs.slice(0, 5).map((s, i) => (
                  <Pressable
                    key={s.track.id}
                    onPress={() => playTrack(s.track, stats.topSongs.map((x) => x.track), { kind: 'mix', id: `stats-${range}`, title: t('stats.topSongs') })}
                    style={styles.songRow}
                  >
                    <Text style={[styles.rank, { color: i === 0 ? accent : textSecondary }]}>{i + 1}</Text>
                    <View style={styles.thumb}>{s.track.thumb ? <SmartImage url={s.track.thumb} size={96} style={StyleSheet.absoluteFill} /> : null}</View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: text, fontSize: 15, fontWeight: '700' }}>
                        {s.track.title}
                      </Text>
                      <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 13, marginTop: 1 }}>
                        {s.track.artist}
                      </Text>
                    </View>
                    <Text style={{ color: textSecondary, fontSize: 12, fontWeight: '600' }}>{t('stats.plays', { n: s.plays })}</Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Top nghệ sĩ */}
            {stats.topArtists.length > 0 &&
              card(
                <>
                  <Text style={[styles.cardTitle, { color: text, marginBottom: 10 }]}>{t('stats.topArtists')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                    {stats.topArtists.slice(0, 8).map((a, i) => (
                      <View key={a.artist} style={{ width: 84, alignItems: 'center' }}>
                        <View style={[styles.artistPic, i === 0 && { borderWidth: 2, borderColor: accent }]}>
                          {a.thumb ? <SmartImage url={a.thumb} size={168} style={StyleSheet.absoluteFill} /> : null}
                        </View>
                        <Text numberOfLines={1} style={{ color: text, fontSize: 13, fontWeight: '700', marginTop: 6 }}>
                          {a.artist}
                        </Text>
                        <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 11, marginTop: 1 }}>
                          {fmtNum(a.seconds / 60, lang)} {t('stats.min')}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const R = 22;
const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  ranges: { flexDirection: 'row', gap: 8, marginTop: 18, marginBottom: 6 },
  range: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, ...SQUIRCLE },
  card: { marginTop: 14, padding: 16, borderRadius: R, ...SQUIRCLE },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 16, gap: 4 },
  barCol: { flex: 1, height: '100%', alignItems: 'center' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%' },
  barLabel: { fontSize: 10, fontWeight: '600', marginTop: 5 },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rank: { width: 18, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.2)', ...SQUIRCLE },
  artistPic: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.2)' },
});
