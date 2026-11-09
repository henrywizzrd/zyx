import React, { useLayoutEffect, useRef } from 'react';
import { makeMutable, useFrameCallback } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { getLogContext, justResumed, log } from '../data/applog';

// Khựng ở luồng giao diện (UI thread: hiệu ứng, cuộn, kéo thả): khung hình cách nhau quá lâu thì ghi vào nhật ký.
// Bỏ qua khoảng cách rất dài (> 3s) vì đó là lúc app vào nền / màn hình tắt chứ không phải giật.
function report(ms: number) {
  if (justResumed()) return;
  const c = getLogContext();
  log('jank', `giao diện khựng ${ms}ms${c ? ` · ${c}` : ''}`);
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
    const dt = performance.now() - t0;
    if (dt < 50 || justResumed()) return;
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

export function JankMonitor() {
  useFrameCallback((f) => {
    'worklet';
    const d = f.timeSincePreviousFrame;
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
