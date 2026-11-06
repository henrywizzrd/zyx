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
export type ContextKind = 'playlist' | 'album' | 'liked' | 'local' | 'chart' | 'mix' | 'search' | 'artist';
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
