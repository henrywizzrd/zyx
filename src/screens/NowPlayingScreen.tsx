import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { usePlayerPick, useProgress } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { Cover, SmartImage } from '../components/Cover';
import { usePlayerTransition } from '../components/PlayerTransition';
import { Slider } from '../components/Slider';
import { LyricsView } from '../components/LyricsView';
import { useLyrics } from '../music/lyrics';
import { audio, musicSupported } from '../music/lazy';
import { QueueSheet } from '../components/QueueSheet';
import { useSongMenu } from '../components/useSongMenu';
import RNMaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import RAnimated, { Easing as REasing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Kiểu khai báo của thư viện chưa khớp React 19, ép kiểu để dùng như component bình thường
const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;

const USE_NATIVE = Platform.OS !== 'web';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const SOFT = 'rgba(255,255,255,0.65)';
const ON = '#1ED760'; // màu nút đang bật (xanh lá kiểu Spotify)

// Nút lặp: hai mũi tên chạy vòng quanh thành hình vuông bo góc (vẽ bằng Skia, khung 24×24).
//  - tắt: trắng mờ
//  - lặp cả danh sách: xanh lá + chấm bên dưới
//  - lặp 1 bài: xanh lá + số 1 nằm chính giữa hình vuông + chấm bên dưới
const REPEAT_PATH = 'M4 12.5V8.5A3.5 3.5 0 0 1 7.5 5H18.5M15.5 2L18.5 5L15.5 8M20 11.5V15.5A3.5 3.5 0 0 1 16.5 19H5.5M8.5 22L5.5 19L8.5 16';
const skia = Platform.OS === 'web' ? null : (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia'));
// Mọi icon ở hàng dưới cùng dùng chung một cỡ khung để nhìn đều nhau
const ICON = 24;
const TITLE_SCALE = 0.72; // tên bài khi bay lên đầu (cạnh ảnh nhỏ) nhỏ lại còn chừng này
const PLAY = 66; // đường kính nút phát
const REPEAT_SIZE = ICON;

// Nút lời bài hát: khung chat bo góc có đuôi, bên trong là hai dấu ngoặc kép (giống Apple Music)
const BUBBLE_PATH = 'M6 4H18A3.5 3.5 0 0 1 21.5 7.5V14.5A3.5 3.5 0 0 1 18 18H11L7 21.2V18H6A3.5 3.5 0 0 1 2.5 14.5V7.5A3.5 3.5 0 0 1 6 4Z';
const QUOTE_TAILS = 'M11.25 9.5c0 1.6-.8 2.6-2 3.1M16.25 9.5c0 1.6-.8 2.6-2 3.1';
function LyricsIcon({ on }: { on: boolean }) {
  const color = on ? ON : SOFT;
  const paths = React.useMemo(
    () => (skia ? { bubble: skia.Skia.Path.MakeFromSVGString(BUBBLE_PATH), tails: skia.Skia.Path.MakeFromSVGString(QUOTE_TAILS) } : null),
    []
  );
  if (!skia || !paths?.bubble || !paths.tails) return <Ionicons name="chatbox-ellipses-outline" size={ICON} color={color} />;
  return (
    <skia.Canvas style={{ width: ICON, height: ICON }}>
      <skia.Path path={paths.bubble} style="stroke" strokeWidth={1.8} strokeJoin="round" color={color} />
      <skia.Circle cx={9.75} cy={9.3} r={1.55} color={color} />
      <skia.Circle cx={14.75} cy={9.3} r={1.55} color={color} />
      <skia.Path path={paths.tails} style="stroke" strokeWidth={1.4} strokeCap="round" color={color} />
    </skia.Canvas>
  );
}

function RepeatIcon({ mode }: { mode: 'off' | 'all' | 'one' }) {
  const on = mode !== 'off';
  const color = on ? ON : SOFT;
  const path = React.useMemo(() => skia?.Skia.Path.MakeFromSVGString(REPEAT_PATH) ?? null, []);
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: REPEAT_SIZE, height: REPEAT_SIZE }}>
        {skia && path ? (
          <skia.Canvas style={{ width: REPEAT_SIZE, height: REPEAT_SIZE }}>
            <skia.Group transform={[{ scale: REPEAT_SIZE / 24 }]}>
              <skia.Path path={path} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" color={color} />
            </skia.Group>
          </skia.Canvas>
        ) : (
          <Ionicons name="repeat" size={REPEAT_SIZE} color={color} />
        )}
        {mode === 'one' && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <Text style={{ color: ON, fontSize: 9, fontWeight: '900', lineHeight: 11, includeFontPadding: false }}>1</Text>
          </View>
        )}
      </View>

    </View>
  );
}

