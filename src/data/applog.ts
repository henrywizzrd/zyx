import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { cacheDel, cacheGet, cacheSet } from './db';

// Nhật ký của app (Cài đặt → Nhật ký): ghi mọi thứ để dò lỗi khi đang dùng
//  - music: trình phát chính (trạng thái, đứng im, hết bài, tải lại link)
//  - fx: chế độ âm thanh 8D / hội trường
//  - error: lỗi JS, console.error / console.warn
//  - jank: luồng JS hoặc luồng giao diện bị khựng
//  - swipe: vuốt quay lại từ cạnh trái
//  - ui: mở / đóng trang, đổi tab, app vào nền / quay lại
// Kept per day for 14 days (see Day store below), saved every few seconds and right away on errors / jank / going to the background.
//  - perf: tóm tắt hiệu năng định kỳ (fps, khung rớt, JS trễ, bộ nhớ) kèm màn đang xem + theme / hiệu ứng / kính
export type LogTag = 'music' | 'fx' | 'error' | 'jank' | 'swipe' | 'ui' | 'motion' | 'perf';
export interface LogLine { t: number; tag: LogTag; msg: string; bg?: boolean }

const KEY = 'applog:v1';
const ALIVE = 'applog:alive';
const MAX = 1000;
let lines: LogLine[] | null = null;
let ver = 0;
const subs = new Set<() => void>();

// ---------- Day store ----------
// The log is kept per day for KEEP_DAYS days (Settings › Log shows one entry per day). Each day is stored in chunks of
// CHUNK lines and only the newest chunk is rewritten on save, so saving every few seconds stays cheap.
// `lines` is the in-memory list of the most recent MAX lines (across days) used by the black box and Sentry.
const DAYS_KEY = 'applog:days:v1';
const CHUNK = 500;
export const KEEP_DAYS = 14;
export interface DayMeta { day: string; chunks: number; lines: number; errors: number; jank: number; crashes: number; crashAt?: number[] }
let days: Record<string, DayMeta> | null = null;
let pending: LogLine[] = [];
let tail: { day: string; idx: number; arr: LogLine[] } | null = null; // newest chunk, kept in memory

