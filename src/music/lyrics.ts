import { useEffect, useState } from 'react';
import type { Track } from '../data/mock';

export type LyricLine = { t: number | null; text: string };
export type Lyrics = { synced: boolean; lines: LyricLine[]; source?: string }; // source: lời lấy từ đâu (hiện nhỏ ở cuối lời)
type Status = 'idle' | 'loading' | 'done';

const BASE = 'https://lrclib.net/api';
// Kho lời của SimpMusic: lưu theo đúng mã video YouTube (videoId), nên mốc thời gian khớp đúng bản đang phát
const SIMP = 'https://api-lyrics.simpmusic.org/v1';
const cache = new Map<string, Lyrics | null>();
const inflight = new Map<string, Promise<Lyrics | null>>();
const MAX_DURATION_DIFF = 3; // giây

// Bỏ các đoạn như (feat. ...), (Remix), (Remastered) để dễ khớp tên bài
const cleanTitle = (s: string) => s.replace(/\s*[\(\[](?:feat|ft|with|remaster|live|version|remix)[^\)\]]*[\)\]]/gi, '').trim();

function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\s*((?:\[\d+:\d+(?:\.\d+)?\])+)\s*(.*)$/);
    if (!m) continue;
    const text = m[2].trim();
    for (const tm of m[1].matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) {
      out.push({ t: Number(tm[1]) * 60 + Number(tm[2]), text });
    }
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

function fromItem(it: any): Lyrics | null {
  if (it?.syncedLyrics) {
    const lines = parseLrc(it.syncedLyrics);
    if (lines.length) return { synced: true, lines };
  }
  if (it?.plainLyrics) {
    return { synced: false, lines: String(it.plainLyrics).split('\n').map((text) => ({ t: null, text: text.trim() })) };
  }
  return null;
}

