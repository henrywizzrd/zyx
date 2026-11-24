import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState, useWindowDimensions } from 'react-native';
import { makeMutable, useFrameCallback } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { crumb, getLogContext, justResumed, log } from '../data/applog';

// Khựng ở luồng giao diện (UI thread: hiệu ứng, cuộn, kéo thả): khung hình cách nhau quá lâu thì ghi vào nhật ký.
// Bỏ qua khoảng cách rất dài (> 3s) vì đó là lúc app vào nền / màn hình tắt chứ không phải giật.
// Mốc "vừa vẽ lại" của các phần (màn có useRenderProbe + vài phần hay vẽ lại như thanh thời gian): khi giao diện khựng thì ghi
// kèm phần nào vừa vẽ lại ngay trước đó — để tìm thủ phạm của các lần khựng ~130ms đều đều ở player đĩa than
const marks: Record<string, number> = {};
export function markRender(name: string) {
  marks[name] = performance.now();
  crumb(`vẽ ${name}`);
}
function recent(ms: number) {
  const now = performance.now();
  const win = ms + 400; // khung khựng + 0,4s trước đó
  const list = Object.entries(marks)
    .map(([k, t]) => [k, Math.round(now - t)] as const)
    .filter(([, a]) => a <= win)
    .sort((a, b) => a[1] - b[1])
    .map(([k, a]) => `${k} ${a}ms trước`);
  return list.length ? ` · vừa vẽ lại: ${list.join(', ')}` : ' · không phần nào vừa vẽ lại';
}
function report(ms: number) {
  if (justResumed()) return;
  const c = getLogContext();
  log('jank', `giao diện khựng ${ms}ms${c ? ` · ${c}` : ''}${recent(ms)}`);
}

// ---------------- Đo thời gian vẽ lại của một màn hình ----------------
// Đặt ở đầu màn hình nặng (Home, Thư viện, Player...). Vẽ lại tốn hơn 50ms thì ghi vào Nhật ký: tốn bao lâu,
// và giá trị nào đổi khiến nó vẽ lại (so với lần vẽ trước) — để biết chỗ làm luồng JS khựng khi mở / đóng player, đổi tab
export function useRenderProbe(name: string, deps: Record<string, unknown>) {
  const t0 = performance.now();
  const prev = useRef<Record<string, unknown> | null>(null);
  const n = useRef(0);
  const p = prev.current;
  const changed = p ? Object.keys(deps).filter((k) => p[k] !== deps[k]) : null;
  prev.current = deps;
  n.current++;
  useLayoutEffect(() => {
    markRender(name);
    const dt = performance.now() - t0;
    if (dt < 50 || justResumed()) return;
    // > 1 giây: không phải thời gian vẽ — màn đang đóng băng (tab ẩn) đã vẽ xong từ trước, tới lúc hiện lại React mới "chốt" nó.
    // Bản trước ghi thành "vẽ lại Home: 4121ms" gây hiểu nhầm → giờ bỏ qua
    if (dt > 1000) return;
    const why = changed == null ? 'lần đầu' : changed.length ? `đổi: ${changed.join(', ')}` : 'trang cha vẽ lại / state riêng';
    log('jank', `vẽ lại ${name}: ${Math.round(dt)}ms (lần ${n.current}) · ${why}`);
  });
}

// ---------------- Đo từng chuyển động (mục "Chuyển động" trong Nhật ký) ----------------
// Mỗi chuyển động quan trọng (mở / đóng player, thu dock, kính lúp, vuốt quay lại...) gọi beginMotion lúc bắt đầu
// và endMotion lúc xong. Trong khoảng đó luồng giao diện đếm từng khung hình: bao nhiêu khung, bao nhiêu khung bị rớt
// (cách nhau quá 1,6 lần nhịp màn hình), khung dài nhất, và rớt ở đoạn nào (đầu / giữa / cuối).
// Luồng JS cũng được đo song song (khoảng lặng dài nhất), để biết khựng do JS bận hay do vẽ.
const M = {
  on: makeMutable(0),
  frames: makeMutable(0),
  dropped: makeMutable(0),
  worst: makeMutable(0),
  worstAt: makeMutable(0), // thời điểm khung dài nhất (ms kể từ lúc bắt đầu)
  t0: makeMutable(0),
  last: makeMutable(0),
  base: makeMutable(1000 / 60), // nhịp màn hình (tự dò: khoảng ngắn nhất thấy được, 8.3ms ở 120Hz)
  drops: makeMutable<number[]>([]), // thời điểm các khung rớt
};
let cur: { label: string; at: number; jsWorst: number; jsLast: number; raf: number; note: string } | null = null;