const p2 = (n: number) => `${n}`.padStart(2, '0');
export function dayOf(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
const chunkKey = (day: string, i: number) => `applog:d:${day}:${i}`;

function loadDays(): Record<string, DayMeta> {
  if (days) return days;
  try {
    days = cacheGet<Record<string, DayMeta>>(DAYS_KEY)?.value ?? {};
  } catch {
    days = {};
  }
  // one-time move of the old single list (before logs were kept per day)
  try {
    const old = cacheGet<LogLine[]>(KEY)?.value;
    if (old?.length) {
      pending = old.concat(pending);
      persistPending();
    }
    if (old) cacheDel(KEY);
  } catch {}
  pruneDays();
  return days;
}

function pruneDays() {
  if (!days) return;
  const keep = new Set(Array.from({ length: KEEP_DAYS }, (_, i) => dayOf(Date.now() - i * 86400000)));
  let changedDays = false;
  for (const d of Object.keys(days)) {
    if (keep.has(d)) continue;
    for (let i = 0; i < days[d].chunks; i++) cacheDel(chunkKey(d, i));
    delete days[d];
    changedDays = true;
  }
  if (changedDays) cacheSet(DAYS_KEY, days);
}

function persistPending() {
  if (!pending.length || !days) return;
  const batch = pending;
  pending = [];
  for (const l of batch) {
    const day = dayOf(l.t);
    const m = (days[day] ??= { day, chunks: 0, lines: 0, errors: 0, jank: 0, crashes: 0 });
    if (!tail || tail.day !== day) {
      if (tail) cacheSet(chunkKey(tail.day, tail.idx), tail.arr); // the day changed (midnight): save the old day's chunk
      const idx = Math.max(m.chunks - 1, 0);
      tail = { day, idx, arr: m.chunks ? cacheGet<LogLine[]>(chunkKey(day, idx))?.value ?? [] : [] };
    }
    if (tail.arr.length >= CHUNK) {
      cacheSet(chunkKey(day, tail.idx), tail.arr);
      tail = { day, idx: tail.idx + 1, arr: [] };
    }
    tail.arr.push(l);
    m.chunks = Math.max(m.chunks, tail.idx + 1);
    m.lines++;
    if (l.tag === 'error') m.errors++;
    if (l.tag === 'jank') m.jank++;
  }
  if (tail) cacheSet(chunkKey(tail.day, tail.idx), tail.arr);
  cacheSet(DAYS_KEY, days);
}

function load(): LogLine[] {
  if (!lines) {
    lines = [];
    try {
      const ds = loadDays();
      // the newest MAX lines, from the newest days backwards
      const order = Object.keys(ds).sort().reverse();
      const out: LogLine[][] = [];
      let n = 0;
      for (const d of order) {
        for (let i = ds[d].chunks - 1; i >= 0 && n < MAX; i--) {
          const c = cacheGet<LogLine[]>(chunkKey(d, i))?.value ?? [];
          out.unshift(c);
          n += c.length;
        }
        if (n >= MAX) break;
      }
      lines = out.flat().slice(-MAX);
    } catch {
      lines = [];
    }
  }
  return lines;
}

export function flushLog() {
  if (!pending.length) return;
  try {
    loadDays();
    persistPending();
  } catch {}
}

// Days that have a log, newest first (for Settings › Log)
export function listLogDays(): DayMeta[] {
  const ds = loadDays();
  flushLog();
  return Object.values(ds).sort((a, b) => (a.day < b.day ? 1 : -1));
}

// Every line of one day, oldest first
export function getDayLines(day: string): LogLine[] {
  const ds = loadDays();
  flushLog();
  const m = ds[day];
  if (!m) return [];
  const out: LogLine[] = [];
  for (let i = 0; i < m.chunks; i++) out.push(...(cacheGet<LogLine[]>(chunkKey(day, i))?.value ?? []));
  return out;
}

// The black box found that the run which logged its last line at `t` crashed / was killed
export function markCrash(t: number) {
  const ds = loadDays();
  const day = dayOf(t);
  const m = (ds[day] ??= { day, chunks: 0, lines: 0, errors: 0, jank: 0, crashes: 0 });
  m.crashes++;
  m.crashAt = [...(m.crashAt ?? []), t].slice(-20);
  cacheSet(DAYS_KEY, ds);
  ver++;
  subs.forEach((f) => f());
}

let notifyQueued = false;
function notify() {
  ver++;
  // App ở nền: màn Nhật ký không cần vẽ lại (quay lại app sẽ vẽ một lần)
  if (notifyQueued || AppState.currentState !== 'active') return;
  notifyQueued = true;
  // gộp nhiều dòng liền nhau thành một lần vẽ lại màn hình Nhật ký
  setTimeout(() => {
    notifyQueued = false;
    subs.forEach((f) => f());
  }, 250);
}

// Đếm việc app làm (để dò "tốn CPU khi ở nền")
export const bgStats = { status: 0, sync: 0, raf: 0, logs: 0, renders: 0 };

// ---- Dấu vết "việc vừa chạy" (để biết thủ phạm khi luồng JS khựng lâu): mỗi dòng nhật ký, mỗi lần một màn vẽ lại, và vài
// việc nặng tự đánh dấu bằng crumb() (tìm lời, đọc trang YouTube...). Khựng thì ghi kèm các dấu vết rơi vào khoảng khựng đó
const crumbs: { t: number; s: string }[] = [];
export function crumb(s: string) {
  crumbs.push({ t: performance.now(), s });
  if (crumbs.length > 60) crumbs.shift();
}
function crumbsWithin(ms: number) {
  const now = performance.now();
  const list = crumbs.filter((c) => now - c.t <= ms + 300).slice(-8);
  return list.length ? ` · việc vừa chạy: ${list.map((c) => `${c.s} (${Math.round(now - c.t)}ms trước)`).join(', ')}` : ' · không có dấu vết việc nào';
}

export function log(tag: LogTag, msg: string) {
  crumb(`[${tag}] ${msg.length > 48 ? `${msg.slice(0, 48)}…` : msg}`);
  bgStats.logs++;
  const arr = load();
  const line: LogLine = { t: Date.now(), tag, msg, bg: AppState.currentState !== 'active' || undefined };
  arr.push(line);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
  pending.push(line);
  // Lỗi, hoặc app đang ở nền: lưu ngay. App bị iOS tắt ở nền thì không kịp lần lưu 5 giây sau → mất đúng mấy dòng cuối
  // (vụ 14/11 20:46: app chết ~1 giây sau khi xuống nền, nhật ký không còn dòng nào kể chuyện gì xảy ra)
  if (tag === 'error' || tag === 'jank' || AppState.currentState !== 'active') flushLog();
  notify();
  // black box: warning signs send a log snapshot right away (see blackbox.ts)
  // Not while the app is in the background or just switching: the OS pauses the app there, which only looks like a freeze
  if (tag === 'jank' && !line.bg && line.t - lastStateChange > 3000) {
    const ms = Number(/(\d+)ms/.exec(msg)?.[1] ?? 0);
    if (ms >= 2000) blackBox()?.blackBoxSnapshot('freeze', msg);
  }
  // Chép ra nhật ký hệ thống (Android: logcat) để máy kiểm tra tự động trên GitHub đọc được
  if (tag !== 'music' && tag !== 'fx') console.log(`[zyx][${tag}] ${msg}`);
}

export function clearLog() {
  const ds = loadDays();
  for (const d of Object.keys(ds)) for (let i = 0; i < ds[d].chunks; i++) cacheDel(chunkKey(d, i));
  days = {};
  tail = null;
  pending = [];
  cacheSet(DAYS_KEY, days);
  lines = [];
  notify();
}

export function getLog(): LogLine[] {
  return load();
}

export function useLog(): LogLine[] {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ver
  );
  return load();
}

