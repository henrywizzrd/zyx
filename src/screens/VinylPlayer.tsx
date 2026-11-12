// Player kiểu "Đĩa than" (Cài đặt → Kiểu player → Đĩa than), dựng theo trang thử "ZYX – Player Đĩa than":
//  - nền: màu ảnh bìa nhoè, trôi xoay chậm (dùng chung nền với player thường)
//  - đĩa than khổng lồ có tâm ở góc trên trái màn hình, chỉ thấy một phần tư; nhãn giữa đĩa = ảnh bìa bài hát
//  - đang phát: nhãn xoay rất chậm (3 vòng/phút); dừng: trôi thêm một chút rồi đứng (có quán tính)
//    (rãnh đĩa là các vòng tròn đồng tâm nên xoay hay không nhìn như nhau → chỉ xoay ẢNH nhãn, rãnh vẽ bằng Skia, rất nhẹ máy)
//  - thanh thời gian cong theo rìa đĩa, kéo gần sát hai mép màn hình; số giờ cũng chạy theo đường cong; chạm / kéo dọc cung để tua
//  - cột trái: thích · lời · hàng chờ · hiệu ứng; bên phải: âm lượng dọc
//  - giữa phía dưới: nghệ sĩ, tên bài (canh giữa) và 3 nút ◀◀ ▶ ▶▶ nằm ngang
// XEM LỜI (bấm nút lời, hoặc vuốt LÊN ở chỗ trống): đĩa vẫn xoay nhưng trượt lên đỉnh màn hình (tâm dời ra giữa, phía trên
// màn hình) → chỉ còn một vành cong ở trên cùng, quanh Dynamic Island, thấy chút ảnh bìa; thanh thời gian chạy theo đĩa và
// thành một cung cân đối ở giữa phía trên; lời trượt lên ở khoảng giữa. Phần dưới giữ nguyên. Vuốt XUỐNG → đĩa về chỗ cũ
// Mọi thứ đi theo một giá trị lp (0 = đĩa, 1 = lời) chạy trên luồng giao diện.
// Chỉ dùng cho màn hình dọc; xoay ngang thì dùng bố cục player thường
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolate, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Canvas, Circle, Group, Path, RadialGradient, Skia, SweepGradient, TextPath, matchFont, vec, type SkFont } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useProgress } from '../player/PlayerProvider';
import type { Track } from '../data/mock';
import { SmartImage } from '../components/Cover';
import { CloseZone, usePlayerTransition } from '../components/PlayerTransition';
import { PlayPauseGlyph, SkipGlyph, useBounce } from '../components/PlayerIcons';
import { useScreenSize } from '../components/ScreenSize';

const ACCENT = '#E8C9A0';
const TEXT = '#F3EEE8';
const TEXT2 = 'rgba(255,255,255,0.68)';
const RPM = 3; // tốc độ xoay: chậm nhất
const LABEL = 0.84; // nhãn ảnh = 84% đường kính đĩa
const M = 14; // hai đầu thanh thời gian cách mép màn hình
const MOVE = { duration: 520, easing: Easing.bezier(0.25, 0.8, 0.25, 1) };

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

let timeFont: SkFont | null = null;
function getTimeFont() {
  if (!timeFont) timeFont = matchFont({ fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }), fontSize: 12, fontWeight: '600' });
  return timeFont;
}

// (các hàm dùng trong worklet phải khai báo TRƯỚC worklet dùng chúng)
const mix = (a: number, b: number, k: number) => {
  'worklet';
  return a + (b - a) * k;
};
const arcPath = (cx: number, cy: number, rr: number, b0: number, b1: number) => {
  'worklet';
  const b = Skia.PathBuilder.Make();
  b.addArc({ x: cx - rr, y: cy - rr, width: rr * 2, height: rr * 2 }, (b0 * 180) / Math.PI, ((b1 - b0) * 180) / Math.PI);
  return b.detach();
};

