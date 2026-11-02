import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const SOFT = 'rgba(255,255,255,0.65)';

// Nhớ đang xem lời hay ảnh bìa, để vuốt xuống rồi mở lại player vẫn giữ nguyên
let lyricsOpen = false;

const lock = (o: ScreenOrientation.OrientationLock) => ScreenOrientation.lockAsync(o).catch(() => {});

export function NowPlayingScreen({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const pad = useContentInsets();
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

  const lyr = useLyrics(track, landscape ? landLyrics : showLyrics);

  const pct = duration > 0 ? Math.min(1, progress / duration) : 0;
  const shownPct = scrub ?? pct;
  const elapsed = shownPct * duration;
  const isLiked = liked.has(track.id);
  const coverSize = Math.max(0, Math.min(box.width, box.height - 16));

  const onVolume = (v: number) => {
    setVol(v);
    if (musicSupported) audio().getPlayer().volume = v;
  };

  const LikeButton = (
    <Pressable onPress={() => track.id !== 'none' && toggleLike(track.id)} hitSlop={10}>
      <View style={[styles.like, isLiked ? { backgroundColor: accent } : { borderWidth: 2, borderColor: SOFT }]}>
        <Ionicons name={isLiked ? 'checkmark' : 'add'} size={22} color={isLiked ? '#000000' : '#FFFFFF'} />
      </View>
    </Pressable>
  );

  // Nền mờ lấy màu từ ảnh bìa
  const Background = (
    <>
      {track.thumb ? (
        <Image
          source={{ uri: track.thumb.replace(/=(w\d+-h\d+|s\d+)/, '=w200-h200') }}
          blurRadius={60}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: track.color }]} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
    </>
  );

  const Progress = (
    <View>
      <Slider
        value={pct}
        thickness={8}
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

  // ================= Màn hình ngang =================
  // Trái: ảnh bìa, tên bài, album, nghệ sĩ, thanh thời gian, 3 nút điều khiển
  // Giữa: lời bài hát (chạy theo nhạc như màn hình dọc)
  // Mép phải: thanh âm lượng dọc, rồi 3 nút lời / hàng đợi / xoay màn hình xếp dọc
  if (landscape) {
    const padT = Math.max(insets.top, 12);
    const padB = Math.max(insets.bottom, 12);
    const usableH = win.height - padT - padB;
    const leftW = Math.min(360, win.width * (landLyrics ? 0.36 : 0.5));
    const art = Math.max(0, Math.min(leftW, usableH - 190));
    return (
      <View style={{ flex: 1 }}>
        {Background}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            paddingTop: padT,
            paddingBottom: padB,
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 12,
            gap: 24,
            justifyContent: landLyrics ? 'flex-start' : 'center',
          }}
        >
          {/* Trái */}
          <View style={{ width: leftW, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={close} style={[styles.circle, { width: 36, height: 36 }]}>
                <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={{ flex: 1 }} />
              {LikeButton}
            </View>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Cover track={track} size={600} style={{ width: art, height: art, borderRadius: 8 }}>
                <Ionicons name="musical-notes" size={40} color="rgba(255,255,255,0.8)" />
              </Cover>
            </View>
            <Text numberOfLines={1} style={[styles.title, { fontSize: 20, marginTop: 10 }]}>{title}</Text>
            <Text numberOfLines={1} style={[styles.artist, { fontSize: 14 }]}>
              {track.album ? `${track.album} • ` : ''}
              {artist}
            </Text>
            <View style={{ marginTop: 6 }}>{Progress}</View>
            <View style={[styles.controls, { justifyContent: 'center', gap: 36, marginTop: 4 }]}>
              <Pressable onPress={prev} hitSlop={10}>
                <Ionicons name="play-back" size={32} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={togglePlay} hitSlop={10} style={{ width: 52, alignItems: 'center' }}>
                {loading ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : (
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={46} color="#FFFFFF" />
                )}
              </Pressable>
              <Pressable onPress={next} hitSlop={10}>
                <Ionicons name="play-forward" size={32} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>

          {/* Giữa: lời */}
          {landLyrics && (
            <View style={{ flex: 1 }}>
              <LyricsView status={lyr.status} lyrics={lyr.lyrics} progress={progress} onSeek={seekTo} />
            </View>
          )}

          {/* Mép phải: âm lượng dọc + 3 nút */}
          <View style={{ width: 44, alignItems: 'center', gap: 14 }}>
            <Ionicons name="volume-high" size={18} color={SOFT} />
            <Slider vertical value={vol} thickness={6} onChange={onVolume} fill="#E6E6E6" />
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
        </View>

        <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
      </View>
    );
  }

  // ================= Màn hình dọc =================
  return (
    <View style={{ flex: 1 }}>
      {Background}

      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
          paddingTop: pad.top + 8,
          paddingBottom: pad.bottom + 12,
          paddingLeft: pad.left + 20,
          paddingRight: pad.right + 20,
        }}
      >
        {/* Thanh trên: thu xuống / tên nghệ sĩ / thêm */}
        <View style={styles.top} {...swipe.panHandlers}>
          <Pressable onPress={close} style={styles.circle}>
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <Text numberOfLines={1} style={styles.topTitle}>{artist}</Text>
          <Pressable style={styles.circle}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {showLyrics && (
          <View style={styles.compact} {...swipe.panHandlers}>
            <Cover track={track} size={300} style={{ width: 72, height: 72, borderRadius: 8 }}>
              <Ionicons name="musical-notes" size={26} color="rgba(255,255,255,0.8)" />
            </Cover>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.compactTitle}>{title}</Text>
              <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
            </View>
            {LikeButton}
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
            <View
              ref={coverRef}
              collapsable={false}
              onLayout={reportCover}
              style={{
                width: coverSize,
                height: coverSize,
                shadowColor: '#000',
                shadowOpacity: 0.5,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 12 },
              }}
            >
              <Cover track={track} size={1200} style={{ flex: 1, borderRadius: 10 }}>
                <Ionicons name="musical-notes" size={64} color="rgba(255,255,255,0.8)" />
              </Cover>
            </View>
          )}
        </View>

        {!showLyrics && (
          <View style={styles.info} {...swipe.panHandlers}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.title}>{title}</Text>
              <Text numberOfLines={1} style={styles.artist}>{artist}</Text>
            </View>
            {LikeButton}
          </View>
        )}

        {/* Thanh tiến trình: chạm hoặc kéo để tua */}
        <View style={{ marginTop: 16 }}>
          <Slider
            value={pct}
            thickness={10}
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

        {/* Nút điều khiển */}
        <View style={styles.controls}>
          <Pressable onPress={toggleShuffle} hitSlop={10}>
            <Ionicons name="shuffle" size={28} color={shuffle ? accent : '#FFFFFF'} />
          </Pressable>
          <Pressable onPress={prev} hitSlop={10}>
            <Ionicons name="play-back" size={42} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={togglePlay} hitSlop={10} style={{ width: 72, alignItems: 'center' }}>
            {loading ? (
              <ActivityIndicator size="large" color="#FFFFFF" />
            ) : (
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={64} color="#FFFFFF" />
            )}
          </Pressable>
          <Pressable onPress={next} hitSlop={10}>
            <Ionicons name="play-forward" size={42} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={cycleRepeat} hitSlop={10}>
            <Ionicons name="repeat" size={28} color={repeat === 'off' ? '#FFFFFF' : accent} />
            {repeat === 'one' && <Text style={[styles.one, { color: accent }]}>1</Text>}
          </Pressable>
        </View>

        {/* Âm lượng của app */}
        <View style={styles.volume}>
          <Ionicons name="volume-low" size={20} color={SOFT} />
          <View style={{ flex: 1 }}>
            <Slider value={vol} thickness={6} onChange={onVolume} fill="#E6E6E6" />
          </View>
          <Ionicons name="volume-high" size={20} color={SOFT} />
        </View>

        {/* Hàng dưới: lời bài hát / thiết bị / hàng chờ */}
        <View style={styles.bottom}>
          <Pressable onPress={() => setShowLyrics((v) => !v)} hitSlop={10}>
            <Ionicons name={showLyrics ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={26} color={showLyrics ? '#FFFFFF' : SOFT} />
          </Pressable>
          <Pressable onPress={toggleLandscape} hitSlop={10}>
            <Ionicons name="phone-landscape-outline" size={26} color={SOFT} />
          </Pressable>
          <Pressable onPress={() => setQueueOpen(true)} hitSlop={10}>
            <Ionicons name="list" size={28} color={SOFT} />
          </Pressable>
        </View>
      </View>

      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  compactTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginBottom: 2 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginBottom: 2 },
  artist: { color: SOFT, fontSize: 18, fontWeight: '600' },
  like: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  time: { color: SOFT, fontSize: 13, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  one: { position: 'absolute', alignSelf: 'center', top: 7, fontSize: 10, fontWeight: '900' },
  volume: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 14 },
});
