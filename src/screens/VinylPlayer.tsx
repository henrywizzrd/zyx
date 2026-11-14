// Player kiểu "Đĩa than" (Cài đặt → Kiểu player → Đĩa than), dựng theo trang thử "ZYX – Player Đĩa than":
//  - nền: gradient tách màu từ ảnh bìa (theme/coverGradient), loang trôi liên tục
//  - đĩa than khổng lồ có tâm ở góc trên trái màn hình, chỉ thấy một phần tư; nhãn giữa đĩa = ảnh bìa bài hát
//  - đang phát: nhãn xoay rất chậm (3 vòng/phút); dừng: trôi thêm một chút rồi đứng (có quán tính)
//    (rãnh đĩa là các vòng tròn đồng tâm nên xoay hay không nhìn như nhau → chỉ xoay ẢNH nhãn, rãnh vẽ bằng Skia, rất nhẹ máy)
//  - thanh thời gian cong theo rìa đĩa, kéo gần sát hai mép màn hình; số giờ cũng chạy theo đường cong; chạm / kéo dọc cung để tua
//  - cột trái: lời · hàng chờ · trộn · lặp; bên phải: âm lượng dọc
//  - giữa phía dưới (từ trên xuống): nghệ sĩ, tên bài, viên kính ( ❤️ | hiệu ứng ), 3 nút ◀◀ ▶ ▶▶ nằm ngang
// XEM LỜI (bấm nút lời, hoặc vuốt LÊN ở chỗ trống): đĩa vẫn xoay nhưng trượt lên đỉnh màn hình (tâm dời ra giữa, phía trên
// màn hình) → chỉ còn một vành cong ở trên cùng, quanh Dynamic Island, thấy chút ảnh bìa; thanh thời gian chạy theo đĩa và
// thành một cung cân đối ở giữa phía trên; lời trượt lên ở khoảng giữa. Phần dưới giữ nguyên. Vuốt XUỐNG → đĩa về chỗ cũ
// Mọi thứ đi theo một giá trị lp (0 = đĩa, 1 = lời) chạy trên luồng giao diện.
// Chỉ dùng cho màn hình dọc; xoay ngang thì dùng bố cục player thường
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image as RNImage, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolate, interpolateColor, useAnimatedReaction, useFrameCallback, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import { Canvas, Circle, Fill, Group, Path, RadialGradient, Shader, Skia, SweepGradient, TextPath, matchFont, vec, type SkFont } from '@shopify/react-native-skia';
import { smokeShader } from '../theme/effects/smoke';
import { discImage, discImageCached, discPad } from '../theme/effects/discImage';
import { markRender } from '../components/JankMonitor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCoverGradient, type CoverGradient } from '../theme/coverGradient';
import { useT } from '../i18n';
import { useProgress } from '../player/PlayerProvider';
import type { Track } from '../data/mock';
import { SmartImage } from '../components/Cover';
import { CloseZone, playerProgress, usePlayerTransition } from '../components/PlayerTransition';
import { PlayPauseGlyph, SkipGlyph, useBounce } from '../components/PlayerIcons';
import { useScreenSize } from '../components/ScreenSize';
import { useVinylFlags } from '../debug/vinylFlags';
import { log } from '../data/applog';

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

// Đổi bài: độ dời để đĩa khuất hẳn. Đang xem đĩa (lp 0): chéo về góc trên trái, đủ xa để cả vành (bán kính R) ra khỏi màn hình.
// Đang xem lời (lp 1): thẳng lên trên, qua khỏi mép trên
const swapDX = (R: number, k: number) => {
  'worklet';
  return mix(-(R + 40) / Math.SQRT2, 0, k);
};
const swapDY = (R: number, rimY: number, k: number) => {
  'worklet';
  return mix(-(R + 40) / Math.SQRT2, -(rimY + 40), k);
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
  icons: React.ReactNode; // cột trái: lời · hàng chờ · trộn · lặp (dựng ở NowPlayingScreen)
  like: React.ReactNode; // nút thích (trái viên kính)
  fx: React.ReactNode; // nút hiệu ứng âm thanh (phải viên kính)
  volume: React.ReactNode; // thanh âm lượng dọc
  lyricsOpen: boolean;
  setLyricsOpen: (v: boolean) => void;
  lyrics: React.ReactNode;
  children?: React.ReactNode; // hàng chờ...
};

