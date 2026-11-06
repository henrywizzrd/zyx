-- ============================================================
-- ZYX 006: Đăng lại (kiểu Threads) + Playlist công khai (tab Share trong hồ sơ)
-- Dán vào Supabase → SQL Editor → Run (SAU file 005; chạy lại nhiều lần cũng không sao)
-- ============================================================

-- 1) Đăng lại bài của người khác (không tự đăng lại bài của mình)
create table if not exists public.reposts (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists reposts_post on public.reposts (post_id);
create index if not exists reposts_time on public.reposts (created_at desc);
alter table public.reposts enable row level security;
drop policy if exists "reposts: ai cũng xem được" on public.reposts;
create policy "reposts: ai cũng xem được" on public.reposts for select using (true);
drop policy if exists "reposts: tự đăng lại" on public.reposts;
create policy "reposts: tự đăng lại" on public.reposts for insert to authenticated
  with check (user_id = auth.uid() and not exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
drop policy if exists "reposts: tự bỏ đăng lại" on public.reposts;
create policy "reposts: tự bỏ đăng lại" on public.reposts for delete to authenticated using (user_id = auth.uid());
grant select on public.reposts to anon, authenticated;
grant insert (post_id), delete on public.reposts to authenticated;

-- 2) Playlist công khai: bản sao của playlist trong máy (để Công khai) để người khác xem và phát
create table if not exists public.shared_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  local_id text not null,
  title text not null check (char_length(title) between 1 and 100),
  description text check (char_length(description) <= 500),
  cover_url text,
  tracks jsonb not null default '[]'::jsonb check (jsonb_typeof(tracks) = 'array' and jsonb_array_length(tracks) <= 1000),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);
create index if not exists shared_playlists_user on public.shared_playlists (user_id, updated_at desc);
alter table public.shared_playlists enable row level security;
drop policy if exists "shared: ai cũng xem được" on public.shared_playlists;
create policy "shared: ai cũng xem được" on public.shared_playlists for select using (true);
drop policy if exists "shared: tự đăng" on public.shared_playlists;
create policy "shared: tự đăng" on public.shared_playlists for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "shared: tự sửa" on public.shared_playlists;
create policy "shared: tự sửa" on public.shared_playlists for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "shared: tự xoá" on public.shared_playlists;
create policy "shared: tự xoá" on public.shared_playlists for delete to authenticated using (user_id = auth.uid());
grant select on public.shared_playlists to anon, authenticated;
grant insert (local_id, title, description, cover_url, tracks, updated_at), update (title, description, cover_url, tracks, updated_at), delete
  on public.shared_playlists to authenticated;

-- 3) Danh sách bài (thay hàm của file 005): thêm số lượt đăng lại + ai đăng lại
--    p_mode: null / 'feed' = bảng tin (bài + lượt đăng lại của mọi người), 'posts' = bài của p_user, 'reposts' = bài p_user đã đăng lại
drop function if exists public.post_rows(uuid, timestamptz, int);
drop function if exists public.post_rows(uuid, timestamptz, int, text);
create function public.post_rows(p_user uuid default null, p_before timestamptz default null, p_limit int default 30, p_mode text default null)
returns table (
  id uuid, user_id uuid, body text, attach jsonb, created_at timestamptz,
  display_name text, tag text, avatar_url text, avatar_color text,
  likes bigint, comments bigint, liked boolean, following boolean,
  reposts bigint, reposted boolean, reposter_id uuid, reposter_name text, item_time timestamptz
)
language sql stable security invoker set search_path = public as $$
  with m as (
    select coalesce(p_mode, case when p_user is null then 'feed' else 'posts' end) as mode
  ), items as (
    select p.id as post_id, null::uuid as reposter, p.created_at as t
    from public.posts p, m
    where m.mode = 'feed' or (m.mode = 'posts' and p.user_id = p_user)
    union all
    select r.post_id, r.user_id, r.created_at
    from public.reposts r, m
    where m.mode = 'feed' or (m.mode = 'reposts' and r.user_id = p_user)
  )
  select p.id, p.user_id, p.body, p.attach, p.created_at,
         pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color,
         (select count(*) from public.post_likes l where l.post_id = p.id),
         (select count(*) from public.post_comments c where c.post_id = p.id),
         exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = p.user_id),
         (select count(*) from public.reposts r where r.post_id = p.id),
         exists (select 1 from public.reposts r where r.post_id = p.id and r.user_id = auth.uid()),
         i.reposter, rp.display_name, i.t
  from items i
  join public.posts p on p.id = i.post_id
  join public.profiles pr on pr.id = p.user_id
  left join public.profiles rp on rp.id = i.reposter
  where p_before is null or i.t < p_before
  order by i.t desc
  limit least(greatest(p_limit, 1), 50);
$$;
grant execute on function public.post_rows(uuid, timestamptz, int, text) to anon, authenticated;
