import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../data/mock';

export type LyricLine = { t: number | null; text: string };
export type Lyrics = { synced: boolean; lines: LyricLine[] };
type Status = 'idle' | 'loading' | 'done';

const BASE = 'https://lrclib.net/api';
const cache = new Map<string, Lyrics | null>();
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
export async function fetchLyrics(t: Track): Promise<Lyrics | null> {
  const title = cleanTitle(t.title);
  const artist = t.artist.split(',')[0].trim();
  const qs = `track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;

  const exact = await getJson(`${BASE}/get?${qs}${t.duration ? `&duration=${Math.round(t.duration)}` : ''}`);
  const a = fromItem(exact);
  if (a) return a;

  const list = await getJson(`${BASE}/search?${qs}`);
  if (Array.isArray(list)) {
    // Chỉ nhận bản có độ dài gần đúng bài đang phát. Lệch nhiều thường là bản khác (MV có intro, live, remix...)
    // và lời sẽ chạy sai hẳn, thà không có lời đồng bộ còn hơn.
    const diff = (x: any) => Math.abs((x.duration ?? 0) - t.duration);
    const near = t.duration ? list.filter((x) => diff(x) <= MAX_DURATION_DIFF) : list;
    const sorted = [...near].sort((x, y) => diff(x) - diff(y));
    // Ưu tiên bản có lời chạy theo thời gian
    for (const it of sorted.slice(0, 8)) {
      if (it?.syncedLyrics) {
        const r = fromItem(it);
        if (r?.synced) return r;
      }
    }
    for (const it of sorted.slice(0, 8)) {
      const r = fromItem(it);
      if (r) return r;
    }
    // Không có bản nào khớp độ dài: chỉ lấy lời thường (không chạy theo nhạc) để khỏi sai nhịp
    for (const it of list.slice(0, 5)) {
      if (it?.plainLyrics) return { synced: false, lines: String(it.plainLyrics).split('\n').map((text: string) => ({ t: null, text: text.trim() })) };
    }
  }
  return null;
}

// enabled=false thì không tải gì (chỉ tải khi mở chế độ lời bài hát)
export function useLyrics(track: Track, enabled: boolean) {
  const [state, setState] = useState<{ status: Status; lyrics: Lyrics | null }>({ status: 'idle', lyrics: null });

  useEffect(() => {
    if (!enabled || track.id === 'none') return;
    if (cache.has(track.id)) {
      setState({ status: 'done', lyrics: cache.get(track.id) ?? null });
      return;
    }
    let dead = false;
    setState({ status: 'loading', lyrics: null });
    fetchLyrics(track)
      .catch(() => null)
      .then((l) => {
        cache.set(track.id, l);
        if (!dead) setState({ status: 'done', lyrics: l });
      });
    return () => {
      dead = true;
    };
  }, [track.id, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

// ---------- Chỉnh lệch lời cho từng bài (lưu lại) ----------
// Số dương: lời hiện sớm hơn. Số âm: lời hiện muộn hơn.
const OFFSET_KEY = 'zyx:lyricOffset';
let offsets: Record<string, number> | null = null;
let offsetsLoad: Promise<Record<string, number>> | null = null;

function loadOffsets(): Promise<Record<string, number>> {
  if (offsets) return Promise.resolve(offsets);
  if (!offsetsLoad) {
    offsetsLoad = AsyncStorage.getItem(OFFSET_KEY)
      .then((raw) => (offsets = raw ? JSON.parse(raw) : {}))
      .catch(() => (offsets = {}));
  }
  return offsetsLoad;
}

export function useLyricOffset(trackId: string): [number, (v: number) => void] {
  const [value, setValue] = useState(() => offsets?.[trackId] ?? 0);
  useEffect(() => {
    let dead = false;
    loadOffsets().then((o) => !dead && setValue(o[trackId] ?? 0));
    return () => {
      dead = true;
    };
  }, [trackId]);
  const set = useCallback(
    (v: number) => {
      const r = Math.round(v * 10) / 10;
      setValue(r);
      loadOffsets().then((o) => {
        if (r === 0) delete o[trackId];
        else o[trackId] = r;
        AsyncStorage.setItem(OFFSET_KEY, JSON.stringify(o)).catch(() => {});
      });
    },
    [trackId]
  );
  return [value, set];
}