// Hình học ở hai trạng thái (toạ độ màn hình):
//  0 (đĩa): tâm đĩa ở góc trên trái (0,0); cung thời gian từ mép trái (dưới) lên mép phải (trên)
//  1 (lời): tâm đĩa ở (W/2, rimY − R) → mép dưới của đĩa nằm ở rimY; cung thời gian cân đối hai bên, ngay dưới vành đĩa
function useGeo(W: number, H: number, top: number, bottomInset: number) {
  return useMemo(() => {
    const R = Math.round(Math.min(W * 1.46, H - 270 - bottomInset * 0.5));
    const r = R + 18; // thanh thời gian: ngay ngoài rìa đĩa
    const rt = r + 14; // số giờ: ngoài thanh thời gian
    const rimY = top + 96;
    const half = (rr: number) => Math.asin(Math.min(1, (W / 2 - M) / rr));
    const g = {
      R, r, rt, rimY,
      cx1: W / 2,
      cy1: rimY - R,
      // cung thời gian: [đầu bài, cuối bài] ở hai trạng thái
      a0: Math.acos(Math.min(1, M / r)),
      a1: Math.acos(Math.min(1, (W - M) / r)),
      b0: Math.PI / 2 + half(r),
      b1: Math.PI / 2 - half(r),
      // đường chữ số giờ
      ta0: Math.acos(Math.min(1, M / rt)),
      ta1: Math.acos(Math.min(1, (W - M) / rt)),
      tb0: Math.PI / 2 + half(rt),
      tb1: Math.PI / 2 - half(rt),
    };
    return {
      ...g,
      yLeft: r * Math.sin(g.a0),
      yRight: r * Math.sin(g.a1),
      yEnds1: g.cy1 + r * Math.sin(g.b0), // hai đầu cung lúc xem lời
      yLow1: g.cy1 + r, // điểm thấp nhất của cung lúc xem lời
    };
  }, [W, H, top, bottomInset]);
}
type Geo = ReturnType<typeof useGeo>;

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
  background: React.ReactNode; // nền màu ảnh bìa nhoè (dựng ở NowPlayingScreen, giống player thường)
  icons: React.ReactNode; // cột trái: thích · lời · hàng chờ · hiệu ứng (dựng ở NowPlayingScreen)
  volume: React.ReactNode; // thanh âm lượng dọc
  lyricsOpen: boolean;
  setLyricsOpen: (v: boolean) => void;
  lyrics: React.ReactNode;
  children?: React.ReactNode; // hàng chờ...
};

