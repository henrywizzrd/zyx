-- ============================================================
-- ZYX 005: Tên#tag kiểu Discord + ẩn username
--  - Tên hiển thị trùng được, tag trùng được, nhưng cặp Tên#tag là DUY NHẤT (không phân biệt hoa thường)
--  - Tài khoản mới tự được tag 4 số ngẫu nhiên chưa ai dùng với tên đó
--  - Username chỉ dùng để đăng nhập: người khác không đọc được nữa
--  - Tìm người dùng: gõ thường → theo tên hiển thị (ra nhiều người); gõ Tên#tag hoặc #tag → đúng người
-- Dán vào Supabase → SQL Editor → Run (SAU file 004; chạy lại nhiều lần cũng không sao)
-- ============================================================

-- 1) Tìm một tag 4 số còn trống cho một tên
create or replace function public.free_tag(p_name text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  t text;
  i int := 0;
begin
  loop
    t := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where lower(display_name) = lower(p_name) and lower(tag) = lower(t));
    i := i + 1;
    if i > 60 then
      t := lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit;
    end if;
  end loop;
  return t;
end;
$$;
revoke all on function public.free_tag(text) from public, anon, authenticated;

-- 2) Mỗi lần tạo / sửa hồ sơ: thiếu tên thì lấy username, thiếu tag thì cấp tag ngẫu nhiên
create or replace function public.profiles_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.display_name := nullif(btrim(coalesce(new.display_name, '')), '');
  if new.display_name is null then
    new.display_name := coalesce(new.username, 'zyx');
  end if;
  new.tag := nullif(btrim(replace(coalesce(new.tag, ''), '#', '')), '');
  if new.tag is null then
    new.tag := public.free_tag(new.display_name);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_fill on public.profiles;
create trigger profiles_fill before insert or update on public.profiles
  for each row execute function public.profiles_fill();

-- 3) Dọn dữ liệu cũ: điền tên / tag còn trống, cặp Tên#tag bị trùng thì người tạo sau nhận tag mới
update public.profiles set display_name = display_name where display_name is null or tag is null or btrim(tag) = '';
do $$
declare r record;
begin
  for r in
    select id, display_name from (
      select id, display_name,
             row_number() over (partition by lower(display_name), lower(tag) order by created_at) as rn
      from public.profiles
    ) x where rn > 1
  loop
    update public.profiles set tag = public.free_tag(r.display_name) where id = r.id;
  end loop;
end;
$$;
create unique index if not exists profiles_name_tag on public.profiles (lower(display_name), lower(tag));

-- 4) Kiểm tra Tên#tag còn trống không (trước khi lưu tên / tag mới)
create or replace function public.name_tag_free(p_name text, p_tag text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.profiles
    where lower(display_name) = lower(btrim(p_name)) and lower(tag) = lower(btrim(replace(p_tag, '#', '')))
      and id is distinct from auth.uid()
  );
$$;
revoke all on function public.name_tag_free(text, text) from public;
grant execute on function public.name_tag_free(text, text) to authenticated;

-- 5) Username của chính mình (dùng lúc đăng nhập Google để biết đã chọn username chưa)
create or replace function public.my_username()
returns text language sql stable security definer set search_path = '' as $$
  select username from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_username() from public;
grant execute on function public.my_username() to authenticated;

-- 6) Ẩn username: chỉ cho đọc các cột công khai
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, tag, avatar_url, cover_url, cover_tone, avatar_color, wall_color, created_at) on public.profiles to anon, authenticated;

-- 7) Làm lại các hàm của file 004 (bỏ username khỏi kết quả). Đổi kiểu kết quả nên phải xoá hàm cũ trước
drop function if exists public.post_rows(uuid, timestamptz, int);
drop function if exists public.profile_card(uuid);
drop function if exists public.search_users(text);
drop function if exists public.comment_rows(uuid);

create function public.post_rows(p_user uuid default null, p_before timestamptz default null, p_limit int default 30)
returns table (
  id uuid, user_id uuid, body text, attach jsonb, created_at timestamptz,
  display_name text, tag text, avatar_url text, avatar_color text,
  likes bigint, comments bigint, liked boolean, following boolean
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.user_id, p.body, p.attach, p.created_at,
         pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color,
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

create function public.profile_card(p_user uuid)
returns table (
  id uuid, display_name text, tag text, avatar_url text, cover_url text,
  avatar_color text, wall_color text, followers bigint, following bigint, is_following boolean, posts bigint
)
language sql stable security invoker set search_path = public as $$
  select pr.id, pr.display_name, pr.tag, pr.avatar_url, pr.cover_url, pr.avatar_color, pr.wall_color,
         (select count(*) from public.follows f where f.followee = pr.id),
         (select count(*) from public.follows f where f.follower = pr.id),
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = pr.id),
         (select count(*) from public.posts p where p.user_id = pr.id)
  from public.profiles pr where pr.id = p_user;
$$;

-- Gõ thường: tên hiển thị CÓ CHỨA chữ đó (nhiều người). Gõ Tên#tag: đúng người. Gõ #tag: mọi người có tag đó
create function public.search_users(q text)
returns table (id uuid, display_name text, tag text, avatar_url text, avatar_color text, followers bigint)
language sql stable security invoker set search_path = public as $$
  with k as (
    select btrim(coalesce(q, '')) as raw
  ), parts as (
    select position('#' in raw) > 0 as has_tag,
           btrim(case when position('#' in raw) > 0 then split_part(raw, '#', 1) else raw end) as name,
           btrim(case when position('#' in raw) > 0 then split_part(raw, '#', 2) else '' end) as tag
    from k
  )
  select pr.id, pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color,
         (select count(*) from public.follows f where f.followee = pr.id) as followers
  from public.profiles pr, parts
  where (parts.has_tag and parts.tag <> '' and lower(pr.tag) = lower(parts.tag)
           and (parts.name = '' or lower(pr.display_name) = lower(parts.name)))
     or (not parts.has_tag and parts.name <> ''
           and pr.display_name ilike '%' || replace(replace(replace(parts.name, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by (lower(pr.display_name) = lower(parts.name)) desc, followers desc, pr.display_name
  limit 30;
$$;

create function public.comment_rows(p_post uuid)
returns table (id uuid, post_id uuid, user_id uuid, body text, created_at timestamptz,
               display_name text, tag text, avatar_url text, avatar_color text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.post_id, c.user_id, c.body, c.created_at, pr.display_name, pr.tag, pr.avatar_url, pr.avatar_color
  from public.post_comments c join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post
  order by c.created_at
  limit 300;
$$;

grant execute on function public.post_rows(uuid, timestamptz, int) to anon, authenticated;
grant execute on function public.profile_card(uuid) to anon, authenticated;
grant execute on function public.search_users(text) to anon, authenticated;
grant execute on function public.comment_rows(uuid) to anon, authenticated;
