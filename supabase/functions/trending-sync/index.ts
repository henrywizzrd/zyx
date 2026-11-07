// ZYX: lưu bảng xếp hạng bài hát TUẦN của YouTube Charts (charts.youtube.com) cho từng khu vực vào bảng trending_weekly.
// Chạy mỗi ngày một lần (pg_cron trong file 007_trending.sql gọi tới). App cộng dồn các tuần đã lưu để ra Top Tháng / Năm.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor → tên "trending-sync"
//   → dán file này → TẮT "Enforce JWT verification" (cron gọi bằng publishable key, không phải JWT) → Deploy.
// Biến SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY Supabase tự cấp cho function, KHÔNG cần (và không được) dán key vào đây.
import { createClient } from 'npm:@supabase/supabase-js@2';

const REGIONS: { code: string; yt: string | null }[] = [
  { code: 'ZZ', yt: null }, // toàn cầu
  { code: 'VN', yt: 'vn' },
  { code: 'KR', yt: 'kr' },
  { code: 'US', yt: 'us' },
];
const MIN_HOURS_BETWEEN = 6; // ai đó gọi liên tục thì bỏ qua (mỗi khu vực tối đa 1 lần / 6 giờ)

// Ngày thứ Hai của tuần chứa ngày d (UTC), dạng YYYY-MM-DD: dùng làm "mã tuần"
function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = thứ Hai
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

async function fetchChart(yt: string | null, chartId = 'weekly:0:0') {
  const res = await fetch('https://charts.youtube.com/youtubei/v1/browse?alt=json&prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://charts.youtube.com', Referer: 'https://charts.youtube.com/' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'en', gl: 'US', theme: 'MUSIC' } },
      browseId: 'FEmusic_analytics_charts_home',
      query: `chart_params_type=WEEK&perspective=CHART&flags=viral_video_chart&selected_chart=TRACKS&chart_params_id=${chartId}${yt ? `:${yt}` : ''}`,
    }),
  });
  if (!res.ok) throw new Error(`YouTube Charts ${res.status}`);
  const data = await res.json();
  const content = data?.contents?.sectionListRenderer?.contents?.[0]?.musicAnalyticsSectionRenderer?.content;
  const items: any[] = content?.trackTypes?.[0]?.trackViews ?? [];
  // Tuần của bảng xếp hạng: lấy ngày MUỘN NHẤT YouTube ghi trong phần mô tả bảng (dạng 20261030 hoặc 2026-10-30),
  // không thấy thì tính theo hôm nay lùi 1 tuần
  const meta = JSON.stringify(content?.perspectiveMetadata ?? {});
  const dates = [...meta.matchAll(/(20\d{2})-?(\d{2})-?(\d{2})/g)]
    .map((x) => `${x[1]}-${x[2]}-${x[3]}`)
    .filter((d) => !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() + 864e5)
    .sort();
  const latest = dates[dates.length - 1];
  const week = latest ? weekStart(new Date(`${latest}T00:00:00Z`)) : weekStart(new Date(Date.now() - 7 * 864e5));
  const rows = items
    .map((it, i) => {
      const id = it?.encryptedVideoId ?? it?.id;
      const thumbs = it?.thumbnail?.thumbnails ?? [];
      const views = Number(it?.viewCount ?? it?.views ?? it?.chartEntryMetadata?.viewCount);
      return id && it?.name
        ? {
            video_id: String(id),
            title: String(it.name),
            artist: (it.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', ') || null,
            thumb: thumbs.length ? thumbs[thumbs.length - 1].url : null,
            rank: Number(it?.chartEntryMetadata?.currentPosition) || i + 1,
            views: Number.isFinite(views) && views > 0 ? Math.round(views) : null,
          }
        : null;
    })
    .filter(Boolean) as any[];
  return { week, rows, dates };
}

