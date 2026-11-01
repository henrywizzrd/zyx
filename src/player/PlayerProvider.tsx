import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import type { Track } from '../data/mock';
import { Position } from '../theme/types';
import { audio, musicSupported, ytmusic } from '../music/lazy';
import { bigThumb } from '../components/Cover';

export type ViewRef = React.ElementRef<typeof View>;
export type DragState = { kind: 'dock' | 'player'; target: Position | 'merge' };

// Hiện khi chưa phát bài nào
const IDLE: Track = { id: 'none', title: 'Chưa phát bài nào', artist: 'Tìm một bài ở tab Search', color: '#333333', duration: 0 };

export type Repeat = 'off' | 'all' | 'one';

interface PlayerContextValue {
  track: Track;
  isPlaying: boolean;
  progress: number; // giây đã phát
  duration: number; // tổng giây
  loading: boolean;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (seconds: number) => void;
  shuffle: boolean;
  repeat: Repeat;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  liked: Set<string>;
  toggleLike: (id: string) => void;
  playTrack: (t: Track, list?: Track[]) => void;
  // Phần dưới dùng cho kéo thả / hợp nhất / tách dock và mini player
  dockRef: React.RefObject<ViewRef | null>;
  playerRef: React.RefObject<ViewRef | null>;
  drag: DragState | null;
  setDrag: (d: DragState | null) => void;
  emergeFrom: { cx: number; cy: number } | null;
  setEmergeFrom: (o: { cx: number; cy: number } | null) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [emergeFrom, setEmergeFrom] = useState<{ cx: number; cy: number } | null>(null);
  const dockRef = useRef<ViewRef>(null);
  const playerRef = useRef<ViewRef>(null);

  // Bản sao dùng trong callback để không bị đọc giá trị cũ
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const loadingRef = useRef(false);
  const endedFor = useRef(-1); // lần tải nào đã báo hết bài rồi, tránh nhảy bài hai lần
  const reqId = useRef(0); // chống chạy lộn khi bấm bài liên tục
  const shuffleRef = useRef(false);
  const repeatRef = useRef<Repeat>('off');
  const advanceRef = useRef<(auto: boolean) => void>(() => {});

  const track = queue[index] ?? IDLE;

  const load = useCallback(async (t: Track) => {
    if (!musicSupported) return;
    const id = ++reqId.current;
    loadingRef.current = true;
    // Tải trước ảnh bìa lớn để lúc mở player ảnh đã sẵn, không bị giật
    if (t.thumb && musicSupported) Image.prefetch(bigThumb(t.thumb, 1200)).catch(() => {});
    setLoading(true);
    setProgress(0);
    setDuration(t.duration);
    try {
      // muxed=true: link mp4 có hình, iPhone phát được (link chỉ âm thanh bị lỗi trên iOS)
      const info = await ytmusic().getAudio(t.id, undefined, true);
      if (id !== reqId.current) return; // đã bấm bài khác
      const p = audio().getPlayer();
      p.replace({ uri: info.url, name: t.title });
      p.play();
    } catch (e) {
      console.warn('Không phát được', t.title, e);
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const n = ((i % q.length) + q.length) % q.length;
      indexRef.current = n;
      setIndex(n);
      load(q[n]);
    },
    [load]
  );

  const playTrack = useCallback(
    (t: Track, list?: Track[]) => {
      const l = list ?? [t];
      const i = Math.max(0, l.findIndex((x) => x.id === t.id));
      queueRef.current = l;
      setQueue(l);
      goTo(i);
    },
    [goTo]
  );

  // auto=true: bài tự hết; auto=false: người dùng bấm Next
  const advance = useCallback(
    (auto: boolean) => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const cur = indexRef.current;
      if (auto && repeatRef.current === 'one') {
        const p = audio().getPlayer();
        p.seekTo(0);
        p.play();
        return;
      }
      if (shuffleRef.current && q.length > 1) {
        let n = cur;
        while (n === cur) n = Math.floor(Math.random() * q.length);
        goTo(n);
        return;
      }
      if (auto && repeatRef.current === 'off' && cur === q.length - 1) return; // hết hàng chờ thì dừng
      goTo(cur + 1);
    },
    [goTo]
  );
  advanceRef.current = advance;
  const next = useCallback(() => advance(false), [advance]);

  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
  }, []);
  const cycleRepeat = useCallback(() => {
    repeatRef.current = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    setRepeat(repeatRef.current);
    // Lặp một bài: để chính trình phát lặp, chắc chắn hơn tự tua về đầu
    if (musicSupported) audio().getPlayer().loop = repeatRef.current === 'one';
  }, []);
  const toggleLike = useCallback((id: string) => {
    setLiked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const prev = useCallback(() => {
    if (!musicSupported || queueRef.current.length === 0) return;
    const p = audio().getPlayer();
    if (p.currentTime > 3) p.seekTo(0);
    else goTo(indexRef.current - 1);
  }, [goTo]);

  const togglePlay = useCallback(() => {
    if (!musicSupported || queueRef.current.length === 0) return;
    const p = audio().getPlayer();
    if (p.playing) p.pause();
    else p.play();
  }, []);

  const seekTo = useCallback((s: number) => {
    if (!musicSupported || queueRef.current.length === 0) return;
    audio().getPlayer().seekTo(Math.max(0, s));
  }, []);

  // Theo dõi trạng thái thật của trình phát
  useEffect(() => {
    if (!musicSupported) return;
    const p = audio().getPlayer();
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      setIsPlaying(s.playing);
      setProgress(s.currentTime);
      if (s.isLoaded && s.duration > 0) setDuration(s.duration);
      // Hết bài: báo của thư viện, hoặc tự nhận biết khi đã chạy tới cuối và dừng
      const ended = s.didJustFinish || (s.isLoaded && s.duration > 0 && !s.playing && s.currentTime >= s.duration - 0.3);
      if (ended && !loadingRef.current && endedFor.current !== reqId.current) {
        endedFor.current = reqId.current;
        advanceRef.current(true);
      }
    });
    return () => sub.remove();
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({
      track, isPlaying, progress, duration, loading, togglePlay, next, prev, seekTo, playTrack,
      shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
      dockRef, playerRef, drag, setDrag, emergeFrom, setEmergeFrom,
    }),
    [track, isPlaying, progress, duration, loading, togglePlay, next, prev, seekTo, playTrack, shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike, drag, emergeFrom]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
