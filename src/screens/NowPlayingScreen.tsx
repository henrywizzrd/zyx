import { useRenderProbe } from '../components/JankMonitor';
import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useCoverTint } from '../theme/coverTint';
import { useT } from '../i18n';
import { usePlayerPick, useProgress } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { Cover, SmartImage } from '../components/Cover';
import { CloseZone, usePlayerTransition } from '../components/PlayerTransition';
import { Slider } from '../components/Slider';
import { LyricsView } from '../components/LyricsView';
import { useLyrics } from '../music/lyrics';
import { audio, musicSupported } from '../music/lazy';
import { QueueSheet } from '../components/QueueSheet';
import { useSongMenu } from '../components/useSongMenu';
import { useActionSheet, useSheetOpen } from '../components/ActionSheet';
import { FX_SPEEDS, FxMode, fxLogText, setFxMode, setFxSpeed, useFxMode, useFxSpeed } from '../player/fxEngine';
import { BlurView } from 'expo-blur';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import RAnimated, { Easing as REasing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { PlayPauseGlyph, SkipGlyph, useBounce } from '../components/PlayerIcons';
import { VectorIcon, type VectorOp } from '../components/VectorIcon';
import { scheduleOnRN } from 'react-native-worklets';
import { useScreenSize } from '../components/ScreenSize';
import { VinylPlayer } from './VinylPlayer';
import { useVinylFlags } from '../debug/vinylFlags';

// Kiểu khai báo của thư viện chưa khớp React 19, ép kiểu để dùng như component bình thường
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;

const USE_NATIVE = Platform.OS !== 'web';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
// Text / icon colours of the player. White on the blurred cover normally; the Pop player (27/11) draws on a flat
// pastel of the cover colour, so NowPlayingScreen switches these to dark ink there (or keeps light on dark covers)
let FG = '#FFFFFF';
let SOFT = 'rgba(255,255,255,0.65)';
let POP = false; // Pop player: flat background, outlined art and buttons
let POP_DARK = false; // Pop player on a dark cover colour
// Màu nút đang bật (trộn, lặp, lời, chế độ âm thanh...): theo màu nhấn của theme, gán lại mỗi lần vẽ màn hình.
// Màu nhấn tối quá (vd. nâu cà phê) thì pha trắng cho sáng lên, không thì chìm trên nền tối của player
let ON = '#1ED760';
function onColor(hex: string) {
  const h = hex.replace('#', '').slice(0, 6);
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return '#1ED760';
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.45) {
    const k = Math.min(0.6, 0.45 - lum + 0.25);
    r = Math.round(r + (255 - r) * k);
    g = Math.round(g + (255 - g) * k);
    b = Math.round(b + (255 - b) * k);
  }
  return `rgb(${r},${g},${b})`;
}

// Pop player controls (mockup 27/11): skip buttons are outlined white squares with a hard shadow, play is a big
// solid square (ink on light covers, light on dark covers)
const popSkip = (k: number) => ({
  height: 54 * k,
  width: 54 * k,
  borderRadius: 16,
  borderCurve: 'continuous' as const,
  backgroundColor: '#FFFFFF',
  borderWidth: 2.5,
  borderColor: '#111111',
  boxShadow: '4px 4px 0px #111111',
});
const popPlay = (k: number) => ({
  width: 74 * k,
  height: 74 * k,
  borderRadius: 22,
  borderCurve: 'continuous' as const,
  backgroundColor: POP_DARK ? '#F4F4F0' : '#111111',
  boxShadow: `5px 5px 0px ${POP_DARK ? '#000000' : 'rgba(0,0,0,0.3)'}`,
});
// Pop: shuffle / repeat are outlined tiles like the skip buttons; turning them on only changes the colour to lime
const popToggle = (on: boolean) => ({
  width: 44,
  height: 44,
  backgroundColor: on ? '#D4F25A' : '#FFFFFF',
  borderRadius: 12,
  borderWidth: 2.5,
  borderColor: '#111111',
  boxShadow: '3px 3px 0px #111111',
});
// Pop: like / more buttons next to the title — outlined white circles; liked = coral
const popRound = (on: boolean) => ({
  width: 38,
  height: 38,
  borderRadius: 19,
  backgroundColor: on ? '#FF7A59' : '#FFFFFF',
  borderWidth: 2.5,
  borderColor: '#111111',
  boxShadow: '3px 3px 0px #111111',
});
const popPlayInk = () => (POP_DARK ? '#111111' : '#D4F25A');

// Nút lặp: hai mũi tên chạy vòng quanh thành hình vuông bo góc (vẽ bằng Skia, khung 24×24).
//  - tắt: trắng mờ
//  - lặp cả danh sách: sáng màu nhấn
//  - lặp 1 bài: sáng màu nhấn + số 1 nằm chính giữa hình vuông
const REPEAT_PATH = 'M4 12.5V8.5A3.5 3.5 0 0 1 7.5 5H18.5M15.5 2L18.5 5L15.5 8M20 11.5V15.5A3.5 3.5 0 0 1 16.5 19H5.5M8.5 22L5.5 19L8.5 16';
const skia = Platform.OS === 'web' ? null : (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia'));
// Mọi icon ở hàng dưới cùng dùng chung một cỡ khung để nhìn đều nhau
const ICON = 24;
const TITLE_SCALE = 0.72; // tên bài khi bay lên đầu (cạnh ảnh nhỏ) nhỏ lại còn chừng này
const PLAY = 66; // đường kính nút phát
const REPEAT_SIZE = ICON;

// Nút lời bài hát: ba vạch (vạch cuối ngắn) + nốt nhạc móc đơn bên phải (theo mẫu Tyson gửi; trang thử "ZYX – Icon lời & hàng chờ").
// Thân nốt + móc là MỘT nét liền (không ghép mảnh), đầu nốt tiếp xúc đúng mép thân
const LYRICS_OPS: VectorOp[] = [
  { d: 'M2.5 5H12.5M2.5 8.6H12.5M2.5 12.2H8', stroke: 1.8, round: true },
  { d: 'M16 17.8V4.2A4.9 4.9 0 0 1 20.9 9.1', stroke: 1.8, round: true },
  { circle: [13.2, 17.8, 3.7] },
];
// Nút hàng chờ: viên thuốc (bài đang phát) + hai vạch + dấu cộng (canh giữa theo hai vạch)
const QUEUE_OPS: VectorOp[] = [
  { d: 'M5.75 3.75H18.25A2.75 2.75 0 0 1 18.25 9.25H5.75A2.75 2.75 0 0 1 5.75 3.75Z', stroke: 1.8, round: true },
  { d: 'M3 14.5H11M3 19.5H11M17.5 13.5V20.5M14 17H21', stroke: 1.8, round: true },
];
function QueueIcon({ size = ICON, color = SOFT }: { size?: number; color?: string }) {
  if (!skia) return <Ionicons name="list" size={size} color={color} />;
  return <VectorIcon ops={QUEUE_OPS} size={size} color={color} />;
}
function LyricsIcon({ on }: { on: boolean }) {
  const color = on ? ON : SOFT;
  if (!skia) return <Ionicons name="chatbox-ellipses-outline" size={ICON} color={color} />;
  // Vẽ ra ảnh (không dùng khung Skia sống): khung Skia biến mất lúc player đang phóng to / thu nhỏ
  return <VectorIcon ops={LYRICS_OPS} size={ICON} color={color} />;
}

const REPEAT_OPS: VectorOp[] = [{ d: REPEAT_PATH, stroke: 2 }];
function RepeatIcon({ mode, color: forced }: { mode: 'off' | 'all' | 'one'; color?: string }) {
  const on = mode !== 'off';
  const color = forced ?? (on ? ON : SOFT);
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: REPEAT_SIZE, height: REPEAT_SIZE }}>
        {skia ? (
          <VectorIcon ops={REPEAT_OPS} box={24} size={REPEAT_SIZE} color={color} />
        ) : (
          <Ionicons name="repeat" size={REPEAT_SIZE} color={color} />
        )}
        {mode === 'one' && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <Text style={{ color, fontSize: 9, fontWeight: '900', lineHeight: 11, includeFontPadding: false }}>1</Text>
          </View>
        )}
      </View>

    </View>
  );
}