const pad = (n: number, w = 2) => `${n}`.padStart(w, '0');
export function fmtTime(t: number) {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
export function logToText(arr: LogLine[]) {
  return arr.map((l) => `${fmtTime(l.t)} [${l.tag}]${l.bg ? ' (nền)' : ''} ${l.msg}`).join('\n');
}

// lazy require: blackbox imports this file
let lastStateChange = 0; // when the app last went to / came back from the background
function blackBox(): typeof import('./blackbox') | null {
  try {
    return require('./blackbox') as typeof import('./blackbox');
  } catch {
    return null;
  }
}

// The previous run's log lines (everything after the previous "— mở app" marker), read before this run logs anything
export let previousSession: LogLine[] = [];

// ---------- Tự bắt lỗi, cảnh báo, khựng ----------
let installed = false;
export function installAppLog() {
  if (installed || Platform.OS === 'web') return;
  installed = true;
  const ver0 = (() => {
    try {
      const U = require('expo-updates') as typeof import('expo-updates');
      return U.updateId ? `bản ${U.updateId.slice(0, 8)}` : 'bản gốc';
    } catch {
      return '';
    }
  })();
  // Lần trước app còn sống tới lúc nào: app bị hệ thống tắt / văng (lỗi native, không kịp ghi gì) thì
  // dòng này cho biết nó chết lúc nào và khoảng cách tới dòng cuối cùng của lần trước
  let lastAlive: number | null = null;
  try {
    lastAlive = cacheGet<number>(ALIVE)?.value ?? null;
  } catch {}
  try {
    const prev = load();
    let start = 0;
    for (let i = prev.length - 1; i >= 0; i--) if (prev[i].msg.startsWith('— mở app')) { start = i; break; }
    previousSession = prev.slice(start);
  } catch {}
  log('ui', `— mở app ${ver0} (${Platform.OS} ${Platform.Version}) —${lastAlive ? ` lần trước còn chạy tới ${fmtTime(lastAlive)}` : ''}`);

  // Lưu định kỳ + đánh dấu "còn sống" (chạy cả khi app ở nền mà đang phát nhạc)
  setInterval(() => {
    flushLog(); // every 3 s: the black box keeps at most ~3 s of ordinary lines unsaved when the app dies
    try {
      cacheSet(ALIVE, Date.now());
    } catch {}
  }, 3000);

  // App vào nền / quay lại
  AppState.addEventListener('change', (st) => {
    lastStateChange = Date.now();
    log('ui', `app → ${st}`);
    if (st !== 'active') flushLog();
  });
  // iOS báo sắp hết bộ nhớ: nếu ngay sau dòng này app bị tắt / mở lại từ đầu → bị tắt vì tốn RAM, không phải lỗi code
  AppState.addEventListener('memoryWarning', () => {
    log('error', 'cảnh báo: iOS báo app sắp hết bộ nhớ (RAM)');
    blackBox()?.blackBoxSnapshot('memory', 'iOS low-memory warning');
  });

  // Lỗi JS chưa bắt (kể cả lỗi làm app tắt): ghi + lưu ngay rồi để RN xử lý như cũ
  const EU = (globalThis as any).ErrorUtils;
  if (EU?.getGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e: any, fatal?: boolean) => {
      try {
        log('error', `${fatal ? 'LỖI NẶNG (app tắt)' : 'lỗi'}: ${e?.message ?? e}\n${String(e?.stack ?? '').split('\n').slice(0, 6).join('\n')}`);
        flushLog();
        if (fatal) blackBox()?.blackBoxSnapshot('fatal', String(e?.message ?? e));
      } catch {}
      prev?.(e, fatal);
    });
  }

  // console.error / console.warn
  const wrap = (k: 'error' | 'warn') => {
    const orig = console[k].bind(console);
    console[k] = (...a: any[]) => {
      try {
        const msg = a.map((x) => (x instanceof Error ? `${x.message}` : typeof x === 'string' ? x : safeJson(x))).join(' ');
        // youtubei.js báo "gặp loại dữ liệu mới của YouTube" (vô hại, nó tự xử lý) — không ghi, đỡ rối nhật ký
        if (msg.includes('[YOUTUBEJS][Parser]')) return orig(...a);
        log('error', `${k === 'warn' ? 'cảnh báo' : 'console.error'}: ${msg.slice(0, 500)}`);
      } catch {}
      orig(...a);
    };
  };
  wrap('error');
  wrap('warn');

  // Khựng luồng JS: đo khoảng cách giữa các khung hình (requestAnimationFrame). CHỈ chạy khi app đang mở:
  // ở nền, React Native vẫn gọi requestAnimationFrame liên tục bằng bộ hẹn giờ → tốn CPU vô ích
  let last = 0;
  let rafOn = false;
  rafLoopOn = () => rafOn;
  const loop = (now: number) => {
    if (AppState.currentState !== 'active') {
      rafOn = false;
      last = 0;
      return;
    }
    bgStats.raf++;
    rafAt = Date.now();
    if (last) {
      const gap = now - last;
      if (gap > 150 && !justResumed()) log('jank', `luồng JS khựng ${Math.round(gap)}ms${ctx ? ` · ${ctx}` : ''}${gap > 400 ? crumbsWithin(gap) : ''}`);
    }
    last = now;
    requestAnimationFrame(loop);
  };
  const startRaf = () => {
    if (rafOn) return;
    rafOn = true;
    last = 0;
    requestAnimationFrame(loop);
  };
  startRaf();
  AppState.addEventListener('change', (st) => {
    if (st === 'active') {
      startRaf();
      // quay lại app: vẽ lại màn Nhật ký một lần
      ver++;
      subs.forEach((f) => f());
    }
  });

  // Ở nền: cứ 20 giây ghi một dòng thống kê việc app đang làm + độ trễ bộ hẹn giờ (trễ nhiều = luồng JS đang bận)
  let lastTick = Date.now();
  let lateSum = 0;
  let ticks = 0;
  setInterval(() => {
    const now = Date.now();
    lateSum += Math.max(0, now - lastTick - 1000);
    lastTick = now;
    ticks++;
    if (ticks < 20) return;
    if (AppState.currentState !== 'active') {
      log('ui', `nền 20s: trễ hẹn giờ ${lateSum}ms, trạng thái nhạc ${bgStats.status}, đồng bộ fx ${bgStats.sync}, khung JS ${bgStats.raf}, ghi log ${bgStats.logs}, vẽ lại player ${bgStats.renders}`);
    }
    ticks = 0;
    lateSum = 0;
    bgStats.status = bgStats.sync = bgStats.raf = bgStats.logs = bgStats.renders = 0;
  }, 1000);
}

