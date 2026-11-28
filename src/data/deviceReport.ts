// Device health for the admin dashboard (27/11). With "Send diagnostics" on (the default), the app sends a small
// summary per day — counts only, no song names, no username or email — and uploads a full day's log when the
// admin asked for that day from the dashboard, or by itself for a day with a crash or a freeze (kept 7 days). Server side: supabase functions report_device / upload_device_log;
// only the admin account can read the data.
import { AppState } from 'react-native';
import { dayOf, getDayLines, listLogDays, log as appLog, type DayMeta } from './applog';
import { crashReportsOn } from './crashReports';
import { dayText, deviceId, deviceInfo } from './logShare';
import { kvGet, kvSet } from './db';

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;

const EVERY_MS = 30 * 60 * 1000; // at most one report every 30 minutes
const SENT_KEY = 'zyx.healthSent'; // day → number of log lines when that day was last reported
const AUTO_KEY = 'zyx.problemLogSent'; // day → number of log lines when that day's log was auto-uploaded
let lastAt = 0;
let busy = false;

export interface DayHealth {
  day: string;
  sessions: number;
  crashes: number;
  errors: number;
  freezes: number;
  janks: number;
  memory_warnings: number;
  startup_ms: number | null;
  peak_js_mb: number | null;
  log_lines: number;
}

// Counts for one day, read from that day's log lines
export function summariseDay(meta: DayMeta): DayHealth {
  const lines = getDayLines(meta.day);
  let sessions = 0;
  let freezes = 0;
  let memory = 0;
  let peak: number | null = null;
  const starts: number[] = [];
  for (const l of lines) {
    const m = l.msg;
    if (l.tag === 'ui' && m.includes('— mở app bản')) sessions++;
    if (l.tag === 'jank') {
      const k = /khựng (\d+)ms/.exec(m);
      if (k && Number(k[1]) >= 1000) freezes++;
    }
    if (l.tag === 'error' && m.includes('hết bộ nhớ')) memory++;
    const js = /bộ nhớ JS (\d+)MB/.exec(m);
    if (js) peak = Math.max(peak ?? 0, Number(js[1]));
    const st = /vào app sau (\d+)ms/.exec(m);
    if (st) starts.push(Number(st[1]));
  }
  starts.sort((a, b) => a - b);
  return {
    day: meta.day,
    sessions,
    crashes: meta.crashes,
    errors: meta.errors,
    freezes,
    janks: meta.jank,
    memory_warnings: memory,
    startup_ms: starts.length ? starts[Math.floor(starts.length / 2)] : null,
    peak_js_mb: peak,
    log_lines: meta.lines,
  };
}

export async function reportDevice(force = false) {
  if (!crashReportsOn() || busy) return;
  if (!force && Date.now() - lastAt < EVERY_MS) return;
  busy = true;
  lastAt = Date.now();
  try {
    const info = await deviceInfo();
    let channel = '';
    try {
      channel = (require('expo-updates') as typeof import('expo-updates')).channel ?? '';
    } catch {}
    // Only days that changed since they were last sent (the first report sends up to 14 days)
    const sent = kvGet<Record<string, number>>(SENT_KEY) ?? {};
    const metas = listLogDays().slice(0, 14).filter((m) => sent[m.day] !== m.lines);
    const days: DayHealth[] = [];
    for (const m of metas) {
      days.push(summariseDay(m));
      await new Promise((r) => setTimeout(r, 0)); // one day at a time, so the UI keeps running
    }
    const id = deviceId();
    const { data, error } = await sb().rpc('report_device', {
      p: { device_id: id, model: info.model, os: info.os, app_version: info.appVersion, channel, update_id: info.updateId, days },
    });
    if (error) throw error;
    for (const m of metas) sent[m.day] = m.lines;
    kvSet(SENT_KEY, Object.fromEntries(Object.entries(sent).sort().slice(-20)));
    // Days with a crash or a freeze (last 7 days): upload the log right away so the admin can read it without asking
    // (28/11). Today's log goes up once; a past day goes up again only if it changed after that. Auto logs are deleted after 7 days
    const auto = kvGet<Record<string, number>>(AUTO_KEY) ?? {};
    const today = dayOf(Date.now());
    const weekAgo = dayOf(Date.now() - 7 * 86400000);
    for (const d of days) {
      if (!(d.crashes > 0 || d.freezes > 0) || d.day < weekAgo) continue;
      if (auto[d.day] != null && (d.day === today || auto[d.day] === d.log_lines)) continue;
      const text = await dayText(d.day);
      const { data: ok, error: e3 } = await sb().rpc('upload_problem_log', { p_device: id, p_day: d.day, p_content: text });
      if (!e3 && ok) auto[d.day] = d.log_lines;
      appLog('ui', e3 ? `problem log ${d.day} failed to upload: ${e3.message}` : `problem log ${d.day} ${ok ? `uploaded (${Math.round(text.length / 1024)}KB)` : 'not accepted'}`);
    }
    kvSet(AUTO_KEY, Object.fromEntries(Object.entries(auto).sort().slice(-10)));
    // Days the admin asked for: upload them (scrubbed the same way as "Send to developer")
    const pending = (data as string[] | null) ?? [];
    for (const day of pending) {
      const text = await dayText(day);
      const { error: e2 } = await sb().rpc('upload_device_log', { p_device: id, p_day: day, p_content: text });
      appLog('ui', e2 ? `requested log ${day} failed to upload: ${e2.message}` : `requested log ${day} uploaded (${Math.round(text.length / 1024)}KB)`);
    }
  } catch (e: any) {
    appLog('ui', `device report failed: ${String(e?.message ?? e)}`);
    lastAt = Date.now() - EVERY_MS + 5 * 60 * 1000; // try again in 5 minutes
  } finally {
    busy = false;
  }
}

// Report 20 s after start (not during the busy start-up) and whenever the app goes to the background
let installed = false;
export function installDeviceReport() {
  if (installed) return;
  installed = true;
  setTimeout(() => reportDevice(true), 20000);
  AppState.addEventListener('change', (s) => {
    if (s === 'background') reportDevice();
  });
}