// Chuyển bài: ảnh bìa và tên bài trượt vào từ phía bài mới (bấm tới / tự sang bài: từ phải; bấm lùi: từ trái),
// mờ dần lên và về đúng cỡ (êm, không nảy)
let swapDir = 1;
function TrackSwap({ id, children, dist = 36, style }: { id: string; children: React.ReactNode; dist?: number; style?: any }) {
  const x = useSharedValue(0);
  const o = useSharedValue(1);
  const sc = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    x.value = swapDir * dist;
    o.value = 0.2;
    sc.value = 0.96;
    const ease = { duration: 320, easing: REasing.out(REasing.cubic) };
    x.value = withTiming(0, ease);
    o.value = withTiming(1, { duration: 280 });
    sc.value = withTiming(1, ease);
    swapDir = 1;
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: x.value }, { scale: sc.value }] }));
  return <RAnimated.View style={[style, st]}>{children}</RAnimated.View>;
}

// Nút trong hàng điều khiển: thu nhỏ nhẹ khi nhấn, trở lại êm khi thả
function CtlBtn({ onPress, style, children }: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const b = useBounce();
  return (
    <Pressable onPress={onPress} onPressIn={b.onPressIn} onPressOut={b.onPressOut} hitSlop={10} style={style}>
      <RAnimated.View style={[{ alignItems: 'center', justifyContent: 'center' }, b.style]}>{children}</RAnimated.View>
    </Pressable>
  );
}

// Thả tim: biểu tượng phồng lên êm, 6 hạt nhỏ toả ra xung quanh rồi tan (chỉ lúc bật)
function LikePop({ on, color, children }: { on: boolean; color: string; children: React.ReactNode }) {
  const pop = useSharedValue(1);
  const burst = useSharedValue(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pop.value = 0.75;
    pop.value = withTiming(1, { duration: 260, easing: REasing.out(REasing.cubic) });
    if (on) {
      burst.value = 0;
      burst.value = withTiming(1, { duration: 520, easing: REasing.out(REasing.cubic) });
    }
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Particle key={i} i={i} burst={burst} color={color} />
      ))}
      <RAnimated.View style={iconStyle}>{children}</RAnimated.View>
    </View>
  );
}
function Particle({ i, burst, color }: { i: number; burst: { value: number }; color: string }) {
  const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
  const style = useAnimatedStyle(() => {
    const t = burst.value;
    const d = 6 + 16 * t;
    return {
      opacity: t <= 0 || t >= 1 ? 0 : 1 - t,
      transform: [{ translateX: Math.cos(a) * d }, { translateY: Math.sin(a) * d }, { scale: 1 - 0.5 * t }],
    };
  });
  return <RAnimated.View pointerEvents="none" style={[{ position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: color }, style]} />;
}

// Nhớ đang xem lời hay ảnh bìa, để vuốt xuống rồi mở lại player vẫn giữ nguyên
let lyricsOpen = false;
// Kích thước bố cục player đo được (giữ qua các lần mở / đóng player)
const layoutMemo = { blockH: 52, slotW: 0, infoH: 0, headerH: 0 };
const posMemo = { ax: 0, ay: 0, lx: 0, ly: 0, ok: false };