export function VinylPlayer(p: VinylProps) {
  const win = useScreenSize();
  const W = win.width;
  const H = win.height;
  const insets = useSafeAreaInsets();
  const g = useGeo(W, H, insets.top, insets.bottom);
  const swipe = usePlayerTransition();
  const reduced = useReducedMotion();
  const { R } = g;
  const LR = R * LABEL;

  // ---- đĩa ⇄ lời
  const lp = useSharedValue(p.lyricsOpen ? 1 : 0);
  const [lyricsMounted, setLyricsMounted] = useState(p.lyricsOpen);
  useEffect(() => {
    if (p.lyricsOpen) setLyricsMounted(true);
    lp.value = withTiming(p.lyricsOpen ? 1 : 0, reduced ? { duration: 200 } : MOVE, (done) => {
      if (done && !p.lyricsOpen) scheduleOnRN(setLyricsMounted, false);
    });
  }, [p.lyricsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const { cx1, cy1 } = g;
  const labelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lp.value * cx1 }, { translateY: lp.value * cy1 }, { rotate: `${rot.value}deg` }],
  }));

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
  const lyricsTop = g.yLow1 + 44;
  const lyricsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(lp.value, [0, 1], [90, 0]) }],
  }));

  // ---- cử chỉ ở chỗ trống: đang xem đĩa → vuốt LÊN mở lời (vuốt xuống vẫn là thu player, xem CloseZone);
  // đang xem lời → vuốt XUỐNG đưa đĩa về chỗ cũ
  const open = () => p.setLyricsOpen(true);
  const close = () => p.setLyricsOpen(false);
  const up = usePanGesture({
    activeOffsetY: -12,
    failOffsetX: [-24, 24],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY < -40 || e.velocityY < -500) scheduleOnRN(open);
    },
  });
  const down = usePanGesture({
    activeOffsetY: 12,
    failOffsetX: [-24, 24],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > 40 || e.velocityY > 500) scheduleOnRN(close);
    },
  });

  return (
    <View style={{ flex: 1 }}>
      {p.background}
      <StatusBar barStyle="light-content" />

      {/* Đĩa (chỉ để nhìn, không nhận chạm) */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <DiscBase W={W} H={H} g={g} lp={lp} />
        <Animated.View
          style={[{ position: 'absolute', left: -LR, top: -LR, width: LR * 2, height: LR * 2, borderRadius: LR, overflow: 'hidden', backgroundColor: p.track.color || '#333' }, labelStyle]}
        >
          {!!p.track.thumb && (
            <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
              <SmartImage url={p.track.thumb} size={1200} style={{ width: LR * 2, height: LR * 2, borderRadius: LR }} />
            </Animated.View>
          )}
        </Animated.View>
        <DiscTop W={W} H={H} g={g} lp={lp} />
      </View>

      {/* Lớp nhận cử chỉ ở chỗ trống */}
      {p.lyricsOpen ? (
        <GestureDetector key="down" gesture={down}>
          <View style={StyleSheet.absoluteFill} />
        </GestureDetector>
      ) : (
        <CloseZone key="up">
          <View style={StyleSheet.absoluteFill}>
            <GestureDetector gesture={up}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          </View>
        </CloseZone>
      )}

      <VinylArc g={g} W={W} lp={lp} lyrics={p.lyricsOpen} duration={p.duration} loading={p.loading} failed={p.failed} seekTo={p.seekTo} />

      {lyricsMounted && (
        <Animated.View
          pointerEvents={p.lyricsOpen ? 'auto' : 'none'}
          style={[{ position: 'absolute', top: lyricsTop, left: 20, right: 20, bottom: H - iconsTop + 12 }, lyricsStyle]}
        >
          {p.lyrics}
        </Animated.View>
      )}

      <View style={[styles.grabberWrap, { top: insets.top + 4 }]} pointerEvents="box-none">
        <Pressable testID="player-close" onPress={p.onClose} hitSlop={14} style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
          <View style={styles.grabber} />
        </Pressable>
      </View>

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

// Dời cả đĩa theo lp (chỉ vẽ lại trong lúc đang chuyển ~0,5s; bình thường đứng yên)
function useDiscTransform(g: Geo, lp: SharedValue<number>) {
  const { cx1, cy1 } = g;
  return useDerivedValue(() => [{ translateX: lp.value * cx1 }, { translateY: lp.value * cy1 }]);
}

// Mặt đĩa (rãnh) — nằm dưới nhãn ảnh
const DiscBase = React.memo(function DiscBase({ g, lp }: { W: number; H: number; g: Geo; lp: SharedValue<number> }) {
  const { R } = g;
  const rings = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    for (let rr = R * LABEL + 4; rr < R - 1; rr += 3) b.addCircle(0, 0, rr);
    return b.detach();
  }, [R]);
  const tf = useDiscTransform(g, lp);
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group transform={tf}>
        {/* bóng đổ mềm quanh đĩa */}
        <Circle cx={0} cy={0} r={R + 30}>
          <RadialGradient c={vec(0, 0)} r={R + 30} colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} positions={[0, R / (R + 30), 1]} />
        </Circle>
        <Circle cx={0} cy={0} r={R}>
          <RadialGradient c={vec(0, 0)} r={R} colors={['#1b1b1d', '#0d0d0e', '#050505']} positions={[0, 0.7, 1]} />
        </Circle>
        <Path path={rings} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.035)" />
        {/* rãnh trống giữa các bài */}
        <Circle cx={0} cy={0} r={R * 0.875} style="stroke" strokeWidth={R * 0.004} color="rgba(255,255,255,0.05)" />
        <Circle cx={0} cy={0} r={R * 0.934} style="stroke" strokeWidth={R * 0.003} color="rgba(255,255,255,0.04)" />
        <Circle cx={0} cy={0} r={R - 0.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.06)" />
      </Group>
    </Canvas>
  );
});

// Viền tối quanh nhãn + vệt phản chiếu đứng yên (đèn không xoay theo đĩa) — nằm trên nhãn ảnh
const DiscTop = React.memo(function DiscTop({ g, lp }: { W: number; H: number; g: Geo; lp: SharedValue<number> }) {
  const { R } = g;
  const t = 'rgba(255,255,255,0)';
  const tf = useDiscTransform(g, lp);
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group transform={tf}>
        <Circle cx={0} cy={0} r={R * LABEL + 1.5} style="stroke" strokeWidth={3} color="#0b0b0b" />
        <Circle cx={0} cy={0} r={R * LABEL + 3.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.08)" />
        <Circle cx={0} cy={0} r={(R * (1 + LABEL)) / 2} style="stroke" strokeWidth={R * (1 - LABEL)}>
          <SweepGradient c={vec(0, 0)} colors={[t, t, 'rgba(255,255,255,0.09)', t, t]} positions={[0, 5 / 360, 28 / 360, 52 / 360, 1]} />
        </Circle>
        <Circle cx={0} cy={0} r={11}>
          <RadialGradient c={vec(0, 0)} r={11} colors={['#050505', '#050505', '#c9c3bb', '#c9c3bb', '#6d6862']} positions={[0, 0.45, 0.5, 0.62, 0.7]} />
        </Circle>
      </Group>
    </Canvas>
  );
});