// memo: chỉ vẽ lại khi có prop thật sự đổi (các phần truyền vào đều được dựng sẵn bằng useMemo ở NowPlayingScreen)
export const VinylPlayer = React.memo(function VinylPlayer(p: VinylProps) {
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
  useEffect(() => {
    lp.value = withTiming(p.lyricsOpen ? 1 : 0, reduced ? { duration: 200 } : MOVE);
  }, [p.lyricsOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Khung lời dựng SẴN (ẩn) ngay khi player hiện ra, lời cũng được tải sẵn (NowPlayingScreen) → vuốt lên là chữ có liền,
  // không còn khoảng "đang tải" / nháy lúc khung lời mới dựng và đo các dòng
  // ...nhưng dựng SAU khi player mở xong (~0,15s sau), không dựng ngay lúc bắt đầu mở: dựng cả trăm dòng chữ đúng lúc hiệu ứng
  // mở player đang chạy làm rớt khung (log 13/11 11:58: khựng 130–250ms ngay đầu mỗi lần mở player)
  const settled = swipe.active && !swipe.moving;
  const dbg = useVinylFlags(); // bảng dò lỗi (Cài đặt → Nhật ký)
  // App xuống NỀN (tắt màn hình / sang app khác): đóng băng hẳn phần hình của player — dừng xoay, dừng khói, gỡ hai khung Skia
  // (khói + thanh thời gian). Nghe nhạc nền không cần chúng, và không để thứ gì trong số đó chạy ngầm ngốn CPU (văng app 16:58:
  // iOS tắt app vì một luồng JavaScript dùng 84% CPU suốt 1 phút khi đang nghe nền)
  const [fg, setFg] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const on = st !== 'background';
      setFg((was) => {
        if (was !== on) log('ui', on ? 'đĩa than: mở băng (app lên lại)' : 'đĩa than: đóng băng khi xuống nền');
        return on;
      });
    });
    return () => sub.remove();
  }, []);
  const [lyricsReady, setLyricsReady] = useState(false);
  // Dựng xong thì GIỮ LẠI khi đóng player (trước đây đóng là gỡ, mở lại là dựng lại cả khung lời → luồng JS đứng 1,3–1,7 giây
  // sau MỖI lần mở player, log 13/11 16:52)
  useEffect(() => {
    if (!settled || lyricsReady) return;
    const id = setTimeout(() => setLyricsReady(true), 150);
    return () => clearTimeout(id);
  }, [settled, swipe.active]); // eslint-disable-line react-hooks/exhaustive-deps
  const lyricsLive = fg && ((dbg.lyricsPre && lyricsReady) || p.lyricsOpen);

  // ---- xoay nhãn: chạy trên luồng giao diện; tạm dừng lúc player đang phóng to / thu nhỏ hoặc đang ẩn
  const rot = useSharedValue(0);
  // Bắt đầu xoay đĩa / chạy khói trễ ~0,12s sau khi mở xong: đúng khung hình cuối của hiệu ứng mở, màn player vừa thôi là
  // "ảnh chụp" và phải vẽ thật lần đầu — dồn thêm khởi động xoay + khói vào đúng lúc đó làm khung cuối dài 60–90ms (log 16:52)
  const [late, setLate] = useState(settled);
  useEffect(() => {
    if (!settled) {
      setLate(false);
      return;
    }
    const id = setTimeout(() => setLate(true), 120);
    return () => clearTimeout(id);
  }, [settled]);
  const spinning = p.isPlaying && late && fg && dbg.spin && !reduced;
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
  const run = late && fg && !reduced;

  // ---- đổi bài: đĩa cũ trượt đi rồi đĩa bài mới trượt vào (thanh thời gian đứng yên, nền + màu đổi dần cùng lúc)
  //  · đang xem đĩa: trượt chéo ra góc trên trái (khuất hẳn), đĩa mới trượt từ góc đó vào
  //  · đang xem lời: đĩa trượt lên khuất khỏi mép trên rồi trượt xuống lại
  // Đĩa đang trượt ra vẫn mang ảnh bài CŨ; khuất hẳn rồi mới đổi sang ảnh bài mới
  const sw = useSharedValue(0); // 0 = đĩa ở chỗ, 1 = đĩa đã khuất
  const [disc, setDisc] = useState({ id: p.track.id, thumb: p.track.thumb, color: p.track.color });
  const latest = useRef(disc);
  latest.current = { id: p.track.id, thumb: p.track.thumb, color: p.track.color };
  const commitDisc = () => setDisc(latest.current);
  useEffect(() => {
    if (p.track.id === disc.id) return;
    if (!visible || reduced) {
      cancelAnimation(sw);
      sw.value = 0;
      setDisc(latest.current);
      return;
    }
    sw.value = withTiming(1, { duration: 340, easing: Easing.bezier(0.4, 0, 0.9, 0.6) }, (done) => {
      if (done) scheduleOnRN(commitDisc);
    });
  }, [p.track.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sw.value > 0.01) sw.value = withTiming(0, { duration: 520, easing: Easing.bezier(0.2, 0.8, 0.25, 1) });
  }, [disc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ---- màu theo ảnh bìa: thanh thời gian + nút phát. Đổi bài thì màu chuyển dần sang màu mới (~0,7s)
  const grad = useCoverGradient(!dbg.coverColor ? null : p.track.thumb?.replace(/=(w\d+-h\d+|s\d+)/, '=w120-h120'));
  const accentTo = grad?.accent ?? ACCENT;
  const cFrom = useSharedValue(accentTo);
  const cTo = useSharedValue(accentTo);
  const cT = useSharedValue(1);
  const lastAccent = useRef(accentTo);
  useEffect(() => {
    if (lastAccent.current === accentTo) return;
    cFrom.value = lastAccent.current;
    cTo.value = accentTo;
    lastAccent.current = accentTo;
    cT.value = 0;
    cT.value = withTiming(1, { duration: 700, easing: Easing.inOut(Easing.cubic) });
  }, [accentTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const accent = useDerivedValue(() => interpolateColor(cT.value, [0, 1], [cFrom.value, cTo.value]) as string);
  const playBg = useAnimatedStyle(() => ({ backgroundColor: accent.value }));

  const ctlBottom = insets.bottom + 12;
  const iconsTop = g.yLeft + 38;
  // Khung lời: từ ngay dưới cung thời gian tới sát cột icon; mép trên / dưới mờ dài (LyricsView fadeStops) nên không thấy khung
  const lyricsTop = g.yLow1 + 26;
  const lyricsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(lp.value, [0, 1], [90, 0]) }],
  }));

  // ---- cử chỉ ở chỗ trống: đang xem đĩa → vuốt LÊN mở lời (vuốt xuống vẫn là thu player, xem CloseZone);
  // đang xem lời → vuốt XUỐNG đưa đĩa về chỗ cũ
  // Cấu hình cử chỉ dựng MỘT lần (useMemo): trước đây mỗi lần màn player vẽ lại là tạo cấu hình mới → bộ nhận cử chỉ được
  // dựng lại trên luồng giao diện mỗi lần (nghi góp phần vào các lần giao diện khựng ~130ms ngay sau khi player vẽ lại)
  const setLyr = useRef(p.setLyricsOpen);
  setLyr.current = p.setLyricsOpen;
  const gest = useMemo(() => {
    const open = () => setLyr.current(true);
    const close = () => setLyr.current(false);
    return {
      up: {
        activeOffsetY: -12,
        failOffsetX: [-24, 24] as [number, number],
        onDeactivate: (e: { translationY: number; velocityY: number }) => {
          'worklet';
          if (e.translationY < -40 || e.velocityY < -500) scheduleOnRN(open);
        },
      },
      down: {
        activeOffsetY: 12,
        failOffsetX: [-24, 24] as [number, number],
        onDeactivate: (e: { translationY: number; velocityY: number }) => {
          'worklet';
          if (e.translationY > 40 || e.velocityY > 500) scheduleOnRN(close);
        },
      },
    };
  }, []);
  const up = usePanGesture(gest.up);
  const down = usePanGesture(gest.down);

  // ---- tua trên thanh thời gian cong: nằm CHUNG lớp chỗ trống với vuốt lên / xuống. Chạm xuống sát cung (±30) thì nhận ngay
  // (các cử chỉ vuốt bị huỷ); chạm chỗ khác thì bỏ qua ngay → vuốt xuống thu player / vuốt lên mở lời vẫn chạy ở MỌI chỗ trống,
  // kể cả khoảng trên tên nghệ sĩ và cạnh thanh âm lượng (trước đây một khung chữ nhật quanh cung chặn hết chỗ đó)
  const scrubSV = useSharedValue(-1);
  const seekRef = useRef({ seekTo: p.seekTo, duration: p.duration });
  seekRef.current = { seekTo: p.seekTo, duration: p.duration };
  const seekGest = useMemo(() => {
    const { r, cx1, cy1, a0, a1, b0, b1 } = g;
    const commit = (v: number) => {
      const q = seekRef.current;
      if (q.duration > 0) q.seekTo(v * q.duration);
    };
    const local = (x: number, y: number, k: number) => {
      'worklet';
      const lx = x - k * cx1;
      const ly = y - k * cy1;
      return { lx, ly, s: k > 0.5 ? b0 : a0, e: k > 0.5 ? b1 : a1 };
    };
    const at = (x: number, y: number, k: number) => {
      'worklet';
      const l = local(x, y, k);
      return Math.max(0, Math.min(1, (Math.atan2(l.ly, l.lx) - l.s) / (l.e - l.s)));
    };
    return {
      manualActivation: true,
      onTouchesDown: (e: { handlerTag: number; allTouches: { x: number; y: number }[] }) => {
        'worklet';
        const t0 = e.allTouches[0];
        const k = lp.value;
        const l = local(t0.x, t0.y, k);
        if (Math.abs(Math.hypot(l.lx, l.ly) - r) < 30) {
          scrubSV.value = at(t0.x, t0.y, k);
          GestureStateManager.activate(e.handlerTag);
        } else GestureStateManager.fail(e.handlerTag);
      },
      onUpdate: (e: { x: number; y: number }) => {
        'worklet';
        scrubSV.value = at(e.x, e.y, lp.value);
      },
      onDeactivate: (e: { canceled: boolean }) => {
        'worklet';
        const v = scrubSV.value;
        scrubSV.value = -1;
        if (!e.canceled && v >= 0) scheduleOnRN(commit, v);
      },
      onFinalize: () => {
        'worklet';
        scrubSV.value = -1;
      },
    };
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps
  const seekA = usePanGesture(seekGest);
  const seekB = usePanGesture(seekGest);

  return (
    <View style={{ flex: 1 }}>
      <VinylBackdrop color={p.track.color} grad={grad} run={run} smoke={fg && dbg.smoke} />
      <StatusBar barStyle="light-content" />

      {/* Đĩa (chỉ để nhìn, không nhận chạm) */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {dbg.disc && <DiscUnder g={g} lp={lp} sw={sw} />}
        {dbg.label && <VinylLabel id={disc.id} thumb={disc.thumb} color={disc.color} LR={LR} g={g} lp={lp} sw={sw} rot={rot} />}
        {dbg.disc && <DiscOver g={g} lp={lp} sw={sw} />}
        {dbg.ghost && <GhostArc g={g} lp={lp} sw={sw} W={W} H={H} />}
      </View>

      {/* Lớp nhận cử chỉ ở chỗ trống */}
      {p.lyricsOpen ? (
        <GestureDetector key="down" gesture={down}>
          <View style={StyleSheet.absoluteFill}>
            <GestureDetector gesture={seekA}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          </View>
        </GestureDetector>
      ) : (
        <CloseZone key="up">
          <View style={StyleSheet.absoluteFill}>
            <GestureDetector gesture={up}>
              <View style={StyleSheet.absoluteFill}>
                <GestureDetector gesture={seekB}>
                  <View style={StyleSheet.absoluteFill} />
                </GestureDetector>
              </View>
            </GestureDetector>
          </View>
        </CloseZone>
      )}

      {fg && dbg.arc && <VinylArc g={g} lp={lp} accent={accent} scrubSV={scrubSV} duration={p.duration} loading={p.loading} failed={p.failed} />}

      {lyricsLive && (
        <Animated.View
          pointerEvents={p.lyricsOpen ? 'auto' : 'none'}
          style={[{ position: 'absolute', top: lyricsTop, left: 20, right: 20, bottom: H - iconsTop + 2 }, lyricsStyle]}
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

      {/* nghệ sĩ + tên bài, canh giữa trên viên kính */}
      <View pointerEvents="none" style={[styles.info, { bottom: ctlBottom + 68 + 12 + PILL + 16 }]}>
        <Text numberOfLines={1} style={styles.artist}>{p.artist}</Text>
        <Text numberOfLines={1} style={styles.title}>{p.title}</Text>
      </View>

      {/* viên kính ( ❤️ | hiệu ứng ), ngay trên 3 nút */}
      <View style={[styles.ctlWrap, { bottom: ctlBottom + 68 + 12 }]} pointerEvents="box-none">
        <View style={styles.pill}>
          <Frost radius={PILL / 2} />
          <View style={styles.pillCell}>{p.like}</View>
          <View style={styles.pillSep} />
          <View style={styles.pillCell}>{p.fx}</View>
        </View>
      </View>

      {/* 3 nút nằm ngang, canh giữa */}
      <View style={[styles.ctlWrap, { bottom: ctlBottom }]} pointerEvents="box-none">
        <View style={styles.controls}>
          <Frost radius={22} />
          <Btn onPress={p.prev}>
            <SkipGlyph dir="back" size={26} color={TEXT} />
          </Btn>
          <Btn onPress={p.togglePlay} bg={playBg}>
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
});

const PILL = 46;

// Kính tối hơn nền một chút. KHÔNG dùng lớp làm nhoè thật (BlurView): nền khói phía sau vốn đã mềm nên nhoè thêm nhìn gần như
// không khác, mà mỗi lớp nhoè phải tính lại MỖI khung hình vì nền khói luôn chuyển động — 3 lớp như vậy làm GPU quá tải, nhất là
// khi đang quay màn hình (iPhone vừa vẽ app vừa nén video). Thay bằng lớp tối trong + viền sáng mảnh ở mép trên
function Frost({ radius }: { radius: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: 'rgba(8,8,14,0.32)' }]}>
      <View style={{ position: 'absolute', left: radius * 0.6, right: radius * 0.6, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.28)' }} />
    </View>
  );
}

// Nền: khói màu tách từ ảnh bìa (theme/effects/smoke.ts), cuộn liên tục với nhịp vừa phải. Đổi bài: màu khói chuyển dần (~1s)
const SMOKE_DIV = 5; // vẽ ở 1/5 kích thước rồi phóng to
const FALLBACK: number[][] = [
  [0.16, 0.2, 0.4],
  [0.45, 0.3, 0.6],
  [0.2, 0.42, 0.62],
  [0.1, 0.12, 0.24],
];
const VinylBackdrop = React.memo(function VinylBackdrop({ color, grad, run, smoke }: { color?: string; grad: CoverGradient | null; run: boolean; smoke: boolean }) {
  const win = useScreenSize();
  const effect = useMemo(() => smokeShader(), []);
  const cw = Math.ceil(win.width / SMOKE_DIV);
  const ch = Math.ceil(win.height / SMOKE_DIV);
  // đồng hồ 30 khung / giây, chỉ chạy khi player đang hiện
  const time = useSharedValue(0);
  const last = useSharedValue(0);
  const clock = useFrameCallback((f) => {
    'worklet';
    const d = f.timeSincePreviousFrame ?? 0;
    last.value += d;
    if (last.value >= 33) {
      time.value += last.value / 1000;
      last.value = 0;
    }
  }, false);
  useEffect(() => {
    clock.setActive(run && smoke);
  }, [run, smoke]); // eslint-disable-line react-hooks/exhaustive-deps
  // 4 màu: nền tối của màu chính, rồi 3 màu nổi bật
  const target = useMemo(() => {
    const c = grad?.rgb?.length ? grad.rgb : FALLBACK;
    const g = (i: number) => c[i % c.length];
    return [g(0).map((v) => v * 0.42), g(1), g(0), g(2)].flat();
  }, [grad]);
  const from = useSharedValue(target);
  const to = useSharedValue(target);
  const k = useSharedValue(1);
  const shown = useRef(target);
  useEffect(() => {
    if (shown.current === target) return;
    // chuyển từ màu đang hiện (tính đúng chỗ đang dở nếu đổi bài liên tiếp)
    const kk = k.value;
    from.value = from.value.map((v, i) => v + (to.value[i] - v) * kk);
    to.value = target;
    shown.current = target;
    k.value = 0;
    k.value = withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.cubic) });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const uniforms = useDerivedValue(() => {
    const a = from.value;
    const b = to.value;
    const m = (i: number) => a[i] + (b[i] - a[i]) * k.value;
    return {
      res: [cw, ch],
      time: time.value,
      c0: [m(0), m(1), m(2)],
      c1: [m(3), m(4), m(5)],
      c2: [m(6), m(7), m(8)],
      c3: [m(9), m(10), m(11)],
    };
  });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: color || '#1a1820' }]}>
      {effect && smoke && (
        <Canvas
          style={{
            position: 'absolute',
            width: cw,
            height: ch,
            left: (win.width - cw) / 2,
            top: (win.height - ch) / 2,
            transform: [{ scale: SMOKE_DIV * 1.02 }],
          }}
        >
          <Fill>
            <Shader source={effect} uniforms={uniforms} />
          </Fill>
        </Canvas>
      )}
      {/* tối nhẹ để chữ trắng luôn đọc được */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]} />
    </View>
  );
});

