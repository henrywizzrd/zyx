-- ============================================================
-- ZYX 002: đăng nhập Google (chọn username lần đầu) + tên hiển thị
-- Dán vào Supabase → SQL Editor → Run (chạy 1 lần, SAU file 001)
-- ============================================================

-- Tài khoản Google lúc mới tạo chưa có username (người dùng chọn ngay sau đó)
alter table public.profiles alter column username drop not null;

-- Tạo hồ sơ khi đăng ký: tài khoản ZYX có sẵn username; tài khoản Google thì để trống, lấy tên Google làm tên hiển thị
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data ->> 'username'),
    coalesce(new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

-- Chọn username (chỉ 1 lần, cho tài khoản chưa có username). Trả về: ok / taken / invalid / already_set / unauthorized
create or replace function public.set_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return 'unauthorized';
  end if;
  if p_username is null or p_username !~ '^[a-z0-9_.]{3,20}$' then
    return 'invalid';
  end if;
  update public.profiles
    set username = p_username, display_name = coalesce(display_name, p_username)
    where id = auth.uid() and username is null;
  if not found then
    return 'already_set';
  end if;
  return 'ok';
exception when unique_violation then
  return 'taken';
end;
$$;
revoke all on function public.set_username(text) from public;
grant execute on function public.set_username(text) to authenticated;
