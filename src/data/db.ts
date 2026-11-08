import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import type { Track } from './mock';

// ---------------------------------------------------------------------------
// Dữ liệu của người dùng, lưu ngay trong máy bằng SQLite:
//   - lịch sử nghe (để dựng Recent, Recommend for you ở Home)
//   - bài đã thích
//   - playlist tự tạo (có cờ công khai, sau này profile cho người khác xem)
//   - album / playlist YouTube / nghệ sĩ đã lưu vào thư viện
// Sau này có backend thì đồng bộ các bảng này lên server.
//
// Trên web không dùng SQLite (cần cấu hình riêng), các hàm trả về rỗng.
// ---------------------------------------------------------------------------

// Đang phát từ đâu: dùng cho mục Recent ("vừa nghe playlist X")
export type ContextKind = 'playlist' | 'album' | 'liked' | 'local' | 'chart' | 'mix' | 'search' | 'artist' | 'shared'; // shared: playlist công khai của người dùng ZYX
export interface PlayContext {
  kind: ContextKind;
  id: string; // id playlist/album trên YouTube, id playlist trong máy, hoặc id bài gốc của mix
  title: string;
  thumb?: string;
}

export interface LocalPlaylist {
  id: string;
  title: string;
  isPublic: boolean;
  count: number;
  thumb?: string; // ảnh bìa: ảnh tự chọn, không có thì ảnh bài đầu tiên
  updatedAt: number;
  cover?: string; // ảnh bìa tự chọn
  description?: string;
}

export interface RecentItem extends PlayContext {
  playedAt: number;
  track?: Track; // với kind 'search': chính bài đó
}

const enabled = Platform.OS !== 'web';
type DB = import('expo-sqlite').SQLiteDatabase;
let db: DB | null = null;

function open(): DB | null {
  if (!enabled) return null;
  if (db) return db;
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  db = SQLite.openDatabaseSync('zyx.db');
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
      album TEXT, duration REAL NOT NULL DEFAULT 0, thumb TEXT
    );
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL, played_at INTEGER NOT NULL,
      ctx_kind TEXT NOT NULL, ctx_id TEXT NOT NULL, ctx_title TEXT NOT NULL, ctx_thumb TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_history_time ON play_history (played_at DESC);
    CREATE TABLE IF NOT EXISTS liked (track_id TEXT PRIMARY KEY, liked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL, added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, position)
    );
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS downloads (track_id TEXT PRIMARY KEY, file TEXT NOT NULL, downloaded_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saved (
      kind TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
      thumb TEXT, saved_at INTEGER NOT NULL, PRIMARY KEY (kind, id)
    );
  `);
  // Cột thêm sau (bản cũ chưa có): ảnh bìa tự chọn và mô tả của playlist. Đã có rồi thì bỏ qua lỗi
  for (const col of ['cover TEXT', 'description TEXT']) {
    try {
      db.execSync(`ALTER TABLE playlists ADD COLUMN ${col}`);
    } catch {}
  }
  // Số giây đã thật sự nghe của mỗi lượt (cho trang Thống kê). Bản cũ chưa có cột này → null (tính gần đúng theo độ dài bài)
  try {
    db.execSync('ALTER TABLE play_history ADD COLUMN secs REAL');
  } catch {}
  return db;
}

// ---- Báo cho màn hình biết dữ liệu vừa đổi (Home, Library tự tải lại)
type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function changed() {
  version++;
  listeners.forEach((l) => l());
}
// Cho hook tự viết (useSyncExternalStore): đăng ký nghe thay đổi + đọc số phiên bản
export function subscribeDb(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const dbVersion = () => version;

export function useDbVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return v;
}

type TrackRow = { id: string; title: string; artist: string; album: string | null; duration: number; thumb: string | null };
const rowToTrack = (r: TrackRow): Track => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album ?? undefined,
  duration: r.duration,
  thumb: r.thumb ?? undefined,
  color: '#2A2A2A',
});

function saveTrack(d: DB, t: Track) {
  d.runSync(
    `INSERT INTO tracks (id, title, artist, album, duration, thumb) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, artist = excluded.artist,
       album = COALESCE(excluded.album, tracks.album), duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE tracks.duration END,
       thumb = COALESCE(excluded.thumb, tracks.thumb)`,
    [t.id, t.title, t.artist, t.album ?? null, t.duration ?? 0, t.thumb ?? null]
  );
}

const safe = <T>(fallback: T, fn: (d: DB) => T): T => {
  try {
    const d = open();
    return d ? fn(d) : fallback;
  } catch (e) {
    console.warn('[db]', e);
    return fallback;
  }
};

// ---------------- Lịch sử nghe ----------------
export function recordPlay(t: Track, ctx: PlayContext) {
  if (t.id === 'none') return;
  safe(undefined, (d) => {
    d.withTransactionSync(() => {
      saveTrack(d, t);
      d.runSync(
        'INSERT INTO play_history (track_id, played_at, ctx_kind, ctx_id, ctx_title, ctx_thumb) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, Date.now(), ctx.kind, ctx.id, ctx.title, ctx.thumb ?? null]
      );
    });
  });
  changed();
}

// Những thứ vừa nghe, mỗi playlist/album/mix chỉ hiện một lần (lần nghe gần nhất).
// Bài nghe lẻ (từ Search) thì hiện chính bài đó.
export function getRecent(limit = 12): RecentItem[] {
  return safe([], (d) => {
    const rows = d.getAllSync<{
      ctx_kind: ContextKind; ctx_id: string; ctx_title: string; ctx_thumb: string | null; played_at: number;
    } & TrackRow>(
      `SELECT h.ctx_kind, h.ctx_id, h.ctx_title, h.ctx_thumb, MAX(h.played_at) AS played_at,
              t.id, t.title, t.artist, t.album, t.duration, t.thumb
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       GROUP BY CASE WHEN h.ctx_kind = 'search' THEN 'track:' || h.track_id ELSE h.ctx_kind || ':' || h.ctx_id END
       ORDER BY played_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) =>
      r.ctx_kind === 'search'
        ? { kind: 'search', id: r.id, title: r.title, thumb: r.thumb ?? undefined, playedAt: r.played_at, track: rowToTrack(r) }
        : { kind: r.ctx_kind, id: r.ctx_id, title: r.ctx_title, thumb: r.ctx_thumb ?? undefined, playedAt: r.played_at }
    );
  });
}