function safeJson(x: unknown) {
  try {
    return JSON.stringify(x)?.slice(0, 300) ?? String(x);
  } catch {
    return String(x);
  }
}

// Vừa mở app / vừa quay lại từ nền: khung hình đầu tiên luôn cách xa khung trước → không phải giật
let activeAt = Date.now();
AppState.addEventListener('change', (st) => {
  if (st === 'active') activeAt = Date.now();
});
export const justResumed = () => Date.now() - activeAt < 1200;

// Đang ở đâu (tab / trang) — gắn kèm dòng khựng để biết khựng ở màn hình nào
let ctx = '';
export function setLogContext(c: string) {
  if (c === ctx) return;
  ctx = c;
  log('ui', `đang ở: ${c}`);
}
export const getLogContext = () => ctx;

// Touch probe (28/11, Tyson: after a Spotify import the Library "froze" while JS and the UI thread kept running).
// For a few minutes after armTouchProbe(), every touch that reaches the app is logged (at most one per 300ms), so the
// next log shows whether taps arrive at all (→ something swallowing them in JS) or not (→ a native layer on top)
let probeUntil = 0;
let lastProbe = 0;
export function armTouchProbe(ms: number, why: string) {
  probeUntil = Date.now() + ms;
  log('ui', `dò chạm bật ${Math.round(ms / 1000)}s: ${why}`);
}
export function noteTouch(x: number, y: number) {
  const now = Date.now();
  if (now > probeUntil || now - lastProbe < 300) return;
  lastProbe = now;
  log('ui', `chạm ${Math.round(x)},${Math.round(y)} · ${ctx}`);
}

