import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer, ViewRef } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';
import { Cover } from '../components/Cover';
import { usePlayerTransition } from '../components/PlayerTransition';
import { Slider } from '../components/Slider';
import { LyricsView } from '../components/LyricsView';
import { useLyrics } from '../music/lyrics';
import { audio, musicSupported } from '../music/lazy';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const SOFT = 'rgba(255,255,255,0.65)';

// Nhớ đang xem lời hay ảnh bìa, để vuốt xuống rồi mở lại player vẫn giữ nguyên
let lyricsOpen = false;

export function NowPlayingScreen({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const pad = useContentInsets();
  const {
    track, isPlaying, progress, duration, loading,
    togglePlay, next, prev, seekTo, shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
  } = usePlayer();
  const accent = theme.colors.accent;

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
  const lyr = useLyrics(track, showLyrics);

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

  return (
    <View style={{ flex: 1 }}>
      {/* Nền mờ lấy màu từ ảnh bìa */}
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
          <Pressable onPress={onClose} style={styles.circle}>
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <Text numberOfLines={1} style={styles.topTitle}>{track.artist}</Text>
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
              <Text numberOfLines={1} style={styles.compactTitle}>{track.title}</Text>
              <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
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
              <Text numberOfLines={1} style={styles.title}>{track.title}</Text>
              <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
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
            <Text style={styles.time}>{loading ? 'Đang tải...' : `-${fmt(duration - elapsed)}`}</Text>
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
          <Ionicons name="phone-portrait-outline" size={26} color={SOFT} />
          <Ionicons name="list" size={28} color={SOFT} />
        </View>
      </View>
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
