-- ============================================================
-- ZYX 007: Trending theo Tháng / Năm
-- Edge Function "trending-sync" mỗi ngày lưu bảng xếp hạng bài hát TUẦN của YouTube Charts (Toàn cầu, VN, KR, US)
-- vào bảng trending_weekly. App cộng dồn các tuần: Tháng = 4-5 tuần gần nhất, Năm = 52 tuần gần nhất.
--
-- Thứ tự làm:
--   1. Database → Extensions: bật pg_cron và pg_net
--   2. Deploy Edge Function trending-sync (xem đầu file supabase/functions/trending-sync/index.ts)
--   3. Dán file này vào SQL Editor → Run (chạy lại nhiều lần cũng không sao)
-- ============================================================

create table if not exists public.trending_weekly (
  region text not null,          -- ZZ (toàn cầu), VN, KR, US
  week_start date not null,      -- thứ Hai của tuần xếp hạng
  video_id text not null,
  title text not null,
  artist text,
  thumb text,
  rank int not null,             -- hạng trong tuần (1 = cao nhất)
  views bigint,                  -- lượt xem trong tuần (nếu YouTube có trả về)
  fetched_at timestamptz not null default now(),
  primary key (region, week_start, video_id)
);
create index if not exists trending_weekly_region_week on public.trending_weekly (region, week_start desc);

-- Ai cũng đọc được; chỉ Edge Function (service role, tự bỏ qua RLS) được ghi
alter table public.trending_weekly enable row level security;
drop policy if exists "trending: ai cũng xem được" on public.trending_weekly;
create policy "trending: ai cũng xem được" on public.trending_weekly for select using (true);
revoke insert, update, delete on public.trending_weekly from anon, authenticated;
grant select on public.trending_weekly to anon, authenticated;

-- Top bài của một khu vực trong p_days ngày gần nhất.
-- Điểm mỗi tuần: lượt xem nếu có, không thì theo hạng (hạng 1 = 100 điểm, hạng 100 = 1 điểm). Cộng dồn các tuần.
create or replace function public.trending_top(p_region text, p_days int, p_limit int default 50)
returns table (video_id text, title text, artist text, thumb text, score numeric, weeks int, total_weeks int)
language sql stable security invoker set search_path = public as $$
  with w as (
    select * from public.trending_weekly
    where region = p_region and week_start > current_date - make_interval(days => p_days)
  ),
  tw as (select count(distinct week_start)::int as n from w),
  has_views as (select bool_and(views is not null) as v from w)
  select
    w.video_id,
    (array_agg(w.title order by w.week_start desc))[1],
    (array_agg(w.artist order by w.week_start desc))[1],
    (array_agg(w.thumb order by w.week_start desc))[1],
    sum(case when (select v from has_views) then w.views::numeric else (101 - least(w.rank, 100))::numeric end) as score,
    count(*)::int as weeks,
    (select n from tw) as total_weeks
  from w
  group by w.video_id
  order by score desc
  limit greatest(1, least(p_limit, 100));
$$;
grant execute on function public.trending_top(text, int, int) to anon, authenticated;

-- Lịch chạy: mỗi ngày 02:23 UTC (09:23 giờ Việt Nam) gọi Edge Function
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('zyx-trending-sync') where exists (select 1 from cron.job where jobname = 'zyx-trending-sync');
select cron.schedule(
  'zyx-trending-sync',
  '23 2 * * *',
  $$ select net.http_post(
       url := 'https://ykekybcmliysyvqfyytx.supabase.co/functions/v1/trending-sync',
       headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_WsvPSq1B93IpX_wMdnXKyA_ZiQ2vkqT"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