// ---- Dò "khung hình JS ngừng chạy" (Tyson 21/11: mở lại player lúc đang thu về → đĩa + nền khói đứng im ~11 giây dù nhạc
// vẫn chạy). Log cho thấy lúc đó requestAnimationFrame / setTimeout của luồng JS KHÔNG chạy, nhưng sự kiện từ trình phát
// (báo giờ mỗi 0,5s) vẫn tới và màn hình vẫn vẽ lại → các việc chờ hẹn giờ (bật xoay đĩa, chạy khói...) bị treo tới lần chạm sau.
// Trình phát gọi hàm này mỗi lần báo giờ: khung hình JS im quá 1,5s trong khi app đang mở → ghi 1 dòng (mỗi lần treo ghi 1 lần)
let rafAt = Date.now();
let rafLoopOn: () => boolean = () => false;
let stuckLogged = 0;
export function checkFrameLoop(src: string) {
  if (!rafLoopOn() || AppState.currentState !== 'active' || justResumed()) return;
  const gap = Date.now() - rafAt;
  if (gap < 1500) {
    stuckLogged = 0;
    return;
  }
  if (stuckLogged && rafAt <= stuckLogged) return;
  stuckLogged = Date.now();
  log('jank', `khung hình JS ngừng ${gap}ms (setTimeout / requestAnimationFrame không chạy) trong khi ${src} vẫn chạy${getLogContext() ? ` · ${getLogContext()}` : ''}${crumbsWithin(gap)}`);
}
