// Player kiểu "Đĩa than" (Cài đặt → Kiểu player → Đĩa than), dựng theo trang thử "ZYX – Player Đĩa than":
//  - đĩa than khổng lồ có tâm ở góc trên trái màn hình, chỉ thấy một phần tư; nhãn giữa đĩa = ảnh bìa bài hát
//  - đang phát: nhãn xoay rất chậm (3 vòng/phút); dừng: trôi thêm một chút rồi đứng (có quán tính)
//    (rãnh đĩa là các vòng tròn đồng tâm nên xoay hay không nhìn như nhau → chỉ xoay ẢNH nhãn, rãnh vẽ một lần, rất nhẹ máy)
//  - thanh thời gian cong theo rìa đĩa, kéo gần sát hai mép màn hình; số giờ cũng chạy theo đường cong; chạm / kéo dọc cung để tua
//  - cột trái: thích · lời · hàng chờ · hiệu ứng; bên phải: âm lượng dọc
//  - giữa phía dưới: nghệ sĩ, tên bài (canh giữa) và 3 nút ◀◀ ▶ ▶▶ nằm ngang
// Chỉ dùng cho màn hình dọc; xoay ngang thì dùng bố cục player thường
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Canvas, Circle, Path, RadialGradient, Rect, Skia, SweepGradient, TextPath, matchFont, vec, type SkFont } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '../i18n';
import { useProgress } from '../player/PlayerProvider';
import type { Track } from '../data/mock';
import { SmartImage } from '../components/Cover';
import { CloseZone, usePlayerTransition } from '../components/PlayerTransition';
import { PlayPauseGlyph, SkipGlyph, useBounce } from '../components/PlayerIcons';
import { useScreenSize } from '../components/ScreenSize';

const ACCENT = '#E8C9A0';
const TEXT = '#F3EEE8';
const TEXT2 = '#A9A39C';
const RPM = 3; // tốc độ xoay: chậm nhất
const LABEL = 0.84; // nhãn ảnh = 84% đường kính đĩa
const M = 14; // hai đầu thanh thời gian cách mép màn hình

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

let timeFont: SkFont | null = null;
function getTimeFont() {
  if (!timeFont) timeFont = matchFont({ fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }), fontSize: 12, fontWeight: '600' });
  return timeFont;
}

// Hình học dùng chung (toạ độ màn hình, tâm đĩa ở góc trên trái = 0,0)
function useGeo(W: number, H: number, bottomInset: number) {
  return useMemo(() => {
    const R = Math.round(Math.min(W * 1.46, H - 270 - bottomInset * 0.5));
    const r = R + 18; // thanh thời gian: ngay ngoài rìa đĩa
    const rt = r + 14; // số giờ: ngoài thanh thời gian
    const a0 = Math.acos(Math.min(1, M / r)); // đầu bài: mép trái (dưới)
    const a1 = Math.acos(Math.min(1, (W - M) / r)); // cuối bài: mép phải (trên)
    const arc = (rr: number, b0: number, b1: number) => {
      const b = Skia.PathBuilder.Make();
      b.addArc({ x: -rr, y: -rr, width: rr * 2, height: rr * 2 }, (b0 * 180) / Math.PI, ((b1 - b0) * 180) / Math.PI);
      return b.detach();
    };
    const tb0 = Math.acos(Math.min(1, M / rt));
    const tb1 = Math.acos(Math.min(1, (W - M) / rt));
    return {
      R, r, rt, a0, a1,
      bar: arc(r, a0, a1),
      textPath: arc(rt, tb0, tb1),
      textLen: rt * (tb0 - tb1),
      yLeft: r * Math.sin(a0),
      yRight: r * Math.sin(a1),
    };
  }, [W, H, bottomInset]);
}

export type VinylProps = {
  track: Track;
  isPlaying: boolean;
  loading: boolean;
  failed: boolean;
  duration: number;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (s: number) => void;
  onClose: () => void;
  title: string;
  artist: string;
  icons: React.ReactNode; // cột trái: thích · lời · hàng chờ · hiệu ứng (dựng ở NowPlayingScreen)
  volume: React.ReactNode; // thanh âm lượng dọc
  lyricsOpen: boolean;
  lyrics: React.ReactNode;
  children?: React.ReactNode; // hàng chờ...
};