async function getJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Lời bài hát lấy từ lrclib.net (miễn phí, không cần khoá, có lời chạy theo thời gian)
// duration: độ dài THẬT của bản đang phát (đọc từ trình phát), không dùng số trong thông tin bài
// (nhiều bài từ kết quả tìm kiếm không có độ dài, hoặc là bản MV dài hơn bản gốc vì có đoạn mở đầu).
//
// Thứ tự tìm, từ khớp nhất tới kém nhất:
//  1. Lời có giờ của chính YouTube Music, gắn đúng vào video đang phát (nguồn LyricFind / Musixmatch)
//  2. Kho SimpMusic theo videoId: lời được cộng đồng canh giờ cho đúng video này
//  3. LRCLIB theo tên bài + nghệ sĩ + độ dài thật (chỉ nhận bản lệch độ dài ≤ 3 giây)
//  4. Zing MP3 theo tên bài + nghệ sĩ (lệch độ dài ≤ 4 giây)
//  5. Không có lời chạy theo thời gian thì hiện lời thường (ưu tiên lời của YouTube Music)
export async function fetchLyrics(t: Track, duration: number): Promise<Lyrics | null> {
  let plainFallback: Lyrics | null = null;
  const keepPlain = (l: Lyrics) => {
    if (!plainFallback && l.lines.some((x) => x.text)) plainFallback = { ...l, synced: false, lines: l.lines.map((x) => ({ t: null, text: x.text })) };
  };

  // 1. YouTube Music
  try {
    const { ytmusic, musicSupported } = require('./lazy') as typeof import('./lazy');
    if (musicSupported) {
      const y = await ytmusic().getYTLyrics(t.id);
      if (y?.synced && y.lines.length) return { synced: true, lines: y.lines, source: y.source };
      if (y) keepPlain({ synced: false, lines: y.lines, source: y.source });
    }
  } catch (e) {
    console.warn('[lyrics] youtube', e);
  }

  // 2. SimpMusic
  const sm = await getJson(`${SIMP}/${encodeURIComponent(t.id)}`);
  const item = Array.isArray(sm?.data) ? sm.data[0] : sm?.data ?? null;
  if (item?.syncedLyrics) {
    const lines = parseLrc(String(item.syncedLyrics));
    if (lines.length) return { synced: true, lines, source: 'SimpMusic Lyrics' };
  }
  if (item?.plainLyric) {
    keepPlain({ synced: false, lines: String(item.plainLyric).split('\n').map((text) => ({ t: null, text: text.trim() })), source: 'SimpMusic Lyrics' });
  }

  // 3. LRCLIB
  const title = cleanTitle(t.title);
  const artist = t.artist.split(',')[0].trim();
  const qs = `track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const len = duration > 0 ? duration : t.duration;
  const exact = await getJson(`${BASE}/get?${qs}${len ? `&duration=${Math.round(len)}` : ''}`);
  const a = fromItem(exact);
  if (a?.synced && len && Math.abs((exact?.duration ?? len) - len) <= MAX_DURATION_DIFF) return { ...a, source: 'LRCLIB' };
  if (a) keepPlain({ ...a, source: 'LRCLIB' });

  const list = await getJson(`${BASE}/search?${qs}`);
  if (Array.isArray(list)) {
    // Chỉ nhận bản có độ dài gần đúng bài đang phát. Lệch nhiều thường là bản khác (MV có intro, live, remix...)
    const diff = (x: any) => Math.abs((x.duration ?? 0) - len);
    const near = len ? list.filter((x) => diff(x) <= MAX_DURATION_DIFF) : [];
    const sorted = [...near].sort((x, y) => diff(x) - diff(y));
    for (const it of sorted.slice(0, 8)) {
      if (it?.syncedLyrics) {
        const r = fromItem(it);
        if (r?.synced) return { ...r, source: 'LRCLIB' };
      }
    }
    for (const it of [...sorted, ...list].slice(0, 8)) {
      const r = fromItem(it);
      if (r) keepPlain({ ...r, source: 'LRCLIB' });
    }
  }

  // 4. Zing MP3 (nguồn thứ hai, mạnh về nhạc Việt): chỉ hỏi khi các nguồn trên không có lời chạy theo thời gian
  try {
    const { zingLyrics } = require('./zing') as typeof import('./zing');
    const z = await zingLyrics(title, artist, len || 0);
    if (z?.synced) return { ...z, source: 'Zing MP3' };
  } catch (e) {
    console.warn('[lyrics] zing', e);
  }

  // 5. Lời thường
  return plainFallback;
}

// duration: độ dài thật của bài đang phát (từ trình phát). Chờ có độ dài rồi mới tìm lời (tối đa 4 giây)
export function useLyrics(track: Track, enabled: boolean, duration = 0) {
  // Lời đã tải rồi (trong phiên): có ngay từ lần vẽ đầu, không phải qua bước "đang tải" (mở player là thấy chữ liền)
  const [state, setState] = useState<{ status: Status; lyrics: Lyrics | null }>(() =>
    cache.has(track.id) ? { status: 'done', lyrics: cache.get(track.id) ?? null } : { status: 'idle', lyrics: null }
  );
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    const id = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(id);
  }, [track.id]);
  const known = duration > 0;

  useEffect(() => {
    if (!enabled || track.id === 'none') return;
    if (cache.has(track.id)) {
      const l = cache.get(track.id) ?? null;
      setState((s) => (s.status === 'done' && s.lyrics === l ? s : { status: 'done', lyrics: l }));
      return;
    }
    let dead = false;
    setState({ status: 'loading', lyrics: null });
    if (!known && !waited) return; // còn đang chờ trình phát báo độ dài bài
    // cùng một bài chỉ tải MỘT lần dù được gọi lại khi đang tải (đóng / mở player liên tục) — trước đây mỗi lần là một lượt
    // tải mới (log 13/11: tra lời Zing 2 lần liền cho cùng một bài)
    let job = inflight.get(track.id);
    if (!job) {
      job = fetchLyrics(track, duration)
        .catch(() => null)
        .then((l) => {
          cache.set(track.id, l);
          inflight.delete(track.id);
          return l;
        });
      inflight.set(track.id, job);
    }
    job.then((l) => {
      if (!dead) setState({ status: 'done', lyrics: l });
    });
    return () => {
      dead = true;
    };
  }, [track.id, enabled, known, waited]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