// Nghệ sĩ nghe nhiều nhất trong `days` ngày gần đây, kèm bài nghe nhiều nhất của họ (làm hạt giống cho mix)
export function getTopArtists(days = 30, limit = 4): { artist: string; plays: number; seed: Track }[] {
  return safe([], (d) => {
    const since = Date.now() - days * 86400000;
    const rows = d.getAllSync<{ artist: string; plays: number; seed_id: string }>(
      `SELECT t.artist AS artist, COUNT(*) AS plays,
              (SELECT h2.track_id FROM play_history h2 JOIN tracks t2 ON t2.id = h2.track_id
               WHERE t2.artist = t.artist GROUP BY h2.track_id ORDER BY COUNT(*) DESC LIMIT 1) AS seed_id
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.played_at >= ? AND t.artist <> ''
       GROUP BY t.artist ORDER BY plays DESC LIMIT ?`,
      [since, limit]
    );
    return rows
      .map((r) => {
        const seed = d.getFirstSync<TrackRow>('SELECT * FROM tracks WHERE id = ?', [r.seed_id]);
        return seed ? { artist: r.artist, plays: r.plays, seed: rowToTrack(seed) } : null;
      })
      .filter((x): x is { artist: string; plays: number; seed: Track } => !!x);
  });
}

// Ghi số giây đã nghe vào lượt nghe gần nhất của bài này (gọi lúc rời bài). Không báo màn hình cập nhật (đỡ vẽ lại)
export function setLastPlaySecs(trackId: string, secs: number) {
  if (!(secs > 0)) return;
  safe(undefined, (d) =>
    d.runSync(
      'UPDATE play_history SET secs = ? WHERE id = (SELECT id FROM play_history WHERE track_id = ? ORDER BY played_at DESC LIMIT 1)',
      [Math.round(secs), trackId]
    )
  );
}