export function VinylPlayer(p: VinylProps) {
  const win = useScreenSize();
  const W = win.width;
  const H = win.height;
  const insets = useSafeAreaInsets();
  const g = useGeo(W, H, insets.bottom);
  const swipe = usePlayerTransition();
  const reduced = useReducedMotion();
  const { R } = g;
  const LR = R * LABEL;

  // ---- xoay nhãn: chạy trên luồng giao diện; tạm dừng lúc player đang phóng to / thu nhỏ hoặc đang ẩn
  const rot = useSharedValue(0);
  const spinning = p.isPlaying && !swipe.moving && swipe.active && !reduced;
  const visible = !swipe.moving && swipe.active;
  useEffect(() => {
    cancelAnimation(rot);
    const from = rot.value % 360;
    rot.value = from;
    if (spinning) {
      rot.value = withRepeat(withTiming(from + 360, { duration: 60000 / RPM, easing: Easing.linear }), -1, false);
    } else if (visible && !reduced) {
      // vừa bấm dừng: đĩa trôi thêm một đoạn ngắn rồi mới đứng
      rot.value = withTiming(from + 10, { duration: 1400, easing: Easing.out(Easing.cubic) });
    }
  }, [spinning]); // eslint-disable-line react-hooks/exhaustive-deps
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));

  // đổi bài: nhãn mờ đi rồi hiện ảnh mới
  const fade = useSharedValue(1);
  const firstId = useRef(true);
  useEffect(() => {
    if (firstId.current) {
      firstId.current = false;
      return;
    }
    fade.value = 0.25;
    fade.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [p.track.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const ctlBottom = insets.bottom + 12;
  const iconsTop = g.yLeft + 38;

  return (
    <View style={{ flex: 1, backgroundColor: '#15120F' }}>
      <StatusBar barStyle="light-content" />
      {/* Nền + đĩa + nhãn: vuốt xuống ở đây để thu player */}
      <CloseZone>
        <View style={StyleSheet.absoluteFill}>
          <DiscBase W={W} H={H} R={R} />
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', left: -LR, top: -LR, width: LR * 2, height: LR * 2, borderRadius: LR, overflow: 'hidden', backgroundColor: p.track.color || '#333' }, spinStyle]}
          >
            {!!p.track.thumb && (
              <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
                <SmartImage url={p.track.thumb} size={1200} style={{ width: LR * 2, height: LR * 2, borderRadius: LR }} />
              </Animated.View>
            )}
          </Animated.View>
          {/* viền tối quanh nhãn + vệt phản chiếu đứng yên (đèn không xoay theo đĩa) */}
          <DiscTop W={W} H={H} R={R} />
          <View style={[styles.grabberWrap, { top: insets.top + 4 }]}>
            <Pressable testID="player-close" onPress={p.onClose} hitSlop={14} style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
              <View style={styles.grabber} />
            </Pressable>
          </View>
        </View>
      </CloseZone>

      <VinylArc g={g} W={W} duration={p.duration} loading={p.loading} failed={p.failed} seekTo={p.seekTo} />

      {p.lyricsOpen && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,10,9,0.86)' }]}>
          <View style={{ position: 'absolute', top: insets.top + 40, left: 24, right: 24, bottom: H - iconsTop + 16 }}>{p.lyrics}</View>
        </Animated.View>
      )}

      {/* cột trái: thích · lời · hàng chờ · hiệu ứng */}
      <View style={[styles.icons, { left: 12 + insets.left, top: iconsTop }]}>{p.icons}</View>

      {/* âm lượng dọc bên phải */}
      <View style={[styles.vol, { right: 18 + insets.right, bottom: ctlBottom }]}>
        <Text style={styles.volSign}>+</Text>
        <View style={{ flex: 1, alignItems: 'center' }}>{p.volume}</View>
        <Text style={styles.volSign}>−</Text>
      </View>

      {/* nghệ sĩ + tên bài, canh giữa ngay trên 3 nút */}
      <View pointerEvents="none" style={[styles.info, { bottom: ctlBottom + 68 + 14 }]}>
        <Text numberOfLines={1} style={styles.artist}>{p.artist}</Text>
        <Text numberOfLines={1} style={styles.title}>{p.title}</Text>
      </View>

      {/* 3 nút nằm ngang, canh giữa */}
      <View style={[styles.ctlWrap, { bottom: ctlBottom }]} pointerEvents="box-none">
        <View style={styles.controls}>
          <Btn onPress={p.prev}>
            <SkipGlyph dir="back" size={26} color={TEXT} />
          </Btn>
          <Btn onPress={p.togglePlay} play>
            {p.loading ? <ActivityIndicator color="#1b1510" /> : <PlayPauseGlyph playing={p.isPlaying} size={28} color="#1b1510" />}
          </Btn>
          <Btn onPress={p.next}>
            <SkipGlyph dir="forward" size={26} color={TEXT} />
          </Btn>
        </View>
      </View>

      {p.children}
    </View>
  );
}

