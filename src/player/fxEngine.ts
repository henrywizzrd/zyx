import { useSyncExternalStore } from 'react';
import { bgStats, flushLog, log as appLog } from '../data/applog';
import { AppState, Platform } from 'react-native';
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
// Tốc độ: chậm / nhanh đổi luôn cao độ (giống bản slowed / sped up trên mạng). Slowed + reverb thêm tiếng vang dài
export type FxSpeed = 'slowedReverb' | 'slowed' | 'normal' | 'spedUp' | 'nightcore';
export const FX_SPEEDS: FxSpeed[] = ['slowedReverb', 'slowed', 'normal', 'spedUp', 'nightcore'];
const SPEED_RATE: Record<FxSpeed, number> = { slowedReverb: 0.85, slowed: 0.85, normal: 1, spedUp: 1.15, nightcore: 1.25 };

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

// ---------- Tốc độ (Slowed / Sped up), áp cho mọi bài tới khi tắt ----------
const SPEED_KEY = 'zyx:fxSpeed';
let speed: FxSpeed = 'normal';
const rate = () => SPEED_RATE[speed];
const reverbOn = () => speed === 'slowedReverb';
// Bộ hiệu ứng chạy khi có chế độ âm thanh HOẶC đang đổi tốc độ
const engineOn = () => mode !== 'off' || speed !== 'normal';
AsyncStorage.getItem(SPEED_KEY)
  .then((v) => {
    if (v && v !== 'normal' && (FX_SPEEDS as string[]).includes(v) && fxSupported()) {
      speed = v as FxSpeed;
      liveRate = rate();
      audio().setRate(rate());
      modeListeners.forEach((l) => l());
    }
  })
  .catch(() => {});
export function getFxSpeed() {
  return speed;
}
export function setFxSpeed(s: FxSpeed) {
  if (s !== 'normal' && !fxSupported()) {
    showToast('fx.needBuild');
    return;
  }
  if (s === speed) return;
  const wasLive = engineOn() && mix > 0.5 && !!source && source.id === curId;
  speed = s;
  AsyncStorage.setItem(SPEED_KEY, s).catch(() => {});
  modeListeners.forEach((l) => l());
  flog(`đổi tốc độ → ${s} (${rate()}x)`);
  if (!wasLive) {
    stopGlide();
    liveRate = rate();
    audio().setRate(rate());
    swellNext = engineOn();
    transTok++;
    if (duck !== 1) rampDuck(1, 0.5);
    applyMode();
    return;
  }
  if (!engineOn()) {
    // Về tốc độ gốc và không còn chế độ nào: trượt tốc độ về 1× rồi trả tiếng về trình phát chính
    glideTo(1, () => transition(() => applyMode(true)));
    return;
  }
  // Đang nghe qua bộ hiệu ứng: tốc độ (và cao độ) trượt dần như bàn xoay đĩa; bật / tắt vang thì morph
  glideTo(rate());
  applyMode();
}

// ---------- Trượt tốc độ kiểu đĩa than ----------
// Tốc độ thật lúc này (đang trượt thì nằm giữa tốc độ cũ và mới). Trình phát chính trượt theo để thời gian vẫn khớp
let liveRate = 1;
export const getLiveRate = () => liveRate;
let glideTimer: ReturnType<typeof setInterval> | null = null;
let gliding = false;
function stopGlide() {
  if (glideTimer) clearInterval(glideTimer);
  glideTimer = null;
  gliding = false;
}
function glideTo(target: number, done?: () => void) {
  stopGlide();
  const src = source && source.id === curId ? source : null;
  const from = liveRate;
  if (!src || Math.abs(from - target) < 0.001) {
    liveRate = target;
    audio().setRate(target);
    done?.();
    return;
  }
  const MS = 800;
  const STEP = 32;
  const steps = Math.max(1, Math.round(MS / STEP));
  let k = 0;
  gliding = true;
  glideTimer = setInterval(() => {
    k++;
    const x = k / steps;
    const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; // chậm - nhanh - chậm
    const r = from + (target - from) * e;
    liveRate = r;
    // Trình phát chính (đang tắt tiếng) chỉ đổi tốc độ một lần lúc trượt xong: đổi 25 lần liên tục làm luồng JS đứng
    // cả giây (trình phát chính chặn mỗi lần đổi), trượt 0,8 giây thành 12 giây
    const ok = src.setRate(r);
    if (!ok) {
      // Máy không trượt tốc độ được: crossfade sang bản mở lại ở tốc độ mới
      stopGlide();
      liveRate = target;
      audio().setRate(target);
      flog('không trượt tốc độ được → crossfade');
      crossfadeSource().finally(() => done?.());
      return;
    }
    if (k >= steps) {
      stopGlide();
      liveRate = target;
      src.rate = target;
      audio().setRate(target);
      flog(`trượt tốc độ xong → ${target}x`);
      done?.();
    }
  }, STEP);
}