export function historyCount(): number {
  return safe(0, (d) => d.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM play_history')?.n ?? 0);
}

// ---------------- Bài đã thích ----------------
export function getLikedIds(): Set<string> {
  return safe(new Set<string>(), (d) => new Set(d.getAllSync<{ track_id: string }>('SELECT track_id FROM liked').map((r) => r.track_id)));
}

export function setLiked(t: Track, on: boolean) {
  safe(undefined, (d) => {
    if (on) {
      saveTrack(d, t);
      d.runSync('INSERT OR REPLACE INTO liked (track_id, liked_at) VALUES (?, ?)', [t.id, Date.now()]);
    } else d.runSync('DELETE FROM liked WHERE track_id = ?', [t.id]);
  });
  changed();
}

export function getLikedTracks(): Track[] {
  return safe([], (d) =>
    d
      .getAllSync<TrackRow>('SELECT t.* FROM liked l JOIN tracks t ON t.id = l.track_id ORDER BY l.liked_at DESC')
      .map(rowToTrack)
  );
}

// ---------------- Playlist trong máy ----------------
const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function getPlaylists(): LocalPlaylist[] {
  return safe([], (d) =>
    d
      .getAllSync<{ id: string; title: string; is_public: number; updated_at: number; count: number; thumb: string | null; cover: string | null; description: string | null }>(
        `SELECT p.id, p.title, p.is_public, p.updated_at, p.cover, p.description,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS count,
                (SELECT t.thumb FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
                 WHERE pt.playlist_id = p.id ORDER BY pt.position LIMIT 1) AS thumb
         FROM playlists p ORDER BY p.updated_at DESC`
      )
      // Ảnh bìa: ảnh tự chọn nếu có, không thì ảnh bài đầu tiên
      .map((r) => ({
        id: r.id, title: r.title, isPublic: !!r.is_public, count: r.count, thumb: r.cover ?? r.thumb ?? undefined, updatedAt: r.updated_at,
        cover: r.cover ?? undefined, description: r.description ?? undefined,
      }))
  );
}

export function getPlaylist(id: string): LocalPlaylist | null {
  return getPlaylists().find((p) => p.id === id) ?? null;
}

export function createPlaylist(title: string): string {
  const id = newId();
  const now = Date.now();
  safe(undefined, (d) => d.runSync('INSERT INTO playlists (id, title, is_public, created_at, updated_at) VALUES (?, ?, 0, ?, ?)', [id, title.trim() || 'Playlist mới', now, now]));
  changed();
  return id;
}

export function renamePlaylist(id: string, title: string) {
  safe(undefined, (d) => d.runSync('UPDATE playlists SET title = ?, updated_at = ? WHERE id = ?', [title.trim() || 'Playlist mới', Date.now(), id]));
  changed();
}

// Ảnh bìa tự chọn (đường dẫn file trong máy; null = bỏ, quay lại dùng ảnh bài đầu tiên)
export function setPlaylistCover(id: string, uri: string | null) {
  safe(undefined, (d) => d.runSync('UPDATE playlists SET cover = ?, updated_at = ? WHERE id = ?', [uri, Date.now(), id]));
  changed();
}

export function setPlaylistDescription(id: string, text: string) {
  safe(undefined, (d) => d.runSync('UPDATE playlists SET description = ?, updated_at = ? WHERE id = ?', [text.trim() || null, Date.now(), id]));
  changed();
}

export function setPlaylistPublic(id: string, isPublic: boolean) {
  safe(undefined, (d) => d.runSync('UPDATE playlists SET is_public = ?, updated_at = ? WHERE id = ?', [isPublic ? 1 : 0, Date.now(), id]));
  changed();
}

export function deletePlaylist(id: string) {
  safe(undefined, (d) =>
    d.withTransactionSync(() => {
      d.runSync('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]);
      d.runSync('DELETE FROM playlists WHERE id = ?', [id]);
    })
  );
  changed();
}

export function addToPlaylist(id: string, t: Track) {
  safe(undefined, (d) =>
    d.withTransactionSync(() => {
      saveTrack(d, t);
      const next = d.getFirstSync<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM playlist_tracks WHERE playlist_id = ?', [id])?.n ?? 0;
      d.runSync('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)', [id, t.id, next, Date.now()]);
      d.runSync('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), id]);
    })
  );
  changed();
}

// Playlist này đã có bài này chưa (để hiện dấu tích trong bảng "Thêm vào playlist")
export function playlistHas(id: string, trackId: string): boolean {
  return safe(false, (d) => !!d.getFirstSync('SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? LIMIT 1', [id, trackId]));
}

// ---------------- Bài đã tải về máy ----------------
export function getDownloads(): Map<string, string> {
  return safe(new Map(), (d) => new Map(d.getAllSync<{ track_id: string; file: string }>('SELECT track_id, file FROM downloads').map((r) => [r.track_id, r.file])));
}
export function setDownload(t: Track, file: string | null) {
  safe(undefined, (d) => {
    if (file) {
      saveTrack(d, t);
      d.runSync('INSERT OR REPLACE INTO downloads (track_id, file, downloaded_at) VALUES (?, ?, ?)', [t.id, file, Date.now()]);
    } else d.runSync('DELETE FROM downloads WHERE track_id = ?', [t.id]);
  });
  changed();
}

export function removeFromPlaylist(id: string, position: number) {
  safe(undefined, (d) =>
    d.withTransactionSync(() => {
      d.runSync('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?', [id, position]);
      d.runSync('UPDATE playlists SET updated_at = ? WHERE id = ?', [Date.now(), id]);
    })
  );
  changed();
}

export function getPlaylistTracks(id: string): (Track & { position: number })[] {
  return safe([], (d) =>
    d
      .getAllSync<TrackRow & { position: number }>(
        'SELECT t.*, pt.position FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position',
        [id]
      )
      .map((r) => ({ ...rowToTrack(r), position: r.position }))
  );
}

// ---------------- Bộ nhớ đệm dữ liệu mạng ----------------
// Lưu kết quả tải từ YouTube (bảng xếp hạng, trang chủ...) để lần sau mở app hiện ngay, rồi mới cập nhật ngầm.
export function cacheGet<T>(key: string): { value: T; at: number } | null {
  return safe(null, (d) => {
    const r = d.getFirstSync<{ value: string; at: number }>('SELECT value, at FROM kv WHERE key = ?', [key]);
    return r ? { value: JSON.parse(r.value) as T, at: r.at } : null;
  });
}

export function cacheSet(key: string, value: unknown) {
  safe(undefined, (d) => d.runSync('INSERT OR REPLACE INTO kv (key, value, at) VALUES (?, ?, ?)', [key, JSON.stringify(value), Date.now()]));
}

// ---------------- Lưu trữ khoá-giá trị (cài đặt nhỏ, profile...) ----------------
// Giống cacheGet/cacheSet nhưng báo cho màn hình cập nhật khi đổi
export function kvGet<T>(key: string): T | null {
  return cacheGet<T>(key)?.value ?? null;
}

export function kvSet(key: string, value: unknown) {
  cacheSet(key, value);
  changed();
}

// ---------------- Album, playlist YouTube và nghệ sĩ đã lưu vào thư viện ----------------
export type SavedKind = 'album' | 'playlist' | 'artist';
export interface SavedItem {
  kind: SavedKind;
  id: string;
  title: string;
  subtitle: string;
  thumb?: string;
  savedAt: number;
}

export function getSaved(): SavedItem[] {
  return safe([], (d) =>
    d
      .getAllSync<{ kind: SavedKind; id: string; title: string; subtitle: string; thumb: string | null; saved_at: number }>(
        'SELECT kind, id, title, subtitle, thumb, saved_at FROM saved ORDER BY saved_at DESC'
      )
      .map((r) => ({ kind: r.kind, id: r.id, title: r.title, subtitle: r.subtitle, thumb: r.thumb ?? undefined, savedAt: r.saved_at }))
  );
}

export function isSaved(kind: SavedKind, id: string): boolean {
  return safe(false, (d) => !!d.getFirstSync('SELECT 1 FROM saved WHERE kind = ? AND id = ?', [kind, id]));
}

export function setSaved(item: Omit<SavedItem, 'savedAt'>, on: boolean) {
  safe(undefined, (d) => {
    if (on) {
      d.runSync(
        `INSERT INTO saved (kind, id, title, subtitle, thumb, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, thumb = COALESCE(excluded.thumb, saved.thumb)`,
        [item.kind, item.id, item.title, item.subtitle, item.thumb ?? null, Date.now()]
      );
    } else {
      d.runSync('DELETE FROM saved WHERE kind = ? AND id = ?', [item.kind, item.id]);
    }
  });
  changed();
}

// ---------------- Thống kê nghe nhạc (trang Wrapped) ----------------
// Mỗi lượt nghe tính số giây thật sự nghe (secs); lượt cũ chưa có secs thì tính gần đúng = độ dài bài (tối đa 10 phút)
const LISTENED = 'COALESCE(h.secs, MIN(CASE WHEN t.duration > 0 THEN t.duration ELSE 180 END, 600))';
export interface ListenStats {
  seconds: number;
  plays: number;
  songs: number;
  artists: number;
  topSongs: { track: Track; plays: number; seconds: number }[];
  topArtists: { artist: string; plays: number; seconds: number; thumb?: string }[];
  byDay: number[]; // giây nghe theo từng ngày trong khoảng (cũ → mới)
  byHour: number[]; // 24 ô: giây nghe theo giờ trong ngày
}
export function getListenStats(since: number, buckets: number, bucketMs: number): ListenStats {
  const empty: ListenStats = { seconds: 0, plays: 0, songs: 0, artists: 0, topSongs: [], topArtists: [], byDay: new Array(buckets).fill(0), byHour: new Array(24).fill(0) };
  return safe(empty, (d) => {
    const tot = d.getFirstSync<{ s: number | null; n: number; songs: number; artists: number }>(
      `SELECT SUM(${LISTENED}) AS s, COUNT(*) AS n, COUNT(DISTINCT h.track_id) AS songs, COUNT(DISTINCT t.artist) AS artists
       FROM play_history h JOIN tracks t ON t.id = h.track_id WHERE h.played_at >= ?`,
      [since]
    );
    const songs = d.getAllSync<TrackRow & { plays: number; s: number }>(
      `SELECT t.*, COUNT(*) AS plays, SUM(${LISTENED}) AS s FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.played_at >= ? GROUP BY h.track_id ORDER BY plays DESC, s DESC LIMIT 10`,
      [since]
    );
    const artists = d.getAllSync<{ artist: string; plays: number; s: number; thumb: string | null }>(
      `SELECT t.artist AS artist, COUNT(*) AS plays, SUM(${LISTENED}) AS s, MAX(t.thumb) AS thumb
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.played_at >= ? AND t.artist <> '' GROUP BY t.artist ORDER BY s DESC LIMIT 10`,
      [since]
    );
    const rows = d.getAllSync<{ at: number; s: number }>(
      `SELECT h.played_at AS at, ${LISTENED} AS s FROM play_history h JOIN tracks t ON t.id = h.track_id WHERE h.played_at >= ?`,
      [since]
    );
    const byDay = new Array(buckets).fill(0);
    const byHour = new Array(24).fill(0);
    for (const r of rows) {
      const i = Math.floor((r.at - since) / bucketMs);
      if (i >= 0 && i < buckets) byDay[i] += r.s;
      byHour[new Date(r.at).getHours()] += r.s;
    }
    return {
      seconds: tot?.s ?? 0,
      plays: tot?.n ?? 0,
      songs: tot?.songs ?? 0,
      artists: tot?.artists ?? 0,
      topSongs: songs.map((r) => ({ track: rowToTrack(r), plays: r.plays, seconds: r.s })),
      topArtists: artists.map((r) => ({ artist: r.artist, plays: r.plays, seconds: r.s, thumb: r.thumb ?? undefined })),
      byDay,
      byHour,
    };
  });
}

// ---------------- Sao lưu / khôi phục thư viện (xem src/data/backup.ts) ----------------
export interface LibraryDump {
  v: 1;
  tracks: [string, string, string, string | null, number, string | null][];
  liked: [string, number][];
  playlists: [string, string, number, number, number, string | null, string | null][]; // id, title, public, created, updated, cover, description
  items: [string, string, number, number][]; // playlist, track, position, added
  saved: [SavedKind, string, string, string, string | null, number][];
  history: [string, number, string, string, string, string | null, number | null][]; // track, at, ctx kind/id/title/thumb, secs
}

export function isLibraryEmpty(): boolean {
  return safe(false, (d) =>
    !d.getFirstSync(
      'SELECT 1 FROM playlists UNION ALL SELECT 1 FROM liked UNION ALL SELECT 1 FROM saved UNION ALL SELECT 1 FROM play_history LIMIT 1'
    )
  );
}

export function exportLibrary(historyLimit = 6000): LibraryDump | null {
  return safe(null, (d) => {
    const playlists = d.getAllSync<{ id: string; title: string; is_public: number; created_at: number; updated_at: number; cover: string | null; description: string | null }>(
      'SELECT id, title, is_public, created_at, updated_at, cover, description FROM playlists'
    );
    const items = d.getAllSync<{ playlist_id: string; track_id: string; position: number; added_at: number }>('SELECT * FROM playlist_tracks');
    const liked = d.getAllSync<{ track_id: string; liked_at: number }>('SELECT * FROM liked');
    const saved = d.getAllSync<{ kind: SavedKind; id: string; title: string; subtitle: string; thumb: string | null; saved_at: number }>('SELECT * FROM saved');
    const history = d.getAllSync<{ track_id: string; played_at: number; ctx_kind: string; ctx_id: string; ctx_title: string; ctx_thumb: string | null; secs: number | null }>(
      'SELECT track_id, played_at, ctx_kind, ctx_id, ctx_title, ctx_thumb, secs FROM play_history ORDER BY played_at DESC LIMIT ?',
      [historyLimit]
    );
    const need = new Set<string>([...items.map((r) => r.track_id), ...liked.map((r) => r.track_id), ...history.map((r) => r.track_id)]);
    const tracks = d.getAllSync<TrackRow>('SELECT * FROM tracks').filter((t) => need.has(t.id));
    return {
      v: 1,
      tracks: tracks.map((t) => [t.id, t.title, t.artist, t.album, t.duration, t.thumb]),
      liked: liked.map((r) => [r.track_id, r.liked_at]),
      playlists: playlists.map((p) => [p.id, p.title, p.is_public, p.created_at, p.updated_at, p.cover, p.description]),
      items: items.map((r) => [r.playlist_id, r.track_id, r.position, r.added_at]),
      saved: saved.map((r) => [r.kind, r.id, r.title, r.subtitle, r.thumb, r.saved_at]),
      history: history.map((r) => [r.track_id, r.played_at, r.ctx_kind, r.ctx_id, r.ctx_title, r.ctx_thumb, r.secs]),
    };
  });
}

// Thêm dữ liệu sao lưu vào máy (không xoá gì đang có; trùng thì giữ cái trong máy)
export function importLibrary(dump: LibraryDump): boolean {
  const ok = safe(false, (d) => {
    d.withTransactionSync(() => {
      for (const t of dump.tracks ?? [])
        d.runSync('INSERT OR IGNORE INTO tracks (id, title, artist, album, duration, thumb) VALUES (?, ?, ?, ?, ?, ?)', t);
      for (const p of dump.playlists ?? [])
        d.runSync('INSERT OR IGNORE INTO playlists (id, title, is_public, created_at, updated_at, cover, description) VALUES (?, ?, ?, ?, ?, ?, ?)', p);
      for (const r of dump.items ?? [])
        d.runSync('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)', r);
      for (const r of dump.liked ?? []) d.runSync('INSERT OR IGNORE INTO liked (track_id, liked_at) VALUES (?, ?)', r);
      for (const r of dump.saved ?? [])
        d.runSync('INSERT OR IGNORE INTO saved (kind, id, title, subtitle, thumb, saved_at) VALUES (?, ?, ?, ?, ?, ?)', r);
      // Lịch sử: gộp với những gì đang có trong máy (lượt nào đã có — cùng bài, cùng thời điểm — thì bỏ qua)
      for (const r of [...(dump.history ?? [])].reverse())
        d.runSync(
          `INSERT INTO play_history (track_id, played_at, ctx_kind, ctx_id, ctx_title, ctx_thumb, secs)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM play_history WHERE track_id = ? AND played_at = ?)`,
          [...r, r[0], r[1]]
        );
    });
    return true;
  });
  changed();
  return ok;
}