// Nhãn giữa đĩa = ảnh bìa, xoay. Tách riêng + memo: màn player vẽ lại (vài lần mỗi giây khi đang phát) không đụng tới ảnh to này.
// KHÔNG bọc khung cắt (overflow: hidden): lớp ~1000 điểm vừa bị cắt tròn vừa xoay thì iPhone phải vẽ lại cả lớp mỗi khung hình
const VinylLabel = React.memo(function VinylLabel({
  id, thumb, color, LR, g, lp, sw, rot,
}: { id: string; thumb?: string; color?: string; LR: number; g: Geo; lp: SharedValue<number>; sw: SharedValue<number>; rot: SharedValue<number> }) {
  const { cx1, cy1, R, rimY } = g;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: lp.value * cx1 + swapDX(R, lp.value) * sw.value },
      { translateY: lp.value * cy1 + swapDY(R, rimY, lp.value) * sw.value },
      { rotate: `${rot.value}deg` },
    ],
  }));
  // đổi bài: nhãn mờ đi rồi hiện ảnh mới
  const fade = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fade.value = 0.25;
    fade.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const imgStyle = useMemo(() => ({ width: LR * 2, height: LR * 2, borderRadius: LR }), [LR]);
  return (
    <Animated.View style={[{ position: 'absolute', left: -LR, top: -LR, width: LR * 2, height: LR * 2 }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: LR, backgroundColor: color || '#333' }]} />
      {!!thumb && (
        <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
          <SmartImage url={thumb} size={1200} style={imgStyle} />
        </Animated.View>
      )}
    </Animated.View>
  );
});