// Thanh thời gian cong: chỉ phần này đọc thời gian đã phát (đổi vài lần mỗi giây). Đi theo đĩa khi chuyển sang lời
const VinylArc = React.memo(function VinylArc({
  g, W, lp, lyrics, duration, loading, failed, seekTo,
}: { g: Geo; W: number; lp: SharedValue<number>; lyrics: boolean; duration: number; loading: boolean; failed: boolean; seekTo: (s: number) => void }) {
  const t = useT();
  const progress = useProgress();
  const [scrub, setScrub] = useState<number | null>(null);
  const pct = scrub ?? (duration > 0 ? Math.min(1, progress / duration) : 0);
  const font = getTimeFont();

  const cur = fmt(pct * duration);
  const right = loading ? t('common.loading') : failed ? t('np.failed') : fmt(duration);
  const rightW = font.measureText(right).width;

  // ---- vẽ theo lp
  const pctSV = useSharedValue(pct);
  useEffect(() => {
    pctSV.value = pct;
  }, [pct]); // eslint-disable-line react-hooks/exhaustive-deps
  const { r, rt, cx1, cy1, a0, a1, b0, b1, ta0, ta1, tb0, tb1 } = g;
  const bar = useDerivedValue(() => {
    const k = lp.value;
    return arcPath(k * cx1, k * cy1, r, mix(a0, b0, k), mix(a1, b1, k));
  });
  const textPath = useDerivedValue(() => {
    const k = lp.value;
    return arcPath(k * cx1, k * cy1, rt, mix(ta0, tb0, k), mix(ta1, tb1, k));
  });
  const rightOff = useDerivedValue(() => {
    const k = lp.value;
    return Math.max(0, rt * (mix(ta0, tb0, k) - mix(ta1, tb1, k)) - rightW);
  }, [rightW]);
  const knobX = useDerivedValue(() => {
    const k = lp.value;
    const a = mix(mix(a0, b0, k), mix(a1, b1, k), pctSV.value);
    return k * cx1 + r * Math.cos(a);
  });
  const knobY = useDerivedValue(() => {
    const k = lp.value;
    const a = mix(mix(a0, b0, k), mix(a1, b1, k), pctSV.value);
    return k * cy1 + r * Math.sin(a);
  });

  // ---- tua: dải chữ nhật bao quanh cung (ở trạng thái hiện tại); chỉ nhận chạm nằm sát cung (±30), chỗ khác bỏ qua
  const top = lyrics ? Math.max(0, g.yEnds1 - 34) : Math.max(0, g.yRight - 34);
  const bottom = lyrics ? g.yLow1 + 34 : g.yLeft + 34;
  const ref = useRef({ g, duration, seekTo, top, lyrics });
  ref.current = { g, duration, seekTo, top, lyrics };
  const local = (x: number, y: number) => {
    const q = ref.current;
    const cx = q.lyrics ? q.g.cx1 : 0;
    const cy = q.lyrics ? q.g.cy1 : 0;
    return { x: x - cx, y: y + q.top - cy, s: q.lyrics ? q.g.b0 : q.g.a0, e: q.lyrics ? q.g.b1 : q.g.a1 };
  };
  const pAt = (x: number, y: number) => {
    const l = local(x, y);
    return Math.max(0, Math.min(1, (Math.atan2(l.y, l.x) - l.s) / (l.e - l.s)));
  };
  const near = (x: number, y: number) => {
    const l = local(x, y);
    return Math.abs(Math.hypot(l.x, l.y) - ref.current.g.r) < 30;
  };
  const last = useRef(0);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => near(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onMoveShouldSetPanResponder: () => false,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          last.current = pAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
          setScrub(last.current);
        },
        onPanResponderMove: (e) => {
          last.current = pAt(e.nativeEvent.locationX, e.nativeEvent.locationY);
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

  return (
    <>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={bar} style="stroke" strokeWidth={3} strokeCap="round" color="rgba(255,255,255,0.18)" />
        <Path path={bar} style="stroke" strokeWidth={3} strokeCap="round" color={ACCENT} start={0} end={pct} />
        <Circle cx={knobX} cy={knobY} r={scrub != null ? 9 : 6.5} color="#FFFFFF" />
        <TextPath path={textPath} font={font} text={cur} initialOffset={0} color={TEXT2} />
        <TextPath path={textPath} font={font} text={right} initialOffset={rightOff} color={failed ? '#FF8A80' : TEXT2} />
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
    backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  btn: { width: 62, height: 56, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
