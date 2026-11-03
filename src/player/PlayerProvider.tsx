import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../data/mock';
import { MiniAnchor, Position } from '../theme/types';
import { audio, musicSupported, toTrack, ytmusic } from '../music/lazy';
import { bigThumb } from '../components/Cover';
import { getLikedIds, PlayContext, recordPlay, setLiked as saveLiked } from '../data/db';
import { localUri } from '../data/downloads';
import { Image as ExpoImage } from 'expo-image';

// ---- Link phát của từng bài, lấy sẵn trước khi cần
// Ở chế độ nền (tắt màn hình), iPhone chỉ cho app chạy tiếp khi đang PHÁT âm thanh. Hết bài mà phải đợi vài giây lấy link
// bài sau (gọi mạng) thì lúc đó im lặng → iOS cho app "ngủ" → bài sau không bao giờ phát (nghe được 1 bài rồi tắt).
// Vì vậy bài sau được lấy link sẵn trong lúc bài hiện tại đang phát: hết bài là phát ngay, không có khoảng im lặng.
const URL_TTL = 3 * 60 * 60 * 1000; // link YouTube hết hạn sau ~6 tiếng, giữ 3 tiếng cho chắc
const urlCache = new Map<string, { url: string; at: number }>();
const urlPending = new Map<string, Promise<string>>();
function resolveUrl(id: string): Promise<string> {
  const local = localUri(id); // bài đã tải về máy: phát thẳng từ file
  if (local) return Promise.resolve(local);
  const c = urlCache.get(id);
  if (c && Date.now() - c.at < URL_TTL) return Promise.resolve(c.url);
  const pending = urlPending.get(id);
  if (pending) return pending; // đang lấy dở (vd. lấy sẵn) thì dùng chung, không gọi lần hai
  // muxed=true: link mp4 có hình, iPhone phát được (link chỉ âm thanh bị lỗi trên iOS)
  const job = ytmusic()
    .getAudio(id, undefined, true)
    .then((a) => {
      urlCache.set(id, { url: a.url, at: Date.now() });
      return a.url;
    })
    .finally(() => urlPending.delete(id));
  urlPending.set(id, job);
  return job;
}

export type ViewRef = React.ElementRef<typeof View>;
export type DragState = { kind: 'dock' | 'player'; target: Position | MiniAnchor | 'merge' };

// Hiện khi chưa phát bài nào
const IDLE: Track = { id: 'none', title: 'Chưa phát bài nào', artist: 'Tìm một bài ở tab Search', color: '#333333', duration: 0 };

export type Repeat = 'off' | 'all' | 'one';

// Một bài trong hàng đợi. qid là mã riêng của lần xếp hàng này (cùng một bài thêm 2 lần vẫn phân biệt được).
// auto = bài do app tự thêm (radio khi hết hàng đợi).
// ctx = bài này được phát từ đâu (playlist, album, mix...), để ghi vào lịch sử nghe.
export type QueueItem = Track & { qid: string; auto?: boolean; ctx: PlayContext };
let qidSeq = 0;
const single = (t: Track): PlayContext => ({ kind: 'search', id: t.id, title: t.title, thumb: t.thumb });
const enqueue = (t: Track, ctx: PlayContext, auto = false): QueueItem => ({ ...t, qid: `q${++qidSeq}`, auto, ctx });
const AUTOPLAY_KEY = 'zyx:autoplay';

