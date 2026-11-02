import { PixelRatio } from 'react-native';
import { cacheGet, cacheSet } from '../data/db';
import { prefetchThumbs } from '../components/Cover';
import { ytmusic } from './lazy';
import type { Shelf } from './ytmusic';

// Bộ nhớ đệm cho trang thể loại:
//  - trong phiên: Map (mở lại là hiện ngay)
//  - trên máy: lưu vào SQLite, mở app lần sau vẫn hiện ngay rồi mới làm mới ngầm (sau 12 tiếng)
//  - tải sẵn: khi mở Search, tải trước vài thể loại đầu (chỉ dữ liệu + ảnh bìa) để bấm vào là có liền
export const GENRE_CARD = 150;
const TTL = 12 * 3600 * 1000;
const mem = new Map<string, Shelf[]>();
const inflight = new Map<string, Promise<Shelf[]>>();
const key = (params: string) => `genre:${params}`;

export function cachedGenre(params: string): { shelves: Shelf[]; fresh: boolean } | null {
  const m = mem.get(params);
  if (m) return { shelves: m, fresh: true };
  const d = cacheGet<Shelf[]>(key(params));
  if (!d) return null;
  mem.set(params, d.value);
  return { shelves: d.value, fresh: Date.now() - d.at < TTL };
}

export function loadGenre(params: string): Promise<Shelf[]> {
  const running = inflight.get(params);
  if (running) return running;
  const p = ytmusic()
    .getGenre(params)
    .then((s) => {
      mem.set(params, s);
      cacheSet(key(params), s);
      // Ảnh bìa của 2 kệ đầu (phần nhìn thấy ngay khi mở trang)
      prefetchThumbs(s.slice(0, 2).flatMap((x) => x.cards.slice(0, 6).map((c) => c.thumb)), Math.round(GENRE_CARD * PixelRatio.get()));
      return s;
    })
    .finally(() => inflight.delete(params));
  inflight.set(params, p);
  return p;
}

// Tải sẵn lần lượt (từng cái một, không làm nghẽn mạng) các thể loại chưa có trên máy
export async function warmGenres(list: string[]) {
  for (const params of list) {
    const c = cachedGenre(params);
    if (c?.fresh) continue;
    try {
      await loadGenre(params);
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
}