// Mở bản mới của bài ở tốc độ hiện tại rồi hoà dần sang (~0,6s): bản cũ nhỏ dần, bản mới to dần
async function crossfadeSource() {
  const c = ctx;
  const old = source;
  const id = curId;
  if (!c || !old || !id || old.id !== id) {
    reopen();
    return;
  }
  try {
    const uri = await fileFor(id);
    const s = streamSource(c, id, uri);
    if (!s || curId !== id) {
      s?.close();
      reopen();
      return;
    }
    const FADE = 0.6;
    const t0 = c.currentTime;
    s.gain.gain.setValueAtTime(0, t0);
    s.play(expected());
    s.gain.gain.linearRampToValueAtTime(1, t0 + FADE);
    old.gain.gain.cancelScheduledValues(t0);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t0);
    old.gain.gain.linearRampToValueAtTime(0, t0 + FADE);
    source = s;
    stuck = { p: -1, at: Date.now() };
    setTimeout(() => old.close(), FADE * 1000 + 200);
  } catch (e) {
    flog(`crossfade lỗi: ${String(e)}`);
    reopen();
  }
}
export function useFxSpeed(): FxSpeed {
  return useSyncExternalStore(
    (l) => {
      modeListeners.add(l);
      return () => {
        modeListeners.delete(l);
      };
    },
    () => speed
  );
}

