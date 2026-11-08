import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Image, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../data/mock';
import { MiniAnchor, Position } from '../theme/types';
import { audio, musicSupported, toTrack, ytmusic } from '../music/lazy';
import { bigThumb } from '../components/Cover';
import { getLikedIds, PlayContext, recordPlay, setLiked as saveLiked } from '../data/db';
import { localUri } from '../data/downloads';
import { Image as ExpoImage } from 'expo-image';
import { showToast } from '../components/toastBridge';
import { flog, fxPrefetch, fxTick, setFxResolver } from './fxEngine';
import { bgStats } from '../data/applog';

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
// Link đã có sẵn chưa (không gọi mạng): dùng để xếp bài trước vào trình phát cho nút Bài trước ở màn hình khoá
function cachedUrl(id: string): string | null {
  const local = localUri(id);
  if (local) return local;
  const c = urlCache.get(id);
  return c && Date.now() - c.at < URL_TTL ? c.url : null;
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
// Phiên nghe gần nhất (hàng đợi, bài đang phát, đang nghe tới giây nào, trộn/lặp) để mở lại app nghe tiếp
const SESSION_KEY = 'zyx:session';
const SESSION_MAX = 300; // lưu tối đa 300 bài quanh bài đang phát
type SavedSession = { queue: QueueItem[]; index: number; position: number; shuffle: boolean; repeat: Repeat };

// Thông tin bài cho màn hình khoá / thông báo nhạc chạy nền.
// Ảnh: lấy bản lớn (600px). Trước đây đưa thẳng ảnh nhỏ của danh sách (60–120px) nên ảnh trên thông báo bị mờ
const nowPlayingMeta = (t: Track) => ({ title: t.title, artist: t.artist, artworkUrl: t.thumb ? bigThumb(t.thumb, 600) : undefined });

// Còn mạng không: hỏi một địa chỉ siêu nhẹ của Google (trả về rỗng), quá 3 giây coi như mất mạng
async function isOnline(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', signal: ctrl.signal });
    return r.ok || r.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
// Đồng hồ phát nhạc phía JS: lần báo gần nhất của trình phát (thời gian, lúc báo, đang phát?).
// Lời bài hát nội suy từ đây thay vì hỏi thẳng trình phát 12 lần/giây (hỏi trình phát có lúc bị chặn cả giây
// khi đang nạp bài dài → luồng JS đứng hình)
export const playClock = { t: 0, at: 0, playing: false };

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
  bgStats.renders++; // đếm số lần vẽ lại (nhật ký nền)
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
  // Mở lại app: hàng đợi cũ đã hiện lại nhưng CHƯA nạp nhạc (bấm phát mới nạp, rồi tua tới chỗ đang nghe dở)
  const needsLoad = useRef(false);
  const resumeAt = useRef(0);
  const pendingSeek = useRef<{ qid: string; at: number } | null>(null);
  const goToRef = useRef<(i: number) => void>(() => {});

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

  // Canh nhạc bị đứng (xem phần "Lưới an toàn" ở dưới). Khai báo trước load() để load() đặt lại được
  const stallRef = useRef({ t: -1, at: 0 });
  const loadAtRef = useRef(0); // lúc vừa đưa link vào trình phát (0 = không chờ bài nào nạp)
  const load = useCallback(async (t: QueueItem) => {
    if (!musicSupported) return;
    needsLoad.current = false;
    if (pendingSeek.current && pendingSeek.current.qid !== t.qid) pendingSeek.current = null;
    const id = ++reqId.current;
    loadingRef.current = true;
    // Tải trước ảnh bìa lớn để lúc mở player ảnh đã sẵn, không bị giật
    if (t.thumb && musicSupported) ExpoImage.prefetch(bigThumb(t.thumb, 1200), 'memory-disk').catch(() => {});
    setLoading(true);
    setFailed(false);
    failedRef.current = false;
    setProgress(0);
    setDuration(t.duration);
    const t0 = Date.now();
    // Bài mới: đồng hồ "đứng im" tính lại từ đầu (trước đây còn giữ mốc từ lúc mở app → vừa bấm bài đã báo đứng im 12s)
    stallRef.current = { t: -1, at: t0 };
    loadAtRef.current = 0;
    flog(`tải bài: ${t.title}${t.artist ? ` — ${t.artist}` : ''}`, 'music');
    try {
      const uri = await resolveUrl(t.id);
      if (id !== reqId.current) return; // đã bấm bài khác
      flog(`có link sau ${Date.now() - t0}ms${uri.startsWith('file:') ? ' (bài đã tải)' : ''}`, 'music');
      // Bài ngay trước trong hàng đợi (nếu đã có link) cũng được xếp vào trình phát, để nút Bài trước ở màn hình khoá dùng được
      const q = queueRef.current;
      const k = q.findIndex((x) => x.qid === t.qid);
      const before = k > 0 ? q[k - 1] : null;
      const beforeUri = before ? cachedUrl(before.id) : null;
      audio().startTrack(t.qid, uri, before && beforeUri ? { key: before.qid, uri: beforeUri } : null);
      loadAtRef.current = Date.now();
      stallRef.current = { t: -1, at: loadAtRef.current };
      // Màn hình khoá / thanh thông báo (Android: cần cái này để nhạc chạy nền lâu dài)
      audio().showNowPlaying(nowPlayingMeta(t));
      // Ghi lịch sử nghe sau khi bài đã phát được vài giây (bấm lướt qua nhiều bài liên tục thì không ghi:
      // mỗi lần ghi làm Home / Thư viện tính lại, lướt nhanh 10 bài là khựng cả mấy giây)
      setTimeout(() => {
        if (id === reqId.current) recordPlay({ ...t, duration: t.duration }, t.ctx);
      }, 4000);
    } catch (e) {
      console.warn('Không phát được', t.title, e);
      // Mất mạng: tự chuyển sang bài kế tiếp ĐÃ TẢI VỀ trong hàng đợi (nếu có), không thì báo cho người dùng biết
      if (id === reqId.current && !(await isOnline()) && id === reqId.current) {
        const q = queueRef.current;
        const k = q.findIndex((x) => x.qid === t.qid);
        for (let j = 1; j < q.length; j++) {
          const c = (k + j) % q.length;
          if (localUri(q[c].id)) {
            showToast('player.offlineSkip');
            loadingRef.current = false;
            goToRef.current(c);
            return;
          }
        }
        showToast('player.offline');
      }
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

  // Bấm Bài sau / Bài trước liên tục: giao diện đổi bài ngay, nhưng chỉ nạp nhạc bài cuối cùng khi ngừng bấm ~0,3s.
  // (Trước đây mỗi lần bấm đều nạp bài, ghi lịch sử, đổi màn hình khoá... → bấm nhanh là luồng JS khựng tới 8 giây)
  const lastGo = useRef(0);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goTo = useCallback(
    (i: number) => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const n = ((i % q.length) + q.length) % q.length;
      indexRef.current = n;
      setIndex(n);
      const now = Date.now();
      const rapid = now - lastGo.current < 400;
      lastGo.current = now;
      if (goTimer.current) clearTimeout(goTimer.current);
      goTimer.current = null;
      if (!rapid) {
        load(q[n]);
        return;
      }
      ++reqId.current; // bỏ lần tải đang dở của bài vừa lướt qua
      loadingRef.current = true;
      setLoading(true);
      goTimer.current = setTimeout(() => {
        goTimer.current = null;
        const cur = queueRef.current[indexRef.current];
        if (cur) load(cur);
      }, 300);
    },
    [load]
  );
  goToRef.current = goTo;

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

  // Bài sẽ phát tiếp: lấy sẵn link rồi xếp ngay sau bài đang phát trong trình phát. Nhờ vậy:
  //  - hết bài là chuyển ngay, kể cả khi tắt màn hình (không có khoảng im lặng để iPhone cho app "ngủ")
  //  - nút Bài sau ở màn hình khoá / Dynamic Island dùng được
  const nextItem = (() => {
    if (queue.length < 2 || repeat === 'one') return null;
    if (shuffle) {
      const pick = shuffleNext.current;
      if (pick && pick.from === index && pick.to < queue.length) return queue[pick.to];
      let n = index;
      while (n === index) n = Math.floor(Math.random() * queue.length);
      shuffleNext.current = { from: index, to: n };
      return queue[n];
    }
    if (index + 1 < queue.length) return queue[index + 1];
    return repeat === 'all' ? queue[0] : null;
  })();
  const nextQid = nextItem?.qid ?? null;
  const nextTrackId = nextItem?.id ?? null;
  const curQid = queue[index]?.qid ?? null;
  useEffect(() => {
    if (!musicSupported || !curQid) return;
    if (!nextQid || !nextTrackId) {
      audio().setNext(null);
      return;
    }
    fxPrefetch(nextTrackId); // Chế độ âm thanh đang bật: tải trước file bài sau
    let dead = false;
    // Đợi bài hiện tại chạy được một chút rồi mới lấy link bài sau (không tranh mạng với bài đang mở)
    const timer = setTimeout(() => {
      resolveUrl(nextTrackId)
        .then((uri) => {
          if (dead || queueRef.current[indexRef.current]?.qid !== curQid || loadingRef.current) return;
          audio().setNext({ key: nextQid, uri });
        })
        .catch(() => {}); // lỗi thì thôi, tới lúc chuyển bài app sẽ tự lấy lại
    }, 1500);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [curQid, nextQid, nextTrackId, loading]);

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
  const next = useCallback(() => {
    flog('bấm Bài sau', 'music');
    advance(false);
  }, [advance]);

  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
  }, []);
  const cycleRepeat = useCallback(() => {
    repeatRef.current = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    setRepeat(repeatRef.current);
    // Lặp một bài: để chính trình phát lặp, chắc chắn hơn tự tua về đầu
    if (musicSupported) audio().setLoopOne(repeatRef.current === 'one');
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
    flog('bấm Bài trước', 'music');
    if (p.currentTime > 3) p.seekTo(0);
    else goTo(indexRef.current - 1);
  }, [goTo]);

  const togglePlay = useCallback(() => {
    if (!musicSupported || queueRef.current.length === 0) return;
    flog('người dùng bấm phát / dừng trong app', 'music');
    // Hàng đợi khôi phục từ lần mở app trước: nạp bài rồi tua tới chỗ đang nghe dở
    if (needsLoad.current) {
      const cur = queueRef.current[indexRef.current];
      if (!cur) return;
      pendingSeek.current = resumeAt.current > 3 ? { qid: cur.qid, at: resumeAt.current } : null;
      load(cur);
      return;
    }
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
    // Chưa nạp bài (vừa mở lại app): chỉ nhớ chỗ muốn nghe, bấm phát sẽ tua tới đó
    if (needsLoad.current) {
      resumeAt.current = Math.max(0, s);
      setProgress(resumeAt.current);
      return;
    }
    audio().getPlayer().seekTo(Math.max(0, s));
  }, []);

  const lastPst = useRef('');
  // Lưới an toàn khi nhạc tự đứng:
  //  - bài đã nạp, trình phát đang "phát" (hoặc đang chờ tải) mà thời gian không nhích suốt 12 giây → link bị ngắt / hết hạn
  //  - đưa link vào rồi mà 25 giây vẫn chưa nạp xong
  // → lấy link mới rồi phát tiếp đúng chỗ đang nghe.
  // Chạy cả khi có báo trạng thái lẫn mỗi 3 giây (lúc kẹt thật, trình phát không báo gì nữa nên chỉ dựa vào báo là không bắt được).
  // Chưa nạp bài (vừa mở app, chưa bấm phát) thì không tính.
  const checkStallRef = useRef(() => {});
  checkStallRef.current = () => {
    const s = lastStatus.current;
    if (!s || loadingRef.current || failedRef.current) return;
    const now = Date.now();
    const st = stallRef.current;
    const cur = queueRef.current[indexRef.current];
    if (!cur) return;
    let why = '';
    if (!s.isLoaded) {
      if (loadAtRef.current && now - loadAtRef.current > 25000) why = 'nạp bài quá 25s';
    } else if (!(s.playing || s.isBuffering) || Math.abs(s.currentTime - st.t) > 0.05) {
      st.t = s.currentTime;
      st.at = now;
    } else if (now - st.at > 12000) {
      why = `đứng im ${Math.round((now - st.at) / 1000)}s ở ${s.currentTime.toFixed(1)}s`;
    }
    if (!why) return;
    st.at = now;
    loadAtRef.current = 0;
    if (localUri(cur.id)) {
      flog(`trình phát ${why} (bài đã tải, không tải lại link)`, 'music');
      return;
    }
    flog(`trình phát ${why} → tải lại link (${cur.title})`, 'music');
    urlCache.delete(cur.id);
    if (s.isLoaded) pendingSeek.current = { qid: cur.qid, at: s.currentTime }; // chưa nạp thì giữ chỗ nghe dở cũ (nếu có)
    load(cur);
  };
  useEffect(() => {
    if (!musicSupported) return;
    const id = setInterval(() => checkStallRef.current(), 3000);
    return () => clearInterval(id);
  }, []);
  const lastStatus = useRef<{ playing: boolean; isBuffering: boolean; isLoaded: boolean; currentTime: number } | null>(null);
  // Theo dõi trạng thái thật của trình phát
  useEffect(() => {
    if (!musicSupported) return;
    setFxResolver(resolveUrl);
    const p = audio().getPlayer();
    const sub = p.addListener('playlistStatusUpdate', (s) => {
      // Nghe tiếp từ lần trước: bài đã nạp xong thì tua tới chỗ đang nghe dở
      const ps = pendingSeek.current;
      if (ps && s.isLoaded && s.duration > 0 && queueRef.current[indexRef.current]?.qid === ps.qid) {
        pendingSeek.current = null;
        // Lần trước nghe gần hết bài (còn < 8s) thì nghe lại từ đầu, không tua tới sát cuối rồi hết bài ngay
        if (ps.at > 0.5 && ps.at < s.duration - 8) p.seekTo(ps.at).catch(() => {});
        else if (ps.at >= s.duration - 8) flog(`nghe dở ở ${ps.at.toFixed(1)}s (gần hết bài) → phát lại từ đầu`, 'music');
      }
      // Nhật ký (dò lỗi "nhạc tự dừng"): ghi mỗi lần đổi giữa phát / dừng / đang chờ tải
      const pst = `${s.playing ? 'phát' : 'dừng'}${s.isBuffering ? '+chờ tải' : ''}${s.isLoaded ? '' : '+chưa tải'}`;
      if (pst !== lastPst.current) {
        flog(`trình phát: ${lastPst.current || '-'} → ${pst} ở ${s.currentTime.toFixed(1)}/${(s.duration ?? 0).toFixed(1)}s (${queueRef.current[indexRef.current]?.title ?? '?'})`, 'music');
        lastPst.current = pst;
      }
      bgStats.status++;
      setIsPlaying(s.playing);
      // App ở nền: không cập nhật thanh thời gian / lời bài hát (không ai thấy) — trước đây cả player vẽ lại mỗi 0,5 giây
      // ngay cả khi tắt màn hình, cộng dồn làm iOS tắt app vì dùng CPU quá mức (cpu_resource_fatal)
      progressRef.current = s.currentTime;
      playClock.t = s.currentTime;
      playClock.at = Date.now();
      playClock.playing = s.playing;
      if (AppState.currentState === 'active') setProgress(s.currentTime);
      lastStatus.current = { playing: s.playing, isBuffering: s.isBuffering, isLoaded: s.isLoaded, currentTime: s.currentTime };
      if (s.isLoaded) loadAtRef.current = 0; // bài đã nạp xong
      checkStallRef.current();
      // Chế độ âm thanh (8D / Phòng hoà nhạc) bám theo trình phát chính
      fxTick(queueRef.current[indexRef.current]?.id ?? null, s.playing, s.currentTime);
      // Độ dài bài khi phát qua mạng hay nhích lên xuống vài phần trăm giây mỗi lần báo:
      // chỉ cập nhật khi lệch thật (> 0,5s), không thì cả app vẽ lại liên tục chỉ vì con số lẻ
      if (s.isLoaded && s.duration > 0) setDuration((d) => (Math.abs(d - s.duration) > 0.5 ? s.duration : d));
      // Hết bài mà trình phát KHÔNG có bài kế tiếp xếp sẵn (có thì nó tự chuyển, app chỉ cập nhật theo ở onTrackChange):
      // báo của thư viện, hoặc tự nhận biết khi đã chạy tới cuối và dừng
      const ended =
        s.didJustFinish ||
        (!audio().hasNext() && s.isLoaded && s.duration > 0 && !s.playing && s.currentTime >= s.duration - 0.3);
      if (ended && !loadingRef.current && endedFor.current !== reqId.current) {
        endedFor.current = reqId.current;
        flog(`hết bài (${s.didJustFinish ? 'báo hết' : 'tự tính'}) → bài kế`, 'music');
        advanceRef.current(true);
      }
    });
    return () => sub.remove();
  }, []);

  // Trình phát tự đổi bài (hết bài thì sang bài đã xếp sẵn, hoặc bấm Bài trước / Bài sau ở màn hình khoá):
  // app cập nhật theo (bài đang phát, thời gian, màn hình khoá, lịch sử) mà KHÔNG tải lại bài
  useEffect(() => {
    if (!musicSupported) return;
    audio().onTrackChange((key) => {
      flog('trình phát tự sang bài khác', 'music');
      const q = queueRef.current;
      const k = q.findIndex((x) => x.qid === key);
      if (k < 0) return;
      const t = q[k];
      ++reqId.current; // bỏ qua mọi lần tải đang dở
      loadingRef.current = false;
      setLoading(false);
      failedRef.current = false;
      setFailed(false);
      shuffleNext.current = null;
      indexRef.current = k;
      setIndex(k);
      setProgress(0);
      setDuration(t.duration);
      if (t.thumb) ExpoImage.prefetch(bigThumb(t.thumb, 1200), 'memory-disk').catch(() => {});
      audio().showNowPlaying(nowPlayingMeta(t));
      recordPlay({ ...t, duration: t.duration }, t.ctx);
    });
    return () => audio().onTrackChange(null);
  }, []);

  // ---- Nhớ phiên nghe để mở lại app nghe tiếp
  const restored = useRef(false);
  const progressRef = useRef(0);
  if (AppState.currentState === 'active') progressRef.current = progress;
  // Quay lại app: thanh thời gian nhảy tới đúng chỗ đang phát
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setProgress(progressRef.current);
    });
    return () => sub.remove();
  }, []);
  const saveSession = useCallback(() => {
    if (!restored.current) return; // chưa đọc xong phiên cũ thì đừng ghi đè
    const q = queueRef.current;
    if (q.length === 0) return;
    const i = indexRef.current;
    const from = Math.max(0, i - Math.floor(SESSION_MAX / 3));
    const data: SavedSession = {
      queue: q.slice(from, from + SESSION_MAX),
      index: i - from,
      position: needsLoad.current ? resumeAt.current : progressRef.current,
      shuffle: shuffleRef.current,
      repeat: repeatRef.current,
    };
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify(data)).catch(() => {});
  }, []);

  // Mở app: đọc phiên cũ, hiện lại bài đang nghe (đang dừng) + hàng đợi, chưa nạp nhạc cho tới khi bấm phát
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY)
      .then((raw) => {
        if (!raw || queueRef.current.length > 0) return; // đã kịp bấm phát bài khác thì thôi
        const d = JSON.parse(raw) as SavedSession;
        if (!Array.isArray(d.queue) || d.queue.length === 0) return;
        const q = d.queue.map(({ qid: _q, auto, ctx, ...tr }) => enqueue(tr as Track, ctx ?? single(tr as Track), !!auto));
        const i = Math.min(Math.max(0, d.index | 0), q.length - 1);
        commitQueue(q, i);
        shuffleRef.current = !!d.shuffle;
        setShuffle(!!d.shuffle);
        if (d.repeat === 'all' || d.repeat === 'one' || d.repeat === 'off') {
          repeatRef.current = d.repeat;
          setRepeat(d.repeat);
          if (musicSupported) audio().setLoopOne(d.repeat === 'one');
        }
        needsLoad.current = true;
        resumeAt.current = Math.max(0, Number(d.position) || 0);
        setDuration(q[i].duration);
        setProgress(resumeAt.current);
        // Lấy sẵn link bài đó để bấm phát là chạy ngay
        if (musicSupported) setTimeout(() => resolveUrl(q[i].id).catch(() => {}), 2500);
      })
      .catch(() => {})
      .finally(() => {
        restored.current = true;
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ghi lại khi đổi bài / hàng đợi / trộn / lặp, mỗi 10 giây khi đang phát, và khi app chuyển xuống nền
  useEffect(() => {
    saveSession();
  }, [queue, index, shuffle, repeat, saveSession]);
  useEffect(() => {
    if (!isPlaying) {
      saveSession(); // vừa dừng: ghi đúng chỗ đang dừng
      return;
    }
    const id = setInterval(saveSession, 10000);
    return () => clearInterval(id);
  }, [isPlaying, saveSession]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') saveSession();
    });
    return () => sub.remove();
  }, [saveSession]);

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
