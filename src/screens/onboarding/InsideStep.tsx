// Welcome 2/3: "What's inside" — stacked colour bands (masterclass categories style). One band is open at a time
// and plays a tiny live demo; tapping another one slides it open while the open one closes.
import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { hapticTick } from '../../components/haptics';
import { CONDENSED_FONT } from '../../theme/fonts';
import { BackButton, Dots, EASE_IN_OUT, EASE_OUT, Headline, OB, PopButton } from './kit';

const CLOSED = 72; // a closed band shows its title
const OVERLAP = 16; // each band tucks under the one above
type Band = { key: 'lyrics' | 'queue' | 'stats' | 'people'; title: string; sub: string; color: string };
const BANDS: Band[] = [
  { key: 'lyrics', title: 'Lyrics', sub: 'line by line', color: '#FFD23F' },
  { key: 'queue', title: 'Queue', sub: 'never runs out', color: '#FF7A59' },
  { key: 'stats', title: 'Stats', sub: 'your month', color: '#7CC8F8' },
  { key: 'people', title: 'People', sub: 'community', color: '#6FE3A5' },
];

// Lines made up for this demo
const LINES = ['Neon on the bridge again', 'Your jacket smells like rain', 'We turn the radio up loud', "Saigon, don't fall asleep"];
function LyricsDemo({ live }: { live: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setI((n) => (n + 1) % LINES.length), 1300);
    return () => clearInterval(id);
  }, [live]);
  return (
    <View style={{ gap: 6 }}>
      {LINES.map((l, k) => (
        <View key={l} style={[styles.line, k === i && styles.lineOn]}>
          <Text style={[styles.lineText, { opacity: k === i ? 1 : 0.38 }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

const SONGS = [
  ['Midnight Scooter', '#FFD23F'],
  ['Paper Planes Home', '#A98BF5'],
  ['Low Tide', '#7CC8F8'],
  ['Rooftop 2AM', '#6FE3A5'],
  ['Static Heart', '#FF9BD0'],
];
function QueueDemo({ live }: { live: boolean }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setN((x) => x + 1), 1100);
    return () => clearInterval(id);
  }, [live]);
  const rows = Array.from({ length: Math.min(n, 4) }, (_, k) => n - Math.min(n, 4) + k);
  return (
    <View style={{ gap: 6 }}>
      {rows.map((k) => {
        const [name, c] = SONGS[k % SONGS.length];
        return (
          <Animated.View key={k} entering={FadeInDown.duration(300)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(250)} style={styles.qRow}>
            <View style={[styles.qArt, { backgroundColor: c }]} />
            <Text style={styles.qText}>{name}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const BARS = [0.4, 0.65, 0.3, 0.9, 0.55, 0.75, 0.45];
function Bar({ h, k, live }: { h: number; k: number; live: boolean }) {
  const v = useSharedValue(0.04);
  useEffect(() => {
    v.value = live ? withDelay(200 + k * 50, withTiming(h, { duration: 700, easing: EASE_OUT })) : 0.04;
  }, [live, h, k, v]);
  const st = useAnimatedStyle(() => ({ transform: [{ scaleY: v.value }] }));
  return <Animated.View style={[styles.bar, st]} />;
}
function StatsDemo({ live }: { live: boolean }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8, height: 100, alignItems: 'flex-end' }}>
        {BARS.map((h, k) => (
          <Bar key={k} h={h} k={k} live={live} />
        ))}
      </View>
      <Text style={[styles.qText, { marginTop: 8 }]}>14 h 20 min this month · top genre Indie</Text>
    </View>
  );
}

function PeopleDemo({ live }: { live: boolean }) {
  const [likes, setLikes] = useState(24);
  const s = useSharedValue(1);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setLikes((x) => x + 1);
      s.value = 1.35;
      s.value = withSpring(1, { duration: 400, dampingRatio: 0.45 });
    }, 1200);
    return () => clearInterval(id);
  }, [live, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <View style={styles.post}>
      <Text style={[styles.qText, { fontSize: 14 }]}>minh.anh shared a song</Text>
      <Text style={{ color: OB.ink, fontSize: 13, marginTop: 2 }}>This one is on repeat all week.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <Animated.Text style={[{ color: '#E5484D', fontSize: 18 }, st]}>♥</Animated.Text>
        <Text style={styles.qText}>{likes}</Text>
      </View>
    </View>
  );
}

function BandView({ band, open, height, onPress, index }: { band: Band; open: boolean; height: number; onPress: () => void; index: number }) {
  const h = useSharedValue(open ? height : CLOSED);
  useEffect(() => {
    h.value = withTiming(open ? height : CLOSED, { duration: 500, easing: EASE_IN_OUT });
  }, [open, height, h]);
  const st = useAnimatedStyle(() => ({ height: h.value }));
  // the demo fades in once the band has opened, and only runs while open
  const o = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    o.value = open ? withDelay(200, withTiming(1, { duration: 350 })) : withTiming(0, { duration: 150 });
  }, [open, o]);
  const fade = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 12 }] }));
  return (
    <Animated.View style={[styles.band, { backgroundColor: band.color, marginTop: index ? -OVERLAP : 0 }, st]}>
      <Pressable onPress={onPress} style={{ flex: 1 }} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={band.title}>
        <View style={styles.bandHead}>
          <Text allowFontScaling={false} style={styles.bandTitle}>
            {band.title}
          </Text>
          <Text style={styles.bandSub}>{band.sub}</Text>
        </View>
        <Animated.View style={[{ marginTop: 10 }, fade]}>
          {band.key === 'lyrics' && <LyricsDemo live={open} />}
          {band.key === 'queue' && <QueueDemo live={open} />}
          {band.key === 'stats' && <StatsDemo live={open} />}
          {band.key === 'people' && <PeopleDemo live={open} />}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export function InsideStep({ onBack, onNext, scale }: { onBack: () => void; onNext: () => void; scale: number }) {
  const [open, setOpen] = useState(0);
  const [avail, setAvail] = useState(0);
  const openH = Math.max(CLOSED + 120, avail - (BANDS.length - 1) * (CLOSED - OVERLAP));
  return (
    <View style={{ flex: 1 }}>
      <Dots at={1} />
      <Headline size={44 * scale} style={{ marginTop: 14, marginBottom: 12 }}>
        {"What's inside"}
      </Headline>
      <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e: LayoutChangeEvent) => setAvail(e.nativeEvent.layout.height)}>
        {avail > 0 &&
          BANDS.map((b, i) => (
            <BandView
              key={b.key}
              band={b}
              index={i}
              open={open === i}
              height={openH}
              onPress={() => {
                if (open !== i) hapticTick();
                setOpen(i);
              }}
            />
          ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <BackButton onPress={onBack} />
        <PopButton kind="ink" label="Next" onPress={onNext} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { borderWidth: 2.5, borderColor: OB.ink, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, overflow: 'hidden' },
  bandHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bandTitle: { fontFamily: CONDENSED_FONT, fontWeight: 'normal', fontSize: 34, lineHeight: 36, color: OB.ink, textTransform: 'uppercase', includeFontPadding: false },
  bandSub: { fontSize: 12, fontWeight: '800', color: OB.ink, opacity: 0.7 },
  line: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  lineOn: { backgroundColor: OB.acc, borderColor: OB.ink, transform: [{ rotate: '-1deg' }] },
  lineText: { fontSize: 17, fontWeight: '900', color: OB.ink },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: OB.paper, borderWidth: 2, borderColor: OB.ink, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  qArt: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: OB.ink },
  qText: { fontSize: 13, fontWeight: '700', color: OB.ink },
  bar: { flex: 1, height: '100%', backgroundColor: OB.ink, borderTopLeftRadius: 6, borderTopRightRadius: 6, transformOrigin: 'bottom' },
  post: { backgroundColor: OB.paper, borderWidth: 2, borderColor: OB.ink, borderRadius: 14, padding: 10 },
});
