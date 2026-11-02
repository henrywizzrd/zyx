import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, ScrollViewInstance, Text, View } from 'react-native';
import type { Lyrics } from '../music/lyrics';
import { audio, musicSupported } from '../music/lazy';
import { usePlayer } from '../player/PlayerProvider';
import { useT } from '../i18n';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

const USE_NATIVE = Platform.OS !== 'web';
// Kiểu khai báo của thư viện chưa khớp React 19, ép kiểu để dùng như component bình thường
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
const TICK_MS = 80; // đọc thời gian bài hát ~12 lần mỗi giây
const LEAD = 0.2; // hiện dòng mới sớm một chút, vì mắt đọc chậm hơn tai nghe
const INTRO_MIN = 4; // câu hát đầu bắt đầu sau từng này giây thì coi đoạn trước đó là nhạc dạo
const GAP_MIN = 10; // hai câu cách nhau từng này giây trở lên thì chèn đoạn chỉ có nhạc vào giữa

// Một dòng hiển thị: câu hát, hoặc đoạn chỉ có nhạc (hiện nốt nhạc)
type Row = { t: number | null; text: string; music?: boolean };

// Ước lượng một câu hát kéo dài bao lâu (lời LRC chỉ có giờ bắt đầu, không có giờ kết thúc)
const singFor = (text: string) => Math.min(6, Math.max(3, text.length * 0.18));

function buildRows(lyrics: Lyrics, duration: number): Row[] {
  if (!lyrics.synced) return lyrics.lines.map((l) => ({ t: null, text: l.text }));
  const src = lyrics.lines.filter((l) => l.t != null) as { t: number; text: string }[];
  const rows: Row[] = [];
  if (src.length && src[0].t >= INTRO_MIN) rows.push({ t: 0, text: '', music: true });
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (!l.text) {
      // Dòng trống trong file LRC thường là chỗ chỉ có nhạc. Gộp nhiều dòng trống liền nhau làm một.
      if (!rows.length || !rows[rows.length - 1].music) rows.push({ t: l.t, text: '', music: true });
      continue;
    }
    rows.push({ t: l.t, text: l.text });
    // Khoảng trống dài giữa hai câu mà file không đánh dấu: tự chèn đoạn chỉ có nhạc sau khi câu này hát xong
    const nextT = i + 1 < src.length ? src[i + 1].t : duration > 0 ? duration : null;
    if (nextT != null && src[i + 1]?.text !== '' && nextT - l.t >= GAP_MIN) {
      const at = l.t + singFor(l.text);
      if (nextT - at >= GAP_MIN / 2) rows.push({ t: at, text: '', music: true });
    }
  }
  return rows;
}

function currentIndex(rows: Row[], time: number) {
  let cur = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i].t ?? Infinity) <= time + LEAD) cur = i;
    else break;
  }
  return cur;
}

// Ba nốt nhạc nhấp nháy lần lượt khi đang ở đoạn chỉ có nhạc
function MusicNotes({ active }: { active: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      v.stopAnimation();
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: USE_NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [active, v]);

  return (
    <View style={{ flexDirection: 'row', gap: 10, height: 38, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => {
        const a = i / 3;
        const opacity = active
          ? v.interpolate({ inputRange: [0, a, a + 0.15, a + 0.33, 1], outputRange: [0.35, 0.35, 1, 0.35, 0.35], extrapolate: 'clamp' })
          : 0.35;
        const translateY = active
          ? v.interpolate({ inputRange: [0, a, a + 0.15, a + 0.33, 1], outputRange: [0, 0, -5, 0, 0], extrapolate: 'clamp' })
          : 0;
        return (
          <Animated.Text key={i} style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800', opacity, transform: [{ translateY }] }}>
            ♪
          </Animated.Text>
        );
      })}
    </View>
  );
}

