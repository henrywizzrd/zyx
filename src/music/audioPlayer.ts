import { createAudioPlayer, createAudioPlaylist, setAudioModeAsync, AudioMetadata, AudioPlayer, AudioPlaylist } from 'expo-audio';

// ---- Trình phát chính của app: một "danh sách phát" (AudioPlaylist) thay vì một bài đơn lẻ.
// Lý do: màn hình khoá / Dynamic Island / thông báo Android chỉ có nút Bài trước / Bài sau khi trình phát có bài trước / sau.
// Danh sách phát ở đây là một "cửa sổ" nhỏ bám theo hàng đợi của app:
//   [ ...các bài đã phát | bài đang phát | bài kế tiếp (link đã lấy sẵn) ]
//  - hết bài: trình phát tự chuyển sang bài kế tiếp ngay (không có khoảng im lặng, chạy được cả khi tắt màn hình)
//  - bấm Bài sau / Bài trước ở màn hình khoá: trình phát tự chuyển, rồi báo cho app (onTrackChange) để app cập nhật theo
//  - app tự chọn bài (bấm bài khác, bấm Next trong app...): app gọi startTrack()
// Mỗi ô trong danh sách gắn với một "key" = mã của bài trong hàng đợi (qid), để biết ô nào là bài nào.

let pl: AudioPlaylist | null = null;
let keys: string[] = [];
let uris: string[] = []; // link của từng ô (song song với keys) — để crossfade mở lại đúng bài đang phát
let currentKey: string | null = null;
let lockScreenOn = false;
let trackListener: ((key: string) => void) | null = null;

// ---- Âm lượng
// userVol = âm lượng người dùng kéo trong player. fxMix = phần tiếng đang chuyển sang bộ hiệu ứng (Chế độ âm thanh, 0..1):
// khi bật 8D / Phòng hoà nhạc, trình phát chính vẫn chạy (giữ màn hình khoá, chạy nền, chuyển bài) nhưng im tiếng,
// tiếng thật phát ra từ bộ hiệu ứng (src/player/fxEngine.ts)
let userVol = 1;
let fxMix = 0;
let duck = 1; // hạ nhỏ tạm thời khi đổi chế độ âm thanh (nhỏ xuống rồi to dần lên)
let xIn = 1; // crossfade: bài mới to dần từ 0 lên 1
const volListeners = new Set<(v: number) => void>();
function applyVolume() {
  if (pl) pl.volume = userVol * (1 - fxMix) * duck * xIn;
}
export function getUserVolume() {
  return userVol;
}
export function setUserVolume(v: number) {
  userVol = Math.max(0, Math.min(1, v));
  applyVolume();
  volListeners.forEach((l) => l(userVol));
}
export function onUserVolume(cb: (v: number) => void) {
  volListeners.add(cb);
  return () => {
    volListeners.delete(cb);
  };
}
export function setDuck(d: number) {
  duck = Math.max(0, Math.min(1, d));
  applyVolume();
}
export function setFxMix(m: number) {
  fxMix = Math.max(0, Math.min(1, m));
  applyVolume();
}

// Tốc độ phát (Slowed / Sped up). Trình phát chính chạy cùng tốc độ để thời gian, màn hình khoá và chuyển bài khớp với
// bộ hiệu ứng (tiếng thật — đổi cả cao độ — phát ra từ bộ hiệu ứng, xem fxEngine)
let rate = 1;
export function setRate(r: number) {
  rate = r;
  if (pl) {
    try {
      pl.playbackRate = r;
    } catch {}
  }
}

export function getPlayer(): AudioPlaylist {
  if (!pl) {
    // shouldPlayInBackground: tắt màn hình / chuyển sang app khác vẫn phát tiếp
    // interruptionMode 'doNotMix': app nhạc chính (dừng app khác đang phát), bắt buộc để hiện điều khiển ở màn hình khoá
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    pl = createAudioPlaylist({ updateInterval: 500, loop: 'none' });
    applyVolume();
    if (rate !== 1) {
      try {
        pl.playbackRate = rate;
      } catch {}
    }
    // Trình phát tự đổi bài (hết bài, hoặc bấm nút ở màn hình khoá): báo cho app
    pl.addListener('trackChanged', ({ currentIndex }) => {
      const key = keys[currentIndex];
      if (!key || key === currentKey) return; // do chính app vừa yêu cầu → app đã biết rồi
      currentKey = key;
      trackListener?.(key);
    });
  }
  return pl;
}

