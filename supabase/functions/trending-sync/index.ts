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

async function fetchChart(yt: string | null) {
  const res = await fetch('https://charts.youtube.com/youtubei/v1/browse?alt=json&prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://charts.youtube.com', Referer: 'https://charts.youtube.com/' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'en', gl: 'US', theme: 'MUSIC' } },
      browseId: 'FEmusic_analytics_charts_home',
      query: `chart_params_type=WEEK&perspective=CHART&flags=viral_video_chart&selected_chart=TRACKS&chart_params_id=weekly:0:0${yt ? `:${yt}` : ''}`,
    }),
  });
  if (!res.ok) throw new Error(`YouTube Charts ${res.status}`);
  const data = await res.json();
  const content = data?.contents?.sectionListRenderer?.contents?.[0]?.musicAnalyticsSectionRenderer?.content;
  const items: any[] = content?.trackTypes?.[0]?.trackViews ?? [];
  // Ngày kết thúc tuần nếu YouTube có ghi trong dữ liệu (dạng 20261030), không thì tính theo hôm nay
  const m = JSON.stringify(content?.perspectiveMetadata ?? {}).match(/(20\d{2})(\d{2})(\d{2})/);
  const week = m ? weekStart(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)) : weekStart(new Date(Date.now() - 7 * 864e5));
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
  return { week, rows, sampleKeys: items[0] ? Object.keys(items[0]) : [] };
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const report: Record<string, unknown> = {};
  for (const r of REGIONS) {
    try {
      const { data: lastRow } = await db.from('trending_weekly').select('fetched_at').eq('region', r.code).order('fetched_at', { ascending: false }).limit(1);
      const last = lastRow?.[0]?.fetched_at ? new Date(lastRow[0].fetched_at).getTime() : 0;
      if (Date.now() - last < MIN_HOURS_BETWEEN * 3600e3) {
        report[r.code] = 'skip (vừa lấy gần đây)';
        continue;
      }
      const { week, rows, sampleKeys } = await fetchChart(r.yt);
      if (!rows.length) {
        report[r.code] = { error: 'không đọc được bài nào', sampleKeys };
        continue;
      }
      const now = new Date().toISOString();
      const { error } = await db
        .from('trending_weekly')
        .upsert(rows.map((x) => ({ ...x, region: r.code, week_start: week, fetched_at: now })), { onConflict: 'region,week_start,video_id' });
      report[r.code] = error ? { error: error.message } : { week, songs: rows.length, withViews: rows.filter((x) => x.views).length, sampleKeys };
    } catch (e) {
      report[r.code] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