function jsTick() {
  if (!cur) return;
  const now = performance.now();
  cur.jsWorst = Math.max(cur.jsWorst, now - cur.jsLast);
  cur.jsLast = now;
  cur.raf = requestAnimationFrame(jsTick);
}

export function beginMotion(label: string, note = '') {
  if (cur) endMotion('bị chuyển động khác chen ngang');
  const now = performance.now();
  cur = { label, at: Date.now(), jsWorst: 0, jsLast: now, raf: 0, note };
  cur.raf = requestAnimationFrame(jsTick);
  M.frames.value = 0;
  M.dropped.value = 0;
  M.worst.value = 0;
  M.worstAt.value = 0;
  M.t0.value = 0;
  M.last.value = 0;
  M.drops.value = [];
  M.on.value = 1;
}

export function endMotion(extra = '') {
  const c = cur;
  if (!c) return;
  cur = null;
  cancelAnimationFrame(c.raf);
  M.on.value = 0;
  const ms = Date.now() - c.at;
  const frames = M.frames.value;
  const fps = ms > 0 ? Math.round((frames * 1000) / ms) : 0;
  const base = M.base.value;
  const dropped = M.dropped.value;
  const where = (t: number) => (t < ms * 0.25 ? 'đầu' : t > ms * 0.75 ? 'cuối' : 'giữa');
  const dropAt = M.drops.value.slice(0, 6).map((t) => `${Math.round(t)}ms(${where(t)})`).join(', ');
  const parts = [
    `${c.label}: ${ms}ms, ${frames} khung (~${fps}/${Math.round(1000 / base)} fps)`,
    dropped ? `rớt ${dropped} khung: ${dropAt}` : 'không rớt khung',
    `khung dài nhất ${Math.round(M.worst.value)}ms (${where(M.worstAt.value)})`,
    `JS lặng lâu nhất ${Math.round(c.jsWorst)}ms`,
  ];
  if (c.note) parts.push(c.note);
  if (extra) parts.push(extra);
  log('motion', parts.join(' · '));
}

// Gọi được từ cả luồng giao diện (worklet) lẫn luồng JS
export function beginMotionAny(label: string, note = '') {
  'worklet';
  if ((globalThis as any)._WORKLET) scheduleOnRN(beginMotion, label, note);
  else beginMotion(label, note);
}
export function endMotionAny(extra = '') {
  'worklet';
  if ((globalThis as any)._WORKLET) scheduleOnRN(endMotion, extra);
  else endMotion(extra);
}

