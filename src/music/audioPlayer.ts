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
const volListeners = new Set<(v: number) => void>();
function applyVolume() {
  if (pl) pl.volume = userVol * (1 - fxMix) * duck;
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

export function getPlayer(): AudioPlaylist {
  if (!pl) {
    // shouldPlayInBackground: tắt màn hình / chuyển sang app khác vẫn phát tiếp
    // interruptionMode 'doNotMix': app nhạc chính (dừng app khác đang phát), bắt buộc để hiện điều khiển ở màn hình khoá
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    pl = createAudioPlaylist({ updateInterval: 500, loop: 'none' });
    applyVolume();
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
  if (keys[cur] === key && p.trackCount > 0) {
    p.seekTo(0).catch(() => {});
  } else if (keys[cur + 1] === key && cur + 1 < p.trackCount) {
    p.next();
  } else if (cur > 0 && keys[cur - 1] === key) {
    p.previous();
  } else {
    p.clear();
    keys = [];
    if (prev) {
      p.add({ uri: prev.uri });
      keys.push(prev.key);
    }
    p.add({ uri });
    keys.push(key);
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
  if (next) {
    p.add({ uri: next.uri });
    keys.push(next.key);
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

// Trình phát riêng cho trang thử nghiệm phát nhạc (Playback lab trong Cài đặt), tách khỏi trình phát chính
let lab: AudioPlayer | null = null;
export function getLabPlayer(): AudioPlayer {
  if (!lab) lab = createAudioPlayer(null);
  return lab;
}
