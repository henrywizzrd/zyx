import { useSyncExternalStore } from 'react';
import { dbVersion, getLikedIds, getPlaylists, getSaved, subscribeDb } from './db';

// Mọi thứ trong Thư viện, gom từ SQLite:
//  - Liked Songs
//  - playlist tự tạo
//  - album / playlist YouTube / nghệ sĩ đã lưu (nút Lưu ở trang album, nút Theo dõi ở trang nghệ sĩ)
export type LibraryKind = 'liked' | 'local' | 'album' | 'playlist' | 'artist';
export interface LibraryEntry {
  key: string; // khoá duy nhất, dùng cho thứ tự tự sắp xếp: "liked", "local:<id>", "album:<id>"...
  id: string; // id gốc (playlist trong máy, album/playlist/kênh trên YouTube)
  kind: LibraryKind;
  title: string;
  subtitle: string;
  thumb?: string;
  addedAt: number; // để sắp theo "mới thêm"
}

export function getLibrary(): LibraryEntry[] {
  const out: LibraryEntry[] = [
    { key: 'liked', id: 'liked', kind: 'liked', title: 'Liked Songs', subtitle: String(getLikedIds().size), addedAt: Number.MAX_SAFE_INTEGER },
  ];
  for (const p of getPlaylists()) {
    out.push({ key: `local:${p.id}`, id: p.id, kind: 'local', title: p.title, subtitle: String(p.count), thumb: p.thumb, addedAt: p.updatedAt });
  }
  for (const s of getSaved()) {
    out.push({ key: `${s.kind}:${s.id}`, id: s.id, kind: s.kind, title: s.title, subtitle: s.subtitle, thumb: s.thumb, addedAt: s.savedAt });
  }
  return out;
}

// Tự đọc lại khi dữ liệu đổi (thích bài, tạo playlist, lưu album...)
// Chỉ báo vẽ lại khi nội dung Thư viện thật sự đổi. Trước đây MỌI thay đổi trong SQLite (nghe một bài → ghi lịch sử,
// đổi một cài đặt...) đều làm cả trang Thư viện dựng lại; tab đang ẩn thì dồn lại tới lúc mở tab → khựng 400-600ms
let snap: { v: number; data: LibraryEntry[]; json: string } | null = null;
function librarySnapshot(): LibraryEntry[] {
  const v = dbVersion();
  if (snap && snap.v === v) return snap.data;
  const data = getLibrary();
  const json = JSON.stringify(data);
  if (snap && snap.json === json) {
    snap.v = v;
    return snap.data;
  }
  snap = { v, data, json };
  return data;
}
export function useLibrary(): LibraryEntry[] {
  return useSyncExternalStore(subscribeDb, librarySnapshot);
}