// ---------------- Tóm tắt hiệu năng định kỳ (mục "Hiệu năng" trong Nhật ký) ----------------
// Luồng giao diện đếm MỌI khung hình (không chỉ lúc có chuyển động): số khung, số khung rớt, khung dài nhất.
// Luồng JS: một nhịp 250ms, trễ hơn dự kiến bao nhiêu = JS đang bận bấy nhiêu (rẻ hơn chạy requestAnimationFrame liên tục).
// Mỗi 20 giây ghi một dòng nếu có rớt khung / JS trễ đáng kể, còn không thì 60 giây một dòng "ổn" để biết mốc bình thường.
// Kèm: đang ở đâu (tab / trang / player), theme + hiệu ứng nền + kính + kiểu player (App.tsx báo qua setPerfInfo), bộ nhớ JS
const P = { frames: makeMutable(0), dropped: makeMutable(0), worst: makeMutable(0) };
let perfInfo = '';
export function setPerfInfo(s: string) {
  perfInfo = s;
}
let winStart = Date.now();
let jsWorst = 0;
let lastQuiet = 0;
export function heapMB() {
  try {
    const st = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
    const b = st?.js_heapSize ?? st?.js_allocatedBytes;
    return typeof b === 'number' ? `${Math.round(b / 1048576)}MB` : '';
  } catch {
    return '';
  }
}
function perfFlush(force = false) {
  const now = Date.now();
  const ms = now - winStart;
  if (ms < 1000) return;
  const frames = P.frames.value;
  const dropped = P.dropped.value;
  const worst = P.worst.value;
  const js = jsWorst;
  P.frames.value = 0;
  P.dropped.value = 0;
  P.worst.value = 0;
  jsWorst = 0;
  winStart = now;
  if (justResumed() || AppState.currentState !== 'active') return;
  const base = M.base.value;
  const hz = Math.round(1000 / base);
  const fps = Math.round((frames * 1000) / ms);
  const pct = frames + dropped > 0 ? (dropped * 100) / (frames + dropped) : 0;
  const bad = dropped > 2 || js > 120;
  // Ổn định: 60 giây mới ghi một dòng (đủ để biết mốc bình thường của từng theme mà không làm đầy nhật ký)
  if (!bad && !force && now - lastQuiet < 60000) return;
  if (!bad) lastQuiet = now;
  const c = getLogContext();
  const mem = heapMB();
  log(
    'perf',
    [
      `${Math.round(ms / 1000)}s ở ${c || '?'}`,
      `UI ~${fps}/${hz}fps, rớt ${dropped} khung (${pct.toFixed(1)}%), khung dài nhất ${Math.round(worst)}ms`,
      `JS trễ lâu nhất ${Math.round(js)}ms`,
      mem && `bộ nhớ JS ${mem}`,
      perfInfo,
    ]
      .filter(Boolean)
      .join(' · ')
  );
}

export function JankMonitor() {
  // Nhịp đo luồng JS + gom số liệu mỗi 20 giây
  useEffect(() => {
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      jsWorst = Math.max(jsWorst, now - last - 250);
      last = now;
    }, 250);
    const flush = setInterval(() => perfFlush(), 20000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') perfFlush(true); // xuống nền: ghi nốt đoạn đang đo
      else {
        winStart = Date.now();
        P.frames.value = 0;
        P.dropped.value = 0;
        P.worst.value = 0;
        jsWorst = 0;
      }
    });
    return () => {
      clearInterval(tick);
      clearInterval(flush);
      sub.remove();
    };
  }, []);
  // Xoay màn hình (dọc ⇄ ngang): đo như một chuyển động (các khối Home nảy vào chỗ, đĩa than lăn vào...)
  const { width, height } = useWindowDimensions();
  const landRef = useRef(width > height);
  useEffect(() => {
    const land = width > height;
    if (land === landRef.current) return;
    landRef.current = land;
    beginMotion('xoay màn hình', `${land ? 'dọc → ngang' : 'ngang → dọc'} · ${getLogContext()}`);
    const id = setTimeout(() => endMotion(), 900);
    return () => clearTimeout(id);
  }, [width, height]);
  useFrameCallback((f) => {
    'worklet';
    const d = f.timeSincePreviousFrame;
    if (d != null && d < 3000) {
      P.frames.value += 1;
      if (d > P.worst.value) P.worst.value = d;
      if (d > M.base.value * 1.6) P.dropped.value += Math.max(1, Math.round(d / M.base.value) - 1);
    }
    // Dò nhịp màn hình thật, làm tròn về 120 / 90 / 60Hz: một khung lệch nhịp (4ms) từng làm nhịp thành 225Hz
    // → mọi khung 8ms đều bị tính là "rớt" dù chạy đủ 120fps
    if (d != null && d > 4) {
      const snap = d < 9.7 ? 1000 / 120 : d < 12.6 ? 1000 / 90 : 1000 / 60;
      if (snap < M.base.value) M.base.value = snap;
    }
    if (d != null && d > 100 && d < 3000) scheduleOnRN(report, Math.round(d));
    if (M.on.value) {
      const t = f.timestamp;
      if (!M.t0.value) M.t0.value = t;
      M.frames.value += 1;
      if (d != null && M.frames.value > 1) {
        const at = t - M.t0.value;
        if (d > M.worst.value) {
          M.worst.value = d;
          M.worstAt.value = at;
        }
        if (d > M.base.value * 1.6) {
          M.dropped.value += Math.max(1, Math.round(d / M.base.value) - 1);
          if (M.drops.value.length < 12) M.drops.value = [...M.drops.value, at];
        }
      }
    }
  });
  return null;
}
