-- ============================================================
-- ZYX: hồ sơ (username không trùng), đăng nhập bằng username, bài đăng
-- Dán toàn bộ vào Supabase → SQL Editor → bấm Run (chạy 1 lần)
-- ============================================================

-- 1) Hồ sơ người dùng: mỗi tài khoản 1 dòng, username duy nhất
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text,
  tag text,
  avatar_url text,
  cover_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles: ai cũng xem được" on public.profiles
  for select to anon, authenticated using (true);
create policy "profiles: chỉ sửa hồ sơ của mình" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

grant select on public.profiles to anon, authenticated;
grant update (display_name, tag, avatar_url, cover_url) on public.profiles to authenticated;

-- 2) Đăng ký xong thì tự tạo hồ sơ với username người dùng chọn (trùng username thì đăng ký bị từ chối)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'), new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Kiểm tra username đã có người dùng chưa
create or replace function public.username_exists(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where username = lower(p_username));
$$;
revoke all on function public.username_exists(text) from public;
grant execute on function public.username_exists(text) to anon, authenticated;

-- 4) Đăng nhập bằng username: chỉ trả về Gmail khi username + mật khẩu ĐÚNG (sai thì trả về rỗng)
create or replace function public.login_email(p_username text, p_password text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_hash text;
begin
  select u.email, u.encrypted_password into v_email, v_hash
  from public.profiles p join auth.users u on u.id = p.id
  where p.username = lower(p_username);
  if v_hash is null or v_hash = '' then
    return null;
  end if;
  if extensions.crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;
  return null;
end;
$$;
revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- 5) Bài đăng (tab Trang chủ của Profile): chữ tối đa 500 ký tự + 1 thứ đính kèm
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  attach jsonb,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attach is not null)
);
create index posts_user_time on public.posts (user_id, created_at desc);
alter table public.posts enable row level security;

create policy "posts: ai cũng xem được" on public.posts
  for select to anon, authenticated using (true);
create policy "posts: chỉ đăng bài của mình" on public.posts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "posts: chỉ xoá bài của mình" on public.posts
  for delete to authenticated using (auth.uid() = user_id);

grant select on public.posts to anon, authenticated;
grant insert, delete on public.posts to authenticated;
