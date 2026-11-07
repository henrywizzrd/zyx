import type { Track } from './mock';
import type { TrendingRegion } from '../theme/types';

// Top Tháng / Năm: YouTube Music chỉ có bảng xếp hạng tuần → server ZYX (Supabase, Edge Function trending-sync) lưu
// bảng xếp hạng tuần của YouTube Charts mỗi ngày rồi cộng dồn: Tháng = các tuần trong 31 ngày gần nhất, Năm = 365 ngày.
// Mới chạy thì chưa đủ tuần (gathering: đã có / cần bao nhiêu tuần)
export type SummedRange = 'week' | 'month' | 'year';
export type SummedTrending = { songs: Track[]; gathering?: { have: number; need: number } };

export async function loadTrendingSummed(range: SummedRange, region: TrendingRegion, limit = 50): Promise<SummedTrending | null> {
  if (range === 'week') return loadTrendingWeek(region, limit);
  const { supabase } = require('../backend/supabase') as typeof import('../backend/supabase');
  const { data, error } = await supabase.rpc('trending_top', { p_region: region, p_days: range === 'month' ? 31 : 365, p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as { video_id: string; title: string; artist: string | null; thumb: string | null; total_weeks: number }[];
  if (!rows.length) return null;
  const songs: Track[] = rows.map((r) => ({ id: r.video_id, title: r.title, artist: r.artist ?? '', thumb: r.thumb ?? undefined, color: '#333333', duration: 0 }));
  const need = range === 'month' ? 4 : 52;
  const have = rows[0].total_weeks ?? 0;
  return { songs, gathering: have < need ? { have, need } : undefined };
}

// Top TUẦN: bảng xếp hạng tuần mới nhất server đã lưu (đúng bảng "Top songs" của YouTube Charts, theo hạng)
export async function loadTrendingWeek(region: TrendingRegion, limit = 50): Promise<SummedTrending | null> {
  const { supabase } = require('../backend/supabase') as typeof import('../backend/supabase');
  const { data, error } = await supabase
    .from('trending_weekly')
    .select('week_start, video_id, title, artist, thumb, rank')
    .eq('region', region)
    .order('week_start', { ascending: false })
    .order('rank', { ascending: true })
    .limit(limit + 100);
  if (error) throw error;
  const rows = (data ?? []) as { week_start: string; video_id: string; title: string; artist: string | null; thumb: string | null }[];
  if (!rows.length) return null;
  const latest = rows[0].week_start;
  const songs: Track[] = rows
    .filter((r) => r.week_start === latest)
    .slice(0, limit)
    .map((r) => ({ id: r.video_id, title: r.title, artist: r.artist ?? '', thumb: r.thumb ?? undefined, color: '#333333', duration: 0 }));
  return { songs };
}

// Mã của danh sách cộng dồn, dùng làm id ngữ cảnh phát / mục "Nghe gần đây" và trang danh sách đầy đủ: "trending:VN:year"
export const trendingId = (region: TrendingRegion, range: SummedRange) => `trending:${region}:${range}`;
export function parseTrendingId(id: string): { region: TrendingRegion; range: SummedRange } | null {
  const m = /^trending:(ZZ|VN|KR|US):(week|month|year)$/.exec(id);
  return m ? { region: m[1] as TrendingRegion, range: m[2] as SummedRange } : null;
}