// App đăng ký để biết khi trình phát tự đổi bài
export function onTrackChange(cb: ((key: string) => void) | null) {
  trackListener = cb;
}

// App chọn phát một bài. Nếu bài đó đang nằm ngay sau / ngay trước trong danh sách thì chỉ việc chuyển (nhanh, không tải lại).
// Không thì làm lại danh sách: [bài trước (nếu có link sẵn)], bài này
export function startTrack(key: string, uri: string, prev?: { key: string; uri: string } | null) {
  const p = getPlayer();
  const cur = p.currentIndex;
  currentKey = key;
  endCrossfade(); // người dùng tự chọn bài: bỏ crossfade đang chạy
  if (keys[cur] === key && p.trackCount > 0) {
    p.seekTo(0).catch(() => {});
  } else if (keys[cur + 1] === key && cur + 1 < p.trackCount) {
    p.next();
  } else if (cur > 0 && keys[cur - 1] === key) {
    p.previous();
  } else {
    p.clear();
    keys = [];
    uris = [];
    if (prev) {
      p.add({ uri: prev.uri });
      keys.push(prev.key);
      uris.push(prev.uri);
    }
    p.add({ uri });
    keys.push(key);
    uris.push(uri);
    if (prev) p.skipTo(1);
  }
  p.play();
}

// Đặt bài kế tiếp (link đã lấy sẵn). key = null: không có bài kế tiếp (hết hàng đợi, lặp 1 bài...)
export function setNext(next: { key: string; uri: string } | null) {
  const p = getPlayer();
  const cur = p.currentIndex;
  if (p.trackCount === 0) return;
  if (next && keys[cur + 1] === next.key && p.trackCount === cur + 2) return; // đã đúng rồi
  // Bỏ các ô sau bài đang phát (bỏ từ cuối lên: bỏ ô phía sau không làm gián đoạn bài đang phát)
  for (let i = p.trackCount - 1; i > cur; i--) p.remove(i);
  keys = keys.slice(0, cur + 1);
  uris = uris.slice(0, cur + 1);
  if (next) {
    p.add({ uri: next.uri });
    keys.push(next.key);
    uris.push(next.uri);
  }
}

// Có bài kế tiếp xếp sẵn trong trình phát không (để biết hết bài là trình phát tự chuyển hay app phải lo)
export function hasNext() {
  const p = getPlayer();
  return p.currentIndex < p.trackCount - 1;
}

export function setLoopOne(one: boolean) {
  getPlayer().loop = one ? 'single' : 'none';
}

// Hiện bài đang phát ở màn hình khoá / Dynamic Island / thanh thông báo (tên bài, ca sĩ, ảnh, phát/dừng, bài trước/sau, thanh tua).
// Trên Android đây cũng là thứ giữ cho nhạc chạy nền: không bật thì hệ điều hành dừng nhạc sau khoảng 3 phút.
// Lần đầu bật điều khiển, các bài sau chỉ đổi thông tin. Lỗi (vd. Expo Go không hỗ trợ) thì bỏ qua, nhạc vẫn phát
export function showNowPlaying(meta: AudioMetadata) {
  const p = getPlayer();
  try {
    if (!lockScreenOn) {
      p.setActiveForLockScreen(true, meta, { showNextTrack: true, showPreviousTrack: true });
      lockScreenOn = true;
    } else {
      p.updateLockScreenMetadata(meta);
    }
  } catch (e) {
    console.warn('[lockscreen]', e);
  }
}