// bg (nút phát): màu nhấn hơi trong (thấy nhẹ nền khói phía sau) + viền sáng mảnh
function Btn({ onPress, bg, children }: { onPress: () => void; bg?: ReturnType<typeof useAnimatedStyle>; children: React.ReactNode }) {
  const b = useBounce();
  return (
    <Pressable onPress={onPress} onPressIn={b.onPressIn} onPressOut={b.onPressOut} hitSlop={6}>
      <Animated.View style={[styles.btn, b.style]}>
        {bg && (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 16, borderCurve: 'continuous', opacity: 0.86 }, bg]} />
            <View style={[StyleSheet.absoluteFill, { borderRadius: 16, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' }]} />
          </>
        )}
        {children}
      </Animated.View>
    </Pressable>
  );
}

// Đĩa vẽ bằng các View thường (vòng tròn có viền), KHÔNG dùng khung Skia nữa:
//  - lúc mở / thu nhỏ player, màn player được "chụp thành ảnh" cho mượt — khung Skia không được chụp vào → đĩa biến mất suốt
//    lúc chuyển rồi bật hiện lại (giật, thấy rõ khi quay màn hình); View thường thì được chụp bình thường
//  - không còn lỗi khung Skia dựng lúc ẩn bị trống (trước phải dựng lại mỗi lần mở player)
//  - viền tròn do hệ thống vẽ, không tốn ảnh to, GPU nhẹ hơn hai khung Skia toàn màn hình
// Cả khối dời theo lp (đĩa ⇄ lời) và sw (đổi bài) giống nhãn ảnh
function useDiscStyle(g: Geo, lp: SharedValue<number>, sw: SharedValue<number>) {
  const { cx1, cy1, R, rimY } = g;
  return useAnimatedStyle(() => ({
    transform: [
      { translateX: lp.value * cx1 + swapDX(R, lp.value) * sw.value },
      { translateY: lp.value * cy1 + swapDY(R, rimY, lp.value) * sw.value },
    ],
  }));
}
// vòng tròn tâm (0,0) bán kính r
const ring = (r: number, extra: object) => ({ position: 'absolute' as const, left: -r, top: -r, width: r * 2, height: r * 2, borderRadius: r, ...extra });