export function getFxMode() {
  return mode;
}
export function setFxMode(m: FxMode) {
  if (m !== 'off' && !fxSupported()) {
    showToast('fx.needBuild');
    return;
  }
  if (m === mode) return;
  const wasOn = engineOn();
  mode = m;
  AsyncStorage.setItem(MODE_KEY, m).catch(() => {});
  modeListeners.forEach((l) => l());
  // Đổi chế độ do người dùng bấm: nhạc nhỏ xuống một chút, đổi, rồi to dần lên trong ~1,5 giây
  // (vào 8D thì tiếng còn từ từ lan dần ra hai bên tai)
  const live = wasOn && mix > 0.5 && !!source && source.id === curId;
  if (!live) {
    // Đang nghe tiếng thường (chưa có bộ hiệu ứng chạy): bật lên thì đợi bộ hiệu ứng sẵn sàng rồi mới nhỏ xuống - to lên
    swellNext = engineOn();
    transTok++; // huỷ lần nhỏ xuống - to lên đang dở (nếu có) và trả âm lượng về bình thường
    if (duck !== 1) rampDuck(1, 0.5);
    applyMode();
    return;
  }
  // Đang nghe qua bộ hiệu ứng: morph sang chế độ mới (tắt hẳn về Bình thường thì vẫn chuyển êm về trình phát chính)
  if (!engineOn()) {
    transition(() => applyMode(true));
    return;
  }
  applyMode();
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

// ---------- Nhật ký (để dò lỗi "đang nghe thì mất tiếng") ----------
// Ghi lại trạng thái bộ hiệu ứng khoảng 2 giây một lần + các sự kiện; người dùng gửi từ bảng Chế độ âm thanh
const LOG: string[] = [];
export function flog(msg: string, tag: 'fx' | 'music' = 'fx') {
  const d = new Date();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  LOG.push(`${hh}:${mm}:${ss} [${AppState.currentState}] ${msg}`);
  if (LOG.length > 400) LOG.shift();
  appLog(tag, msg);
}
export const fxLogText = () => LOG.join('\n');
AppState.addEventListener('change', (st) => {
  flog(`app → ${st}; mode=${mode} ctx=${ctx?.state ?? '-'}`);
  if (st !== 'active' && engineOn() && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
});

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
  if (!id || !engineOn() || !fxSupported()) return;
  // Đợi file bài đang nghe tải xong rồi mới tải bài sau (tải cùng lúc dễ làm nghẽn mạng của trình phát chính)
  setTimeout(async () => {
    const cur = curId ? filePending.get(curId) : undefined;
    if (cur) await cur.catch(() => {});
    if (engineOn()) fileFor(id).catch(() => {});
  }, 4000);
}

// ---------- Âm thanh ----------
let ctx: Ctx | null = null;
let input: Node | null = null; // nguồn → input → (chuỗi hiệu ứng) → master → duckNode → loa
let master: Node | null = null;
let duckNode: Node | null = null;
let chain: { key: string; exit: Node; stop: () => void } | null = null;
const chainKey = () => `${mode}|${reverbOn() ? 'reverb' : ''}`;

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

function buildChain(c: Ctx, m: FxMode, reverb: boolean, startGain = 1) {
  // Mỗi chuỗi có cổng vào / ra riêng: hai chuỗi chạy chồng lên nhau được trong lúc chuyển chế độ (morph)
  const entry = c.createGain();
  const exit = c.createGain();
  exit.gain.value = startGain;
  input!.connect(entry);
  exit.connect(master!);
  let inp: Node = entry;
  const out = exit;
  const nodes: { disconnect: () => void }[] = [];
  const sources: { stop: (when?: number) => void }[] = [];
  const keep = <T extends { disconnect: () => void }>(n: T) => (nodes.push(n), n);

  // Slowed + reverb: tầng vang dài, ấm (đuôi vang tối) đặt trước chế độ âm thanh
  if (reverb) {
    const stage = keep(c.createGain());
    const dry = keep(c.createGain());
    dry.gain.value = 0.72;
    entry.connect(dry);
    dry.connect(stage);
    const pre = keep(c.createDelay(0.2));
    pre.delayTime.value = 0.045;
    const verb = keep(c.createConvolver());
    verb.buffer = impulse(c, 3.2, 0.35, 0.95);
    const tone = keep(c.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    const wet = keep(c.createGain());
    wet.gain.value = 0.5;
    entry.connect(pre);
    pre.connect(verb);
    verb.connect(tone);
    tone.connect(wet);
    wet.connect(stage);
    inp = stage;
  }

  if (m === '8d') {
    // Tiếng chạy vòng quanh đầu (khoảng 9 giây một vòng):
    //  - trái ↔ phải: StereoPanner lắc theo sóng sin
    //  - lúc vòng ra sau đầu: chuyển dần sang một nhánh đã lọc bớt tiếng cao (đục, nhỏ hơn), theo sóng cos (lệch 1/4 vòng).
    //    Bộ lọc đứng yên, chỉ đổi âm lượng giữa hai nhánh. (Bản trước kéo tần số bộ lọc liên tục → tiếng bị rè)
    //  - thêm chút vang phòng nhỏ cho có không gian
    //  - tổng âm lượng luôn dưới mức tối đa một khoảng (không bị vỡ tiếng ở đoạn nhạc to)
    const RATE = 1 / 9;
    const pan = keep(c.createStereoPanner());
    const sin = c.createOscillator();
    sin.frequency.value = RATE;
    const panDepth = keep(c.createGain());
    // Lan dần ra hai bên tai: độ xoay tăng từ 0 lên hết trong ~2,5 giây
    panDepth.gain.setValueAtTime(0, c.currentTime);
    panDepth.gain.linearRampToValueAtTime(0.9, c.currentTime + 2.5);
    sin.connect(panDepth);
    panDepth.connect(pan.pan);

    // Nhánh trước mặt (trong) và nhánh sau đầu (đục)
    const front = keep(c.createGain());
    const back = keep(c.createGain());
    const lp = keep(c.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    lp.Q.value = 0.6;
    front.gain.value = 0.42; // 0.42 ± 0.4 → 0.82 (trước) .. 0.02 (sau)
    back.gain.value = 0.32; // 0.32 ∓ 0.3 → 0.02 (trước) .. 0.62 (sau)
    const cos = c.createOscillator();
    cos.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
    cos.frequency.value = RATE;
    const fDepth = keep(c.createGain());
    fDepth.gain.value = 0.4;
    const bDepth = keep(c.createGain());
    bDepth.gain.value = -0.3;
    cos.connect(fDepth);
    fDepth.connect(front.gain);
    cos.connect(bDepth);
    bDepth.connect(back.gain);
    keep(sin);
    keep(cos);
    sources.push(sin, cos);
    sin.start();
    cos.start();

    const mixBus = keep(c.createGain());
    mixBus.gain.value = 1;
    inp.connect(pan);
    pan.connect(front);
    pan.connect(lp);
    lp.connect(back);
    front.connect(mixBus);
    back.connect(mixBus);
    mixBus.connect(out);

    const room = keep(c.createConvolver());
    room.buffer = impulse(c, 0.8, 0.3, 0.75);
    const wet = keep(c.createGain());
    wet.gain.value = 0.12;
    mixBus.connect(room);
    room.connect(wet);
    wet.connect(out);
  } else if (m === 'hall') {
    // Khán phòng: tiếng gốc + tiếng vang dài ~2,4s, đến muộn hơn một chút (phòng lớn), tiếng vang hơi tối
    const dry = keep(c.createGain());
    dry.gain.value = 0.7; // chừa khoảng trống âm lượng cho tiếng vang cộng vào (không vỡ tiếng)
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
    wet.gain.value = 0.42;
    inp.connect(pre);
    pre.connect(hall);
    hall.connect(tone);
    tone.connect(wet);
    wet.connect(out);
  } else {
    inp.connect(out);
  }

  return {
    key: `${m}|${reverb ? 'reverb' : ''}`,
    exit,
    stop: () => {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      try {
        (input as any)?.disconnect(entry);
      } catch {}
      [entry, exit, inp].forEach((n) => {
        try {
          n.disconnect();
        } catch {}
      });
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
// Nguồn phát của bộ hiệu ứng. Ưu tiên ĐỌC DẦN file (giải mã từng đoạn khi phát, như thẻ <audio>): chỉ tốn vài MB.
// Trước đây giải mã cả bài vào bộ nhớ (~80-100MB một bài): chạy nền lâu, iPhone thấy app tốn RAM nên tắt luôn app
// → mất nhạc, mất cả trình phát trên Dynamic Island. Máy không đọc dần được định dạng này thì mới giải mã cả bài như cũ
interface FxSource {
  id: string;
  rate: number; // tốc độ nguồn đang chạy
  gain: Node; // âm lượng riêng của nguồn (để hoà hai nguồn khi crossfade)
  setRate(r: number): boolean; // đổi tốc độ ngay khi đang phát; false = không đổi được
  playing: boolean;
  pos(): number; // vị trí đang phát trong bài (giây)
  ended(): boolean; // đã phát tới cuối file (nguồn đọc dần hết file thì không tua / phát lại được nữa, phải mở lại)
  play(at: number): void; // phát từ vị trí at
  pause(): void;
  close(): void;
}

function streamSource(c: Ctx, id: string, uri: string): FxSource | null {
  const A = lib();
  if (!A || !input) return null;
  let path = uri.replace(/^file:\/\//, '');
  try {
    path = decodeURI(path);
  } catch {}
  const r = liveRate;
  const node: any = (c as any).context?.createFileSource?.({ source: path, loop: false, volume: 1, playbackRate: r, preservesPitch: false });
  if (!node) return null;
  // Đưa nguồn vào chuỗi hiệu ứng (không thì thư viện tự nối thẳng ra loa)
  const media = new A.MediaElementAudioSourceNode(c as any, { mediaElement: { getFileSourceNode: () => node } as any });
  const g = c.createGain();
  media.connect(g);
  g.connect(input);
  const src: FxSource = {
    id,
    rate: r,
    gain: g,
    setRate(v) {
      try {
        node.playbackRate = v;
        return Math.abs((node.playbackRate ?? v) - v) < 0.01;
      } catch {
        return false;
      }
    },
    playing: false,
    pos: () => (typeof node.currentTime === 'number' ? node.currentTime : -1),
    ended: () => typeof node.duration === 'number' && node.duration > 0 && node.currentTime >= node.duration - 0.3,
    play(at) {
      try {
        node.seekToTime(Math.max(0, at));
        node.start(c.currentTime);
        (c as any).markRunningOnSourceStart?.();
        src.playing = true;
      } catch (e) {
        console.warn('[fx] play', e);
      }
    },
    pause() {
      try {
        node.pause();
      } catch {}
      src.playing = false;
    },
    close() {
      src.pause();
      try {
        media.disconnect();
      } catch {}
      try {
        g.disconnect();
      } catch {}
      try {
        node.onended = '0';
        node.disconnect(undefined);
      } catch {}
    },
  };
  return src;
}

// Dự phòng: giải mã cả bài vào bộ nhớ (cách cũ)
async function bufferSource(c: Ctx, id: string, uri: string): Promise<FxSource> {
  const A = lib()!;
  const buffer: Buf = await A.decodeAudioData(uri);
  const r = liveRate;
  const g = c.createGain();
  g.connect(input!);
  let node: Src | null = null;
  let start = 0; // ctx.currentTime lúc bắt đầu
  let offset = 0; // vị trí trong bài lúc đó
  const stopNode = () => {
    if (!node) return;
    try {
      node.stop();
    } catch {}
    try {
      node.disconnect();
    } catch {}
    node = null;
  };
  const src: FxSource = {
    id,
    rate: r,
    gain: g,
    setRate: () => false, // nguồn giải mã cả bài: đổi tốc độ bằng cách mở lại (crossfade)
    playing: false,
    pos: () => (node ? offset + (c.currentTime - start) * r : -1),
    ended: () => !!node && offset + (c.currentTime - start) * r >= buffer.duration - 0.3,
    play(at) {
      stopNode();
      if (!input || at >= buffer.duration - 0.05) return;
      const n = c.createBufferSource();
      n.buffer = buffer;
      n.playbackRate.value = r; // đổi cả tốc độ lẫn cao độ
      n.connect(g);
      const when = c.currentTime + 0.03;
      n.start(when, Math.max(0, at + 0.03 * r));
      node = n;
      start = when;
      offset = Math.max(0, at + 0.03 * r);
      src.playing = true;
    },
    pause() {
      stopNode();
      src.playing = false;
    },
    close() {
      stopNode();
      try {
        g.disconnect();
      } catch {}
    },
  };
  return src;
}

let curId: string | null = null; // bài trình phát chính đang phát
let source: FxSource | null = null; // nguồn đã sẵn sàng (đúng bài curId thì mới dùng)
let loadToken = 0;
let failedId: string | null = null;
let driftCount = 0;
let stuck = { p: -1, at: 0 }; // vị trí nguồn hiệu ứng lần cuối còn nhích
let deadSince = 0;
let lastLog = 0; // lúc bộ âm thanh bắt đầu không chạy (0 = đang chạy bình thường)
let last = { playing: false, time: 0, at: 0 };
let lastSeekAt = 0;
let lastLagLog = 0; // lần báo gần nhất của trình phát chính

// Vị trí trong bài lúc này theo trình phát chính (đang đổi tốc độ thì thời gian trong bài chạy nhanh / chậm hơn đồng hồ)
const expected = () => (last.playing ? last.time + ((Date.now() - last.at) / 1000) * liveRate : last.time);

function dropSource() {
  source?.close();
  source = null;
}

async function loadTrack(id: string) {
  const token = ++loadToken;
  const c = context();
  if (!c) return;
  try {
    const uri = await fileFor(id);
    if (token !== loadToken) return;
    let s: FxSource | null = null;
    try {
      s = streamSource(c, id, uri);
    } catch (e) {
      console.warn('[fx] stream', e);
      flog(`stream lỗi: ${String(e)}`);
    }
    flog(`mở bài ${id} bằng ${s ? 'stream' : 'buffer'}`);
    if (!s) {
      // Giải mã cả bài vào RAM chỉ dùng cho bài ngắn, khi app đang mở. Bài dài (mix 1-2 tiếng) mà giải mã cả bài thì
      // tốn hàng GB RAM và chặn luồng JS cả phút → iOS tắt app (cpu_resource_fatal). Không được thì nghe tiếng thường
      const dur = lastDuration;
      if (AppState.currentState !== 'active' || !(dur > 0) || dur > 600) {
        throw new Error(`không giải mã cả bài (${AppState.currentState}, dài ${Math.round(dur)}s)`);
      }
      flushLog();
      s = await bufferSource(c, id, uri);
    }
    if (token !== loadToken) {
      s.close();
      return;
    }
    dropSource();
    source = s;
    sync(true);
  } catch (e) {
    if (token !== loadToken) return;
    console.warn('[fx] không dựng được bài', id, e);
    flog(`không dựng được bài ${id}: ${String(e)}`);
    if (failedId !== id) showToast('fx.trackFail');
    failedId = id;
  }
}

// Đặt lại toàn bộ theo chế độ hiện tại
// instant: đổi ngay (không morph)
function applyMode(instant = false) {
  if (!engineOn()) {
    wantMix = 0;
    setMix(0, instant ? 0.05 : 0.35);
    const c = ctx;
    setTimeout(() => {
      if (engineOn()) return;
      dropSource();
      chain?.stop();
      chain = null;
      loadToken++;
      c?.suspend().catch(() => {});
    }, 450);
    return;
  }
  const c = context();
  if (!c) return;
  if (chain?.key !== chainKey()) {
    const old = chain;
    const live = !!old && mix > 0.5 && !!source && source.id === curId && last.playing && !instant;
    if (old && live) {
      // Morph: chuỗi cũ tan dần, chuỗi mới hiện dần (~1,2s). 8D lan dần ra hai tai, đuôi vang cũ nhỏ dần chứ không bị cắt
      const MORPH = 1.2;
      const nw = buildChain(c, mode, reverbOn(), 0);
      const t0 = c.currentTime;
      old.exit.gain.cancelScheduledValues(t0);
      old.exit.gain.setValueAtTime(old.exit.gain.value, t0);
      old.exit.gain.linearRampToValueAtTime(0, t0 + MORPH);
      nw.exit.gain.setValueAtTime(0, t0);
      nw.exit.gain.linearRampToValueAtTime(1, t0 + MORPH);
      chain = nw;
      flog(`morph ${old.key} → ${nw.key}`);
      setTimeout(() => old.stop(), MORPH * 1000 + 300);
    } else {
      old?.stop();
      chain = buildChain(c, mode, reverbOn());
    }
  }
  if (curId && source?.id !== curId) loadTrack(curId);
  sync(true);
}

// Mở lại nguồn của bài đang phát (tiếng tạm về trình phát chính trong lúc mở)
// Giới hạn mở lại nguồn: quá 4 lần / phút cho cùng một bài thì thôi, nghe tiếng thường (tránh vòng lặp mở lại tốn CPU)
let reopenLog: number[] = [];
let reopenFor: string | null = null;
function reopen() {
  const now = Date.now();
  if (reopenFor !== curId) {
    reopenFor = curId;
    reopenLog = [];
  }
  reopenLog = reopenLog.filter((t) => now - t < 60000);
  reopenLog.push(now);
  if (reopenLog.length > 4 && curId) {
    flog('mở lại nguồn quá nhiều lần → tạm nghe tiếng thường cho bài này');
    flushLog();
    failedId = curId;
    loadToken++;
    dropSource();
    if (wantMix !== 0) {
      wantMix = 0;
      setMix(0, 0.2);
    }
    return;
  }
  if (wantMix !== 0) {
    wantMix = 0;
    setMix(0, 0.15);
  }
  dropSource();
  if (curId) loadTrack(curId);
}

// Đồng bộ với trình phát chính. force: chạy lại ngay cả khi không lệch
function sync(force = false) {
  bgStats.sync++;
  if (!engineOn()) return;
  const c = ctx;
  if (!c || !chain) return;
  const src = source && source.id === curId ? source : null;
  if (!src) {
    // Bài mới chưa sẵn: tiếng trả về trình phát chính, nguồn cũ tắt
    if (source?.playing) source.pause();
    stuck = { p: -1, at: Date.now() };
    if (wantMix !== 0) {
      wantMix = 0;
      setMix(0, 0.15);
    }
    return;
  }
  if (!last.playing) {
    // Dừng: chỉ dừng nguồn, KHÔNG tắt bộ âm thanh (tắt rồi bật lại khi app đang chạy nền có thể không lên tiếng nữa)
    if (src.playing) src.pause();
    deadSince = 0;
    stuck = { p: -1, at: Date.now() };
    return;
  }
  // Bộ âm thanh không chạy (bị hệ thống dừng khi chạy nền, có cuộc gọi...): thử bật lại; quá 1,5 giây vẫn không chạy
  // thì trả tiếng về trình phát chính cho khỏi im lặng, chạy lại được thì tự chuyển về hiệu ứng
  if (c.state !== 'running') {
    c.resume().catch((e) => flog(`resume lỗi: ${String(e)}`));
    if (!deadSince) {
      deadSince = Date.now();
      flog(`ctx không chạy: ${c.state}`);
    }
    if (Date.now() - deadSince > 1500 && wantMix !== 0) {
      flog('→ trả tiếng về trình phát chính (ctx không chạy)');
      wantMix = 0;
      setMix(0, 0.2);
    }
    stuck = { p: -1, at: Date.now() };
    return;
  }
  deadSince = 0;
  // Vừa đổi tốc độ: nguồn đang mở với tốc độ cũ → mở lại với tốc độ mới
  if (gliding) return; // đang trượt tốc độ: đừng tua (thời gian hai bên đang đổi cùng nhịp)
  if (Math.abs(src.rate - liveRate) > 0.001) {
    flog(`nguồn đang ở ${src.rate}x, cần ${liveRate}x → crossfade`);
    src.rate = liveRate; // tránh gọi lại liên tục trong lúc chờ
    crossfadeSource();
    return;
  }
  const want = expected();
  const now = Date.now();
  // Nguồn đã phát hết file mà trình phát chính quay lại đầu bài (lặp lại bài, tua lùi sau khi hết...): nguồn đọc dần
  // không tua lại được nữa → mở lại nguồn từ file (đã có sẵn trong máy, rất nhanh). Lúc mở lại tiếng tạm về trình phát chính
  if (src.ended() && want < src.pos() - 1) {
    flog(`nguồn đã hết file (pos=${src.pos().toFixed(1)}) mà nhạc ở ${want.toFixed(1)}s → mở lại nguồn`);
    reopen();
    return;
  }
  const drift = Math.abs(src.pos() - want);
  // Lệch xa (tua, lặp lại bài) thì theo ngay; lệch ít thì phải lệch 2 lần liền mới theo (tránh giật vì số báo về bị trễ).
  // Lúc app chạy nền số báo về thưa và trễ hơn → chỉ theo khi lệch hẳn (tua từ màn hình khoá), tránh tua tới tua lui làm mất tiếng
  const bg = AppState.currentState !== 'active';
  driftCount = drift > (bg ? 2.5 : 0.35) ? driftCount + 1 : 0;
  // Vừa tua xong thì chờ ~0,6s cho nguồn kịp nhảy tới chỗ mới (trước đây hết bài quay lại đầu là tua liền 4 lần)
  const settling = now - lastSeekAt < 600;
  // Nguồn tụt lại phía sau (máy bận, thiếu dữ liệu → tiếng rè / giật): kể cả khi app ở nền, tụt quá 1,5s là kéo lên ngay
  const lag = want - src.pos();
  const hard = bg ? drift > 4 || lag > 1.5 : drift > 1.5;
  if (src.playing && lag > 0.6 && now - lastLagLog > 3000) {
    lastLagLog = now;
    flog(`nguồn chạy chậm hơn nhạc ${lag.toFixed(2)}s (máy bận / thiếu dữ liệu)`);
  }
  if (!src.playing || force || ((hard || driftCount >= 2) && !settling)) {
    if (src.playing) flog(`tua lại: lệch ${drift.toFixed(2)}s`);
    driftCount = 0;
    lastSeekAt = now;
    src.play(want);
  }
  // Nguồn không nhích suốt 2,5 giây trong khi nhạc vẫn chạy (kể cả sau khi đã bảo nó phát / tua) → hỏng: mở lại nguồn.
  // (Bản trước mỗi lần tua lại là đặt lại mốc, nên nguồn kẹt cứng mà không bao giờ bị phát hiện)
  const p = src.pos();
  if (Math.abs(p - stuck.p) > 0.05) stuck = { p, at: now };
  else if (now - stuck.at > 2500) {
    flog(`nguồn đứng im ở ${p.toFixed(1)}s → mở lại nguồn`);
    stuck = { p, at: now };
    reopen();
    return;
  }
  if (now - lastLog > (bg ? 10000 : 2000)) { // app ở nền: ghi thưa hơn cho nhẹ máy
    lastLog = now;
    flog(`ctx=${c.state} t=${c.currentTime.toFixed(1)} pos=${p.toFixed(1)} want=${want.toFixed(1)} mix=${mix.toFixed(2)} duck=${duck.toFixed(2)} vol=${audio().getUserVolume().toFixed(2)}`);
  }
  if (wantMix !== 1) {
    flog('→ chuyển sang bộ hiệu ứng');
    wantMix = 1;
    if (swellNext) {
      // Vừa bật chế độ: nhỏ xuống, chuyển sang bộ hiệu ứng, to dần lên
      swellNext = false;
      transition(() => setMix(1, 0.05));
    } else setMix(1, 0.6); // sang bài mới: chuyển êm sang bộ hiệu ứng
  }
}

// Gọi mỗi lần trình phát chính báo trạng thái (PlayerProvider)
let waitId: string | null = null; // bài đang chờ bấm phát mới mở
let lastDuration = 0; // độ dài bài đang phát (giây), theo trình phát chính
export function fxTick(id: string | null, playing: boolean, time: number, duration = 0) {
  last = { playing, time, at: Date.now() };
  if (duration > 0) lastDuration = duration;
  else if (id !== curId) lastDuration = 0;
  const changed = id !== curId;
  curId = id;
  if (!engineOn() || !fxSupported()) return;
  if (changed && id && source?.id !== id) dropSource(); // bỏ bài cũ trước khi mở bài mới
  // Chưa phát thì chưa mở file / dựng bộ hiệu ứng (vừa mở app mà đã mở stream → khựng ~1s lúc khởi động)
  if (!playing && !chain) {
    if (id && source?.id !== id) waitId = id;
    return;
  }
  if (id && source?.id !== id && (changed || waitId === id)) {
    waitId = null;
    loadTrack(id);
  }
  if (!chain) applyMode();
  else sync();
}
