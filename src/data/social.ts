import { useMemo } from 'react';
import type { Track } from './mock';
import { kvGet, kvSet, useDbVersion } from './db';

// ---------------------------------------------------------------------------
// Phần mạng xã hội của trang Profile (kiểu Threads). Chưa có backend nên:
//  - bài mình đăng: lưu ngay trong máy (bảng kv của SQLite), tắt app mở lại vẫn còn
//  - tab Đăng lại: vài bài MẪU của người dùng giả để xem giao diện (khi có server sẽ thay bằng dữ liệu thật)
// Sau này có backend thì các hàm ở đây gọi API thay vì đọc/ghi trong máy, màn hình không phải sửa.
// ---------------------------------------------------------------------------

export const POST_MAX = 500; // giới hạn số ký tự một bài

// Thứ đính kèm vào bài: một bài hát, playlist, album hoặc nghệ sĩ
export type AttachKind = 'song' | 'playlist' | 'album' | 'artist';
export interface Attachment {
  kind: AttachKind;
  id: string;
  title: string;
  subtitle: string;
  thumb?: string;
  source: 'yt' | 'local' | 'liked'; // playlist trong máy / Liked Songs / trên YouTube Music
  track?: Track; // với bài hát: đủ thông tin để bấm là phát
}

export interface Author {
  name: string;
  tag: string;
  color: string; // màu avatar chữ cái (người dùng giả)
  avatar?: string;
}

export interface Post {
  id: string;
  text: string;
  attach?: Attachment;
  createdAt: number;
  likes: number;
  liked: boolean;
  author?: Author; // bỏ trống = chính mình
}

const KEY = 'social:posts';

function readPosts(): Post[] {
  return kvGet<Post[]>(KEY) ?? [];
}

// Bài của mình, mới nhất lên đầu (tự cập nhật khi đăng / xoá / thích)
export function useMyPosts(): Post[] {
  const v = useDbVersion();
  return useMemo(() => readPosts().sort((a, b) => b.createdAt - a.createdAt), [v]);
}

export function createPost(text: string, attach?: Attachment) {
  const body = text.trim().slice(0, POST_MAX);
  if (!body && !attach) return;
  const post: Post = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: body, attach, createdAt: Date.now(), likes: 0, liked: false };
  kvSet(KEY, [post, ...readPosts()]);
}

export function deletePost(id: string) {
  kvSet(KEY, readPosts().filter((p) => p.id !== id));
}

export function toggleLikePost(id: string) {
  kvSet(
    KEY,
    readPosts().map((p) => (p.id === id ? { ...p, liked: !p.liked, likes: Math.max(0, p.likes + (p.liked ? -1 : 1)) } : p))
  );
}

// ---- Bài mẫu cho tab Đăng lại (người dùng giả, chỉ để xem giao diện)
const HOUR = 3600 * 1000;
export function sampleReposts(): Post[] {
  const now = Date.now();
  return [
    {
      id: 'demo1',
      author: { name: 'Mây', tag: 'chill', color: '#3C6DC2' },
      text: 'Tối nay mưa, ai cần một playlist để ngồi cạnh cửa sổ thì nghe cái này nha 🌧️',
      attach: { kind: 'playlist', id: 'demo', title: 'Rainy night', subtitle: 'Playlist • 32 bài', source: 'yt' },
      createdAt: now - 3 * HOUR,
      likes: 128,
      liked: false,
    },
    {
      id: 'demo2',
      author: { name: 'Khoa', tag: 'lofi', color: '#2E7D6B' },
      text: 'Nghe đi nghe lại cả tuần nay mà vẫn chưa chán. Đoạn bridge ở phút thứ 2 quá đỉnh.',
      createdAt: now - 26 * HOUR,
      likes: 42,
      liked: true,
    },
  ];
}

// "5 phút", "3 giờ", "2 ngày", rồi tới ngày/tháng
export function timeAgo(at: number, lang: 'vi' | 'en'): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  const vi = lang === 'vi';
  if (s < 60) return vi ? 'Vừa xong' : 'now';
  if (s < 3600) return `${Math.floor(s / 60)}${vi ? ' phút' : 'm'}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${vi ? ' giờ' : 'h'}`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}${vi ? ' ngày' : 'd'}`;
  const d = new Date(at);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
