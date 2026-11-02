import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { usePlayer, ViewRef } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { Cover } from '../components/Cover';
import { usePlayerTransition } from '../components/PlayerTransition';
import { Slider } from '../components/Slider';
import { LyricsView } from '../components/LyricsView';
import { useLyrics } from '../music/lyrics';
import { audio, musicSupported } from '../music/lazy';
import { QueueSheet } from '../components/QueueSheet';
import { useSongMenu } from '../components/useSongMenu';

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

const lock = (o: ScreenOrientation.OrientationLock) => ScreenOrientation.lockAsync(o).catch(() => {});

export function NowPlayingScreen({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
  const songMenu = useSongMenu();
  const {
    track, isPlaying, progress, duration, loading,
    togglePlay, next, prev, seekTo, shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
  } = usePlayer();
  const accent = theme.colors.accent;
  // Chưa phát bài nào: hiện câu nhắc theo ngôn ngữ đang chọn
  const idle = track.id === 'none';
  const title = idle ? t('np.idleTitle') : track.title;
  const artist = idle ? t('np.idleArtist') : track.artist;

  // Báo vị trí ảnh bìa lớn để lúc mở player, ảnh album từ mini player bay tới đúng chỗ này.
  // Vùng gắn swipe.panHandlers cho phép vuốt xuống để thoát.
  const swipe = usePlayerTransition();
  const coverRef = useRef<ViewRef>(null);
  const reportCover = () =>
    coverRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0) swipe.reportCover({ x, y, w, h, r: 10 });
    });

  const [showLyrics, setShowLyricsState] = useState(() => lyricsOpen);
  const setShowLyrics = (v: boolean | ((p: boolean) => boolean)) =>
    setShowLyricsState((p) => (lyricsOpen = typeof v === 'function' ? v(p) : v));
  const [scrub, setScrub] = useState<number | null>(null); // 0..1 khi đang kéo thanh tiến trình
  const [vol, setVol] = useState(() => (musicSupported ? audio().getPlayer().volume : 1));
  const [box, setBox] = useState({ width: 0, height: 0 });
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

  const pct = duration > 0 ? Math.min(1, progress / duration) : 0;
  const shownPct = scrub ?? pct;
  const elapsed = shownPct * duration;
  const isLiked = liked.has(track.id);
  const coverSize = Math.max(0, Math.min(box.width, box.height - 16));

  const onVolume = (v: number) => {
    setVol(v);
    if (musicSupported) audio().getPlayer().volume = v;
  };

  // Ảnh bìa thu nhỏ lại khi tạm dừng, phóng to lại khi phát (giống Apple Music)
  const artScale = useRef(new Animated.Value(isPlaying ? 1 : 0.86)).current;
  useEffect(() => {
    Animated.spring(artScale, { toValue: isPlaying || loading ? 1 : 0.86, friction: 7, tension: 60, useNativeDriver: USE_NATIVE }).start();
  }, [isPlaying, loading, artScale]);

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

  // Nền kiểu Apple Music: màu của ảnh bìa nhoè thành những mảng màu lớn, chậm rãi trôi xoay.
  // Hai lớp ảnh mờ xoay ngược chiều nhau nên màu cứ loang đổi liên tục mà rất nhẹ máy (chỉ là xoay ảnh)
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: USE_NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
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

  const Progress = (
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
        <Text style={styles.time}>{loading ? t('common.loading') : `-${fmt(duration - elapsed)}`}</Text>
      </View>
    </View>
  );

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

  const Volume = (
    <View style={styles.volume}>
      <Ionicons name="volume-low" size={18} color={SOFT} />
      <View style={{ flex: 1 }}>
        <Slider value={vol} thickness={6} onChange={onVolume} fill="rgba(255,255,255,0.9)" track="rgba(255,255,255,0.22)" />
      </View>
      <Ionicons name="volume-high" size={18} color={SOFT} />
    </View>
  );

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
        <Slider vertical value={vol} thickness={6} onChange={onVolume} fill="rgba(255,255,255,0.9)" track="rgba(255,255,255,0.22)" />
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
            <LyricsView status={lyr.status} lyrics={lyr.lyrics} progress={progress} onSeek={seekTo} />
          </View>
          {SideButtons}
        </View>
        <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
      </View>
    );
  }

  // ================= Màn hình dọc (kiểu Apple Music) =================
  return (
    <View style={{ flex: 1 }}>
      {Background}
      <StatusBar barStyle="light-content" />

      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
          paddingTop: pad.top + 4,
          paddingBottom: pad.bottom + 8,
          paddingLeft: pad.left + 24,
          paddingRight: pad.right + 24,
        }}
      >
        {/* Thanh kéo nhỏ ở đỉnh: vuốt xuống (hoặc bấm) để thu player lại */}
        <Pressable onPress={close} hitSlop={14} style={styles.grabberWrap} {...swipe.panHandlers}>
          <View style={styles.grabber} />
        </Pressable>

        {/* Đang xem lời: ảnh nhỏ + tên bài ở trên (giống Apple Music) */}
        {showLyrics && (
          <View style={styles.compact} {...swipe.panHandlers}>
            <Cover track={track} size={300} style={{ width: 56, height: 56, borderRadius: 8 }}>
              <Ionicons name="musical-notes" size={22} color="rgba(255,255,255,0.8)" />
            </Cover>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.compactTitle}>{title}</Text>
              <Text numberOfLines={1} style={[styles.artist, { fontSize: 15 }]}>{artist}</Text>
            </View>
            {LikeButton}
            {MoreButton}
          </View>
        )}

        {/* Giữa: ảnh bìa lớn hoặc lời bài hát */}
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          onLayout={(e) => setBox(e.nativeEvent.layout)}
          {...(showLyrics ? {} : swipe.panHandlers)}
        >
          {showLyrics ? (
            <View style={{ width: '100%', height: '100%' }}>
              <LyricsView status={lyr.status} lyrics={lyr.lyrics} progress={progress} onSeek={seekTo} />
            </View>
          ) : (
            <Animated.View
              ref={coverRef as any}
              collapsable={false}
              onLayout={reportCover}
              style={{
                width: coverSize,
                height: coverSize,
                shadowColor: '#000',
                shadowOpacity: 0.45,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 16 },
                transform: [{ scale: artScale }],
              }}
            >
              <Cover track={track} size={1200} style={{ flex: 1, borderRadius: 12 }}>
                <Ionicons name="musical-notes" size={64} color="rgba(255,255,255,0.8)" />
              </Cover>
            </Animated.View>
          )}
        </View>

        {/* Tên bài + nghệ sĩ bên trái, thích + menu bên phải */}
        {!showLyrics && (
          <View style={styles.info} {...swipe.panHandlers}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.title}>{title}</Text>
              <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
            </View>
            {LikeButton}
            {MoreButton}
          </View>
        )}

        <View style={{ marginTop: 18 }}>{Progress}</View>
        <View style={{ marginTop: 18 }}>{controls(true)}</View>
        <View style={{ marginTop: 22 }}>{Volume}</View>

        {/* Hàng dưới: lời / trộn bài / lặp / xoay ngang / hàng chờ.
            Nút đang bật: màu xanh lá + chấm nhỏ bên dưới (kiểu Spotify) */}
        <View style={styles.bottom}>
          <Pressable onPress={() => setShowLyrics((v) => !v)} hitSlop={10} style={styles.bottomBtn}>
            <LyricsIcon on={showLyrics} />
            {showLyrics && <View style={styles.dot} />}
          </Pressable>
          <Pressable onPress={toggleShuffle} hitSlop={10} style={styles.bottomBtn}>
            <Ionicons name="shuffle" size={ICON} color={shuffle ? ON : SOFT} />
            {shuffle && <View style={styles.dot} />}
          </Pressable>
          <Pressable onPress={cycleRepeat} hitSlop={10} style={styles.bottomBtn}>
            <RepeatIcon mode={repeat} />
            {repeat !== 'off' && <View style={styles.dot} />}
          </Pressable>
          <Pressable onPress={toggleLandscape} hitSlop={10} style={styles.bottomBtn}>
            <Ionicons name="phone-landscape-outline" size={ICON} color={SOFT} />
          </Pressable>
          <Pressable onPress={() => setQueueOpen(true)} hitSlop={10} style={styles.bottomBtn}>
            <Ionicons name="list" size={ICON} color={SOFT} />
          </Pressable>
        </View>
      </View>

      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grabberWrap: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 24 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  roundBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 6 },
  compactTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 1 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 2 },
  artist: { color: SOFT, fontSize: 18, fontWeight: '500' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, paddingHorizontal: 8 },
  bottomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: ON },
});