interface PlayerContextValue {
  track: Track;
  isPlaying: boolean;
  duration: number; // tổng giây
  loading: boolean;
  togglePlay: () => void;
  failed: boolean; // bài hiện tại không lấy được link phát (bấm nút phát để thử lại)
  next: () => void;
  prev: () => void;
  seekTo: (seconds: number) => void;
  shuffle: boolean;
  repeat: Repeat;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  liked: Set<string>;
  toggleLike: (id: string, t?: Track) => void; // t: thông tin bài (khi bài không nằm trong hàng đợi)
  // ctx: phát từ đâu (để hiện ở mục Recent). Bỏ trống = bài lẻ.
  playTrack: (t: Track, list?: Track[], ctx?: PlayContext) => void;
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
// Thời gian đã phát nằm riêng một chỗ: nó đổi liên tục (vài lần mỗi giây). Trước đây nằm chung với mọi thứ khác
// nên mỗi lần đổi là cả app (mọi màn hình dùng usePlayer) vẽ lại → tụt khung hình khi đang phát nhạc.
// Giờ chỉ thanh tiến trình đọc nó (useProgress)
const ProgressContext = createContext(0);

// Kho trạng thái phát nhạc để màn hình "chọn" đúng phần mình cần (usePlayerPick).
// usePlayer() kiểu cũ làm màn hình vẽ lại mỗi khi BẤT KỲ thứ gì đổi (hàng chờ, đang tải, trộn bài...);
// usePlayerPick('track', 'playTrack') chỉ vẽ lại khi đúng hai thứ đó đổi
type Store = { value: PlayerContextValue | null; listeners: Set<() => void>; subscribe: (l: () => void) => () => void };
function makeStore(): Store {
  const st: Store = {
    value: null,
    listeners: new Set(),
    subscribe: (l) => {
      st.listeners.add(l);
      return () => st.listeners.delete(l);
    },
  };
  return st;
}
const StoreContext = createContext<Store | null>(null);

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
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [liked, setLiked] = useState<Set<string>>(() => getLikedIds());
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
  // Đang trộn bài: bài kế tiếp được chọn sẵn (để lấy link trước), tới lúc chuyển bài thì dùng đúng bài đó
  const shuffleNext = useRef<{ from: number; to: number } | null>(null);
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

