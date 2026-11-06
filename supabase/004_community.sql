-- ============================================================
-- ZYX 004: cộng đồng — theo dõi, thích, bình luận, bảng tin, tìm người dùng
-- Dán vào Supabase → SQL Editor → Run (SAU file 003; chạy lại nhiều lần cũng không sao)
-- ============================================================

-- 1) Theo dõi: follower theo dõi followee
create table if not exists public.follows (
  follower uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);
alter table public.follows enable row level security;
drop policy if exists "follows: ai cũng xem được" on public.follows;
create policy "follows: ai cũng xem được" on public.follows for select using (true);
drop policy if exists "follows: tự theo dõi" on public.follows;
create policy "follows: tự theo dõi" on public.follows for insert to authenticated with check (follower = auth.uid());
drop policy if exists "follows: tự bỏ theo dõi" on public.follows;
create policy "follows: tự bỏ theo dõi" on public.follows for delete to authenticated using (follower = auth.uid());
grant select on public.follows to anon, authenticated;
grant insert (followee), delete on public.follows to authenticated;

-- 2) Thích bài đăng
create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user on public.post_likes (user_id);
alter table public.post_likes enable row level security;
drop policy if exists "likes: ai cũng xem được" on public.post_likes;
create policy "likes: ai cũng xem được" on public.post_likes for select using (true);
drop policy if exists "likes: tự thích" on public.post_likes;
create policy "likes: tự thích" on public.post_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "likes: tự bỏ thích" on public.post_likes;
create policy "likes: tự bỏ thích" on public.post_likes for delete to authenticated using (user_id = auth.uid());
grant select on public.post_likes to anon, authenticated;
grant insert (post_id), delete on public.post_likes to authenticated;

-- 3) Bình luận (tối đa 500 ký tự). Người viết xoá được bình luận của mình, chủ bài xoá được mọi bình luận trong bài
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post on public.post_comments (post_id, created_at);
alter table public.post_comments enable row level security;
drop policy if exists "comments: ai cũng xem được" on public.post_comments;
create policy "comments: ai cũng xem được" on public.post_comments for select using (true);
drop policy if exists "comments: tự viết" on public.post_comments;
create policy "comments: tự viết" on public.post_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "comments: xoá" on public.post_comments;
create policy "comments: xoá" on public.post_comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
grant select on public.post_comments to anon, authenticated;
grant insert (post_id, body), delete on public.post_comments to authenticated;

-- 4) Danh sách bài kèm tác giả + số thích / bình luận. p_user = null → bảng tin (mọi người, mới nhất trước)
create or replace function public.post_rows(p_user uuid default null, p_before timestamptz default null, p_limit int default 30)
returns table (
  id uuid, user_id uuid, body text, attach jsonb, created_at timestamptz,
  username text, display_name text, tag text, avatar_url text, avatar_color text,
  likes bigint, comments bigint, liked boolean, following boolean
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.user_id, p.body, p.attach, p.created_at,
         pr.username, pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color,
         (select count(*) from public.post_likes l where l.post_id = p.id),
         (select count(*) from public.post_comments c where c.post_id = p.id),
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.user_id)
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  where (p_user is null or p.user_id = p_user)
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- 5) Thẻ hồ sơ của một người: thông tin + số người theo dõi / đang theo dõi + mình có đang theo dõi không
create or replace function public.profile_card(p_user uuid)
returns table (
  id uuid, username text, display_name text, tag text, avatar_url text, cover_url text,
  avatar_color text, wall_color text, followers bigint, following bigint, is_following boolean, posts bigint
)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.username, pr.display_name, pr.tag, pr.avatar_url, pr.cover_url, pr.avatar_color, pr.wall_color,
         (select count(*) from public.follows f where f.followee = pr.id),
         (select count(*) from public.follows f where f.follower = pr.id),
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = pr.id),
         (select count(*) from public.posts p where p.user_id = pr.id)
  from public.profiles pr where pr.id = p_user;
$$;

-- 6) Tìm người dùng theo username, tên hiển thị hoặc #tag (không phân biệt hoa thường)
create or replace function public.search_users(q text)
returns table (id uuid, username text, display_name text, tag text, avatar_url text, avatar_color text, followers bigint)
language sql stable security invoker set search_path = public as $$
  with k as (
    select '%' || replace(replace(replace(lower(trim(both '#@ ' from coalesce(q, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           lower(trim(both '#@ ' from coalesce(q, ''))) as raw
  )
  select pr.id, pr.username, pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color,
         (select count(*) from public.follows f where f.followee = pr.id)
  from public.profiles pr, k
  where length(k.raw) > 0
    and (pr.username ilike k.pat or pr.display_name ilike k.pat or pr.tag ilike k.pat)
  order by (pr.username = k.raw) desc, (pr.username ilike k.raw || '%') desc, pr.username
  limit 30;
$$;

-- 7) Bình luận của một bài, kèm tác giả, cũ nhất trước
create or replace function public.comment_rows(p_post uuid)
returns table (id uuid, post_id uuid, user_id uuid, body text, created_at timestamptz,
               username text, display_name text, tag text, avatar_url text, avatar_color text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.post_id, c.user_id, c.body, c.created_at, pr.username, pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color
  from public.post_comments c join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post
  order by c.created_at
  limit 300;
$$;

grant execute on function public.post_rows(uuid, timestamptz, int) to anon, authenticated;
grant execute on function public.profile_card(uuid) to anon, authenticated;
grant execute on function public.search_users(text) to anon, authenticated;
grant execute on function public.comment_rows(uuid) to anon, authenticated;