// Mặt đĩa + rãnh — nằm dưới nhãn ảnh: MỘT ảnh vẽ sẵn (theme/effects/discImage). Chưa có ảnh (lần đầu, đang vẽ) thì tạm
// một hình tròn đen
const DiscUnder = React.memo(function DiscUnder({ g, lp, sw }: { g: Geo; lp: SharedValue<number>; sw: SharedValue<number> }) {
  const { R } = g;
  const style = useDiscStyle(g, lp, sw);
  const [uri, setUri] = useState(() => discImageCached(R));
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => discImage(R).then((u) => alive && u && setUri(u)), uri ? 0 : 1200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [R]); // eslint-disable-line react-hooks/exhaustive-deps
  const S = R + discPad;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }, style]}>
      {uri ? (
        <RNImage source={{ uri }} fadeDuration={0} style={{ position: 'absolute', left: -S, top: -S, width: S * 2, height: S * 2 }} />
      ) : (
        <View style={ring(R, { backgroundColor: '#0b0b0c' })} />
      )}
    </Animated.View>
  );
});

// Viền tối quanh nhãn + lỗ tâm — nằm trên nhãn ảnh (đứng yên, không xoay)
// ghost: lúc player chưa mở xong (đang mở / thu nhỏ / đang ẩn) vẽ thêm vòng thanh thời gian bằng View — thanh thời gian thật là
// khung Skia, không được chụp vào ảnh lúc chuyển nên sẽ biến mất rồi hiện lại
const DiscOver = React.memo(function DiscOver({ g, lp, sw }: { g: Geo; lp: SharedValue<number>; sw: SharedValue<number> }) {
  const { R } = g;
  const LR = R * LABEL;
  const style = useDiscStyle(g, lp, sw);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }, style]}>
      <View style={ring(LR + 3, { borderWidth: 3.5, borderColor: '#0b0b0b' })} />
      <View style={ring(LR + 4, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' })} />
      <View style={ring(11, { backgroundColor: '#6d6862' })} />
      <View style={ring(7.5, { backgroundColor: '#c9c3bb' })} />
      <View style={ring(5, { backgroundColor: '#050505' })} />
    </Animated.View>
  );
});