function Btn({ onPress, play, children }: { onPress: () => void; play?: boolean; children: React.ReactNode }) {
  const b = useBounce();
  return (
    <Pressable onPress={onPress} onPressIn={b.onPressIn} onPressOut={b.onPressOut} hitSlop={6}>
      <Animated.View style={[styles.btn, play && { backgroundColor: ACCENT }, b.style]}>{children}</Animated.View>
    </Pressable>
  );
}

// Nền + mặt đĩa (rãnh): vẽ MỘT LẦN, không đổi theo thời gian
const DiscBase = React.memo(function DiscBase({ W, H, R }: { W: number; H: number; R: number }) {
  const rings = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    for (let rr = R * LABEL + 4; rr < R - 1; rr += 3) b.addCircle(0, 0, rr);
    return b.detach();
  }, [R]);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H}>
        <RadialGradient c={vec(W, H)} r={Math.max(W, H) * 1.1} colors={['#2a211a', '#15120F']} positions={[0, 0.6]} />
      </Rect>
      {/* bóng đổ mềm quanh đĩa */}
      <Circle cx={0} cy={0} r={R + 30}>
        <RadialGradient c={vec(0, 0)} r={R + 30} colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} positions={[0, R / (R + 30), 1]} />
      </Circle>
      <Circle cx={0} cy={0} r={R}>
        <RadialGradient c={vec(0, 0)} r={R} colors={['#1b1b1d', '#0d0d0e', '#050505']} positions={[0, 0.7, 1]} />
      </Circle>
      <Path path={rings} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.035)" />
      {/* rãnh trống giữa các bài */}
      <Circle cx={0} cy={0} r={R * 0.875} style="stroke" strokeWidth={R * 0.004} color="rgba(255,255,255,0.05)" />
      <Circle cx={0} cy={0} r={R * 0.934} style="stroke" strokeWidth={R * 0.003} color="rgba(255,255,255,0.04)" />
      <Circle cx={0} cy={0} r={R - 0.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.06)" />
    </Canvas>
  );
});

const DiscTop = React.memo(function DiscTop({ W, H, R }: { W: number; H: number; R: number }) {
  const t = 'rgba(255,255,255,0)';
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={0} cy={0} r={R * LABEL + 1.5} style="stroke" strokeWidth={3} color="#0b0b0b" />
      <Circle cx={0} cy={0} r={R * LABEL + 3.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.08)" />
      {/* vệt sáng trên vành rãnh (đứng yên) */}
      <Circle cx={0} cy={0} r={R * (1 + LABEL) / 2} style="stroke" strokeWidth={R * (1 - LABEL)}>
        <SweepGradient c={vec(0, 0)} colors={[t, t, 'rgba(255,255,255,0.09)', t, t]} positions={[0, 5 / 360, 28 / 360, 52 / 360, 1]} />
      </Circle>
      <Circle cx={0} cy={0} r={11}>
        <RadialGradient c={vec(0, 0)} r={11} colors={['#050505', '#050505', '#c9c3bb', '#c9c3bb', '#6d6862']} positions={[0, 0.45, 0.5, 0.62, 0.7]} />
      </Circle>
    </Canvas>
  );
});

