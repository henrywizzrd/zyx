// Import a Spotify playlist or album (28/11). Spotify's Web API no longer gives other people's playlists to small apps,
// so we read the public embed page (open.spotify.com/embed/...) right on the phone: it carries the name, cover and
// the first ~100 tracks. Longer lists are paged with the anonymous token the embed page itself uses; if Spotify refuses,
// the import keeps what it got and says how many were left out.
// Each Spotify track is then looked up by title + artist in ZYX's own catalogue and the closest version is kept.
import { log } from '../data/applog';
import type { Track } from '../data/mock';
import { toTrack, ytmusic } from './lazy';
import type { Song } from './ytmusic';

export type SpotifyKind = 'playlist' | 'album';
export type SpotifyTrack = { title: string; artists: string[]; duration: number /* seconds, 0 = unknown */ };
export type SpotifyList = { kind: SpotifyKind; id: string; name: string; cover?: string; tracks: SpotifyTrack[]; total: number };

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// open.spotify.com/playlist/ID, open.spotify.com/intl-vi/album/ID, spotify:playlist:ID
function parseRef(text: string): { kind: SpotifyKind; id: string } | null {
  const m = text.match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]{10,40})/i);
  return m ? { kind: m[1].toLowerCase() as SpotifyKind, id: m[2] } : null;
}

// Share links (spotify.link/…, spotify.app.link/…) redirect to open.spotify.com: follow them
export async function resolveLink(text: string): Promise<{ kind: SpotifyKind; id: string } | null> {
  const direct = parseRef(text);
  if (direct) return direct;
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url || !/spotify/i.test(url)) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const found = parseRef(res.url) ?? parseRef(await res.text());
    log('music', `spotify import: short link → ${found ? `${found.kind} ${found.id}` : 'nothing found'}`);
    return found;
  } catch (e) {
    log('error', `spotify import: short link failed: ${String(e)}`);
    return null;
  }
}

// Walk the page's JSON and pick out what we need without depending on its exact shape (Spotify reshuffles it often)
function walk(v: unknown, visit: (o: Record<string, unknown>) => void, depth = 0) {
  if (depth > 40 || v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) walk(x, visit, depth + 1);
    return;
  }
  visit(v as Record<string, unknown>);
  for (const x of Object.values(v as Record<string, unknown>)) walk(x, visit, depth + 1);
}

const splitArtists = (s: unknown) =>
  typeof s === 'string' ? s.split(/,\s*|\s*&\s*|\s+feat\.?\s+/i).map((a) => a.trim()).filter(Boolean) : [];

function fromEmbed(json: unknown, kind: SpotifyKind, id: string): SpotifyList | null {
  let entity: Record<string, unknown> | null = null;
  let token: string | undefined;
  walk(json, (o) => {
    if (!entity && Array.isArray(o.trackList) && typeof (o.name ?? o.title) === 'string') entity = o;
    if (!token && typeof o.accessToken === 'string') token = o.accessToken;
  });
  if (!entity) return null;
  const e = entity as Record<string, unknown>;
  const tracks: SpotifyTrack[] = [];
  for (const t of e.trackList as Record<string, unknown>[]) {
    const title = typeof t.title === 'string' ? t.title : '';
    if (!title) continue;
    const dur = typeof t.duration === 'number' ? t.duration : 0;
    tracks.push({ title, artists: splitArtists(t.subtitle), duration: Math.round(dur / 1000) });
  }
  let cover: string | undefined;
  walk(e.coverArt ?? e.visualIdentity ?? e, (o) => {
    if (!cover && typeof o.url === 'string' && /^https:\/\/.*(scdn|spotifycdn|mosaic)/.test(o.url)) cover = o.url;
  });
  const list: SpotifyList & { token?: string } = { kind, id, name: String(e.name ?? e.title), cover, tracks, total: tracks.length };
  list.token = token;
  return list;
}

async function fetchEmbed(kind: SpotifyKind, id: string): Promise<(SpotifyList & { token?: string }) | null> {
  const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) {
    log('error', `spotify import: embed page ${res.status}`);
    return null;
  }
  const html = await res.text();
  const raw = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) {
    log('error', `spotify import: no page data (${html.length} bytes)`);
    return null;
  }
  return fromEmbed(JSON.parse(raw), kind, id);
}