  const load = useCallback(async (t: QueueItem) => {
    if (!musicSupported) return;
    const id = ++reqId.current;
    loadingRef.current = true;
    // Tải trước ảnh bìa lớn để lúc mở player ảnh đã sẵn, không bị giật
    if (t.thumb && musicSupported) ExpoImage.prefetch(bigThumb(t.thumb, 1200), 'memory-disk').catch(() => {});
    setLoading(true);
    setFailed(false);
    failedRef.current = false;
    setProgress(0);
    setDuration(t.duration);
    try {
      const uri = await resolveUrl(t.id);
      if (id !== reqId.current) return; // đã bấm bài khác
      const p = audio().getPlayer();
      p.replace({ uri, name: t.title });
      p.play();
      // Màn hình khoá / thanh thông báo (Android: cần cái này để nhạc chạy nền lâu dài)
      audio().showNowPlaying({ title: t.title, artist: t.artist, artworkUrl: t.thumb });
      // Ghi lịch sử nghe (thêm đủ thông tin bài để Home dựng Recent / Recommend)
      recordPlay({ ...t, duration: t.duration }, t.ctx);
    } catch (e) {
      console.warn('Không phát được', t.title, e);
      if (id === reqId.current) {
        setFailed(true);
        failedRef.current = true;
      }
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
    (t: Track, list?: Track[], ctx?: PlayContext) => {
            const l = (list ?? [t]).map((x) => enqueue(x, ctx ?? single(x)));
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
      commitQueue([...q.slice(0, i + 1), enqueue(t, single(t)), ...q.slice(i + 1)]);
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
      commitQueue([...q.slice(0, at), enqueue(t, single(t)), ...q.slice(at)]);
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
        const add = songs.filter((s) => !have.has(s.id)).slice(0, 25).map((s) => enqueue(toTrack(s), { kind: 'mix', id: seed.id, title: `Mix ${seed.artist.split(',')[0]}`, thumb: seed.thumb }, true));
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

  // Lấy sẵn link của bài sẽ phát tiếp (đợi vài giây sau khi bài hiện tại bắt đầu, để không tranh mạng với nó)
  const nextId = (() => {
    if (queue.length < 2 || repeat === 'one') return null;
    if (shuffle) {
      const pick = shuffleNext.current;
      if (pick && pick.from === index && pick.to < queue.length) return queue[pick.to].id;
      let n = index;
      while (n === index) n = Math.floor(Math.random() * queue.length);
      shuffleNext.current = { from: index, to: n };
      return queue[n].id;
    }
    if (index + 1 < queue.length) return queue[index + 1].id;
    return repeat === 'all' ? queue[0].id : null;
  })();
  useEffect(() => {
    if (!musicSupported || !nextId) return;
    const timer = setTimeout(() => {
      resolveUrl(nextId).catch(() => {}); // lỗi thì thôi, tới lúc chuyển bài sẽ thử lại
    }, 4000);
    return () => clearTimeout(timer);
  }, [nextId]);

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
        const pick = shuffleNext.current;
        let n = pick && pick.from === cur && pick.to < q.length ? pick.to : cur;
        while (n === cur) n = Math.floor(Math.random() * q.length);
        shuffleNext.current = null;
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
  // Thả tim: lưu vào máy (SQLite) để tắt app mở lại vẫn còn, và để có playlist Liked Songs
  const likedRef = useRef(liked);
  likedRef.current = liked;
  const toggleLike = useCallback((id: string, track?: Track) => {
    const t = track ?? queueRef.current.find((x) => x.id === id);
    const n = new Set(likedRef.current);
    const on = !n.has(id);
    if (on) n.add(id);
    else n.delete(id);
    likedRef.current = n;
    setLiked(n);
    if (t) saveLiked(t, on);
  }, []);

  const prev = useCallback(() => {
    if (!musicSupported || queueRef.current.length === 0) return;
    const p = audio().getPlayer();
    if (p.currentTime > 3) p.seekTo(0);
    else goTo(indexRef.current - 1);
  }, [goTo]);

  const togglePlay = useCallback(() => {
    if (!musicSupported || queueRef.current.length === 0) return;
    // Bài trước đó không phát được: bấm phát là thử tải lại
    if (failedRef.current) {
      const cur = queueRef.current[indexRef.current];
      if (cur) load(cur);
      return;
    }
    const p = audio().getPlayer();
    if (p.playing) p.pause();
    else p.play();
  }, [load]);

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
      // Độ dài bài khi phát qua mạng hay nhích lên xuống vài phần trăm giây mỗi lần báo:
      // chỉ cập nhật khi lệch thật (> 0,5s), không thì cả app vẽ lại liên tục chỉ vì con số lẻ
      if (s.isLoaded && s.duration > 0) setDuration((d) => (Math.abs(d - s.duration) > 0.5 ? s.duration : d));
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
      track, isPlaying, duration, loading, failed, togglePlay, next, prev, seekTo, playTrack,
      shuffle, repeat, toggleShuffle, cycleRepeat, liked, toggleLike,
      queue, index, playNext, addToQueue, removeFromQueue, reorderUpNext, jumpTo, autoplay, setAutoplay, radioLoading,
      dockRef, playerRef, emergeFrom, setEmergeFrom,
    }),
    [
      track, isPlaying, duration, loading, failed, togglePlay, next, prev, seekTo, playTrack, shuffle, repeat, toggleShuffle,
      cycleRepeat, liked, toggleLike, queue, index, playNext, addToQueue, removeFromQueue, reorderUpNext, jumpTo, autoplay,
      setAutoplay, radioLoading, emergeFrom,
    ]
  );

  const dragValue = useMemo<DragContextValue>(() => ({ drag, setDrag }), [drag]);

  const store = useRef<Store>(makeStore()).current;
  store.value = value;
  useLayoutEffect(() => {
    store.listeners.forEach((l) => l());
  }, [value, store]);

  return (
    <PlayerContext.Provider value={value}>
      <StoreContext.Provider value={store}>
      <ProgressContext.Provider value={progress}>
        <DragContext.Provider value={dragValue}>{children}</DragContext.Provider>
      </ProgressContext.Provider>
      </StoreContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}


// Chỉ lấy vài phần của trạng thái phát nhạc; màn hình chỉ vẽ lại khi đúng những phần đó đổi
export function usePlayerPick<K extends keyof PlayerContextValue>(...keys: K[]): Pick<PlayerContextValue, K> {
  const store = useContext(StoreContext);
  if (!store) throw new Error('usePlayerPick must be used inside PlayerProvider');
  const cache = useRef<Pick<PlayerContextValue, K> | null>(null);
  const get = () => {
    const v = store.value!;
    const prev = cache.current;
    if (prev && keys.every((k) => prev[k] === v[k])) return prev;
    const next = {} as Pick<PlayerContextValue, K>;
    for (const k of keys) next[k] = v[k];
    cache.current = next;
    return next;
  };
  return useSyncExternalStore(store.subscribe, get);
}

// Số giây đã phát của bài hiện tại (chỉ dùng ở chỗ thật sự cần hiện thời gian)
export function useProgress() {
  return useContext(ProgressContext);
}

export function useDrag() {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDrag must be used inside PlayerProvider');
  return ctx;
}
