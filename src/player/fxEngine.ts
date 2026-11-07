import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { audio } from '../music/lazy';
import { showToast } from '../components/toastBridge';

// ---- Chế độ âm thanh: 8D (tiếng xoay quanh đầu) và Phòng hoà nhạc (tiếng vang như trong khán phòng lớn)
//
// expo-audio (trình phát chính) không có hiệu ứng, nên dùng thêm react-native-audio-api (Web Audio cho React Native).
// Cách làm: trình phát chính VẪN chạy như cũ (hàng đợi, màn hình khoá, chạy nền, tự chuyển bài, tua...),
// chỉ là bị vặn nhỏ về 0. Bộ hiệu ứng ở đây phát CÙNG bài đó, bám theo thời gian của trình phát chính:
//   - đổi bài → tải file bài mới về (bài đã tải sẵn trong máy thì dùng luôn), giải mã, rồi phát qua chuỗi hiệu ứng
//   - dừng / phát / tua / lặp → mỗi lần trình phát chính báo trạng thái (0,5s một lần) thì so thời gian, lệch là theo lại
//   - trong lúc đang tải bài mới, tiếng vẫn ra từ trình phát chính (không bị im), tải xong thì chuyển dần sang bộ hiệu ứng
// Bản app cũ chưa có thư viện này (cần cài bản build mới): fxSupported() = false, nút chọn chế độ báo cần cập nhật app.

export type FxMode = 'off' | '8d' | 'hall';
export const FX_MODES: FxMode[] = ['off', '8d', 'hall'];

type Api = typeof import('react-native-audio-api');
type Ctx = InstanceType<Api['AudioContext']>;
type Buf = InstanceType<Api['AudioBuffer']>;
type Src = ReturnType<Ctx['createBufferSource']>;
type Node = ReturnType<Ctx['createGain']>;

let api: Api | null | undefined;
function lib(): Api | null {
  if (api !== undefined) return api;
  try {
    api = Platform.OS === 'web' ? null : (require('react-native-audio-api') as Api);
  } catch {
    api = null; // bản app cài trên máy chưa có thư viện native này
  }
  return api;
}
export const fxSupported = () => lib() != null;

// ---------- Chế độ đang chọn (nhớ giữa các lần mở app) ----------
const MODE_KEY = 'zyx:fxMode';
let mode: FxMode = 'off';
const modeListeners = new Set<() => void>();
AsyncStorage.getItem(MODE_KEY)
  .then((v) => {
    if (v === '8d' || v === 'hall') {
      mode = v;
      modeListeners.forEach((l) => l());
    }
  })
  .catch(() => {});

export function getFxMode() {
  return mode;
}
export function setFxMode(m: FxMode) {
  if (m !== 'off' && !fxSupported()) {
    showToast('fx.needBuild');
    return;
  }
  if (m === mode) return;
  const prev = mode;
  mode = m;
  AsyncStorage.setItem(MODE_KEY, m).catch(() => {});
  modeListeners.forEach((l) => l());
  // Đổi chế độ do người dùng bấm: nhạc nhỏ xuống một chút, đổi, rồi to dần lên trong ~1,5 giây
  // (vào 8D thì tiếng còn từ từ lan dần ra hai bên tai)
  const live = prev !== 'off' && mix > 0.5 && !!buffer && bufId === curId;
  if (!live) {
    // Đang nghe tiếng thường (chưa có bộ hiệu ứng chạy): bật lên thì đợi bộ hiệu ứng sẵn sàng rồi mới nhỏ xuống - to lên
    swellNext = m !== 'off';
    transTok++; // huỷ lần nhỏ xuống - to lên đang dở (nếu có) và trả âm lượng về bình thường
    if (duck !== 1) rampDuck(1, 0.5);
    applyMode();
    return;
  }
  transition(() => applyMode(true));
}
export function useFxMode(): FxMode {
  return useSyncExternalStore(
    (l) => {
      modeListeners.add(l);
      return () => {
        modeListeners.delete(l);
      };
    },
    () => mode
  );
}

