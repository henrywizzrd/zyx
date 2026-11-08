-- ============================================================
-- ZYX 008: Sao lưu thư viện theo tài khoản
-- Playlist, Liked Songs, album / playlist / nghệ sĩ đã lưu, lịch sử nghe (cho Recently played + Thống kê) và theme
-- được app tự gửi lên đây khi có thay đổi. Cài lại app / đổi máy → đăng nhập là tự khôi phục.
-- Mỗi tài khoản đúng 1 dòng, CHỈ chính chủ đọc / ghi được (không ai khác xem được, kể cả người dùng khác).
-- Dán vào Supabase → SQL Editor → Run (chạy lại nhiều lần cũng không sao)
-- ============================================================

create table if not exists public.library_backups (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  check (pg_column_size(data) < 4000000) -- tối đa ~4MB mỗi tài khoản
);

alter table public.library_backups enable row level security;
drop policy if exists "backup: chỉ chính chủ xem" on public.library_backups;
create policy "backup: chỉ chính chủ xem" on public.library_backups for select to authenticated using (user_id = auth.uid());
drop policy if exists "backup: chỉ chính chủ tạo" on public.library_backups;
create policy "backup: chỉ chính chủ tạo" on public.library_backups for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "backup: chỉ chính chủ sửa" on public.library_backups;
create policy "backup: chỉ chính chủ sửa" on public.library_backups for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.library_backups from anon;
grant select, insert (data, updated_at), update (data, updated_at) on public.library_backups to authenticated;