// Màn player: chọn bố cục. Kiểu Đĩa than (màn dọc) là một component RIÊNG chỉ có đúng những gì nó cần — trước đây nó nằm chung
// trong player thường nên mỗi lần vẽ lại phải chạy cả ~30 hook / hiệu ứng của bố cục thường (~50ms trên luồng JS mỗi lần)
export function NowPlayingScreen({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const win = useScreenSize();
  // Đĩa than dùng cả khi xoay ngang (đĩa trái · lời phải, VinylPlayer tự đổi bố cục) → xoay máy không bị đổi sang player thường
  const tint = useCoverTint();
  POP = theme.style === 'pop' && theme.player.look !== 'vinyl';
  POP_DARK = POP && (tint ? tint.pop.dark : theme.colors.glassTint === 'dark');
  FG = POP && !POP_DARK ? '#111111' : '#FFFFFF';
  SOFT = POP && !POP_DARK ? 'rgba(17,17,17,0.62)' : 'rgba(255,255,255,0.65)';
  if (theme.player.look === 'vinyl') return <VinylNowPlaying onClose={onClose} />;
  return <ClassicNowPlaying onClose={onClose} />;
}

// Nút chọn chế độ âm thanh (dùng ở player Đĩa than)
function useFxPicker() {
  const sheet = useActionSheet();
  const t = useT();
  const fxMode = useFxMode();
  const fxSpeed = useFxSpeed();
  const fxOn = fxMode !== 'off' || fxSpeed !== 'normal';
  const pickFx = () => {
    const opts: { id: FxMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
      { id: 'off', label: t('fx.off'), icon: 'musical-note-outline' },
      { id: '8d', label: t('fx.8d'), icon: 'sync-outline' },
      { id: 'hall', label: t('fx.hall'), icon: 'business-outline' },
    ];
    sheet.openActions({ title: t('fx.title'), subtitle: t('fx.hint'), icon: 'headset-outline' }, [
      ...opts.map((o) => ({ label: o.label, icon: fxMode === o.id ? 'checkmark-circle' : o.icon, on: fxMode === o.id, run: () => setFxMode(o.id) })),
      {
        label: t('fx.speed'),
        icon: 'speedometer-outline' as const,
        on: fxSpeed !== 'normal',
        run: () => {},
        chips: FX_SPEEDS.map((sp) => ({ label: t(`fx.speed.${sp}` as const), on: fxSpeed === sp, run: () => setFxSpeed(sp) })),
      },
      { label: t('fx.sendLog'), icon: 'bug-outline' as const, run: () => {
          setTimeout(() => Share.share({ message: fxLogText() || '(trống)' }).catch(() => {}), 300);
        },
      },
    ]);
  };
  const ref = useRef(pickFx);
  ref.current = pickFx;
  const stable = useCallback(() => ref.current(), []);
  return { fxOn, pickFx: stable };
}

const V_ICON = { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const };

function VinylNowPlaying({ onClose }: { onClose: () => void }) {
  const { theme, landscape } = useTheme();
  ON = onColor(theme.colors.accent);
  const t = useT();
  const { fxOn, pickFx } = useFxPicker();
  const {
    track, isPlaying, duration, loading, failed,
    togglePlay, next, prev, seekTo, shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
  } = usePlayerPick('track', 'isPlaying', 'duration', 'loading', 'failed', 'togglePlay', 'next', 'prev', 'seekTo', 'shuffle', 'repeat', 'toggleShuffle', 'cycleRepeat', 'liked', 'toggleLike');
  const idle = track.id === 'none';
  const title = idle ? t('np.idleTitle') : track.title;
  const artist = idle ? t('np.idleArtist') : track.artist;
  const swipe = usePlayerTransition();
  // Lời: màn dọc nhớ theo người dùng; màn ngang lúc nào xoay vào cũng mở lời sẵn (đĩa trái · lời phải), xoay dọc lại thì về
  // đúng như trước. Tính thẳng từ hướng màn hình ngay trong lần vẽ này — trước đây đổi bằng setState trong effect sau khi xoay
  // → player vẽ lại thêm 1–2 lần (~60ms mỗi lần) đúng lúc đang xoay (log 20/11 12:29)
  const [portLyrics, setPortLyrics] = useState(() => lyricsOpen);
  const [landLyrics, setLandLyrics] = useState(true);
  const [seenLand, setSeenLand] = useState(landscape);
  if (seenLand !== landscape) {
    setSeenLand(landscape);
    if (landscape && !landLyrics) setLandLyrics(true);
  }
  const showLyrics = landscape ? landLyrics : portLyrics;
  const landRef = useRef(landscape);
  landRef.current = landscape;
  const setShowLyrics = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    if (landRef.current) setLandLyrics((p) => (typeof v === 'function' ? v(p) : v));
    else setPortLyrics((p) => (lyricsOpen = typeof v === 'function' ? v(p) : v));
  }, []);
  const [queueOpen, setQueueOpen] = useState(false);
  // tải lời sẵn ngay khi player hiện ra → vuốt đĩa lên là có chữ liền
  const vf = useVinylFlags(); // bảng dò lỗi: tắt 'Tải lời sẵn khi mở player' → chỉ tải khi bấm nút lời
  const lyr = useLyrics(track, showLyrics || (vf.lyricsFetch && swipe.active), duration);
  useRenderProbe('Player đĩa than', { theme, track, isPlaying, duration, loading, failed, shuffle, repeat, liked, active: swipe.active, moving: swipe.moving, showLyrics, queueOpen, lyr: lyr.lyrics, lyrSt: lyr.status, fxOn });
  const isLiked = liked.has(track.id);
  const goPrev = useCallback(() => {
    swapDir = -1;
    prev();
  }, [prev]);

  // Các phần dựng sẵn bằng useMemo: chỉ dựng lại khi chính nó đổi
  const lyricsNode = useMemo(() => <LyricsView status={lyr.status} lyrics={lyr.lyrics} onSeek={seekTo} fadeStops={[0.3, 0.6]} />, [lyr.status, lyr.lyrics, seekTo]);
  const volume = useMemo(() => <VolumeBar vertical />, []);
  const likeNode = useMemo(
    () => (
      <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={6} style={V_ICON}>
        <LikePop on={isLiked} color={ON}>
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={22} color={isLiked ? ON : '#FFFFFF'} />
        </LikePop>
      </Pressable>
    ),
    [isLiked, track.id, toggleLike, theme.colors.accent] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const fxNode = useMemo(
    () => (
      <Pressable onPress={pickFx} hitSlop={10} style={styles.sideBtn}>
        <Ionicons name={fxOn ? 'headset' : 'headset-outline'} size={22} color={fxOn ? ON : SOFT} />
      </Pressable>
    ),
    [fxOn, pickFx, theme.colors.accent] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const icons = useMemo(
    () => (
      <>
        <Pressable onPress={() => setShowLyrics((v) => !v)} hitSlop={6} style={V_ICON}>
          <LyricsIcon on={showLyrics} />
        </Pressable>
        <Pressable onPress={() => setQueueOpen(true)} hitSlop={6} style={V_ICON}>
          <QueueIcon />
        </Pressable>
        <CtlBtn onPress={toggleShuffle} style={V_ICON}>
          <Ionicons name="shuffle" size={ICON} color={shuffle ? ON : SOFT} />
        </CtlBtn>
        <CtlBtn onPress={cycleRepeat} style={V_ICON}>
          <RepeatIcon mode={repeat} color={repeat !== 'off' ? ON : SOFT} />
        </CtlBtn>
      </>
    ),
    [showLyrics, shuffle, repeat, toggleShuffle, cycleRepeat, setShowLyrics, theme.colors.accent] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const queue = useMemo(() => <QueueSheet visible={queueOpen} onClose={closeQueue} />, [queueOpen, closeQueue]);

  return (
    <VinylPlayer
      track={track}
      isPlaying={isPlaying}
      loading={loading}
      failed={failed}
      duration={duration}
      togglePlay={togglePlay}
      next={next}
      prev={goPrev}
      seekTo={seekTo}
      onClose={onClose}
      title={title}
      artist={artist}
      lyricsOpen={showLyrics}
      setLyricsOpen={setShowLyrics}
      lyrics={lyricsNode}
      noLyrics={lyr.status === 'done' && !lyr.lyrics}
      volume={volume}
      like={likeNode}
      fx={fxNode}
      icons={icons}
    >
      {queue}
    </VinylPlayer>
  );
}

function ClassicNowPlaying({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  ON = POP && !POP_DARK ? theme.colors.accentText : onColor(theme.colors.accent);
  const popTint = useCoverTint();
  const sheet = useActionSheet();
  // Đang mở hàng chờ / bảng thao tác: duỗi phẳng hai trang sách. Trang nghiêng 3D chồm ra phía trước nên iPhone vẽ nó
  // đè lên mọi thứ ở trên (hàng chờ, bảng "Thêm vào playlist"), kể cả khi các bảng đó nằm ở lớp trên
  const sheetOpen = useSheetOpen();
  const t = useT();
  // Chế độ âm thanh: Bình thường / 8D / Phòng hoà nhạc
  const fxMode = useFxMode();
  const fxSpeed = useFxSpeed();
  const fxOn = fxMode !== 'off' || fxSpeed !== 'normal';

  const pickFx = () => {
    const opts: { id: FxMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
      { id: 'off', label: t('fx.off'), icon: 'musical-note-outline' },
      { id: '8d', label: t('fx.8d'), icon: 'sync-outline' },
      { id: 'hall', label: t('fx.hall'), icon: 'business-outline' },
    ];
    sheet.openActions(
      { title: t('fx.title'), subtitle: t('fx.hint'), icon: 'headset-outline' },
      [
        ...opts.map((o) => ({ label: o.label, icon: fxMode === o.id ? 'checkmark-circle' : o.icon, on: fxMode === o.id, run: () => setFxMode(o.id) })),
        // Tốc độ: Slowed + reverb / Slowed / Gốc / Sped up / Nightcore (đổi cả cao độ), dùng chung được với 8D / Hội trường
        {
          label: t('fx.speed'),
          icon: 'speedometer-outline' as const,
          on: fxSpeed !== 'normal',
          run: () => {},
          chips: FX_SPEEDS.map((sp) => ({ label: t(`fx.speed.${sp}` as const), on: fxSpeed === sp, run: () => setFxSpeed(sp) })),
        },
        // Gửi nhật ký bộ hiệu ứng (dò lỗi mất tiếng khi chạy nền)
        { label: t('fx.sendLog'), icon: 'bug-outline' as const, run: () => {
            setTimeout(() => Share.share({ message: fxLogText() || '(trống)' }).catch(() => {}), 300);
          },
        },
      ]
    );
  };
  const FxButton = (
    <Pressable onPress={pickFx} hitSlop={10} style={styles.sideBtn}>
      <Ionicons name={fxOn ? 'headset' : 'headset-outline'} size={22} color={fxOn ? ON : SOFT} />
    </Pressable>
  );
  const pad = useContentInsets();
  const songMenu = useSongMenu();
  const {
    track, isPlaying, duration, loading, failed,
    togglePlay, next, prev, seekTo, shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
  } = usePlayerPick('track', 'isPlaying', 'duration', 'loading', 'failed', 'togglePlay', 'next', 'prev', 'seekTo', 'shuffle', 'repeat', 'toggleShuffle', 'cycleRepeat', 'liked', 'toggleLike');
  const accent = theme.colors.accent;
  // Chưa phát bài nào: hiện câu nhắc theo ngôn ngữ đang chọn
  const idle = track.id === 'none';
  const title = idle ? t('np.idleTitle') : track.title;
  const artist = idle ? t('np.idleArtist') : track.artist;

  // Báo vị trí ảnh bìa lớn để lúc mở player, ảnh album từ mini player bay tới đúng chỗ này.
  // Các vùng bọc <CloseZone> cho phép vuốt xuống để thoát.
  const swipe = usePlayerTransition();

  const [showLyrics, setShowLyricsState] = useState(() => lyricsOpen);
  const setShowLyrics = (v: boolean | ((p: boolean) => boolean)) =>
    setShowLyricsState((p) => (lyricsOpen = typeof v === 'function' ? v(p) : v));
  const [queueOpen, setQueueOpen] = useState(false);

  // Màn hình ngang: app tự xoay theo điện thoại (không còn nút xoay). Đóng player bằng cách vuốt xuống
  const win = useScreenSize();
  const landscape = win.width > win.height;
  const insets = useSafeAreaInsets();
  const [landLyrics, setLandLyrics] = useState(true); // ở chế độ ngang, lời hiện mặc định
  // Đo thời gian vẽ lại + ghi lại giá trị nào đổi (log 13/11: player vẽ lại ~2 lần / giây "trang cha vẽ lại / state riêng",
  // cần biết cụ thể là giá trị nào)
  useRenderProbe('Player', {
    theme, sheet, sheetOpen, t, fxMode, fxSpeed, track, isPlaying, duration, loading, failed, togglePlay, next, prev, seekTo,
    shuffle, repeat, liked, pad, songMenu, moving: swipe.moving, active: swipe.active, win, insets, showLyrics, queueOpen,
  });

  const lyr = useLyrics(track, landscape ? landLyrics : showLyrics, duration);

  // ---- Chuyển ảnh bìa ⇄ lời (giống Apple Music): một giá trị lp chạy 0 → 1 trên UI thread, mọi thứ đi theo nó:
  //  ảnh bìa lớn nhoè dần + tối đi, ảnh nhỏ hiện ra ở góc trên, tên bài bay từ dưới lên cạnh ảnh nhỏ (và nhỏ lại),
  //  nút thích / menu ở dưới mờ đi, lời hiện dần từ dưới lên. Đóng lời thì chạy ngược lại
  const lp = useSharedValue(showLyrics ? 1 : 0);
  const [lyricsMounted, setLyricsMounted] = useState(showLyrics);
  useEffect(() => {
    if (showLyrics) setLyricsMounted(true);
    lp.value = withTiming(showLyrics ? 1 : 0, { duration: 460, easing: REasing.bezier(0.25, 0.8, 0.25, 1) }, (done) => {
      if (done && !showLyrics) scheduleOnRN(setLyricsMounted, false);
    });
  }, [showLyrics]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Lời toàn màn hình: phần đầu trượt lên, thanh thời gian + nút điều khiển trượt xuống và mờ đi, lời chiếm cả màn hình
  const [full, setFull] = useState(false);
  const fp = useSharedValue(0);
  const [bodyH, setBodyH] = useState(0);
  const bodyHV = useSharedValue(0);
  const headerHV = useSharedValue(layoutMemo.headerH);
  useEffect(() => {
    if (!showLyrics && full) setFull(false);
  }, [showLyrics]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fp.value = withTiming(full ? 1 : 0, { duration: 380, easing: REasing.bezier(0.25, 0.8, 0.25, 1) });
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  // Vị trí của tên bài ở hai chỗ (đo bằng onLayout): dưới ảnh bìa (a) và trên đầu cạnh ảnh nhỏ (l)
  const ax = useSharedValue(posMemo.ax), ay = useSharedValue(posMemo.ay), lx = useSharedValue(posMemo.lx), ly = useSharedValue(posMemo.ly);
  const measured = useSharedValue(posMemo.ok ? 1 : 0); // đủ 2 vị trí thì mới hiện tên bài (tránh nháy ở góc trái trên)
  // Các kích thước đo được nhớ lại cho lần mở player sau (layoutMemo, ngoài component): mở player là có số đúng ngay,
  // không phải vẽ lại vài lần giữa lúc đang phóng to (mỗi lần vẽ lại giữa chừng làm hiệu ứng mở bị giật)
  const [blockH, setBlockHRaw] = useState(layoutMemo.blockH); // chiều cao khối tên bài + nghệ sĩ (cỡ chữ lớn)
  const [slotW, setSlotWRaw] = useState(layoutMemo.slotW); // bề ngang chỗ dành cho tên bài ở dưới ảnh bìa
  const [infoH, setInfoHRaw] = useState(layoutMemo.infoH); // chiều cao phần tên bài ở dưới (ảnh bìa dừng ngay trên phần này)
  const [headerH, setHeaderHRaw] = useState(layoutMemo.headerH); // phần đầu (thanh kéo + hàng ảnh nhỏ): lời bắt đầu ngay dưới
  const remember = (k: keyof typeof layoutMemo, set: (v: number) => void) => (v: number) => {
    if (Math.abs(layoutMemo[k] - v) < 0.5) return;
    layoutMemo[k] = v;
    set(v);
  };
  const setBlockH = remember('blockH', setBlockHRaw);
  const setSlotW = remember('slotW', setSlotWRaw);
  const setInfoH = remember('infoH', setInfoHRaw);
  const setHeaderH = remember('headerH', setHeaderHRaw);
  const pos = useRef({ wrapY: 0, rowY: 0, slotX: 0, slotY: 0, hRowY: 0, hSlotX: 0, hSlotY: 0, side: 0 });
  const updatePos = () => {
    const q = pos.current;
    const next = { ax: q.side + q.slotX, ay: q.wrapY + q.rowY + q.slotY, lx: q.side + q.hSlotX, ly: q.hRowY + q.hSlotY };
    // Chỉ cập nhật khi vị trí thật sự đổi (mở player lần sau dùng luôn số đã nhớ, không làm hiệu ứng mở phải vẽ lại)
    const same = posMemo.ok && (['ax', 'ay', 'lx', 'ly'] as const).every((k) => Math.abs(posMemo[k] - next[k]) < 0.5);
    if (same) return;
    // Lần đầu: đợi đo đủ cả 4 chỗ (hàng dưới, chỗ tên bài dưới, hàng đầu, chỗ tên bài trên) rồi mới hiện tên bài
    if (!(q.wrapY > 0 && q.hRowY > 0 && q.slotX >= 0 && q.hSlotX > 0)) return;
    Object.assign(posMemo, next, { ok: true });
    ax.value = next.ax;
    ay.value = next.ay;
    lx.value = next.lx;
    ly.value = next.ly;
    measured.value = 1;
  };
  const floatStyle = useAnimatedStyle(() => ({
    opacity: measured.value,
    transform: [
      { translateX: interpolate(lp.value, [0, 1], [ax.value, lx.value]) },
      { translateY: interpolate(lp.value, [0, 1], [ay.value, ly.value]) },
      { scale: interpolate(lp.value, [0, 1], [1, TITLE_SCALE]) },
    ],
  }));
  // Ảnh bìa phóng nhẹ khi mở lời. Chỉ phóng ẢNH, còn mặt nạ mờ dần ở mép dưới đứng yên: trước đây mặt nạ bị phóng theo
  // nên phần mờ dần trôi xuống quá mép khung → ảnh bị cắt ngang ở mép dưới, thành một đường kẻ ngay trên thanh thời gian
  const sharpArtStyle = useAnimatedStyle(() => ({ opacity: interpolate(lp.value, [0, 0.65], [1, 0], 'clamp') }));
  const blurArtStyle = useAnimatedStyle(() => ({ opacity: interpolate(lp.value, [0, 0.45, 1], [0, 0.95, 0.45]) }));
  const artZoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(lp.value, [0, 1], [1, 1.08]) }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: lp.value * 0.35 }));
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.35, 0.9], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(lp.value, [0, 1], [0.6, 1]) }],
  }));
  const infoBtnsStyle = useAnimatedStyle(() => ({ opacity: interpolate(lp.value, [0, 0.4], [1, 0], 'clamp') }));
  const headerFullStyle = useAnimatedStyle(() => ({
    opacity: 1 - fp.value,
    transform: [{ translateY: -70 * fp.value }],
  }));
  const bodyFullStyle = useAnimatedStyle(() => ({
    opacity: 1 - fp.value,
    transform: [{ translateY: (bodyHV.value + 20) * fp.value }],
  }));
  // Lời toàn màn hình: khung lời LUÔN to bằng cỡ toàn màn hình (mép trên sát tai thỏ, mép dưới tới chỗ thanh thời gian),
  // chỉ có "cửa sổ" nhìn thấy (mặt nạ mờ mép) là rộng ra / hẹp lại. Lời không bị dựng lại bố cục, câu đang hát đứng yên
  // đúng chỗ cũ; phần đầu trượt lên, phần dưới trượt xuống, lộ thêm các câu trên / dưới.
  // (Trước đây đổi top/bottom của khung lời mỗi khung hình → máy tính lại bố cục liên tục, lời bị đẩy lệch → giật)
  const [stageH, setStageH] = useState(0);
  const stageHV = useSharedValue(0);
  const fullTop = pad.top + 8;
  const fullBottomOver = Math.max(0, bodyH - pad.bottom - 44); // khung lời thò xuống dưới sân khấu (vào chỗ phần dưới)
  const boxH = Math.max(1, stageH - fullTop + fullBottomOver);
  const lyricFocus = headerH - fullTop + (stageH - headerH) / 2; // giữa vùng lời lúc bình thường
  const windowStyle = useAnimatedStyle(() => {
    const bh = Math.max(1, stageHV.value - fullTop + Math.max(0, bodyHV.value - pad.bottom - 44));
    const y0 = headerHV.value - fullTop;
    const k = Math.max(0.05, (stageHV.value - headerHV.value) / bh);
    return {
      transform: [
        { translateY: interpolate(fp.value, [0, 1], [y0, 0]) },
        { scaleY: interpolate(fp.value, [0, 1], [k, 1]) },
      ],
    };
  });
  // Nút toàn màn hình: góc phải dưới khung lời, ngay trên thanh thời gian (chỉ dịch chuyển, không đổi bố cục)
  const lyricBtnsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.5, 1], [0, 1], 'clamp'),
    transform: [{ translateY: fp.value * (bodyHV.value + 4 - (pad.bottom + 10)) }],
  }));
  const lyricsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(lp.value, [0, 1], [60, 0]) }],
  }));

  const isLiked = liked.has(track.id);


  const LikeButton = (
    <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={10} style={[styles.roundBtn, POP && popRound(isLiked)]}>
      <LikePop on={isLiked} color={POP ? '#111111' : ON}>
        <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={20} color={POP ? '#111111' : isLiked ? ON : FG} />
      </LikePop>
    </Pressable>
  );
  const MoreButton = (
    <Pressable onPress={() => track.id !== 'none' && songMenu(track)} hitSlop={10} style={[styles.roundBtn, POP && popRound(false)]}>
      <Ionicons name="ellipsis-horizontal" size={20} color={POP ? '#111111' : FG} />
    </Pressable>
  );

  // Kiểu Spotify: đã thích = vòng tròn xanh có dấu tích, chưa thích = vòng tròn viền có dấu cộng
  const SaveButton = (
    <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={10} style={styles.flatBtn}>
      <LikePop on={isLiked} color={ON}>
        <Ionicons name={isLiked ? 'checkmark-circle' : 'add-circle-outline'} size={30} color={isLiked ? ON : FG} />
      </LikePop>
    </Pressable>
  );
  const MoreButtonFlat = (
    <Pressable onPress={() => track.id !== 'none' && songMenu(track)} hitSlop={10} style={styles.flatBtn}>
      <Ionicons name="ellipsis-horizontal" size={24} color={FG} />
    </Pressable>
  );

  // Nền kiểu Apple Music: màu của ảnh bìa nhoè thành những mảng màu lớn, chậm rãi trôi xoay.
  // Hai lớp ảnh mờ xoay ngược chiều nhau nên màu cứ loang đổi liên tục mà rất nhẹ máy (chỉ là xoay ảnh)
  // Trong lúc phóng to / thu nhỏ player thì tạm dừng xoay (màn player đang được chụp thành ảnh, có gì chuyển động là phải chụp lại mỗi khung hình)
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (swipe.moving || !swipe.active) return;
    let alive = true;
    let anim: Animated.CompositeAnimation | null = null;
    // Xoay tiếp từ chỗ đang dừng tới hết vòng, rồi mới lặp vòng mới (không bị giật ngược về góc cũ)
    spin.stopAnimation((v) => {
      if (!alive) return;
      anim = Animated.timing(spin, { toValue: 1, duration: Math.max(1, (1 - v) * 60000), easing: Easing.linear, useNativeDriver: USE_NATIVE });
      anim.start(({ finished }) => {
        if (!finished || !alive) return;
        spin.setValue(0); // 360° và 0° là cùng một góc nên không thấy nhảy
        anim = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: USE_NATIVE }));
        anim.start();
      });
    });
    return () => {
      alive = false;
      anim?.stop();
    };
  }, [spin, swipe.moving, swipe.active]);
  const rot1 = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rot2 = spin.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  const blobSize = Math.max(win.width, win.height) * 1.9;
  const blob = { position: 'absolute' as const, width: blobSize, height: blobSize, left: (win.width - blobSize) / 2, top: (win.height - blobSize) / 2 };
  const smallThumb = track.thumb?.replace(/=(w\d+-h\d+|s\d+)/, '=w120-h120');
  const Background = POP ? (
    // Pop: one flat colour — a pastel of the cover (dark grey for colourless covers). No blur, nothing moving
    <View style={[StyleSheet.absoluteFill, { backgroundColor: popTint?.pop.bg ?? theme.colors.bg }]} />
  ) : (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: track.color || '#222' }]}>
      {smallThumb && (
        <>
          <Animated.Image source={{ uri: smallThumb }} blurRadius={70} resizeMode="cover" style={[blob, { transform: [{ rotate: rot1 }] }]} />
          <Animated.Image
            source={{ uri: smallThumb }}
            blurRadius={70}
            resizeMode="cover"
            style={[blob, { opacity: 0.6, transform: [{ rotate: rot2 }, { scaleX: -1 }, { scale: 0.8 }] }]}
          />
        </>
      )}
      {/* Phủ tối nhẹ để chữ trắng luôn đọc được */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} />
    </View>
  );

  // Thanh thời gian và âm lượng là component riêng (khai báo ngoài màn hình, bên dưới):
  // kéo thanh / thời gian chạy chỉ vẽ lại đúng cái thanh đó, không vẽ lại cả màn player như trước (kéo âm lượng từng tụt còn 5 fps)
  const Progress = <ProgressBar duration={duration} loading={loading} failed={failed} seekTo={seekTo} />;

  // ◀◀  ❚❚  ▶▶ to, trắng, ở giữa (giống Apple Music).
  // Gọi như hàm thường (controls(true)), KHÔNG dùng như component <Controls />: component khai báo bên trong
  // màn hình bị React coi là loại mới sau mỗi lần vẽ lại (thời gian bài hát đổi liên tục) nên nút bị gỡ ra
  // dựng lại giữa lúc đang bấm → lúc ăn lúc không
  const controls = (big = true) => (
    <View style={styles.spotRow}>{controlRow(big ? 1 : 0.8)}</View>
  );

  // Hàng điều khiển kiểu mới: trộn | ◀◀ | ▶ to (không vòng tròn) | ▶▶ | lặp.
  // Nút đang bật chỉ sáng lên màu nhấn của theme (không còn chấm bên dưới); lặp 1 bài có số 1. Bấm nút nào cũng nảy nhẹ
  const controlRow = (k: number) => (
    <>
      <CtlBtn onPress={toggleShuffle} style={[styles.sideBtn, POP && popToggle(shuffle)]}>
        <Ionicons name="shuffle" size={Math.round((POP ? 22 : 26) * k)} color={POP ? '#111111' : shuffle ? ON : FG} />
      </CtlBtn>
      <CtlBtn
        onPress={() => {
          swapDir = -1;
          prev();
        }}
        style={[styles.skipSlot, { width: 52 * k }, POP && popSkip(k)]}
      >
        <SkipGlyph dir="back" size={Math.round((POP ? 24 : 31) * k)} color={POP ? '#111111' : '#FFFFFF'} />
      </CtlBtn>
      <CtlBtn
        onPress={togglePlay}
        style={[{ width: PLAY * k, height: PLAY * k, alignItems: 'center', justifyContent: 'center' }, POP && popPlay(k)]}
      >
        {loading ? (
          <ActivityIndicator size="large" color={POP ? popPlayInk() : '#FFFFFF'} />
        ) : (
          <PlayPauseGlyph playing={isPlaying} size={Math.round((POP ? 32 : 38) * k)} color={POP ? popPlayInk() : '#FFFFFF'} />
        )}
      </CtlBtn>
      <CtlBtn onPress={next} style={[styles.skipSlot, { width: 52 * k }, POP && popSkip(k)]}>
        <SkipGlyph dir="forward" size={Math.round((POP ? 24 : 31) * k)} color={POP ? '#111111' : '#FFFFFF'} />
      </CtlBtn>
      <CtlBtn onPress={cycleRepeat} style={[styles.sideBtn, POP && popToggle(repeat !== 'off')]}>
        <RepeatIcon mode={repeat} color={POP ? '#111111' : repeat !== 'off' ? ON : FG} />
      </CtlBtn>
    </>
  );
  const spotifyControls = <View style={styles.spotRow}>{controlRow(1)}</View>;

  const Volume = <VolumeBar />;

  // ================= Màn hình ngang =================
  // Có lời: trái là ảnh + điều khiển, giữa là lời, mép phải là âm lượng và các nút.
  // Không lời: ảnh bìa lớn bên trái, bên phải là tên bài + điều khiển + thanh thời gian (giống Apple Music khi xoay ngang)
  if (landscape) {
    const padT = Math.max(insets.top, 12);
    const padB = Math.max(insets.bottom, 12);
    const usableH = win.height - padT - padB;
    const SideButtons = (
      <View style={{ width: 44, alignItems: 'center', gap: 14, justifyContent: 'center' }}>
        <Ionicons name="volume-high" size={18} color={SOFT} />
        {/* Thanh âm lượng không chiếm hết chiều cao: phần trống trên / dưới để vuốt xuống thu nhỏ player */}
        <View style={{ flex: 1, maxHeight: Math.max(110, usableH - 250), alignItems: 'center' }}>
          <VolumeBar vertical />
        </View>
        <Ionicons name="volume-low" size={18} color={SOFT} />
        {/* Lời | chế độ âm thanh | hàng chờ: ba ô cùng cỡ, cách đều nhau */}
        <View style={{ alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Pressable onPress={() => setLandLyrics((v) => !v)} hitSlop={8} style={styles.sideBtn}>
            <LyricsIcon on={landLyrics} />
          </Pressable>
          {FxButton}
          <Pressable onPress={() => setQueueOpen(true)} hitSlop={8} style={styles.sideBtn}>
            <QueueIcon size={26} />
          </Pressable>
        </View>
      </View>
    );
    // Cột nút bên phải + khoảng trống quanh nó (kéo rộng sang trái và tới sát mép màn hình): vuốt xuống ở đây để thu nhỏ player.
    // Trước đây vùng vuốt chỉ rộng đúng bằng cột 44px, gần như kín chỗ bởi thanh âm lượng nên không kéo được
    const sideZone = { alignSelf: 'stretch' as const, flexDirection: 'row' as const, justifyContent: 'center' as const, marginLeft: -20, paddingLeft: 20, paddingRight: Math.max(10, insets.right - 16) }; // pushed closer to the right edge (28/11), still clear of the Dynamic Island
    // Vuốt xuống để thoát khi nằm ngang: thanh ngang ở mép trên (cả dải trên cùng đều vuốt được),
    // và mọi chỗ trống không phải lời / thanh trượt (trang trái, cột nút bên phải)
    const GrabBar = (
      <CloseZone><View  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: padT + 14, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 }}>
        <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: SOFT }} />
      </View></CloseZone>
    );
    const rowStyle = {
      flex: 1,
      flexDirection: 'row' as const,
      paddingTop: padT,
      paddingBottom: padB,
      paddingLeft: insets.left + 20,
      paddingRight: 0,
      gap: 28,
    };

    if (!landLyrics) {
      const art = Math.max(0, Math.round(usableH * 0.8)); // nhỏ lại một chút cho thoáng
      return (
        <View style={{ flex: 1 }}>
          {Background}
          <StatusBar barStyle={POP && !POP_DARK ? 'dark-content' : 'light-content'} />
          <View style={rowStyle}>
            <CloseZone><View style={{ justifyContent: 'center' }} >
              <TrackSwap id={track.id}>
              <Cover track={track} size={1200} style={{ width: art, height: art, borderRadius: 12 }}>
                <Ionicons name="musical-notes" size={48} color="rgba(255,255,255,0.8)" />
              </Cover>
              </TrackSwap>
            </View></CloseZone>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <View style={{ flex: 1 }} />
                {LikeButton}
                {MoreButton}
              </View>
              <Text numberOfLines={1} style={[styles.title, { color: FG }, { textAlign: 'center', fontSize: 26 }]}>{title}</Text>
              <Text numberOfLines={1} style={[styles.artist, { color: SOFT }, { textAlign: 'center' }]}>{artist}</Text>
              <View style={{ marginTop: 14 }}>
                {controls(true)}
              </View>
              <View style={{ marginTop: 14 }}>{Progress}</View>
            </View>
            <CloseZone><View  style={sideZone}>{SideButtons}</View></CloseZone>
          </View>
          {GrabBar}
          <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} inModal />
        </View>
      );
    }

    // Bento (28/11): flat tiles, no 3D tilt. Left: big cover, title + like, time bar.
    // Middle: lyrics. Then the 5 player buttons stacked vertically, then volume + side buttons at the right edge
    const top = padT + 14; // tiles start below the grab bar
    const innerH = win.height - top - padB;
    const TILE_PAD = 14;
    const INFO_H = 98; // title row + time bar under the cover
    const art = Math.max(120, Math.min(innerH - TILE_PAD * 2 - INFO_H, Math.round(win.width * 0.4) - TILE_PAD * 2));
    const tile = POP
      ? { borderRadius: 22, borderCurve: 'continuous' as const, borderWidth: 2.5, borderColor: '#111111', backgroundColor: POP_DARK ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.32)', boxShadow: '5px 5px 0px #111111' }
      : { borderRadius: 24, borderCurve: 'continuous' as const, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' };
    return (
      <View style={{ flex: 1 }}>
        {Background}
        <StatusBar barStyle={POP && !POP_DARK ? 'dark-content' : 'light-content'} />
        <View style={[rowStyle, { paddingTop: top, gap: 12 }]}>
          <CloseZone><View style={[tile, { width: art + TILE_PAD * 2, padding: TILE_PAD, justifyContent: 'center' }]}>
            <TrackSwap id={track.id}>
              <Cover track={track} size={1200} style={{ width: art, height: art, borderRadius: POP ? 14 : 16, borderWidth: POP ? 2.5 : 0, borderColor: '#111111' }}>
                <Ionicons name="musical-notes" size={48} color="rgba(255,255,255,0.8)" />
              </Cover>
            </TrackSwap>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.title, { color: FG }, { fontSize: 19 }]}>{title}</Text>
                <Text numberOfLines={1} style={[styles.artist, { color: SOFT }, { fontSize: 14 }]}>{artist}</Text>
              </View>
              {LikeButton}
            </View>
            <View style={{ marginTop: 6 }}>{Progress}</View>
          </View></CloseZone>
          {/* Clipping happens on an inner view: overflow hidden on the outlined tile itself breaks its border and shadow at the corners */}
          <View style={[tile, { flex: 1 }]}>
            <View style={{ flex: 1, borderRadius: tile.borderRadius - 2.5, overflow: 'hidden', paddingLeft: 24, paddingRight: 10 }}>
              <LyricsView scale={0.72} status={lyr.status} lyrics={lyr.lyrics} onSeek={seekTo} ink={POP && !POP_DARK ? '#111111' : undefined} mark={POP && !POP_DARK ? '#D4F25A' : undefined} />
            </View>
          </View>
          <View style={[tile, { width: POP ? 84 : 76, paddingVertical: 10, alignItems: 'center', justifyContent: 'space-evenly' }]}>
            {controlRow(0.8)}
          </View>
          <CloseZone><View style={[sideZone, { marginLeft: -12, paddingLeft: 12 }]}>{SideButtons}</View></CloseZone>
        </View>
        {GrabBar}
        <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} inModal />
      </View>
    );
  }

  // ================= Màn hình dọc (kiểu Spotify) =================
  // Bottom: tên bài + thích/menu, thanh thời gian, hàng điều khiển (trộn ở đầu, lặp ở cuối), âm lượng,
  // hàng dưới cùng chỉ còn nút lời (trái) và hàng chờ (phải)
  const PlayerBody = (
    <>
      <View style={{ marginTop: 20 }}>{Progress}</View>
      <View style={{ marginTop: 10 }}>{spotifyControls}</View>
      <View style={{ marginTop: 18 }}>{Volume}</View>
      {/* Hàng dưới dựng y hệt khung của hàng điều khiển (cùng các ô rộng bằng nhau) nên nút lời nằm
          thẳng dưới nút lùi, nút hàng chờ thẳng dưới nút tới, đối xứng hai bên nút phát */}
      <View style={[styles.spotRow, { marginTop: 14 }]}>
        <View style={styles.sideBtn} />
        <Pressable onPress={() => setShowLyrics((v) => !v)} hitSlop={10} style={styles.skipSlot}>
          <LyricsIcon on={showLyrics} />
        </Pressable>
        {/* Chế độ âm thanh: giữa nút lời và nút hàng chờ, thẳng dưới nút phát */}
        <View style={{ width: PLAY, alignItems: 'center' }}>{FxButton}</View>
        <Pressable onPress={() => setQueueOpen(true)} hitSlop={10} style={styles.skipSlot}>
          <QueueIcon />
        </Pressable>
        <View style={styles.sideBtn} />
      </View>
    </>
  );

  const sidePad = { paddingLeft: pad.left + 24, paddingRight: pad.right + 24 };

  const side = pad.left + 24;
  pos.current.side = side;
  const artMask = <LinearGradient colors={['#000', '#000', 'transparent']} locations={[0, 0.72, 1]} style={{ flex: 1 }} />;

  // Một bố cục duy nhất cho cả ảnh bìa và lời: các phần chỉ đổi vị trí / độ hiện theo lp (không dựng lại màn hình)
  return (
    <View style={{ flex: 1 }}>
      {Background}
      {/* Tối nhẹ cả màn hình khi xem lời để chữ trắng dễ đọc (phủ cả màn, không chỉ phần trên → không có đường kẻ ngang) */}
      {!POP && <RAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dimStyle]} />}
      <StatusBar barStyle={POP && !POP_DARK ? 'dark-content' : 'light-content'} />
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        {/* Sân khấu: ảnh bìa, phần đầu, lời, tên bài */}
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            const v = e.nativeEvent.layout.height;
            stageHV.value = v;
            setStageH((o) => (Math.abs(o - v) < 0.5 ? o : v));
          }}
        >
          {POP ? (
            // Pop: the cover sits in an outlined square card with a hard shadow, centred above the title
            (() => {
              const top = pad.top + 44;
              const availH = Math.max(0, stageH - infoH - top - 14);
              const size = Math.max(120, Math.min(Math.min(win.width, 560) - 48, availH));
              return (
                <RAnimated.View
                  pointerEvents="none"
                  style={[
                    { position: 'absolute', top: top + Math.max(0, (availH - size) / 2), alignSelf: 'center', width: size, height: size },
                    { borderRadius: 22, borderCurve: 'continuous', borderWidth: 3, borderColor: '#111111', boxShadow: '7px 7px 0px #111111', backgroundColor: track.color || '#222' },
                    sharpArtStyle,
                  ]}
                >
                  <View style={{ flex: 1, borderRadius: 19, overflow: 'hidden' }}>
                    <TrackSwap id={track.id} dist={60} style={{ flex: 1 }}>
                      <Cover track={track} size={900} style={{ flex: 1 }}>
                        <Ionicons name="musical-notes" size={72} color="rgba(255,255,255,0.8)" />
                      </Cover>
                    </TrackSwap>
                  </View>
                </RAnimated.View>
              );
            })()
          ) : (
          <>
          {/* Ảnh bìa tràn ngang: bản rõ (mờ dần khi mở lời) và bản nhoè (hiện lên làm nền cho lời) */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: infoH, overflow: 'hidden' }}>
            <RAnimated.View style={[StyleSheet.absoluteFill, sharpArtStyle]}>
              <MaskedView style={StyleSheet.absoluteFill} maskElement={artMask}>
                <RAnimated.View style={[StyleSheet.absoluteFill, artZoomStyle]}>
                  <TrackSwap id={track.id} dist={60} style={{ flex: 1 }}>
                    <Cover track={track} size={1200} style={{ flex: 1 }}>
                      <Ionicons name="musical-notes" size={72} color="rgba(255,255,255,0.8)" />
                    </Cover>
                  </TrackSwap>
                </RAnimated.View>
              </MaskedView>
            </RAnimated.View>
            {/* Bản nhoè chỉ dựng khi đang xem lời (hoặc đang chuyển): bình thường không tốn thêm một lớp ảnh có mặt nạ */}
            {!!track.thumb && lyricsMounted && (
              <RAnimated.View style={[StyleSheet.absoluteFill, blurArtStyle]}>
                <MaskedView style={StyleSheet.absoluteFill} maskElement={artMask}>
                  <RAnimated.View style={[StyleSheet.absoluteFill, artZoomStyle]}>
                    <SmartImage url={track.thumb} size={300} blurRadius={40} style={StyleSheet.absoluteFill} />
                  </RAnimated.View>
                </MaskedView>
              </RAnimated.View>
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pad.top + 60 }}
            />
          </View>
          </>
          )}

          {/* Lời: từ ngay dưới phần đầu tới hết sân khấu */}
          {lyricsMounted && stageH > 0 && (
            <RAnimated.View
              pointerEvents={showLyrics ? 'auto' : 'none'}
              style={[{ position: 'absolute', top: fullTop, height: boxH, left: side, right: pad.right + 24 }, lyricsStyle]}
            >
              <MaskedView
                style={{ flex: 1, marginHorizontal: -30 }}
                maskElement={
                  <View style={{ flex: 1 }}>
                    <RAnimated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: boxH, transformOrigin: 'center top' }, windowStyle]}>
                      <LinearGradient colors={['transparent', '#000', '#000', 'transparent']} locations={[0, 0.12, 0.88, 1]} style={{ flex: 1 }} />
                    </RAnimated.View>
                  </View>
                }
              >
                <View style={{ flex: 1, marginHorizontal: 30 }}>
                  {/* Lời có ngay từ lần vẽ đầu (đã tải thì lấy từ bộ nhớ), không phải chờ */}
                  <LyricsView status={lyr.status} lyrics={lyr.lyrics} onSeek={seekTo} focus={lyricFocus} fade={false} ink={POP && !POP_DARK ? '#111111' : undefined} mark={POP && !POP_DARK ? '#D4F25A' : undefined} />
                </View>
              </MaskedView>
            </RAnimated.View>
          )}

          {/* Phần đầu: thanh kéo + hàng ảnh nhỏ (khi xem lời). Vuốt xuống ở đây để thu player lại */}
          <RAnimated.View style={headerFullStyle} pointerEvents={full ? 'none' : 'box-none'}>
          <CloseZone><View
            
            onLayout={(e) => {
              setHeaderH(e.nativeEvent.layout.height);
              headerHV.value = e.nativeEvent.layout.height;
            }}
            style={{ paddingTop: pad.top + 4, paddingLeft: side, paddingRight: pad.right + 24 }}
          >
            <Pressable testID="player-close" onPress={onClose} hitSlop={14} style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: SOFT }]} />
            </Pressable>
            <View
              style={styles.compact}
              pointerEvents={showLyrics ? 'auto' : 'none'}
              onLayout={(e) => {
                pos.current.hRowY = e.nativeEvent.layout.y;
                updatePos();
              }}
            >
              <RAnimated.View style={thumbStyle}>
                <Cover track={track} size={300} style={{ width: 52, height: 52, borderRadius: 6 }}>
                  <Ionicons name="musical-notes" size={22} color="rgba(255,255,255,0.8)" />
                </Cover>
              </RAnimated.View>
              {/* Chỗ tên bài sẽ bay tới */}
              <View
                style={{ flex: 1, height: blockH * TITLE_SCALE }}
                onLayout={(e) => {
                  pos.current.hSlotX = e.nativeEvent.layout.x;
                  pos.current.hSlotY = e.nativeEvent.layout.y;
                  updatePos();
                }}
              />
            </View>
          </View></CloseZone>
          </RAnimated.View>

          {/* Khoảng trống giữa (vuốt xuống để thu player khi đang xem ảnh bìa) */}
          <CloseZone><View style={{ flex: 1 }} pointerEvents={showLyrics ? 'none' : 'auto'}  /></CloseZone>

          {/* Hàng tên bài dưới ảnh bìa: chỉ giữ chỗ cho tên bài + nút thích / menu.
              Vùng vuốt (CloseZone) bọc BÊN TRONG: bộ nhận cử chỉ thêm một lớp bao, bọc ở ngoài thì toạ độ đo (wrapY)
              bị tính theo lớp bao đó (= 0) → tên bài bay sai chỗ, mất hẳn khỏi màn hình */}
          <View
            style={{ paddingLeft: side, paddingRight: pad.right + 24 }}
            pointerEvents={showLyrics ? 'none' : 'auto'}
            onLayout={(e) => {
              pos.current.wrapY = e.nativeEvent.layout.y;
              setInfoH(e.nativeEvent.layout.height);
              updatePos();
            }}
            
          >
            <CloseZone><View
              style={styles.info}
              onLayout={(e) => {
                pos.current.rowY = e.nativeEvent.layout.y;
                updatePos();
              }}
            >
              <View
                style={{ flex: 1, height: blockH }}
                onLayout={(e) => {
                  pos.current.slotX = e.nativeEvent.layout.x;
                  pos.current.slotY = e.nativeEvent.layout.y;
                  setSlotW(e.nativeEvent.layout.width);
                  updatePos();
                }}
              />
              <RAnimated.View style={[{ flexDirection: 'row', gap: 8 }, infoBtnsStyle]} pointerEvents={showLyrics ? 'none' : 'auto'}>
                {SaveButton}
                {MoreButtonFlat}
              </RAnimated.View>
            </View></CloseZone>
          </View>

          {/* Tên bài + nghệ sĩ: một khối duy nhất bay giữa hai chỗ trên */}
          <RAnimated.View
            pointerEvents="none"
            onLayout={(e) => setBlockH(e.nativeEvent.layout.height)}
            style={[{ position: 'absolute', left: 0, top: 0, width: slotW || undefined, transformOrigin: 'left top' }, floatStyle]}
          >
            <TrackSwap id={track.id}>
              <Text numberOfLines={1} style={[styles.title, { color: FG }]}>{title}</Text>
              <Text numberOfLines={1} style={[styles.artist, { color: SOFT }]}>{artist}</Text>
            </TrackSwap>
          </RAnimated.View>
        </View>

        {/* Thanh thời gian, nút điều khiển, âm lượng, hàng dưới: đứng yên khi chuyển ảnh bìa ⇄ lời */}
        <CloseZone><RAnimated.View
          style={[{ paddingLeft: side, paddingRight: pad.right + 24, paddingBottom: pad.bottom + 8 }, bodyFullStyle]}
          pointerEvents={full ? 'none' : 'auto'}
          onLayout={(e) => {
            setBodyH(e.nativeEvent.layout.height);
            bodyHV.value = e.nativeEvent.layout.height;
          }}
          
        >
          {PlayerBody}
        </RAnimated.View></CloseZone>

        {/* Kiểu lời + toàn màn hình: chỉ là ký hiệu, không nền */}
        {lyricsMounted && bodyH > 0 && (
          <RAnimated.View
            pointerEvents={showLyrics ? 'box-none' : 'none'}
            style={[{ position: 'absolute', right: pad.right + 18, bottom: bodyH + 4, flexDirection: 'row', gap: 18, alignItems: 'center' }, lyricBtnsStyle]}
          >
            <Pressable onPress={() => setFull((f) => !f)} hitSlop={10}>
              <Ionicons name={full ? 'contract-outline' : 'expand-outline'} size={22} color={FG} />
            </Pressable>
          </RAnimated.View>
        )}
      </View>

      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
    </View>
  );
}

