import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, View, AppState } from 'react-native';
import type { Lyrics } from '../music/lyrics';
import { musicSupported } from '../music/lazy';
import { getLiveRate } from '../player/fxEngine';
import { usePlayerPick, playClock } from '../player/PlayerProvider';
import { useT } from '../i18n';
import { usePlayerTransition } from './PlayerTransition';
import { markRender } from './JankMonitor';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

const USE_NATIVE = Platform.OS !== 'web';
// Kiểu khai báo của thư viện chưa khớp React 19, ép kiểu để dùng như component bình thường
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;
const TICK_MS = 80; // đọc thời gian bài hát ~12 lần mỗi giây
const LEAD = 0.2; // hiện dòng mới sớm một chút, vì mắt đọc chậm hơn tai nghe
const INTRO_MIN = 4; // câu hát đầu bắt đầu sau từng này giây thì coi đoạn trước đó là nhạc dạo
const GAP_MIN = 10;
const BACK_MS = 1500; // người dùng tự lướt xem lời: thả tay ra từng này mili giây thì tự lướt về câu đang hát // hai câu cách nhau từng này giây trở lên thì chèn đoạn chỉ có nhạc vào giữa

// Dòng không hát thì nhoè (kiểu Spotify): chữ mờ đi và toả bóng trắng mềm ra xung quanh,
// càng xa dòng đang hát càng nhoè. Dùng bóng chữ nên rất nhẹ máy, không cần lớp blur thật
const GLOW = 24; // chỗ trống quanh chữ cho quầng sáng
const styles = StyleSheet.create({
  // Chữ có khoảng đệm rộng (rồi lùi lại bằng lề âm nên vị trí chữ không đổi) để quầng sáng có chỗ toả ra.
  // Không có đệm thì bóng chữ bị cắt theo khung chữ nhật của dòng → nhìn vuông vức
  line: { fontSize: 30, lineHeight: 38, fontWeight: '800', paddingHorizontal: GLOW, marginHorizontal: -GLOW, paddingVertical: GLOW, marginVertical: -GLOW },
  // Câu đang hát: trắng sáng + quầng sáng toả ra xung quanh (chói như đèn)
  active: { color: '#FFFFFF', textShadowColor: 'rgba(255,255,255,0.55)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  plain: { color: '#FFFFFF' },
  // Đang tự lướt xem lời: các câu khác hết nhoè để đọc được
  browse: { color: 'rgba(255,255,255,0.5)' },
  near: { color: 'rgba(255,255,255,0.32)', textShadowColor: 'rgba(255,255,255,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } },
  // lớp mờ của LyricLine: KHÔNG có bóng chữ (bóng chữ to làm iPhone vẽ chữ rất lâu; cả trăm dòng cùng lúc khi đổi bài)
  dim: { color: 'rgba(255,255,255,0.3)' },
  far: { color: 'rgba(255,255,255,0.2)', textShadowColor: 'rgba(255,255,255,0.4)', textShadowRadius: 9, textShadowOffset: { width: 0, height: 0 } },
});
type LineState = 'active' | 'near' | 'far' | 'browse' | 'plain';
const stateFor = (d: number): LineState => (d <= 1 ? 'near' : 'far');

// Một dòng lời = HAI lớp chữ chồng nhau, kiểu chữ không bao giờ đổi: lớp sáng (câu đang hát, có quầng) và lớp mờ (có bóng mềm).
// Sang câu mới chỉ đổi ĐỘ TRONG của hai lớp (chạy trên GPU, mờ dần ~0,3s). Trước đây đổi kiểu chữ (màu + bóng) của vài dòng
// mỗi lần sang câu → iPhone phải vẽ lại chữ có bóng to trên luồng giao diện → giao diện khựng ~140ms mỗi lần đổi câu (log 13/11)
const DIM: Record<LineState, number> = { active: 0, near: 1, far: 0.6, browse: 1, plain: 0 };
// Lớp sáng (có quầng) chỉ được dựng cho các dòng quanh câu đang hát (near), dòng xa chỉ có lớp mờ → đổi bài không phải
// dựng / vẽ cả trăm dòng chữ có quầng
const LyricLine = React.memo(function LyricLine({ text, state, near }: { text: string; state: LineState; near: boolean }) {
  const lit = state === 'active' || state === 'plain';
  const a = useRef(new Animated.Value(lit ? 1 : 0)).current;
  const d = useRef(new Animated.Value(DIM[state])).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const cfg = { duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: USE_NATIVE };
    Animated.parallel([Animated.timing(a, { toValue: lit ? 1 : 0, ...cfg }), Animated.timing(d, { toValue: DIM[state], ...cfg })]).start();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View>
      <Animated.Text style={[styles.line, state === 'browse' ? styles.browse : styles.dim, { opacity: d }]}>{text}</Animated.Text>
      {(near || lit) && <Animated.Text style={[styles.line, styles.active, { position: 'absolute', left: 0, right: 0, top: 0, opacity: a }]}>{text}</Animated.Text>}
    </View>
  );
});

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
  progress = 0,
  onSeek,
  focus,
  fade = true,
  fadeStops,
}: {
  status: 'idle' | 'loading' | 'done';
  lyrics: Lyrics | null;
  progress?: number; // chỉ dùng khi không đọc được thời gian từ trình phát (web)
  onSeek: (seconds: number) => void;
  // Câu đang hát nằm ở độ cao này trong khung (px tính từ mép trên). Không truyền thì nằm giữa khung.
  // Lời toàn màn hình dùng: khung lời luôn to bằng cả màn hình, câu đang hát giữ đúng chỗ cũ khi mở / đóng toàn màn hình
  focus?: number;
  fade?: boolean; // mép trên / dưới mờ dần (tắt khi bên ngoài đã tự làm mép mờ)
  // [hết vùng mờ trên, bắt đầu vùng mờ dưới] theo phần khung (0..1). Dải mờ dài + mềm → chữ hiện dần từ dưới lên rồi tan dần ở
  // trên, không thấy "cái hộp" (player Đĩa than dùng). Mặc định dải mờ ngắn 12%
  fadeStops?: [number, number];
}) {
  const { track, duration } = usePlayerPick('track', 'duration');
  const { moving, active } = usePlayerTransition();
  const activeRef = useRef(active);
  activeRef.current = active;
  const t = useT();
  // Không còn chỉnh lệch tay: lời được chọn theo đúng videoId / độ dài thật nên khớp sẵn
  const offset = 0;
  const scroll = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const hs = useRef<number[]>([]); // chiều cao từng dòng, để đặt câu đang hát đúng giữa khung
  const [h, setH] = useState(0);
  const focusAt = focus != null && h > 0 ? Math.min(h, Math.max(0, focus)) : h / 2;

  const rows = useMemo(() => (lyrics ? buildRows(lyrics, duration) : []), [lyrics, duration]);
  const last = useRef(rows);
  const gen = useRef(0);
  const wrapY = useRef(0); // vị trí khối các dòng trong nội dung cuộn (vị trí từng dòng đo theo khối này) // đổi lời (đổi bài) → dựng lại toàn bộ dòng để đo lại vị trí từng dòng
  // Lần đầu hiện (mở player, đổi bài): nhảy thẳng tới câu đang hát, không cuộn từ trên xuống.
  // Ẩn khung lời cho tới khi đã nhảy xong để không thấy nháy.
  const placed = useRef(false);
  const [ready, setReady] = useState(false);
  if (last.current !== rows) {
    last.current = rows;
    gen.current++;
    ys.current = [];
    hs.current = [];
    placed.current = false;
  }

  // Đồng hồ riêng cho lời: đọc thẳng thời gian từ trình phát thay vì đợi sự kiện 0,5 giây một lần.
  // Chỉ vẽ lại khi sang dòng mới.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const readTime = () => {
    if (musicSupported && playClock.at) {
      // Nội suy từ lần báo gần nhất của trình phát (không gọi xuống trình phát)
      return playClock.t + (playClock.playing ? ((Date.now() - playClock.at) / 1000) * getLiveRate() : 0);
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
      if (AppState.currentState !== 'active') return; // ở nền / tắt màn hình: không đọc thời gian, không vẽ lại lời
      if (!activeRef.current) return; // player đang đóng (ẩn): không cần theo lời
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
    // Đặt tâm của dòng vào đúng chỗ (giữa khung, hoặc độ cao focus)
    scroll.current?.scrollTo({ y: Math.max(0, wrapY.current + y + (hs.current[i] ?? 0) / 2 - focusAt), animated });
    return true;
  };

  // Người dùng tự lướt xem lời: tạm ngưng tự cuộn. Thả tay ra (và lời đã dừng trôi) mà 1,5 giây không chạm lại
  // thì tự lướt về câu đang hát. Chạm lại / lướt tiếp thì huỷ hẹn giờ.
  const [browsing, setBrowsing] = useState(false);
  const browsingRef = useRef(false);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelBack = () => {
    if (backTimer.current) clearTimeout(backTimer.current);
    backTimer.current = null;
  };
  const startBrowse = () => {
    cancelBack();
    if (!browsingRef.current) {
      browsingRef.current = true;
      setBrowsing(true);
    }
  };
  const scheduleBack = () => {
    if (!browsingRef.current) return;
    cancelBack();
    backTimer.current = setTimeout(() => {
      backTimer.current = null;
      browsingRef.current = false;
      setBrowsing(false);
      if (curRef.current >= 0) scrollToLine(curRef.current, true);
    }, BACK_MS);
  };
  useEffect(() => cancelBack, []);
  // Bấm vào một dòng để tua: về chế độ theo lời ngay
  const stopBrowse = () => {
    cancelBack();
    browsingRef.current = false;
    setBrowsing(false);
  };

  // ghi mốc "đổi câu" để log khựng biết có trùng lúc sang câu mới không
  useEffect(() => {
    if (cur >= 0) markRender('lời đổi câu');
  }, [cur]);

  // Lần đầu (hoặc khung lời vừa đổi chiều cao): nhảy tức thì. Sau đó: cuộn mượt theo câu đang hát.
  const lastH = useRef(0);
  useEffect(() => {
    if (!h) return;
    const key = h * 100000 + Math.round(focusAt);
    const resized = lastH.current !== key;
    lastH.current = key;
    if (!placed.current || resized) {
      if (cur < 0 || scrollToLine(cur, false)) {
        placed.current = true;
        setReady(true);
      }
      return;
    }
    if (cur >= 0 && !browsingRef.current) scrollToLine(cur, true);
  }, [cur, h, focusAt]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Khung lời rộng ra hai bên GLOW px (nội dung lùi vào lại đúng bằng chừng đó) để quầng sáng ở mép trái/phải không bị cắt
    <View style={{ flex: 1, marginHorizontal: -GLOW }}>
      {/* Mép trên và mép dưới của khung lời mờ dần (chữ tan dần khi trôi ra khỏi khung, không bị cắt ngang) */}
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          fadeStops && fade ? (
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.75)', '#000', '#000', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.18)', 'transparent']}
              locations={[0, fadeStops[0] * 0.4, fadeStops[0] * 0.75, fadeStops[0], fadeStops[1], fadeStops[1] + (1 - fadeStops[1]) * 0.35, fadeStops[1] + (1 - fadeStops[1]) * 0.7, 1]}
              style={{ flex: 1 }}
            />
          ) : (
            <LinearGradient
              colors={['transparent', '#000', '#000', 'transparent']}
              locations={fade ? [0, 0.12, 0.88, 1] : [0, 0, 1, 1]}
              style={{ flex: 1 }}
            />
          )
        }
      >
      <ScrollView
        ref={scroll}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        scrollEventThrottle={16}
        onScrollBeginDrag={startBrowse}
        onMomentumScrollBegin={cancelBack}
        onScrollEndDrag={scheduleBack}
        onMomentumScrollEnd={scheduleBack}
        style={{ flex: 1, opacity: ready ? 1 : 0 }}
        contentContainerStyle={{ paddingTop: focusAt, paddingBottom: h - focusAt, paddingHorizontal: GLOW }}
      >
        {!synced && (
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 12 }}>
            {t('lyrics.plainOnly')}
          </Text>
        )}
        {/* key theo lần đổi lời: khung lời giờ dựng sẵn và giữ lại qua các bài. Dòng mới mà nằm đúng chỗ dòng cũ thì không được đo
            lại (onLayout không chạy) → không biết vị trí → không cuộn theo, câu đang hát sáng nhưng lệch khỏi giữa (lời Zing 13/11) */}
        <View
          key={gen.current}
          onLayout={(e) => {
            // khối các dòng vừa có / đổi vị trí (đo xong sau các dòng, hoặc khung lời đổi cao): đặt lại câu đang hát vào giữa
            wrapY.current = e.nativeEvent.layout.y;
            if (curRef.current >= 0 && !browsingRef.current && scrollToLine(curRef.current, false)) {
              placed.current = true;
              setReady(true);
            }
          }}
        >
        {rows.map((l, i) => {
          const onLayout = (e: any) => {
            ys.current[i] = e.nativeEvent.layout.y;
            hs.current[i] = e.nativeEvent.layout.height;
            // Dòng đang hát vừa được đo (lần đầu, hoặc đo lại vì bố cục vừa xê dịch — ví dụ khung lời vừa có chiều cao thật
            // khi mở player): đặt lại đúng giữa khung ngay. Trước đây chỉ đặt một lần theo số đo cũ nên mở lại player
            // lời nằm sai chỗ và "đứng im" cho tới khi sang câu mới
            if (i === curRef.current && !browsingRef.current && scrollToLine(i, false)) {
              placed.current = true;
              setReady(true);
            }
          };
          const active = synced ? i === cur : true;
          if (l.music) {
            return (
              <Pressable key={i} onLayout={onLayout} onPress={() => {
                if (l.t == null) return;
                stopBrowse();
                onSeek(Math.max(0, l.t - offset));
                scrollToLine(i, true);
              }} style={{ paddingVertical: 6 }}>
                <MusicNotes active={active && !moving} />
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
              onPress={() => {
                if (l.t == null) return;
                stopBrowse();
                onSeek(Math.max(0, l.t - offset));
                scrollToLine(i, true);
              }}
              style={{ paddingVertical: 6 }}
            >
              <LyricLine text={l.text} near={!synced || Math.abs(i - cur) <= 2} state={!synced ? 'plain' : active ? 'active' : browsing ? 'browse' : stateFor(Math.abs(i - cur))} />
            </Pressable>
          );
        })}
        </View>
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
