-- ============================================================
-- ZYX 003: hồ sơ riêng cho từng tài khoản (đồng bộ tên, #tag, màu, avatar, ảnh bìa)
-- Dán vào Supabase → SQL Editor → Run (SAU file 002; chạy lại nhiều lần cũng không sao)
-- ============================================================

-- 1) Thêm vài cột cho hồ sơ
alter table public.profiles add column if not exists cover_tone text check (cover_tone in ('dark', 'light'));
alter table public.profiles add column if not exists avatar_color text check (avatar_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles add column if not exists wall_color text check (wall_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len check (char_length(display_name) <= 40) not valid;
alter table public.profiles drop constraint if exists profiles_tag_len;
alter table public.profiles add constraint profiles_tag_len check (char_length(tag) <= 30) not valid;

grant update (display_name, tag, avatar_url, cover_url, cover_tone, avatar_color, wall_color) on public.profiles to authenticated;

-- 2) Kho ảnh "profiles": ai cũng xem được (để người khác thấy avatar / ảnh bìa),
--    mỗi tài khoản chỉ được tải lên / sửa / xoá trong thư mục mang id của chính mình. Tối đa 5 MB, chỉ ảnh
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profiles', 'profiles', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "profiles ảnh: tải lên thư mục của mình" on storage.objects;
create policy "profiles ảnh: tải lên thư mục của mình" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profiles' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profiles ảnh: sửa ảnh của mình" on storage.objects;
create policy "profiles ảnh: sửa ảnh của mình" on storage.objects
  for update to authenticated
  using (bucket_id = 'profiles' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profiles ảnh: xoá ảnh của mình" on storage.objects;
create policy "profiles ảnh: xoá ảnh của mình" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profiles' and (storage.foldername(name))[1] = auth.uid()::text);
-- Cần quyền xem file của mình để upsert / xoá hoạt động
drop policy if exists "profiles ảnh: xem ảnh của mình" on storage.objects;
create policy "profiles ảnh: xem ảnh của mình" on storage.objects
  for select to authenticated
  using (bucket_id = 'profiles' and (storage.foldername(name))[1] = auth.uid()::text);