// Thanh thời gian: chỉ phần này đọc thời gian đã phát (đổi vài lần mỗi giây)
const ProgressBar = React.memo(function ProgressBar({
  duration, loading, failed, seekTo,
}: { duration: number; loading: boolean; failed: boolean; seekTo: (s: number) => void }) {
  const t = useT();
  const progress = useProgress();
  const [scrub, setScrub] = useState<number | null>(null); // 0..1 khi đang kéo
  const pct = duration > 0 ? Math.min(1, progress / duration) : 0;
  const elapsed = (scrub ?? pct) * duration;
  return (
    <View>
      <Slider
        value={pct}
        thickness={POP ? 10 : 6}
        fill={POP ? FG : 'rgba(255,255,255,0.9)'}
        track={POP ? (POP_DARK ? 'rgba(255,255,255,0.22)' : 'rgba(17,17,17,0.16)') : 'rgba(255,255,255,0.22)'}
        onChange={setScrub}
        onCommit={(v) => {
          seekTo(v * duration);
          setScrub(null);
        }}
      />
      <View style={styles.times}>
        <Text style={[styles.time, POP && { color: SOFT, fontWeight: '800' }]}>{fmt(elapsed)}</Text>
        <Text style={[styles.time, POP && { color: SOFT, fontWeight: '800' }, failed && { color: '#FF8A80' }]}>
          {loading ? t('common.loading') : failed ? t('np.failed') : `-${fmt(duration - elapsed)}`}
        </Text>
      </View>
    </View>
  );
});