// Vòng thanh thời gian GIẢ (View thường): lúc chuyển cảnh, cả player được chụp thành ảnh mà ảnh chụp không có phần vẽ bằng
// Skia → vòng giả thay chỗ cho đường ray của thanh thời gian. Luôn nằm sẵn, chỉ hiện khi player chưa mở hẳn (đọc thẳng độ mở
// player trên luồng giao diện: dựng mới đúng lúc bắt đầu thu player thì khựng 60–75ms khung đầu).
// Vòng tròn đủ thì dài hơn thanh thật → lúc kéo player xuống thấy thanh "dãn ra hai bên". Thanh thật luôn chạy từ x = M tới
// x = W − M (cả khi xem đĩa lẫn khi xem lời) → cắt vòng giả đúng trong dải đó là trùng khít với thanh thật
const GhostArc = React.memo(function GhostArc({ g, lp, sw, W, H }: { g: Geo; lp: SharedValue<number>; sw: SharedValue<number>; W: number; H: number }) {
  const style = useDiscStyle(g, lp, sw);
  const shown = useAnimatedStyle(() => ({ opacity: playerProgress.value > 0.995 ? 0 : 1 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: M, top: 0, width: W - 2 * M, height: H, overflow: 'hidden' }, shown]}>
      <Animated.View style={[{ position: 'absolute', left: -M, top: 0, width: 0, height: 0 }, style]}>
        <View style={ring(g.r + 1.5, { borderWidth: 3, borderColor: 'rgba(255,255,255,0.18)' })} />
      </Animated.View>
    </Animated.View>
  );
});