// Nhớ đang xem lời hay ảnh bìa, để vuốt xuống rồi mở lại player vẫn giữ nguyên
let lyricsOpen = false;
// Kích thước bố cục player đo được (giữ qua các lần mở / đóng player)
const layoutMemo = { blockH: 52, slotW: 0, infoH: 0, headerH: 0 };
const posMemo = { ax: 0, ay: 0, lx: 0, ly: 0, ok: false };

const lock = (o: ScreenOrientation.OrientationLock) => ScreenOrientation.lockAsync(o).catch(() => {});

export function NowPlayingScreen({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
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
  // Vùng gắn swipe.panHandlers cho phép vuốt xuống để thoát.
  const swipe = usePlayerTransition();

  const [showLyrics, setShowLyricsState] = useState(() => lyricsOpen);
  const setShowLyrics = (v: boolean | ((p: boolean) => boolean)) =>
    setShowLyricsState((p) => (lyricsOpen = typeof v === 'function' ? v(p) : v));
  const [queueOpen, setQueueOpen] = useState(false);

  // Màn hình ngang: bấm nút điện thoại để xoay. Rời player thì luôn quay về dọc.
  const win = useWindowDimensions();
  const landscape = win.width > win.height;
  const insets = useSafeAreaInsets();
  const [landLyrics, setLandLyrics] = useState(true); // ở chế độ ngang, lời hiện mặc định
  const toggleLandscape = () => lock(landscape ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE);
  useEffect(() => () => void lock(ScreenOrientation.OrientationLock.PORTRAIT_UP), []);
  // Đang ngang mà đóng player: xoay về dọc trước, xoay xong mới chạy hiệu ứng thu về mini player
  const closeAfterRotate = useRef(false);
  const close = () => {
    if (!landscape) return onClose();
    closeAfterRotate.current = true;
    lock(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  };
  useEffect(() => {
    if (landscape || !closeAfterRotate.current) return;
    closeAfterRotate.current = false;
    const id = setTimeout(onClose, 60);
    return () => clearTimeout(id);
  }, [landscape, onClose]);

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
  const sharpArtStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0, 0.65], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(lp.value, [0, 1], [1, 1.08]) }],
  }));
  const blurArtStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0, 0.45, 1], [0, 0.95, 0.45]),
    transform: [{ scale: interpolate(lp.value, [0, 1], [1, 1.08]) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: lp.value * 0.35 }));
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.35, 0.9], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(lp.value, [0, 1], [0.6, 1]) }],
  }));
  const infoBtnsStyle = useAnimatedStyle(() => ({ opacity: interpolate(lp.value, [0, 0.4], [1, 0], 'clamp') }));
  const lyricsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lp.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(lp.value, [0, 1], [60, 0]) }],
  }));

  const isLiked = liked.has(track.id);


  const LikeButton = (
    <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={10} style={styles.roundBtn}>
      <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={20} color={isLiked ? accent : '#FFFFFF'} />
    </Pressable>
  );
  const MoreButton = (
    <Pressable onPress={() => track.id !== 'none' && songMenu(track)} hitSlop={10} style={styles.roundBtn}>
      <Ionicons name="ellipsis-horizontal" size={20} color="#FFFFFF" />
    </Pressable>
  );

  // Kiểu Spotify: đã thích = vòng tròn xanh có dấu tích, chưa thích = vòng tròn viền có dấu cộng
  const SaveButton = (
    <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={10} style={styles.flatBtn}>
      <Ionicons name={isLiked ? 'checkmark-circle' : 'add-circle-outline'} size={30} color={isLiked ? ON : '#FFFFFF'} />
    </Pressable>
  );
  const MoreButtonFlat = (
    <Pressable onPress={() => track.id !== 'none' && songMenu(track)} hitSlop={10} style={styles.flatBtn}>
      <Ionicons name="ellipsis-horizontal" size={24} color="#FFFFFF" />
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
  const Background = (
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
    <View style={[styles.controls, { gap: big ? 54 : 36 }]}>
      <Pressable onPress={prev} hitSlop={12}>
        <Ionicons name="play-back" size={big ? 40 : 32} color="#FFFFFF" />
      </Pressable>
      <Pressable onPress={togglePlay} hitSlop={12} style={{ width: big ? 64 : 52, alignItems: 'center' }}>
        {loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" />
        ) : (
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={big ? 58 : 46} color="#FFFFFF" />
        )}
      </Pressable>
      <Pressable onPress={next} hitSlop={12}>
        <Ionicons name="play-forward" size={big ? 40 : 32} color="#FFFFFF" />
      </Pressable>
    </View>
  );

  // Hàng điều khiển kiểu Spotify: trộn bài | lùi | phát (nút tròn trắng) | tới | lặp
  const spotifyControls = (
    <View style={styles.spotRow}>
      <Pressable onPress={toggleShuffle} hitSlop={10} style={styles.sideBtn}>
        <Ionicons name="shuffle" size={26} color={shuffle ? ON : SOFT} />
        {shuffle && <View style={styles.dot} />}
      </Pressable>
      <Pressable onPress={prev} hitSlop={12} style={styles.skipSlot}>
        <Ionicons name="play-skip-back" size={34} color="#FFFFFF" />
      </Pressable>
      <Pressable onPress={togglePlay} hitSlop={10} style={styles.playBtn}>
        {loading ? (
          <ActivityIndicator color="#000000" />
        ) : (
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color="#000000" style={isPlaying ? undefined : { marginLeft: 4 }} />
        )}
      </Pressable>
      <Pressable onPress={next} hitSlop={12} style={styles.skipSlot}>
        <Ionicons name="play-skip-forward" size={34} color="#FFFFFF" />
      </Pressable>
      <Pressable onPress={cycleRepeat} hitSlop={10} style={styles.sideBtn}>
        <RepeatIcon mode={repeat} />
        {repeat !== 'off' && <View style={styles.dot} />}
      </Pressable>
    </View>
  );

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
        <VolumeBar vertical />
        <Ionicons name="volume-low" size={18} color={SOFT} />
        <Pressable onPress={() => setLandLyrics((v) => !v)} hitSlop={10} style={{ marginTop: 6 }}>
          <Ionicons name={landLyrics ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={24} color={landLyrics ? '#FFFFFF' : SOFT} />
        </Pressable>
        <Pressable onPress={() => setQueueOpen(true)} hitSlop={10}>
          <Ionicons name="list" size={26} color={SOFT} />
        </Pressable>
        <Pressable onPress={toggleLandscape} hitSlop={10}>
          <Ionicons name="phone-portrait-outline" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    );
    const rowStyle = {
      flex: 1,
      flexDirection: 'row' as const,
      paddingTop: padT,
      paddingBottom: padB,
      paddingLeft: insets.left + 20,
      paddingRight: insets.right + 12,
      gap: 28,
    };

    if (!landLyrics) {
      const art = Math.max(0, usableH - 8);
      return (
        <View style={{ flex: 1 }}>
          {Background}
          <StatusBar barStyle="light-content" />
          <View style={rowStyle}>
            <View style={{ justifyContent: 'center' }}>
              <Cover track={track} size={900} style={{ width: art, height: art, borderRadius: 12 }}>
                <Ionicons name="musical-notes" size={48} color="rgba(255,255,255,0.8)" />
              </Cover>
            </View>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Pressable onPress={close} hitSlop={10} style={styles.roundBtn}>
                  <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
                </Pressable>
                <View style={{ flex: 1 }} />
                {LikeButton}
                {MoreButton}
              </View>
              <Text numberOfLines={1} style={[styles.title, { textAlign: 'center', fontSize: 26 }]}>{title}</Text>
              <Text numberOfLines={1} style={[styles.artist, { textAlign: 'center' }]}>{artist}</Text>
              <View style={{ marginTop: 14 }}>
                {controls(true)}
              </View>
              <View style={{ marginTop: 14 }}>{Progress}</View>
            </View>
            {SideButtons}
          </View>
          <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
        </View>
      );
    }

    const leftW = Math.min(340, win.width * 0.34);
    const art = Math.max(0, Math.min(leftW, usableH - 170));
    return (
      <View style={{ flex: 1 }}>
        {Background}
        <StatusBar barStyle="light-content" />
        <View style={rowStyle}>
          <View style={{ width: leftW, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={close} hitSlop={10} style={styles.roundBtn}>
                <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
              </Pressable>
              <View style={{ flex: 1 }} />
              {LikeButton}
            </View>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Cover track={track} size={600} style={{ width: art, height: art, borderRadius: 10 }}>
                <Ionicons name="musical-notes" size={40} color="rgba(255,255,255,0.8)" />
              </Cover>
            </View>
            <Text numberOfLines={1} style={[styles.title, { fontSize: 19, marginTop: 10 }]}>{title}</Text>
            <Text numberOfLines={1} style={[styles.artist, { fontSize: 14 }]}>{artist}</Text>
            <View style={{ marginTop: 6 }}>{Progress}</View>
            <View style={{ marginTop: 2 }}>
              {controls(false)}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <LyricsView status={lyr.status} lyrics={lyr.lyrics} onSeek={seekTo} />
          </View>
          {SideButtons}
        </View>
        <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
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
          {showLyrics && <View style={styles.dot} />}
        </Pressable>
        <View style={{ width: PLAY }} />
        <Pressable onPress={() => setQueueOpen(true)} hitSlop={10} style={styles.skipSlot}>
          <Ionicons name="list" size={ICON} color={SOFT} />
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
      <RAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dimStyle]} />
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        {/* Sân khấu: ảnh bìa, phần đầu, lời, tên bài */}
        <View style={{ flex: 1 }}>
          {/* Ảnh bìa tràn ngang: bản rõ (mờ dần khi mở lời) và bản nhoè (hiện lên làm nền cho lời) */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: infoH, overflow: 'hidden' }}>
            <RAnimated.View style={[StyleSheet.absoluteFill, sharpArtStyle]}>
              <MaskedView style={StyleSheet.absoluteFill} maskElement={artMask}>
                <Cover track={track} size={1200} style={{ flex: 1 }}>
                  <Ionicons name="musical-notes" size={72} color="rgba(255,255,255,0.8)" />
                </Cover>
              </MaskedView>
            </RAnimated.View>
            {/* Bản nhoè chỉ dựng khi đang xem lời (hoặc đang chuyển): bình thường không tốn thêm một lớp ảnh có mặt nạ */}
            {!!track.thumb && lyricsMounted && (
              <RAnimated.View style={[StyleSheet.absoluteFill, blurArtStyle]}>
                <MaskedView style={StyleSheet.absoluteFill} maskElement={artMask}>
                  <SmartImage url={track.thumb} size={300} blurRadius={40} style={StyleSheet.absoluteFill} />
                </MaskedView>
              </RAnimated.View>
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pad.top + 60 }}
            />
          </View>

          {/* Lời: từ ngay dưới phần đầu tới hết sân khấu */}
          {lyricsMounted && (
            <RAnimated.View
              pointerEvents={showLyrics ? 'auto' : 'none'}
              style={[{ position: 'absolute', top: headerH, bottom: 0, left: side, right: pad.right + 24 }, lyricsStyle]}
            >
              {/* Lời có ngay từ lần vẽ đầu (đã tải thì lấy từ bộ nhớ), không phải chờ */}
              <LyricsView status={lyr.status} lyrics={lyr.lyrics} onSeek={seekTo} />
            </RAnimated.View>
          )}

          {/* Phần đầu: thanh kéo + hàng ảnh nhỏ (khi xem lời). Vuốt xuống ở đây để thu player lại */}
          <View
            {...swipe.panHandlers}
            onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
            style={{ paddingTop: pad.top + 4, paddingLeft: side, paddingRight: pad.right + 24 }}
          >
            <Pressable onPress={close} hitSlop={14} style={styles.grabberWrap}>
              <View style={styles.grabber} />
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
          </View>

          {/* Khoảng trống giữa (vuốt xuống để thu player khi đang xem ảnh bìa) */}
          <View style={{ flex: 1 }} pointerEvents={showLyrics ? 'none' : 'auto'} {...swipe.panHandlers} />

          {/* Hàng tên bài dưới ảnh bìa: chỉ giữ chỗ cho tên bài + nút thích / menu */}
          <View
            style={{ paddingLeft: side, paddingRight: pad.right + 24 }}
            pointerEvents={showLyrics ? 'none' : 'auto'}
            onLayout={(e) => {
              pos.current.wrapY = e.nativeEvent.layout.y;
              setInfoH(e.nativeEvent.layout.height);
              updatePos();
            }}
            {...swipe.panHandlers}
          >
            <View
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
            </View>
          </View>

          {/* Tên bài + nghệ sĩ: một khối duy nhất bay giữa hai chỗ trên */}
          <RAnimated.View
            pointerEvents="none"
            onLayout={(e) => setBlockH(e.nativeEvent.layout.height)}
            style={[{ position: 'absolute', left: 0, top: 0, width: slotW || undefined, transformOrigin: 'left top' }, floatStyle]}
          >
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
            <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
          </RAnimated.View>
        </View>

        {/* Thanh thời gian, nút điều khiển, âm lượng, hàng dưới: đứng yên khi chuyển ảnh bìa ⇄ lời */}
        <View style={{ paddingLeft: side, paddingRight: pad.right + 24, paddingBottom: pad.bottom + 8 }} {...swipe.panHandlers}>
          {PlayerBody}
        </View>
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
        thickness={6}
        fill="rgba(255,255,255,0.9)"
        track="rgba(255,255,255,0.22)"
        onChange={setScrub}
        onCommit={(v) => {
          seekTo(v * duration);
          setScrub(null);
        }}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{fmt(elapsed)}</Text>
        <Text style={[styles.time, failed && { color: '#FF8A80' }]}>
          {loading ? t('common.loading') : failed ? t('np.failed') : `-${fmt(duration - elapsed)}`}
        </Text>
      </View>
    </View>
  );
});

// Âm lượng: tự giữ giá trị của mình, kéo chỉ vẽ lại thanh này
const VolumeBar = React.memo(function VolumeBar({ vertical = false }: { vertical?: boolean }) {
  const [vol, setVol] = useState(() => (musicSupported ? audio().getPlayer().volume : 1));
  const onVolume = (v: number) => {
    setVol(v);
    if (musicSupported) audio().getPlayer().volume = v;
  };
  if (vertical) return <Slider vertical value={vol} thickness={6} onChange={onVolume} fill="rgba(255,255,255,0.9)" track="rgba(255,255,255,0.22)" />;
  return (
    <View style={styles.volume}>
      <Ionicons name="volume-low" size={18} color={SOFT} />
      <View style={{ flex: 1 }}>
        <Slider value={vol} thickness={6} onChange={onVolume} fill="rgba(255,255,255,0.9)" track="rgba(255,255,255,0.22)" />
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
  dot: { position: 'absolute', bottom: 0, width: 4, height: 4, borderRadius: 2, backgroundColor: ON },
});