// ---------------- Crossfade giữa bài (6 giây) ----------------
// Còn 6 giây là hết bài: mở thêm một trình phát phụ chạy nốt đuôi bài cũ (đúng chỗ đang nghe), rồi cho trình phát chính
// sang bài kế ngay (màn hình khoá, chạy nền, lịch sử... đi theo bài mới như bình thường). Trong 6 giây đó đuôi bài cũ
// nhỏ dần, bài mới to dần (kiểu "công suất đều": tổng âm lượng không bị hụt ở giữa).
// Trình phát phụ được mở sẵn từ lúc còn ~10 giây để kịp tải; tới giờ mà chưa tải xong thì thôi, chuyển bài bình thường.
// Không chạy khi: tắt trong Cài đặt, đang bật Chế độ âm thanh / đổi tốc độ (bộ hiệu ứng tự lo tiếng), lặp 1 bài, bài < 30 giây.
export const CROSSFADE_SEC = 6;
let xfadeOn = false;
let tail: AudioPlayer | null = null;
let xState: 'idle' | 'prep' | 'fading' = 'idle';
let xFor: string | null = null; // bài (key) đã crossfade / đang chuẩn bị — mỗi bài một lần
let xTimer: ReturnType<typeof setInterval> | null = null;

export function setCrossfadeEnabled(on: boolean) {
  xfadeOn = on;
  if (!on) endCrossfade();
}

function releaseTail() {
  const t = tail;
  tail = null;
  if (!t) return;
  try {
    t.pause();
  } catch {}
  try {
    t.remove();
  } catch {}
}

export function endCrossfade() {
  if (xTimer) clearInterval(xTimer);
  xTimer = null;
  releaseTail();
  xState = 'idle';
  if (xIn !== 1) {
    xIn = 1;
    applyVolume();
  }
}

// Gọi mỗi lần trình phát chính báo trạng thái (~0,5 giây). allowed = không bật bộ hiệu ứng / đổi tốc độ
export function crossfadeTick(time: number, duration: number, playing: boolean, allowed: boolean, log?: (m: string) => void) {
  if (xState === 'fading') {
    if (!playing) endCrossfade(); // dừng nhạc giữa chừng: kết thúc luôn, không để đuôi bài cũ kêu một mình
    return;
  }
  const p = pl;
  if (!p || !xfadeOn || !allowed || !playing || !(duration >= 30) || p.loop === 'single' || rate !== 1) {
    if (xState === 'prep') endCrossfade();
    return;
  }
  const cur = p.currentIndex;
  const key = keys[cur];
  const remaining = duration - time;
  const nextReady = cur < p.trackCount - 1;
  if (xState === 'idle') {
    if (!nextReady || !key || xFor === key || !uris[cur]) return;
    if (remaining <= CROSSFADE_SEC + 4 && remaining > CROSSFADE_SEC + 0.6) {
      xFor = key;
      xState = 'prep';
      try {
        tail = createAudioPlayer({ uri: uris[cur] }, { updateInterval: 1000 });
        tail.volume = 0;
      } catch {
        endCrossfade();
      }
    }
    return;
  }
  // prep
  if (!nextReady || keys[cur] !== xFor || remaining > CROSSFADE_SEC + 4.5) {
    endCrossfade(); // tua ngược / đổi bài / bỏ bài kế: thôi
    return;
  }
  if (remaining > CROSSFADE_SEC) return;
  const t = tail;
  if (!t || !t.isLoaded) {
    log?.('crossfade: đuôi bài chưa tải kịp → chuyển bài bình thường');
    endCrossfade();
    return;
  }
  xState = 'fading';
  const from = time + 0.12;
  t.seekTo(from)
    .catch(() => {})
    .then(() => {
      if (xState !== 'fading' || tail !== t) return;
      const base = userVol * duck;
      t.volume = base;
      t.play();
      xIn = 0;
      applyVolume();
      p.next(); // trình phát chính sang bài kế (app được báo qua trackChanged như khi hết bài)
      log?.(`crossfade ${CROSSFADE_SEC}s từ ${from.toFixed(1)}s`);
      const t0 = Date.now();
      const ms = Math.max(1000, (duration - from) * 1000);
      xTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        const b = userVol * duck;
        try {
          t.volume = b * Math.cos((k * Math.PI) / 2);
        } catch {}
        xIn = Math.sin((k * Math.PI) / 2);
        applyVolume();
        if (k >= 1) endCrossfade();
      }, 120);
    });
}
