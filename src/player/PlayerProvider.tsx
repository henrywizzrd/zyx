import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../data/mock';
import { MiniAnchor, Position } from '../theme/types';
import { audio, musicSupported, toTrack, ytmusic } from '../music/lazy';
import { bigThumb } from '../components/Cover';

export type ViewRef = React.ElementRef<typeof View>;
export type DragState = { kind: 'dock' | 'player'; target: Position | MiniAnchor | 'merge' };

// Hiện khi chưa phát bài nào
const IDLE: Track = { id: 'none', title: 'Chưa phát bài nào', artist: 'Tìm một bài ở tab Search', color: '#333333', duration: 0 };

export type Repeat = 'off' | 'all' | 'one';

// Một bài trong hàng đợi. qid là mã riêng của lần xếp hàng này (cùng một bài thêm 2 lần vẫn phân biệt được).
// auto = bài do app tự thêm (radio khi hết hàng đợi).
export type QueueItem = Track & { qid: string; auto?: boolean };
let qidSeq = 0;
const enqueue = (t: Track, auto = false): QueueItem => ({ ...t, qid: `q${++qidSeq}`, auto });
const AUTOPLAY_KEY = 'zyx:autoplay';

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
  // Hàng đợi
  queue: QueueItem[];
  index: number; // vị trí bài đang phát trong queue
  playNext: (t: Track) => void; // chèn ngay sau bài đang phát
  addToQueue: (t: Track) => void; // thêm vào cuối phần người dùng tự thêm (trước các bài radio)
  removeFromQueue: (qid: string) => void;
  reorderUpNext: (qids: string[]) => void; // thứ tự mới của các bài phía sau bài đang phát
  jumpTo: (qid: string) => void;
  autoplay: boolean; // hết hàng đợi thì tự phát bài liên quan
  setAutoplay: (v: boolean) => void;
  radioLoading: boolean;
  // Phần dưới dùng cho kéo thả / hợp nhất / tách dock và mini player
  dockRef: React.RefObject<ViewRef | null>;
  playerRef: React.RefObject<ViewRef | null>;
  emergeFrom: { cx: number; cy: number } | null;
  setEmergeFrom: (o: { cx: number; cy: number } | null) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