// Tracks after the first page, with the embed page's anonymous token. Stops quietly when Spotify says no
async function fetchRest(kind: SpotifyKind, id: string, token: string, from: number): Promise<{ tracks: SpotifyTrack[]; total: number | null }> {
  const out: SpotifyTrack[] = [];
  let total: number | null = null;
  let url: string | null = `https://api.spotify.com/v1/${kind}s/${id}/tracks?offset=${from}&limit=${kind === 'album' ? 50 : 100}`;
  for (let page = 0; url && page < 100; page++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      log('music', `spotify import: more tracks refused (${res.status}) after ${from + out.length}`);
      break;
    }
    const data = (await res.json()) as { items?: unknown[]; next?: string | null; total?: number };
    total = data.total ?? total;
    for (const it of data.items ?? []) {
      const t = ((it as { track?: unknown }).track ?? it) as { name?: string; artists?: { name?: string }[]; duration_ms?: number; type?: string };
      if (!t?.name || (t.type && t.type !== 'track')) continue;
      out.push({ title: t.name, artists: (t.artists ?? []).map((a) => a.name ?? '').filter(Boolean), duration: Math.round((t.duration_ms ?? 0) / 1000) });
    }
    url = data.next ?? null;
  }
  return { tracks: out, total };
}

export async function fetchSpotifyList(text: string): Promise<SpotifyList | null> {
  const ref = await resolveLink(text.trim());
  if (!ref) return null;
  const t0 = Date.now();
  const list = await fetchEmbed(ref.kind, ref.id);
  if (!list) return null;
  // The embed page stops at about 100 tracks (albums: 50): try to get the rest
  if (list.token && list.tracks.length >= (ref.kind === 'album' ? 50 : 100)) {
    try {
      const more = await fetchRest(ref.kind, ref.id, list.token, list.tracks.length);
      list.tracks.push(...more.tracks);
      if (more.total != null) list.total = Math.max(more.total, list.tracks.length);
    } catch (e) {
      log('error', `spotify import: paging failed: ${String(e)}`);
    }
  }
  list.total = Math.max(list.total, list.tracks.length);
  delete list.token;
  log('music', `spotify import: "${list.name}" ${list.tracks.length}/${list.total} tracks in ${Date.now() - t0}ms`);
  return list;
}

// ---------------- Matching ----------------
const VERSION_WORDS = ['remix', 'live', 'acoustic', 'instrumental', 'karaoke', 'cover', 'sped up', 'slowed', 'lofi', 'lo-fi', 'nightcore', 'remaster'];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Title without "(feat. …)", "- Remastered 2011" and the like
const core = (s: string) => norm(s.replace(/\s*[([].*?[)\]]/g, ' ').replace(/\s+-\s+.*$/, ''));
const words = (s: string) => new Set(s.split(' ').filter((w) => w.length > 0));
function overlap(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}
const versionOf = (s: string) => VERSION_WORDS.filter((w) => norm(s).includes(w)).sort().join(',');

function score(want: SpotifyTrack, got: Song): number {
  const title = core(want.title) === core(got.title) ? 1 : overlap(core(want.title), core(got.title));
  const gotArtists = norm(got.artist);
  const artist = want.artists.length ? (want.artists.some((a) => norm(a) && gotArtists.includes(norm(a))) ? 1 : 0) : 0.5;
  let length = 0.5;
  if (want.duration && got.duration) {
    const d = Math.abs(want.duration - got.duration);
    length = d <= 3 ? 1 : d <= 10 ? 0.7 : d <= 30 ? 0.3 : 0;
  }
  // A remix / live / sped-up version only when Spotify's track is that version too
  const version = versionOf(want.title) === versionOf(got.title) ? 0 : -0.25;
  return title * 0.5 + artist * 0.3 + length * 0.2 + version;
}

export const MATCH_MIN = 0.55;

export async function matchTrack(want: SpotifyTrack): Promise<Track | null> {
  const q = `${want.title.replace(/\s*[([].*?[)\]]/g, '')} ${want.artists[0] ?? ''}`.trim();
  let songs: Song[] = [];
  try {
    songs = await ytmusic().searchSongs(q);
  } catch {
    try {
      songs = await ytmusic().searchSongs(q); // one retry: the first search after a while can time out
    } catch (e) {
      log('error', `spotify import: search failed for "${q}": ${String(e)}`);
      return null;
    }
  }
  let best: Song | null = null;
  let bestScore = -1;
  for (const s of songs.slice(0, 8)) {
    const sc = score(want, s);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return best && bestScore >= MATCH_MIN ? toTrack(best) : null;
}

// Look up every track, a few at a time, keeping Spotify's order. onProgress(done, found)
export async function matchAll(
  tracks: SpotifyTrack[],
  onProgress: (done: number, found: number) => void,
  cancelled: () => boolean
): Promise<(Track | null)[]> {
  const out: (Track | null)[] = new Array(tracks.length).fill(null);
  let next = 0;
  let done = 0;
  let found = 0;
  // Smoothness (28/11, Tyson: the page stuttered a little while matching): each search result is parsed on the JS
  // thread, so run 3 at a time, give the UI a frame between searches, and redraw the progress at most ~4 times a second
  let shownAt = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - shownAt < 250) return;
    shownAt = now;
    onProgress(done, found);
  };
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const worker = async () => {
    while (next < tracks.length && !cancelled()) {
      const i = next++;
      out[i] = await matchTrack(tracks[i]);
      done++;
      if (out[i]) found++;
      report();
      await frame();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  report(true);
  return out;
}