// Thanh thời gian cong: chỉ phần này đọc thời gian đã phát (đổi vài lần mỗi giây). Đi theo đĩa khi chuyển sang lời
const VinylArc = React.memo(function VinylArc({
  g, lp, accent, scrubSV, duration, loading, failed,
}: { g: Geo; lp: SharedValue<number>; accent: SharedValue<string>; scrubSV: SharedValue<number>; duration: number; loading: boolean; failed: boolean }) {
  const t = useT();
  const progress = useProgress();
  markRender('thanh thời gian');
  // đang kéo tua (cử chỉ tua nằm ở VinylPlayer, chạy trên luồng giao diện): scrubSV = vị trí 0..1, -1 = không kéo
  const [scrub, setScrub] = useState<number | null>(null);
  useAnimatedReaction(
    () => scrubSV.value,
    (v, prev) => {
      if (v !== prev) scheduleOnRN(setScrub, v < 0 ? null : v);
    }
  );
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

  return (
    <>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={bar} style="stroke" strokeWidth={3} strokeCap="round" color="rgba(255,255,255,0.18)" />
        <Path path={bar} style="stroke" strokeWidth={3} strokeCap="round" color={accent} start={0} end={pct} />
        <Circle cx={knobX} cy={knobY} r={scrub != null ? 9 : 6.5} color="#FFFFFF" />
        <TextPath path={textPath} font={font} text={cur} initialOffset={0} color={TEXT2} />
        <TextPath path={textPath} font={font} text={right} initialOffset={rightOff} color={failed ? '#FF8A80' : TEXT2} />
      </Canvas>
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
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pill: {
    height: PILL, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: PILL / 2, borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillCell: { width: 52, height: PILL, alignItems: 'center', justifyContent: 'center' },
  pillSep: { width: StyleSheet.hairlineWidth * 2, height: 20, backgroundColor: 'rgba(255,255,255,0.28)' },
  btn: { width: 62, height: 56, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
