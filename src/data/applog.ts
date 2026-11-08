import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { cacheGet, cacheSet } from './db';

// Nhật ký của app (Cài đặt → Nhật ký): ghi mọi thứ để dò lỗi khi đang dùng
//  - music: trình phát chính (trạng thái, đứng im, hết bài, tải lại link)
//  - fx: chế độ âm thanh 8D / hội trường
//  - error: lỗi JS, console.error / console.warn
//  - jank: luồng JS hoặc luồng giao diện bị khựng
//  - swipe: vuốt quay lại từ cạnh trái
//  - ui: mở / đóng trang, đổi tab, app vào nền / quay lại
// Giữ 1000 dòng gần nhất, lưu xuống máy vài giây một lần (và ngay khi có lỗi / app vào nền) nên còn sau khi tắt app.
export type LogTag = 'music' | 'fx' | 'error' | 'jank' | 'swipe' | 'ui';
export interface LogLine { t: number; tag: LogTag; msg: string; bg?: boolean }

const KEY = 'applog:v1';
const ALIVE = 'applog:alive';
const MAX = 1000;
let lines: LogLine[] | null = null;
let dirty = false;
let ver = 0;
const subs = new Set<() => void>();

function load(): LogLine[] {
  if (!lines) {
    try {
      lines = cacheGet<LogLine[]>(KEY)?.value ?? [];
    } catch {
      lines = [];
    }
  }
  return lines;
}

export function flushLog() {
  if (!dirty || !lines) return;
  dirty = false;
  try {
    cacheSet(KEY, lines); // ghi thẳng, không báo màn hình vẽ lại như kvSet
  } catch {}
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

export function log(tag: LogTag, msg: string) {
  bgStats.logs++;
  const arr = load();
  arr.push({ t: Date.now(), tag, msg, bg: AppState.currentState !== 'active' || undefined });
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
  dirty = true;
  if (tag === 'error') flushLog();
  notify();
}

export function clearLog() {
  lines = [];
  dirty = true;
  flushLog();
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
  log('ui', `— mở app ${ver0} (${Platform.OS} ${Platform.Version}) —${lastAlive ? ` lần trước còn chạy tới ${fmtTime(lastAlive)}` : ''}`);

  // Lưu định kỳ + đánh dấu "còn sống" (chạy cả khi app ở nền mà đang phát nhạc)
  setInterval(() => {
    flushLog();
    try {
      cacheSet(ALIVE, Date.now());
    } catch {}
  }, 5000);

  // App vào nền / quay lại
  AppState.addEventListener('change', (st) => {
    log('ui', `app → ${st}`);
    if (st !== 'active') flushLog();
  });

  // Lỗi JS chưa bắt (kể cả lỗi làm app tắt): ghi + lưu ngay rồi để RN xử lý như cũ
  const EU = (globalThis as any).ErrorUtils;
  if (EU?.getGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e: any, fatal?: boolean) => {
      try {
        log('error', `${fatal ? 'LỖI NẶNG (app tắt)' : 'lỗi'}: ${e?.message ?? e}\n${String(e?.stack ?? '').split('\n').slice(0, 6).join('\n')}`);
        flushLog();
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
  const loop = (now: number) => {
    if (AppState.currentState !== 'active') {
      rafOn = false;
      last = 0;
      return;
    }
    bgStats.raf++;
    if (last) {
      const gap = now - last;
      if (gap > 150 && !justResumed()) log('jank', `luồng JS khựng ${Math.round(gap)}ms${ctx ? ` · ${ctx}` : ''}`);
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
