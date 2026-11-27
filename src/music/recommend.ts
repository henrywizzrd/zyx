// Queue suggestions ("Suggested for you", 27/11): replaces the old radio, which asked YouTube Music for the
// "Up next" of the LAST song in the queue only. That drifted away from the user's taste (each batch was seeded
// by the previous suggestion), repeated songs heard yesterday and ignored likes and skips.
//
// How a batch is made (all on the phone, nothing sent anywhere):
//  1. Seeds: the song playing now, the newest song the user chose themselves (not a suggestion), and one liked
//     song. Each seed's YouTube Music radio is fetched in parallel.
//  2. Every candidate gets a score:
//     + found in several radios (strong sign it fits), + higher up in a radio
//     + artist the user really listens to (by listened seconds, last 30 days)
//     − played in the last 3 days (a lot) / last 14 days (a little)
//     − skipped early twice or more before, − artist skipped this session
//     dropped: already in the queue / played this session, and versions (live, remix, sped up, karaoke…)
//     unless the seed itself is that kind of version
//  3. Highest scores first, with variety: at most 2 songs per artist in a batch and never the same artist twice
//     in a row.
// Batches are 10 songs; the player asks for the next batch when 4 songs are left (so at song 6 of 10),
// and the Queue sheet asks for more when scrolled to the bottom.
import type { Track } from '../data/mock';
import type { Song } from './ytmusic';
import { getTaste } from '../data/db';
import { log as appLog } from '../data/applog';

export type SuggestReason = 'artist' | 'similar';
export interface Suggestion {
  song: Song;
  reason: SuggestReason; // shown in the Queue: "You like" (known artist) or "Similar"
  seed: Track;
}

const VERSION = /\b(live|remix|remixed|sped ?up|slowed|nightcore|karaoke|instrumental|acoustic|cover|8d|lofi|lo-fi|1 hour|reverb)\b/i;
const artistKey = (a: string) => (a || '').split(',')[0].trim().toLowerCase();

// Session memory (cleared when the app restarts)
const sessionPlayed = new Set<string>();
const sessionArtistSkips = new Map<string, number>();

// Called when the player leaves a song: remember it was played, and if it was left early, that its artist
// may not be wanted right now
export function noteListen(t: { id: string; artist: string; duration?: number }, secs: number) {
  sessionPlayed.add(t.id);
  const early = secs < 30 && (!t.duration || secs < t.duration * 0.4);
  if (!early) return;
  const k = artistKey(t.artist);
  if (k) sessionArtistSkips.set(k, (sessionArtistSkips.get(k) ?? 0) + 1);
}

export async function suggestNext({
  seeds,
  exclude,
  count = 10,
  fetchRadio,
}: {
  seeds: Track[];
  exclude: Set<string>;
  count?: number;
  fetchRadio: (id: string) => Promise<Song[]>;
}): Promise<Suggestion[]> {
  const taste = getTaste();
  // Third seed: one of the 10 newest liked songs, picked at random so batches don't all look alike
  const likedPick = taste.liked.slice(0, 10).filter((l) => !seeds.some((s) => s?.id === l.id));
  const withLiked = likedPick.length ? [...seeds, likedPick[Math.floor(Math.random() * likedPick.length)]] : seeds;
  const uniq = withLiked.filter((s, i, a) => s && s.id !== 'none' && a.findIndex((x) => x?.id === s.id) === i).slice(0, 3);
  if (!uniq.length) return [];
  const radios = await Promise.allSettled(uniq.map((s) => fetchRadio(s.id)));

  // The most-listened artist sets the scale for the artist bonus
  const maxArtist = Math.max(1, ...taste.artists.values());
  const now = Date.now();
  type Cand = { song: Song; hits: number; best: number; seed: Track };
  const cands = new Map<string, Cand>();
  radios.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const seed = uniq[i];
    const allowVersions = VERSION.test(seed.title);
    r.value.forEach((song, pos) => {
      if (song.id === seed.id || exclude.has(song.id) || sessionPlayed.has(song.id)) return;
      if (!allowVersions && VERSION.test(song.title)) return;
      const rank = 1 - pos / Math.max(1, r.value.length);
      const c = cands.get(song.id);
      if (c) {
        c.hits += 1;
        c.best = Math.max(c.best, rank);
      } else cands.set(song.id, { song, hits: 1, best: rank, seed });
    });
  });

  const scored = [...cands.values()].map((c) => {
    const key = artistKey(c.song.artist);
    const artistLove = (taste.artists.get(key) ?? 0) / maxArtist; // 0..1
    const last = taste.lastPlayed.get(c.song.id);
    const days = last ? (now - last) / 86400000 : Infinity;
    let score = (c.hits - 1) * 2 + c.best * 1.5 + artistLove * 2;
    if (days < 3) score -= 3;
    else if (days < 14) score -= 1;
    if (taste.skipped.has(c.song.id)) score -= 4;
    score -= (sessionArtistSkips.get(key) ?? 0) * 1.5;
    return { ...c, key, score, reason: (artistLove > 0.15 ? 'artist' : 'similar') as SuggestReason };
  });
  scored.sort((a, b) => b.score - a.score);

  // Variety: max 2 per artist, never the same artist back to back
  const out: typeof scored = [];
  const perArtist = new Map<string, number>();
  const pool = [...scored];
  while (out.length < count && pool.length) {
    const prevKey = out[out.length - 1]?.key;
    const i = pool.findIndex((c) => c.key !== prevKey && (perArtist.get(c.key) ?? 0) < 2);
    if (i < 0) break;
    const [c] = pool.splice(i, 1);
    perArtist.set(c.key, (perArtist.get(c.key) ?? 0) + 1);
    out.push(c);
  }
  appLog(
    'music',
    `suggestions: ${out.length}/${cands.size} from ${uniq.length} seeds (${uniq.map((s) => s.title.slice(0, 18)).join(' · ')})`
  );
  return out.map((c) => ({ song: c.song, reason: c.reason, seed: c.seed }));
}