export function LyricsView({
  status,
  lyrics,
  progress,
  onSeek,
}: {
  status: 'idle' | 'loading' | 'done';
  lyrics: Lyrics | null;
  progress: number;
  onSeek: (seconds: number) => void;
}) {
  const { track, duration } = usePlayer();
  const t = useT();
  // Không còn chỉnh lệch tay: lời được chọn theo đúng videoId / độ dài thật nên khớp sẵn
  const offset = 0;
  const scroll = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const [h, setH] = useState(0);

  const rows = useMemo(() => (lyrics ? buildRows(lyrics, duration) : []), [lyrics, duration]);
  const last = useRef(rows);
  // Lần đầu hiện (mở player, đổi bài): nhảy thẳng tới câu đang hát, không cuộn từ trên xuống.
  // Ẩn khung lời cho tới khi đã nhảy xong để không thấy nháy.
  const placed = useRef(false);
  const [ready, setReady] = useState(false);
  if (last.current !== rows) {
    last.current = rows;
    ys.current = [];
    placed.current = false;
  }

  // Đồng hồ riêng cho lời: đọc thẳng thời gian từ trình phát thay vì đợi sự kiện 0,5 giây một lần.
  // Chỉ vẽ lại khi sang dòng mới.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const readTime = () => {
    if (musicSupported) {
      try {
        return audio().getPlayer().currentTime;
      } catch {}
    }
    return progressRef.current;
  };
  const synced = !!lyrics?.synced;
  const [cur, setCur] = useState(() => (synced ? currentIndex(rows, readTime() + offset) : -1));
  const curRef = useRef(cur);
  curRef.current = cur;
  useEffect(() => {
    if (!synced) {
      setCur(-1);
      return;
    }
    const tick = () => {
      const i = currentIndex(rows, readTime() + offsetRef.current);
      setCur((c) => (c === i ? c : i));
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [rows, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToLine = (i: number, animated: boolean) => {
    const y = ys.current[i];
    if (y == null || !h) return false;
    scroll.current?.scrollTo({ y: Math.max(0, y - h * 0.22), animated });
    return true;
  };

  // Lần đầu: nhảy tức thì. Sau đó: cuộn mượt theo câu đang hát.
  useEffect(() => {
    if (!h) return;
    if (!placed.current) {
      if (cur < 0 || scrollToLine(cur, false)) {
        placed.current = true;
        setReady(true);
      }
      return;
    }
    if (cur >= 0) scrollToLine(cur, true);
  }, [cur, h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lưới an toàn: nếu vì lý do nào đó chưa đặt được vị trí thì vẫn hiện sau 400ms
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(id);
  }, [rows]);

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (!lyrics) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>{t('lyrics.notFound')}</Text>
      </View>
    );
  }


  return (
    <View style={{ flex: 1 }}>
      {/* Mép trên và mép dưới của khung lời mờ dần (chữ tan dần khi trôi ra khỏi khung, không bị cắt ngang) */}
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <LinearGradient
            colors={['transparent', '#000', '#000', 'transparent']}
            locations={[0, 0.14, 0.8, 1]}
            style={{ flex: 1 }}
          />
        }
      >
      <ScrollView
        ref={scroll}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={{ flex: 1, opacity: ready ? 1 : 0 }}
        contentContainerStyle={{ paddingTop: h * 0.12 + 8, paddingBottom: h * 0.6 }}
      >
        {!synced && (
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 12 }}>
            {t('lyrics.plainOnly')}
          </Text>
        )}
        {rows.map((l, i) => {
          const onLayout = (e: any) => {
            ys.current[i] = e.nativeEvent.layout.y;
            // Dòng đang hát vừa đo xong mà chưa đặt vị trí lần đầu: nhảy tới luôn
            if (!placed.current && i === curRef.current && scrollToLine(i, false)) {
              placed.current = true;
              setReady(true);
            }
          };
          const active = synced ? i === cur : true;
          if (l.music) {
            return (
              <Pressable key={i} onLayout={onLayout} onPress={() => l.t != null && onSeek(Math.max(0, l.t - offset))} style={{ paddingVertical: 6 }}>
                <MusicNotes active={active} />
              </Pressable>
            );
          }
          if (!l.text) return <View key={i} onLayout={onLayout} style={{ height: 22 }} />;
          return (
            <Pressable
              key={i}
              onLayout={onLayout}
              disabled={l.t == null}
              // Bấm vào dòng: tua tới đúng lúc dòng đó hiện (đã tính độ lệch)
              onPress={() => l.t != null && onSeek(Math.max(0, l.t - offset))}
              style={{ paddingVertical: 6 }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 38, fontWeight: '800', opacity: active ? 1 : 0.35 }}>
                {l.text}
              </Text>
            </Pressable>
          );
        })}
        {/* Lời lấy từ đâu (YouTube Music / LyricFind, SimpMusic, LRCLIB) */}
        {!!lyrics.source && (
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 24 }}>
            {/^(source|nguồn)/i.test(lyrics.source) ? lyrics.source : t('lyrics.source', { src: lyrics.source })}
          </Text>
        )}
      </ScrollView>
      </MaskedView>

    </View>
  );
}