type Geo = ReturnType<typeof useGeo>;

// Thanh thời gian cong: chỉ phần này đọc thời gian đã phát (đổi vài lần mỗi giây)
const VinylArc = React.memo(function VinylArc({ g, W, duration, loading, failed, seekTo }: { g: Geo; W: number; duration: number; loading: boolean; failed: boolean; seekTo: (s: number) => void }) {
  const t = useT();
  const progress = useProgress();
  const [scrub, setScrub] = useState<number | null>(null);
  const pct = scrub ?? (duration > 0 ? Math.min(1, progress / duration) : 0);
  const font = getTimeFont();

  // vùng chạm: dải chữ nhật bao quanh cung; chỉ nhận chạm nằm sát cung (±30), chỗ khác bỏ qua
  const top = Math.max(0, g.yRight - 34);
  const bottom = g.yLeft + 34;
  const ref = useRef({ g, duration, seekTo, top });
  ref.current = { g, duration, seekTo, top };
  const pAt = (x: number, y: number) => {
    const { g: q } = ref.current;
    const a = Math.atan2(y, x);
    return Math.max(0, Math.min(1, (a - q.a0) / (q.a1 - q.a0)));
  };
  const near = (x: number, y: number) => Math.abs(Math.hypot(x, y) - ref.current.g.r) < 30;
  const last = useRef(0);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => near(e.nativeEvent.locationX, e.nativeEvent.locationY + ref.current.top),
        onMoveShouldSetPanResponder: () => false,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          last.current = pAt(e.nativeEvent.locationX, e.nativeEvent.locationY + ref.current.top);
          setScrub(last.current);
        },
        onPanResponderMove: (e) => {
          last.current = pAt(e.nativeEvent.locationX, e.nativeEvent.locationY + ref.current.top);
          setScrub(last.current);
        },
        onPanResponderRelease: () => {
          if (ref.current.duration > 0) ref.current.seekTo(last.current * ref.current.duration);
          setScrub(null);
        },
        onPanResponderTerminate: () => setScrub(null),
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const a = g.a0 + (g.a1 - g.a0) * pct;
  const cur = fmt(pct * duration);
  const right = loading ? t('common.loading') : failed ? t('np.failed') : fmt(duration);
  const rightW = font.measureText(right).width;
  return (
    <>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={g.bar} style="stroke" strokeWidth={3} strokeCap="round" color="rgba(255,255,255,0.14)" />
        <Path path={g.bar} style="stroke" strokeWidth={3} strokeCap="round" color={ACCENT} start={0} end={pct} />
        <Circle cx={g.r * Math.cos(a)} cy={g.r * Math.sin(a)} r={scrub != null ? 9 : 6.5} color="#FFFFFF" />
        <TextPath path={g.textPath} font={font} text={cur} initialOffset={0} color={TEXT2} />
        <TextPath path={g.textPath} font={font} text={right} initialOffset={Math.max(0, g.textLen - rightW)} color={failed ? '#FF8A80' : TEXT2} />
      </Canvas>
      <View {...pan.panHandlers} style={{ position: 'absolute', left: 0, width: W, top, height: bottom - top }} />
    </>
  );
});

const styles = StyleSheet.create({
  grabberWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  icons: { position: 'absolute', gap: 8 },
  vol: { position: 'absolute', width: 40, height: 230, alignItems: 'center', gap: 6 },
  volSign: { color: TEXT2, fontWeight: '700', fontSize: 15 },
  info: { position: 'absolute', left: 64, right: 64, alignItems: 'center' },
  artist: { color: TEXT2, fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },
  title: { color: TEXT, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  ctlWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  controls: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 22, borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
  },
  btn: { width: 62, height: 56, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