// ---------- Lấy file bài để giải mã ----------
// Link phát của bài (giống trình phát chính đang dùng); PlayerProvider gắn vào lúc khởi động
let resolver: ((id: string) => Promise<string>) | null = null;
export function setFxResolver(r: (id: string) => Promise<string>) {
  resolver = r;
}

function fs() {
  return require('expo-file-system') as typeof import('expo-file-system');
}
let dirReady = false;
function cacheDir() {
  const { Directory, Paths } = fs();
  const d = new Directory(Paths.cache, 'fx');
  if (!dirReady) {
    // Mỗi lần mở app dọn file cũ của lần trước (chỉ là bản tạm, file nhạc đã tải nằm chỗ khác)
    try {
      if (d.exists) d.delete();
    } catch {}
    dirReady = true;
  }
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}
const KEEP_FILES = 4; // giữ vài file gần nhất (bài trước / bài sau) cho khỏi tải lại
const fileOrder: string[] = [];
const filePending = new Map<string, Promise<string>>();
const safeName = (id: string) => `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;

function fileFor(id: string): Promise<string> {
  const pending = filePending.get(id);
  if (pending) return pending;
  const job = (async () => {
    if (!resolver) throw new Error('no resolver');
    const uri = await resolver(id);
    if (uri.startsWith('file:')) return uri; // bài đã tải về máy
    const { File } = fs();
    const target = new File(cacheDir(), safeName(id));
    if (!(target.exists && (target.size ?? 0) > 0)) {
      await File.downloadFileAsync(uri, target, { idempotent: true });
    }
    const k = fileOrder.indexOf(id);
    if (k >= 0) fileOrder.splice(k, 1);
    fileOrder.push(id);
    while (fileOrder.length > KEEP_FILES) {
      const old = fileOrder.shift()!;
      try {
        const f = new File(cacheDir(), safeName(old));
        if (f.exists) f.delete();
      } catch {}
    }
    return target.uri;
  })().finally(() => filePending.delete(id));
  filePending.set(id, job);
  return job;
}

// Tải trước file bài kế tiếp (chỉ khi đang bật chế độ), để sang bài là có hiệu ứng ngay
export function fxPrefetch(id: string | null) {
  if (!id || mode === 'off' || !fxSupported()) return;
  setTimeout(() => fileFor(id).catch(() => {}), 4000);
}

// ---------- Âm thanh ----------
let ctx: Ctx | null = null;
let input: Node | null = null; // nguồn → input → (chuỗi hiệu ứng) → master → duckNode → loa
let master: Node | null = null;
let duckNode: Node | null = null;
let chain: { mode: FxMode; stop: () => void } | null = null;

function context(): Ctx | null {
  const A = lib();
  if (!A) return null;
  if (ctx) return ctx;
  try {
    // iPhone: để expo-audio tự lo phiên âm thanh (chạy nền, màn hình khoá, ngắt khi có cuộc gọi). Thư viện này không đụng vào
    if (Platform.OS === 'ios') A.AudioManager.disableSessionManagement();
    ctx = new A.AudioContext();
    input = ctx.createGain();
    master = ctx.createGain();
    master.gain.value = 0;
    duckNode = ctx.createGain();
    duckNode.gain.value = duck;
    master.connect(duckNode);
    duckNode.connect(ctx.destination);
    audio().onUserVolume(() => setMix(mix, 0.05));
  } catch (e) {
    console.warn('[fx] AudioContext', e);
    ctx = null;
  }
  return ctx;
}

// Tiếng vang giả lập: tiếng ồn tắt dần theo hàm mũ, tiếng cao tắt nhanh hơn tiếng trầm (giống phòng thật),
// cộng vài tiếng dội sớm từ tường trong 80ms đầu. Hai kênh khác nhau một chút cho tiếng rộng ra hai bên
function impulse(c: Ctx, seconds: number, early: number, damp: number): Buf {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(len);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp((-6.9 * t) / seconds); // -60dB ở cuối
      // hệ số lọc giảm dần theo thời gian: đuôi vang tối dần
      const a = Math.max(0.04, 1 - damp * (t / seconds));
      lp += a * (Math.random() * 2 - 1 - lp);
      data[i] = lp * env;
    }
    // Tiếng dội sớm
    for (let k = 0; k < 9; k++) {
      const at = Math.floor(rate * (0.008 + Math.random() * 0.075));
      if (at < len) data[at] += (Math.random() > 0.5 ? 1 : -1) * early * (1 - k / 10);
    }
    buf.copyToChannel(data, ch);
  }
  return buf;
}

function buildChain(c: Ctx, m: FxMode) {
  const inp = input!;
  const out = master!;
  const nodes: { disconnect: () => void }[] = [];
  const sources: { stop: (when?: number) => void }[] = [];
  const keep = <T extends { disconnect: () => void }>(n: T) => (nodes.push(n), n);

  if (m === '8d') {
    // Tiếng chạy vòng quanh đầu (khoảng 9 giây một vòng):
    //  - trái ↔ phải: StereoPanner lắc theo sóng sin
    //  - lúc ở phía sau đầu: nhỏ hơn và đục hơn một chút (lọc bớt tiếng cao), theo sóng cos (lệch 1/4 vòng)
    //  - thêm chút vang phòng nhỏ cho có không gian
    const RATE = 1 / 9;
    const pan = keep(c.createStereoPanner());
    const lp = keep(c.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 12000;
    lp.Q.value = 0.5;
    const dip = keep(c.createGain());
    dip.gain.value = 0.9;

    const sin = c.createOscillator();
    sin.frequency.value = RATE;
    const panDepth = keep(c.createGain());
    // Lan dần ra hai bên tai: độ xoay tăng từ 0 lên hết trong ~2,5 giây
    panDepth.gain.setValueAtTime(0, c.currentTime);
    panDepth.gain.linearRampToValueAtTime(0.92, c.currentTime + 2.5);
    sin.connect(panDepth);
    panDepth.connect(pan.pan);

    const cos = c.createOscillator();
    cos.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
    cos.frequency.value = RATE;
    const lpDepth = keep(c.createGain());
    lpDepth.gain.value = 6000; // 6 kHz (sau đầu) .. 18 kHz (trước mặt)
    const dipDepth = keep(c.createGain());
    dipDepth.gain.value = 0.1; // 0.8 (sau) .. 1.0 (trước)
    cos.connect(lpDepth);
    lpDepth.connect(lp.frequency);
    cos.connect(dipDepth);
    dipDepth.connect(dip.gain);
    keep(sin);
    keep(cos);
    sources.push(sin, cos);
    sin.start();
    cos.start();

    inp.connect(pan);
    pan.connect(lp);
    lp.connect(dip);
    dip.connect(out);

    const room = keep(c.createConvolver());
    room.buffer = impulse(c, 0.9, 0.35, 0.7);
    const wet = keep(c.createGain());
    wet.gain.value = 0.22;
    dip.connect(room);
    room.connect(wet);
    wet.connect(out);
  } else if (m === 'hall') {
    // Khán phòng: tiếng gốc + tiếng vang dài ~2,4s, đến muộn hơn một chút (phòng lớn), tiếng vang hơi tối
    const dry = keep(c.createGain());
    dry.gain.value = 0.78;
    inp.connect(dry);
    dry.connect(out);

    const pre = keep(c.createDelay(0.2));
    pre.delayTime.value = 0.03;
    const hall = keep(c.createConvolver());
    hall.buffer = impulse(c, 2.4, 0.5, 0.92);
    const tone = keep(c.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.value = 6500;
    const wet = keep(c.createGain());
    wet.gain.value = 0.55;
    inp.connect(pre);
    pre.connect(hall);
    hall.connect(tone);
    tone.connect(wet);
    wet.connect(out);
  } else {
    inp.connect(out);
  }

  return {
    mode: m,
    stop: () => {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      try {
        inp.disconnect();
      } catch {}
      nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {}
      });
    },
  };
}

// mix: 0 = tiếng ra từ trình phát chính, 1 = tiếng ra từ bộ hiệu ứng. Chuyển dần cho khỏi giật
let mix = 0;
let mixTimer: ReturnType<typeof setInterval> | null = null;
function setMix(target: number, seconds = 0.35) {
  const c = ctx;
  const vol = audio().getUserVolume();
  if (c && master) {
    const now = c.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(vol * target, now + Math.max(0.01, seconds));
  }
  // Trình phát chính: đổi âm lượng theo từng bước nhỏ cùng lúc
  if (mixTimer) clearInterval(mixTimer);
  const from = mix;
  const steps = Math.max(1, Math.round(seconds / 0.04));
  let k = 0;
  mix = target;
  if (steps === 1) {
    audio().setFxMix(target);
    return;
  }
  mixTimer = setInterval(() => {
    k++;
    audio().setFxMix(from + ((target - from) * k) / steps);
    if (k >= steps && mixTimer) {
      clearInterval(mixTimer);
      mixTimer = null;
    }
  }, 40);
}

// ---------- Nhỏ xuống - to lên khi đổi chế độ ----------
let duck = 1;
let duckTimer: ReturnType<typeof setInterval> | null = null;
let transTok = 0;
let swellNext = false; // bộ hiệu ứng sẵn sàng lần tới thì chuyển sang bằng kiểu nhỏ xuống - to lên
let wantMix = 0;

// Hạ / nâng âm lượng chung của cả hai đường tiếng (trình phát chính và bộ hiệu ứng) tới target trong seconds giây
function rampDuck(target: number, seconds: number): Promise<void> {
  if (duckTimer) clearInterval(duckTimer);
  duckTimer = null;
  const c = ctx;
  if (c && duckNode) {
    const now = c.currentTime;
    duckNode.gain.cancelScheduledValues(now);
    duckNode.gain.setValueAtTime(duck, now);
    duckNode.gain.linearRampToValueAtTime(target, now + seconds);
  }
  const from = duck;
  const steps = Math.max(1, Math.round(seconds / 0.04));
  let k = 0;
  return new Promise((resolve) => {
    duckTimer = setInterval(() => {
      k++;
      // to lên theo đường cong êm (chậm dần ở cuối), nhỏ xuống thì đều
      const x = k / steps;
      const e = target > from ? 1 - (1 - x) * (1 - x) : x;
      duck = from + (target - from) * e;
      audio().setDuck(duck);
      if (k >= steps) {
        if (duckTimer) clearInterval(duckTimer);
        duckTimer = null;
        duck = target;
        audio().setDuck(target);
        resolve();
      }
    }, 40);
  });
}

// Nhỏ xuống còn ~30% trong 0,3s → làm thay đổi (đổi chuỗi hiệu ứng / chuyển đường tiếng) → to dần lên trong 1,5s
async function transition(change: () => void) {
  const tok = ++transTok;
  await rampDuck(0.3, 0.3);
  if (tok !== transTok) return;
  change();
  await rampDuck(1, 1.5);
}

// ---------- Bám theo trình phát chính ----------
let curId: string | null = null; // bài trình phát chính đang phát
let bufId: string | null = null; // bài đã giải mã xong
let buffer: Buf | null = null;
let loadToken = 0;
let failedId: string | null = null;
let src: Src | null = null;
let srcStart = 0; // ctx.currentTime lúc nguồn bắt đầu
let srcOffset = 0; // vị trí trong bài lúc đó
let driftCount = 0;
let last = { playing: false, time: 0, at: 0 }; // lần báo gần nhất của trình phát chính

const expected = () => (last.playing ? last.time + (Date.now() - last.at) / 1000 : last.time);
const fxPos = () => (ctx && src ? srcOffset + (ctx.currentTime - srcStart) : -1);

function stopSrc() {
  if (!src) return;
  try {
    src.stop();
  } catch {}
  try {
    src.disconnect();
  } catch {}
  src = null;
}

function startAt(offset: number) {
  const c = ctx;
  if (!c || !buffer || !input) return;
  stopSrc();
  if (offset >= buffer.duration - 0.05) return;
  const s = c.createBufferSource();
  s.buffer = buffer;
  s.connect(input);
  const when = c.currentTime + 0.03;
  s.start(when, Math.max(0, offset + 0.03));
  src = s;
  srcStart = when;
  srcOffset = Math.max(0, offset + 0.03);
}

async function loadTrack(id: string) {
  const token = ++loadToken;
  const A = lib();
  const c = context();
  if (!A || !c) return;
  try {
    const path = await fileFor(id);
    if (token !== loadToken) return;
    const b = await A.decodeAudioData(path, c.sampleRate);
    if (token !== loadToken) return;
    buffer = b;
    bufId = id;
    sync(true);
  } catch (e) {
    if (token !== loadToken) return;
    console.warn('[fx] không dựng được bài', id, e);
    if (failedId !== id) showToast('fx.trackFail');
    failedId = id;
  }
}

// Đặt lại toàn bộ theo chế độ hiện tại
function applyMode(instant = false) {
  if (mode === 'off') {
    wantMix = 0;
    setMix(0, instant ? 0.05 : 0.35);
    const c = ctx;
    setTimeout(() => {
      if (mode !== 'off') return;
      stopSrc();
      chain?.stop();
      chain = null;
      buffer = null; // nhả bộ nhớ (một bài giải mã ra tốn vài chục MB)
      bufId = null;
      loadToken++;
      c?.suspend().catch(() => {});
    }, 450);
    return;
  }
  const c = context();
  if (!c) return;
  if (chain?.mode !== mode) {
    chain?.stop();
    chain = buildChain(c, mode);
  }
  if (curId && bufId !== curId) loadTrack(curId);
  sync(true);
}

// Đồng bộ với trình phát chính. force: chạy lại ngay cả khi không lệch
function sync(force = false) {
  if (mode === 'off') return;
  const c = ctx;
  if (!c || !chain) return;
  const ready = buffer && bufId === curId;
  if (!ready) {
    // Bài mới chưa sẵn: tiếng trả về trình phát chính, nguồn cũ tắt
    if (src) stopSrc();
    if (wantMix !== 0) {
      wantMix = 0;
      setMix(0, 0.15);
    }
    return;
  }
  if (!last.playing) {
    if (src) {
      stopSrc();
      c.suspend().catch(() => {});
    }
    return;
  }
  if (c.state !== 'running') c.resume().catch(() => {});
  const want = expected();
  const drift = Math.abs(fxPos() - want);
  // Lệch xa (tua, lặp lại bài) thì theo ngay; lệch ít thì phải lệch 2 lần liền mới theo (tránh giật vì số báo về bị trễ)
  driftCount = drift > 0.35 ? driftCount + 1 : 0;
  if (!src || force || drift > 1.5 || driftCount >= 2) {
    driftCount = 0;
    startAt(want);
  }
  if (wantMix !== 1) {
    wantMix = 1;
    if (swellNext) {
      // Vừa bật chế độ: nhỏ xuống, chuyển sang bộ hiệu ứng, to dần lên
      swellNext = false;
      transition(() => setMix(1, 0.05));
    } else setMix(1, 0.6); // sang bài mới: chuyển êm sang bộ hiệu ứng
  }
}

// Gọi mỗi lần trình phát chính báo trạng thái (PlayerProvider)
export function fxTick(id: string | null, playing: boolean, time: number) {
  last = { playing, time, at: Date.now() };
  const changed = id !== curId;
  curId = id;
  if (mode === 'off' || !fxSupported()) return;
  if (changed) {
    if (id && bufId !== id) {
      stopSrc();
      buffer = null; // bỏ bài cũ trước khi giải mã bài mới (đỡ tốn bộ nhớ)
      bufId = null;
      loadTrack(id);
    }
  }
  if (!chain) applyMode();
  else sync();
}