// Lấy lại các tuần cũ (chạy tay 1 lần cho từng khu vực): ?backfill=52&region=VN
// YouTube liệt kê sẵn các tuần có bảng xếp hạng (danh sách "dates"); thử vài kiểu mã tuần, kiểu nào trả về
// bảng khác với tuần mới nhất (lượt xem khác) thì dùng kiểu đó cho các tuần còn lại
const pad = (d: string) => d.replaceAll('-', '');
const FORMATS: ((d: string) => string)[] = [
  (d) => `weekly:${pad(d)}:0`,
  (d) => `weekly:${d}:0`,
  (d) => `weekly:${pad(d)}`,
  (d) => `weekly:${d}`,
];
async function backfill(db: any, region: { code: string; yt: string | null }, weeks: number) {
  const latest = await fetchChart(region.yt);
  const latestViews = latest.rows[0]?.views;
  // Gom ngày theo tuần, mỗi tuần lấy ngày muộn nhất (ngày kết thúc tuần)
  const byWeek = new Map<string, string>();
  for (const d of latest.dates) {
    const w = weekStart(new Date(`${d}T00:00:00Z`));
    if (!byWeek.has(w) || byWeek.get(w)! < d) byWeek.set(w, d);
  }
  const past = [...byWeek.entries()].filter(([w]) => w < latest.week).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, weeks);
  let fmt: ((d: string) => string) | null = null;
  const tried: string[] = [];
  let stored = 0;
  for (const [w, end] of past) {
    const candidates = fmt ? [fmt] : FORMATS;
    for (const f of candidates) {
      try {
        const r = await fetchChart(region.yt, f(end));
        if (!fmt) tried.push(`${f(end)} → ${r.rows.length} bài, top1 ${r.rows[0]?.title ?? '-'}`);
        if (!r.rows.length || (!fmt && r.rows[0]?.views === latestViews)) continue; // không ra, hoặc vẫn là tuần mới nhất
        fmt = f;
        const { error } = await db
          .from('trending_weekly')
          .upsert(r.rows.map((x: any) => ({ ...x, region: region.code, week_start: w })), { onConflict: 'region,week_start,video_id' });
        if (!error) stored++;
        break;
      } catch (e) {
        if (!fmt) tried.push(`${f(end)} → lỗi ${String(e)}`);
      }
    }
    if (!fmt) break; // không kiểu nào dùng được: dừng, báo lại các kiểu đã thử
  }
  return { latestWeek: latest.week, weeksAvailable: byWeek.size, stored, format: fmt ? fmt('YYYY-MM-DD') : null, tried };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const bf = Number(url.searchParams.get('backfill'));
  if (bf > 0) {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const region = REGIONS.find((r) => r.code === (url.searchParams.get('region') ?? 'ZZ').toUpperCase()) ?? REGIONS[0];
    const out = await backfill(db, region, Math.min(60, bf));
    return new Response(JSON.stringify({ region: region.code, ...out }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }

  // ?force=1: bỏ qua giới hạn 6 giờ (để bấm Test thử lại)
  const force = url.searchParams.get('force') === '1';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const report: Record<string, unknown> = {};
  for (const r of REGIONS) {
    try {
      const { data: lastRow } = await db.from('trending_weekly').select('fetched_at').eq('region', r.code).order('fetched_at', { ascending: false }).limit(1);
      const last = lastRow?.[0]?.fetched_at ? new Date(lastRow[0].fetched_at).getTime() : 0;
      if (!force && Date.now() - last < MIN_HOURS_BETWEEN * 3600e3) {
        report[r.code] = 'skip (vừa lấy gần đây)';
        continue;
      }
      const { week, rows } = await fetchChart(r.yt);
      if (!rows.length) {
        report[r.code] = { error: 'không đọc được bài nào' };
        continue;
      }
      const now = new Date().toISOString();
      const { error } = await db
        .from('trending_weekly')
        .upsert(rows.map((x) => ({ ...x, region: r.code, week_start: week, fetched_at: now })), { onConflict: 'region,week_start,video_id' });
      report[r.code] = error ? { error: error.message } : { week, songs: rows.length, withViews: rows.filter((x) => x.views).length, top1: rows[0]?.title };
    } catch (e) {
      report[r.code] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
