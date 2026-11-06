// Cộng đồng: tìm người dùng, hồ sơ người khác, theo dõi, thích, bình luận, bảng tin.
// Tất cả nằm trên Supabase (supabase/004_community.sql). Khách xem được, muốn thích / bình luận / theo dõi thì cần tài khoản
import { currentAccount } from './auth';
import type { Attachment, Post } from './social';

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;

export interface UserRow {
  id: string;
  username: string;
  name: string;
  tag: string;
  avatar?: string;
  color: string;
  followers: number;
}

export interface ProfileCard extends UserRow {
  cover?: string;
  wall: string;
  following: number;
  isFollowing: boolean;
  posts: number;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  text: string;
  createdAt: number;
  author: { id: string; username: string; name: string; tag: string; avatar?: string; color: string };
}

const COLOR = '#8E6CF0';
const WALL = '#0B4A7A';
const nameOf = (r: { display_name?: string | null; username: string }) => r.display_name || r.username;

// Chữ "không có mạng / chưa đăng nhập" để màn hình hiện thông báo phù hợp
export class NeedAccount extends Error {}

function requireAccount() {
  const acc = currentAccount();
  if (!acc) throw new NeedAccount('need-account');
  return acc;
}

export async function searchUsers(q: string): Promise<UserRow[]> {
  const { data, error } = await sb().rpc('search_users', { q });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    username: r.username,
    name: nameOf(r),
    tag: r.tag || r.username,
    avatar: r.avatar_url ?? undefined,
    color: r.avatar_color || COLOR,
    followers: Number(r.followers) || 0,
  }));
}

export async function getProfileCard(id: string): Promise<ProfileCard | null> {
  const { data, error } = await sb().rpc('profile_card', { p_user: id });
  if (error) throw error;
  const r = (data ?? [])[0];
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    name: nameOf(r),
    tag: r.tag || r.username,
    avatar: r.avatar_url ?? undefined,
    cover: r.cover_url ?? undefined,
    color: r.avatar_color || COLOR,
    wall: r.wall_color || WALL,
    followers: Number(r.followers) || 0,
    following: Number(r.following) || 0,
    isFollowing: !!r.is_following,
    posts: Number(r.posts) || 0,
  };
}

export async function setFollow(userId: string, follow: boolean) {
  const acc = requireAccount();
  if (follow) {
    const { error } = await sb().from('follows').insert({ followee: userId });
    if (error && error.code !== '23505') throw error; // đã theo dõi rồi thì thôi
  } else {
    const { error } = await sb().from('follows').delete().eq('follower', acc.id).eq('followee', userId);
    if (error) throw error;
  }
}

// Bài đăng: userId = null → bảng tin (mọi người, mới nhất trước)
export async function fetchPosts(userId: string | null, before?: number): Promise<Post[]> {
  const { data, error } = await sb().rpc('post_rows', {
    p_user: userId,
    p_before: before ? new Date(before).toISOString() : null,
    p_limit: 30,
  });
  if (error) throw error;
  const me = currentAccount()?.id;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    text: r.body ?? '',
    attach: (r.attach as Attachment | null) ?? undefined,
    createdAt: Date.parse(r.created_at),
    likes: Number(r.likes) || 0,
    liked: !!r.liked,
    comments: Number(r.comments) || 0,
    remote: true,
    // bài của chính mình: bỏ trống author → thẻ bài dùng tên / ảnh trong hồ sơ của mình và hiện nút xoá
    author:
      r.user_id === me
        ? undefined
        : { id: r.user_id, username: r.username, name: nameOf(r), tag: r.tag || r.username, avatar: r.avatar_url ?? undefined, color: r.avatar_color || COLOR },
  }));
}

export async function setLike(postId: string, like: boolean) {
  const acc = requireAccount();
  if (like) {
    const { error } = await sb().from('post_likes').insert({ post_id: postId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await sb().from('post_likes').delete().eq('post_id', postId).eq('user_id', acc.id);
    if (error) throw error;
  }
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const { data, error } = await sb().rpc('comment_rows', { p_post: postId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    postId: r.post_id,
    userId: r.user_id,
    text: r.body,
    createdAt: Date.parse(r.created_at),
    author: { id: r.user_id, username: r.username, name: nameOf(r), tag: r.tag || r.username, avatar: r.avatar_url ?? undefined, color: r.avatar_color || COLOR },
  }));
}

export async function addComment(postId: string, text: string) {
  requireAccount();
  const { error } = await sb().from('post_comments').insert({ post_id: postId, body: text.trim().slice(0, 500) });
  if (error) throw error;
}

export async function deleteComment(id: string) {
  requireAccount();
  const { error } = await sb().from('post_comments').delete().eq('id', id);
  if (error) throw error;
}

// Báo cho các danh sách bài đang mở biết một bài vừa đổi (thích / bình luận / xoá) để cập nhật ngay
type Patch = { id: string; likes?: number; liked?: boolean; comments?: number; deleted?: boolean };
const listeners = new Set<(p: Patch) => void>();
export const onPostPatch = (fn: (p: Patch) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const emitPostPatch = (p: Patch) => listeners.forEach((fn) => fn(p));
export const applyPatch = (list: Post[], p: Patch) =>
  p.deleted ? list.filter((x) => x.id !== p.id) : list.map((x) => (x.id === p.id ? { ...x, ...p } : x));
