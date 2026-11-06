import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPatch, fetchPosts, onPostPatch } from '../data/community';
import type { Post } from '../data/social';

// Một bài có thể xuất hiện nhiều lần trên bảng tin (bài gốc + mỗi lượt đăng lại)
export const feedKey = (p: Post) => `${p.id}:${p.repostedBy?.id ?? ''}`;

// Dữ liệu bảng tin: tải trang đầu (limit bài), kéo để làm mới, tải thêm bài cũ hơn khi cuộn tới cuối
export function useFeed(limit: number) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(true);
  const busy = useRef(false);
  const postsRef = useRef<Post[] | null>(null);
  postsRef.current = posts;

  const refresh = useCallback((pull = false) => {
    if (busy.current) return;
    busy.current = true;
    if (pull) setRefreshing(true);
    setError(null);
    fetchPosts(null, undefined, undefined, limit)
      .then((l) => {
        setPosts(l);
        setMore(l.length >= limit);
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => {
        busy.current = false;
        setRefreshing(false);
      });
  }, [limit]);

  const loadMore = useCallback(() => {
    const cur = postsRef.current;
    if (busy.current || !more || !cur?.length) return;
    busy.current = true;
    const last = cur[cur.length - 1];
    fetchPosts(null, last.itemTime ?? last.createdAt, undefined, limit)
      .then((l) => {
        setPosts((c) => (c ? [...c, ...l.filter((p) => !c.some((x) => feedKey(x) === feedKey(p)))] : l));
        setMore(l.length >= limit);
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
  }, [limit, more]);

  useEffect(() => refresh(), [refresh]);
  useEffect(() => onPostPatch((p) => setPosts((l) => (l ? applyPatch(l, p) : l))), []);
  return { posts, error, refreshing, more, refresh, loadMore };
}