// Trạng thái đang kéo dock/mini player tách riêng: nó đổi liên tục lúc kéo, để chung thì cả app vẽ lại theo từng cử động ngón tay
interface DragContextValue {
  drag: DragState | null;
  setDrag: (d: DragState | null) => void;
}
const DragContext = createContext<DragContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
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
  const [autoplay, setAutoplayState] = useState(true);
  const [radioLoading, setRadioLoading] = useState(false);
  const dockRef = useRef<ViewRef>(null);
  const playerRef = useRef<ViewRef>(null);

  // Bản sao dùng trong callback để không bị đọc giá trị cũ
  const queueRef = useRef<QueueItem[]>([]);
  const indexRef = useRef(0);
  const loadingRef = useRef(false);
  const endedFor = useRef(-1); // lần tải nào đã báo hết bài rồi, tránh nhảy bài hai lần
  const reqId = useRef(0); // chống chạy lộn khi bấm bài liên tục
  const shuffleRef = useRef(false);
  const repeatRef = useRef<Repeat>('off');
  const advanceRef = useRef<(auto: boolean) => void>(() => {});
  const autoplayRef = useRef(true);
  const radioBusy = useRef<Promise<boolean> | null>(null);

  // Đổi hàng đợi: luôn cập nhật cả bản sao (ref) lẫn state
  const commitQueue = useCallback((q: QueueItem[], i = indexRef.current) => {
    queueRef.current = q;
    indexRef.current = i;
    setQueue(q);
    setIndex(i);
  }, []);

  // Nhớ lựa chọn tự phát
  useEffect(() => {
    AsyncStorage.getItem(AUTOPLAY_KEY)
      .then((v) => {
        if (v != null) {
          autoplayRef.current = v === '1';
          setAutoplayState(v === '1');
        }
      })
      .catch(() => {});
  }, []);
  const setAutoplay = useCallback((v: boolean) => {
    autoplayRef.current = v;
    setAutoplayState(v);
    AsyncStorage.setItem(AUTOPLAY_KEY, v ? '1' : '0').catch(() => {});
  }, []);

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
      const l = (list ?? [t]).map((x) => enqueue(x));
      const i = Math.max(0, l.findIndex((x) => x.id === t.id));
      commitQueue(l, i);
      goTo(i);
    },
    [goTo, commitQueue]
  );

  const playNext = useCallback(
    (t: Track) => {
      const q = queueRef.current;
      if (q.length === 0) return playTrack(t);
      const i = indexRef.current;
      commitQueue([...q.slice(0, i + 1), enqueue(t), ...q.slice(i + 1)]);
    },
    [playTrack, commitQueue]
  );

  const addToQueue = useCallback(
    (t: Track) => {
      const q = queueRef.current;
      if (q.length === 0) return playTrack(t);
      // Giống Spotify: bài tự thêm vào nằm trước các bài radio app tự nối
      const i = indexRef.current;
      let at = q.findIndex((x, k) => k > i && x.auto);
      if (at < 0) at = q.length;
      commitQueue([...q.slice(0, at), enqueue(t), ...q.slice(at)]);
    },
    [playTrack, commitQueue]
  );

  const removeFromQueue = useCallback(
    (qid: string) => {
      const q = queueRef.current;
      const k = q.findIndex((x) => x.qid === qid);
      const i = indexRef.current;
      if (k < 0 || k === i) return; // không xoá bài đang phát
      commitQueue(
        q.filter((x) => x.qid !== qid),
        k < i ? i - 1 : i
      );
    },
    [commitQueue]
  );

  const reorderUpNext = useCallback(
    (qids: string[]) => {
      const q = queueRef.current;
      const i = indexRef.current;
      const byId = new Map(q.map((x) => [x.qid, x]));
      const head = q.slice(0, i + 1);
      const moved = qids.map((id) => byId.get(id)).filter((x): x is QueueItem => !!x && !head.includes(x));
      // Bài nào không có trong danh sách mới (phòng hờ) thì giữ ở cuối
      const rest = q.slice(i + 1).filter((x) => !qids.includes(x.qid));
      commitQueue([...head, ...moved, ...rest]);
    },
    [commitQueue]
  );

  const jumpTo = useCallback(
    (qid: string) => {
      const k = queueRef.current.findIndex((x) => x.qid === qid);
      if (k >= 0) goTo(k);
    },
    [goTo]
  );

  // Nối thêm bài liên quan (radio của YouTube Music) vào cuối hàng đợi. Trả về true nếu có thêm được bài.
  const extendRadio = useCallback((): Promise<boolean> => {
    if (radioBusy.current) return radioBusy.current;
    const q = queueRef.current;
    const seed = q[q.length - 1] ?? q[indexRef.current];
    if (!musicSupported || !seed) return Promise.resolve(false);
    setRadioLoading(true);
    const job = ytmusic()
      .getUpNext(seed.id)
      .then((songs) => {
        const cur = queueRef.current;
        const have = new Set(cur.map((x) => x.id));
        const add = songs.filter((s) => !have.has(s.id)).slice(0, 25).map((s) => enqueue(toTrack(s), true));
        if (add.length) commitQueue([...cur, ...add]);
        return add.length > 0;
      })
      .catch((e) => {
        console.warn('Không lấy được bài liên quan', e);
        return false;
      })
      .finally(() => {
        radioBusy.current = null;
        setRadioLoading(false);
      });
    radioBusy.current = job;
    return job;
  }, [commitQueue]);

  // Sắp hết hàng đợi thì lấy sẵn bài liên quan, để chuyển bài không phải chờ
  useEffect(() => {
    if (!autoplay || repeat !== 'off' || queue.length === 0) return;
    if (index >= queue.length - 2) extendRadio();
  }, [index, queue.length, autoplay, repeat, extendRadio]);

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
      const atEnd = cur === q.length - 1;
      if (atEnd && repeatRef.current !== 'all' && autoplayRef.current) {
        // Hết hàng đợi: nối bài liên quan rồi phát tiếp. Không lấy được thì bấm Next quay về đầu, còn tự hết thì dừng.
        extendRadio().then((ok) => {
          if (ok) goTo(indexRef.current + 1);
          else if (!auto) goTo(0);
        });
        return;
      }
      if (auto && repeatRef.current === 'off' && atEnd) return; // hết hàng chờ thì dừng
      goTo(cur + 1);
    },
    [goTo, extendRadio]
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
      queue, index, playNext, addToQueue, removeFromQueue, reorderUpNext, jumpTo, autoplay, setAutoplay, radioLoading,
      dockRef, playerRef, emergeFrom, setEmergeFrom,
    }),
    [
      track, isPlaying, progress, duration, loading, togglePlay, next, prev, seekTo, playTrack, shuffle, repeat, toggleShuffle,
      cycleRepeat, liked, toggleLike, queue, index, playNext, addToQueue, removeFromQueue, reorderUpNext, jumpTo, autoplay,
      setAutoplay, radioLoading, emergeFrom,
    ]
  );

  const dragValue = useMemo<DragContextValue>(() => ({ drag, setDrag }), [drag]);

  return (
    <PlayerContext.Provider value={value}>
      <DragContext.Provider value={dragValue}>{children}</DragContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}


export function useDrag() {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDrag must be used inside PlayerProvider');
  return ctx;
}
