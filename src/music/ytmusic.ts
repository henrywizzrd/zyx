import './polyfills';
import { Innertube, Platform } from 'youtubei.js';

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number; // giây
  thumb?: string;
}

export interface AudioInfo {
  url: string;
  client: string; // client của YouTube đã lấy được link
  mime: string;
  host: string;
}

export type Log = (msg: string) => void;

// youtubei.js không có sẵn bộ chạy JavaScript để giải mã link phát, nên mình cung cấp.
// Đây là điểm dễ hỏng nhất trong React Native (phụ thuộc Hermes có hỗ trợ `new Function` không).
Platform.shim.eval = async (data: any) => {
  return new Function(data.output)();
};

let sessionPromise: Promise<Innertube> | null = null;

export function getSession(log?: Log): Promise<Innertube> {
  if (!sessionPromise) {
    const t0 = Date.now();
    log?.('Đang tạo phiên Innertube...');
    sessionPromise = Innertube.create()
      .then((yt) => {
        log?.(`Tạo phiên xong (${Date.now() - t0} ms)`);
        return yt;
      })
      .catch((e) => {
        sessionPromise = null; // cho phép thử lại
        throw e;
      });
  }
  return sessionPromise;
}

export async function searchSongs(query: string, log?: Log): Promise<Song[]> {
  const yt = await getSession(log);
  const t0 = Date.now();
  const res = await yt.music.search(query, { type: 'song' });
  const items = res.songs?.contents ?? [];
  log?.(`Tìm "${query}": ${items.length} kết quả (${Date.now() - t0} ms)`);

  const songs: Song[] = [];
  for (const it of items) {
    if (!it.id) continue;
    songs.push({
      id: it.id,
      title: it.title ?? '(không tên)',
      artist: it.artists?.map((a) => a.name).join(', ') ?? it.author?.name ?? '',
      album: it.album?.name,
      duration: it.duration?.seconds,
      thumb: it.thumbnails?.[it.thumbnails.length - 1]?.url,
    });
  }
  return songs;
}

// Thử lần lượt vài client của YouTube, client nào cho link phát được thì dùng.
// Việc ghi lại client nào chạy được sẽ giúp biết nên giữ cách nào về sau.
const CLIENTS = ['IOS', 'ANDROID', 'TV', 'YTMUSIC', 'WEB'] as const;

export async function getAudio(videoId: string, log?: Log, muxed = false): Promise<AudioInfo> {  const yt = await getSession(log);
  const errors: string[] = [];

  for (const client of CLIENTS) {
    const t0 = Date.now();
    try {
      // type 'audio' và format 'mp4' (mp4a): định dạng iPhone phát được. webm/opus thì iOS không phát.
      const format = await yt.getStreamingData(
        videoId,
        muxed
          ? { type: 'video+audio', quality: '360p', format: 'mp4', client }
          : { type: 'audio', quality: 'best', format: 'mp4', client }
      );
      const url = format.url;
      if (!url) throw new Error('không có url');
      const probe = await fetch(url, { headers: { Range: 'bytes=0-1' } });
      log?.(`Client ${client}: kiểm tra link, HTTP ${probe.status}`);
      if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      const host = new URL(url).host;
      log?.(`Client ${client}: có link (${Date.now() - t0} ms), ${format.mime_type}`);
      return { url, client, mime: format.mime_type, host };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      log?.(`Client ${client}: lỗi - ${msg}`);
      errors.push(`${client}: ${msg}`);
    }
  }
  throw new Error('Không client nào lấy được link phát.\n' + errors.join('\n'));
}

// ---------- Gợi ý trong lúc gõ (giống ô tìm kiếm của YouTube Music) ----------
// Trả về hai thứ: các từ khoá gợi ý, và các bài hát / nghệ sĩ / album khớp luôn với chữ đang gõ.
export type SuggestKind = 'song' | 'video' | 'artist' | 'album' | 'playlist';

export interface SuggestItem {
  kind: SuggestKind;
  id: string;
  title: string;
  subtitle: string;
  thumb?: string;
  song?: Song; // chỉ có với bài hát / video (phát được ngay)
}

export interface Suggestions {
  queries: string[];
  items: SuggestItem[];
}

const SUGGEST_KINDS: SuggestKind[] = ['song', 'video', 'artist', 'album', 'playlist'];

export async function getSuggestions(input: string): Promise<Suggestions> {
  const yt = await getSession();
  const sections = await yt.music.getSearchSuggestions(input);
  const queries: string[] = [];
  const items: SuggestItem[] = [];
  for (const section of sections) {
    for (const node of section.contents as any[]) {
      if (node.type === 'SearchSuggestion' || node.type === 'HistorySuggestion') {
        const q: string = node.suggestion?.toString?.() ?? '';
        if (q && !queries.includes(q)) queries.push(q);
        continue;
      }
      if (node.type !== 'MusicResponsiveListItem') continue;
      const kind = node.item_type as SuggestKind;
      if (!SUGGEST_KINDS.includes(kind) || !node.id) continue;
      const title: string = node.title ?? node.name ?? '';
      const artist: string = node.artists?.map((a: { name: string }) => a.name).join(', ') ?? node.author?.name ?? '';
      const thumbs = node.thumbnails ?? [];
      const thumb: string | undefined = thumbs[thumbs.length - 1]?.url;
      const subtitle: string = node.subtitle?.toString?.() || artist;
      const playable = kind === 'song' || kind === 'video';
      items.push({
        kind,
        id: node.id,
        title,
        subtitle,
        thumb,
        song: playable ? { id: node.id, title, artist, duration: node.duration?.seconds, thumb } : undefined,
      });
    }
  }
  return { queries, items };
}
