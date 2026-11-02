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

// Hai phiên YouTube:
//  - phiên "duyệt" (nhẹ): tìm kiếm, gợi ý, Home, album, nghệ sĩ... Không tải "player" của YouTube nên tạo gần như tức thì.
//  - phiên "phát" (nặng): chỉ dùng để lấy link phát nhạc. Phải tải và phân tích mã JavaScript player của YouTube
//    (để giải mã link) — việc này làm luồng JS bận khoảng 1 giây, nên chỉ làm khi thật sự phát bài đầu tiên,
//    không làm lúc mở app (trước đây làm lúc mở app nên vừa vào app là dock bị đơ một lúc).
let browsePromise: Promise<Innertube> | null = null;
let sessionPromise: Promise<Innertube> | null = null;

export function getBrowseSession(): Promise<Innertube> {
  if (!browsePromise) {
    browsePromise = Innertube.create({ retrieve_player: false }).catch((e) => {
      browsePromise = null; // cho phép thử lại
      throw e;
    });
  }
  return browsePromise;
}

export function getSession(log?: Log): Promise<Innertube> {
  if (!sessionPromise) {
    const t0 = Date.now();
    log?.('Đang tạo phiên Innertube...');
    // cache: lưu player đã phân tích vào file, lần mở app sau không phải phân tích lại
    const { FileCache } = require('./ytCache') as typeof import('./ytCache');
    sessionPromise = Innertube.create({ cache: new FileCache() })
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
  const yt = await getBrowseSession();
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
  const yt = await getBrowseSession();
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

// ---------- Danh sách "Up next" / radio của YouTube Music ----------
// Dùng để tự phát tiếp các bài liên quan khi hết hàng đợi. Bài đầu tiên thường chính là bài đang phát.
export async function getUpNext(videoId: string): Promise<Song[]> {
  const yt = await getBrowseSession();
  const panel = await yt.music.getUpNext(videoId, true);
  const out: Song[] = [];
  for (const raw of (panel?.contents ?? []) as any[]) {
    const v = raw?.type === 'PlaylistPanelVideoWrapper' ? raw.primary : raw;
    if (!v || v.type !== 'PlaylistPanelVideo' || !v.video_id) continue;
    const thumbs = v.thumbnail ?? [];
    out.push({
      id: v.video_id,
      title: v.title?.toString?.() ?? '(không tên)',
      artist: v.artists?.map((a: { name: string }) => a.name).join(', ') || v.author || '',
      album: v.album?.name,
      duration: v.duration?.seconds,
      thumb: thumbs[thumbs.length - 1]?.url,
    });
  }
  return out;
}
// ---------- Dữ liệu cho Home và trang playlist/album ----------
// Viết kiểu "chịu lỗi": YouTube đổi cấu trúc thì phần nào không đọc được sẽ bị bỏ qua, không làm sập cả trang.
export type CardKind = 'song' | 'video' | 'album' | 'playlist' | 'artist';

export interface Card {
  kind: CardKind;
  id: string;
  title: string;
  subtitle: string;
  thumb?: string;
  song?: Song; // chỉ có với bài hát / video
}

export interface Shelf {
  title: string;
  cards: Card[];
}

export interface Collection {
  title: string;
  subtitle: string; // ví dụ "EP • 2025" hoặc "Playlist • 50 bài"
  thumb?: string;
  songs: Song[];
  // Nghệ sĩ / người tạo hiện dưới tên (ảnh tròn nhỏ + tên, bấm để mở trang nghệ sĩ)
  owner?: { name: string; id?: string; thumb?: string };
}

// Người tạo / nghệ sĩ trong phần đầu trang album / playlist
function ownerOf(h: any): Collection['owner'] {
  const t = h?.strapline_text_one;
  const name = str(t);
  if (!name) return undefined;
  const ep = t?.endpoint ?? t?.runs?.find((r: any) => r?.endpoint)?.endpoint;
  const id: string | undefined = ep?.payload?.browseId;
  return { name, id, thumb: lastThumb(h?.strapline_thumbnail) };
}

const CARD_KINDS: CardKind[] = ['song', 'video', 'album', 'playlist', 'artist'];
const str = (v: any): string => (v == null ? '' : typeof v === 'string' ? v : v.toString?.() ?? '');
const lastThumb = (v: any): string | undefined => {
  const arr: any[] = Array.isArray(v) ? v : v?.contents ?? [];
  return arr[arr.length - 1]?.url;
};
const artistsOf = (n: any): string =>
  n?.artists?.map((a: { name: string }) => a.name).join(', ') || n?.author?.name || n?.authors?.map((a: { name: string }) => a.name).join(', ') || '';

function toCard(n: any): Card | null {
  if (!n || (n.type !== 'MusicTwoRowItem' && n.type !== 'MusicResponsiveListItem')) return null;
  const kind = n.item_type as CardKind;
  if (!CARD_KINDS.includes(kind) || !n.id) return null;
  const title = str(n.title) || str(n.name);
  const artist = artistsOf(n);
  const thumb = n.type === 'MusicTwoRowItem' ? lastThumb(n.thumbnail) : lastThumb(n.thumbnails);
  const subtitle = str(n.subtitle) || artist;
  const playable = kind === 'song' || kind === 'video';
  return {
    kind,
    id: n.id,
    title,
    subtitle,
    thumb,
    song: playable ? { id: n.id, title, artist, duration: n.duration?.seconds, thumb } : undefined,
  };
}

function toShelves(sections: any[] | undefined): Shelf[] {
  const out: Shelf[] = [];
  for (const s of sections ?? []) {
    if (s?.type !== 'MusicCarouselShelf') continue;
    const cards = (s.contents ?? []).map(toCard).filter((c: Card | null): c is Card => !!c);
    if (cards.length) out.push({ title: str(s.header?.title) || 'YouTube Music', cards });
  }
  return out;
}

// Trang chủ YouTube Music (chưa đăng nhập: nội dung chung theo khu vực)
export async function getHomeShelves(): Promise<Shelf[]> {
  const yt = await getBrowseSession();
  const feed = await yt.music.getHomeFeed();
  return toShelves(feed.sections as any[]);
}

// Trang Khám phá: mới phát hành, tâm trạng & thể loại...
export async function getExploreShelves(): Promise<Shelf[]> {
  const yt = await getBrowseSession();
  const ex = await yt.music.getExplore();
  return toShelves(ex.sections as any[]);
}

// Bảng xếp hạng theo quốc gia (mặc định Việt Nam). Trả về các kệ trên trang Charts của YouTube Music.
export async function getChartShelves(country = 'VN'): Promise<Shelf[]> {
  const yt = await getBrowseSession();
  const res: any = await yt.actions.execute('/browse', {
    browseId: 'FEmusic_charts',
    formData: { selectedValues: [country] },
    client: 'YTMUSIC',
    parse: true,
  });
  return toShelves(res?.contents_memo?.get('MusicCarouselShelf'));
}

function songsFrom(items: any[] | undefined): Song[] {
  const out: Song[] = [];
  for (const n of items ?? []) {
    if (n?.type !== 'MusicResponsiveListItem' || !n.id) continue;
    out.push({
      id: n.id,
      title: str(n.title),
      artist: artistsOf(n),
      album: n.album?.name,
      duration: n.duration?.seconds,
      thumb: lastThumb(n.thumbnails),
    });
  }
  return out;
}

// Danh sách bài của một playlist hoặc album trên YouTube Music
export async function getCollection(kind: 'playlist' | 'album', id: string): Promise<Collection> {
  const yt = await getBrowseSession();
  if (kind === 'album') {
    const a: any = await yt.music.getAlbum(id);
    const h = a.header;
    const thumb = lastThumb(h?.thumbnail);
    // Bài trong album thường không có ảnh riêng: dùng ảnh album
    const songs = songsFrom(a.contents).map((s) => ({ ...s, thumb: s.thumb ?? thumb, album: s.album ?? str(h?.title) }));
    return { title: str(h?.title), subtitle: str(h?.subtitle), thumb, songs, owner: ownerOf(h) };
  }
  const p: any = await yt.music.getPlaylist(id);
  const h = p.header;
  let songs = songsFrom(p.items);
  // Playlist dài: tải thêm vài trang (tối đa ~200 bài) để đủ dùng mà không quá chậm
  let page = p;
  for (let i = 0; i < 2 && page.has_continuation && songs.length < 200; i++) {
    try {
      page = await page.getContinuation();
      songs = songs.concat(songsFrom(page.items));
    } catch {
      break;
    }
  }
  return {
    title: str(h?.title),
    subtitle: str(h?.subtitle) || str(h?.second_subtitle),
    thumb: lastThumb(h?.thumbnail),
    songs,
    owner: ownerOf(h),
  };
}

// ---------- Tìm kiếm theo loại: Tất cả / Bài hát / Album / Nghệ sĩ ----------
export type SearchKind = 'all' | 'song' | 'album' | 'artist';
export interface SearchResults {
  top?: Card; // "Kết quả hàng đầu" của YouTube Music (thường đúng nhất)
  songs: Song[]; // bài hát chính thức
  videos: Song[]; // video ca nhạc (nhiều bài Việt chỉ có dạng video, không có bản "bài hát")
  albums: Card[];
  artists: Card[];
}

// Một dòng kết quả (MusicResponsiveListItem) thành thẻ album / nghệ sĩ / playlist
function listCard(n: any): Card | null {
  if (n?.type !== 'MusicResponsiveListItem' || !n.id) return null;
  const kind = n.item_type as CardKind;
  if (kind !== 'album' && kind !== 'artist' && kind !== 'playlist') return null;
  const title = str(n.title) || str(n.name) || str(n.author?.name);
  if (!title) return null;
  const thumb = lastThumb(n.thumbnails);
  let subtitle = '';
  if (kind === 'album') subtitle = [artistsOf(n), n.year].filter(Boolean).join(' • ');
  else if (kind === 'artist') subtitle = n.subscribers || '';
  else subtitle = artistsOf(n) || str(n.item_count);
  return { kind, id: n.id, title, subtitle, thumb };
}

const toSong = (n: any): Song => ({
  id: n.id,
  title: str(n.title) || '(không tên)',
  artist: artistsOf(n),
  album: n.album?.name,
  duration: n.duration?.seconds,
  thumb: lastThumb(n.thumbnails),
});

// Chia các dòng kết quả vào bài hát / video / album / nghệ sĩ theo loại của từng dòng
// (không dựa vào tên kệ "Songs", "Albums"... vì tên kệ đổi theo ngôn ngữ)
function collect(nodes: any[], into: SearchResults) {
  for (const n of nodes) {
    if (n?.type !== 'MusicResponsiveListItem' || !n.id) continue;
    if (n.item_type === 'song' || n.item_type === 'video') {
      const list = n.item_type === 'song' ? into.songs : into.videos;
      if (!list.some((s) => s.id === n.id)) list.push(toSong(n));
      continue;
    }
    const c = listCard(n);
    if (!c) continue;
    const list = c.kind === 'album' ? into.albums : c.kind === 'artist' ? into.artists : null;
    if (list && !list.some((x) => x.id === c.id)) list.push(c);
  }
}

// Thẻ "Kết quả hàng đầu" (MusicCardShelf): đọc xem nó là bài/video (có videoId) hay nghệ sĩ/album (có browseId)
function topCard(shelf: any): Card | undefined {
  const p = shelf?.on_tap?.payload ?? {};
  const title = str(shelf?.title);
  if (!title) return undefined;
  const subtitle = str(shelf?.subtitle);
  const thumb = lastThumb(shelf?.thumbnail?.contents ?? shelf?.thumbnail);
  if (p.videoId) {
    // Dòng phụ dạng "Bài hát • Ca sĩ • Album" hoặc "Video • Ca sĩ • 12 Tr lượt xem"
    const parts = subtitle.split(' • ');
    const artist = parts.length > 1 ? parts[1] : parts[0] ?? '';
    return { kind: 'song', id: p.videoId, title, subtitle, thumb, song: { id: p.videoId, title, artist, thumb } };
  }
  const pageType: string = p.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
  if (p.browseId && pageType.includes('ARTIST')) return { kind: 'artist', id: p.browseId, title, subtitle, thumb };
  if (p.browseId && pageType.includes('ALBUM')) return { kind: 'album', id: p.browseId, title, subtitle, thumb };
  return undefined;
}

// Tìm theo một loại, kèm thêm một trang nữa nếu có (mỗi trang YouTube trả khoảng 20 kết quả)
async function searchFiltered(yt: Innertube, query: string, type: 'song' | 'video' | 'album' | 'artist', into: SearchResults, pages = 1) {
  let res: any = await yt.music.search(query, { type });
  for (const section of (res.contents ?? []) as any[]) {
    if (section?.type === 'MusicShelf') collect(section.contents ?? [], into);
  }
  for (let i = 1; i < pages && res?.has_continuation; i++) {
    try {
      res = await res.getContinuation();
      collect((res.contents?.contents ?? []) as any[], into);
    } catch {
      break;
    }
  }
}

export async function searchMusic(query: string, kind: SearchKind): Promise<SearchResults> {
  const out: SearchResults = { songs: [], videos: [], albums: [], artists: [] };
  const yt = await getBrowseSession();
  if (kind === 'song') {
    // Bài hát và video ca nhạc tìm song song: nhiều bài chỉ có trên YouTube dưới dạng video
    await Promise.all([
      searchFiltered(yt, query, 'song', out, 2).catch(() => {}),
      searchFiltered(yt, query, 'video', out, 1).catch(() => {}),
    ]);
    if (!out.songs.length && !out.videos.length) throw new Error('Không tìm được');
    return out;
  }
  if (kind === 'album' || kind === 'artist') {
    await searchFiltered(yt, query, kind, out, 2);
    return out;
  }
  const res: any = await yt.music.search(query);
  for (const section of (res.contents ?? []) as any[]) {
    if (section?.type === 'MusicCardShelf') {
      out.top = out.top ?? topCard(section);
      collect(section.contents ?? [], out);
    } else if (section?.type === 'MusicShelf') {
      collect(section.contents ?? [], out);
    }
  }
  return out;
}

// ---------- Trang nghệ sĩ ----------
export interface ArtistPage {
  name: string;
  thumb?: string;
  songs: Song[]; // bài nổi bật
  shelves: Shelf[]; // Album, Đĩa đơn, Video, Nghệ sĩ tương tự...
}

export async function getArtist(id: string): Promise<ArtistPage> {
  const yt = await getBrowseSession();
  const a: any = await yt.music.getArtist(id);
  const h = a.header;
  const thumb = lastThumb(h?.thumbnail?.contents ?? h?.thumbnail) ?? lastThumb(h?.foreground_thumbnail);
  const sections = (a.sections ?? []) as any[];
  const songShelf = sections.find((s) => s?.type === 'MusicShelf');
  return {
    name: str(h?.title),
    thumb,
    songs: songsFrom(songShelf?.contents).slice(0, 10),
    shelves: toShelves(sections),
  };
}

// ---------- Lời có giờ của chính YouTube Music ----------
// YouTube Music có lời chạy theo thời gian (từ LyricFind / Musixmatch) gắn đúng vào từng video.
// Cách lấy (giống thư viện ytmusicapi):
//  1. /next của bài → tìm mã trang lời (browseId bắt đầu bằng "MPLYt")
//  2. /browse trang lời đó bằng client của app YouTube Music trên Android → có thêm mốc thời gian từng dòng
// Bài không có lời có giờ thì trả về lời thường (nếu có), hoặc null.
export interface YTLyrics {
  synced: boolean;
  lines: { t: number | null; text: string }[];
  source: string;
}

export async function getYTLyrics(videoId: string): Promise<YTLyrics | null> {
  const yt = await getBrowseSession();
  const next: any = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC' });
  const m = JSON.stringify(next?.data ?? {}).match(/"browseId":"(MPLYt[^"]+)"/);
  if (!m) return null;

  const client: any = (yt.session as any).context?.client ?? {};
  const res = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(client.visitorData ? { 'X-Goog-Visitor-Id': client.visitorData } : {}) },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID_MUSIC',
          clientVersion: '7.21.50',
          hl: client.hl ?? 'en',
          gl: client.gl ?? 'US',
          ...(client.visitorData ? { visitorData: client.visitorData } : {}),
        },
      },
      browseId: m[1],
    }),
  });
  if (!res.ok) return null;
  const d: any = await res.json();
  const data = d?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData;
  const raw: any[] | undefined = data?.timedLyricsData;
  if (!Array.isArray(raw) || !raw.length) return null;
  const timed = raw.every((x) => x?.cueRange?.startTimeMilliseconds != null);
  return {
    synced: timed,
    lines: raw.map((x) => ({
      t: timed ? Number(x.cueRange.startTimeMilliseconds) / 1000 : null,
      text: String(x?.lyricLine ?? '').trim(),
    })),
    source: String(data?.sourceMessage ?? 'YouTube Music'),
  };
}