// Âm lượng: tự giữ giá trị của mình, kéo chỉ vẽ lại thanh này
const VolumeBar = React.memo(function VolumeBar({ vertical = false }: { vertical?: boolean }) {
  const [vol, setVol] = useState(() => (musicSupported ? audio().getUserVolume() : 1));
  const onVolume = (v: number) => {
    setVol(v);
    if (musicSupported) audio().setUserVolume(v);
  };
  if (vertical) return <Slider vertical value={vol} thickness={6} onChange={onVolume} fill="rgba(255,255,255,0.9)" track="rgba(255,255,255,0.22)" />;
  return (
    <View style={styles.volume}>
      <Ionicons name="volume-low" size={18} color={SOFT} />
      <View style={{ flex: 1 }}>
        <Slider
          value={vol}
          thickness={6}
          onChange={onVolume}
          fill={POP ? FG : 'rgba(255,255,255,0.9)'}
          track={POP && !POP_DARK ? 'rgba(17,17,17,0.16)' : 'rgba(255,255,255,0.22)'}
        />
      </View>
      <Ionicons name="volume-high" size={18} color={SOFT} />
    </View>
  );
});

const styles = StyleSheet.create({
  grabberWrap: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 24 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  roundBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  column: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' },
  flatBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  spotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  skipSlot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: PLAY, height: PLAY, borderRadius: PLAY / 2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 6 },
  compactTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 1 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginBottom: 2 },
  artist: { color: SOFT, fontSize: 18, fontWeight: '500' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  bottomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 0, width: 4, height: 4, borderRadius: 2 },
  // Chấm "đang bật" của nút trộn / lặp (nút nằm trong hàng giãn đều nên chấm đặt theo mép trái / phải hàng)
  dotLeft: { left: 18, bottom: -2 },
  dotRight: { right: 18, bottom: -2 },
});
