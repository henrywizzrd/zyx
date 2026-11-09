// Nguồn lời thứ hai: Zing MP3 (mạnh về nhạc Việt, có lời chạy theo từng câu).
// Cách gọi giống web zingmp3.vn: mỗi yêu cầu kèm chữ ký sig = HMAC-SHA512(đường dẫn + SHA256(tham số), khoá bí mật).
// Phải ghé trang chủ một lần trước để nhận cookie (app tự giữ cookie cho các lần gọi sau).
// Lỗi gì cũng chỉ trả về null + ghi Nhật ký, không làm hỏng các nguồn lời khác.
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { log } from '../data/applog';
import type { LyricLine } from './lyrics';

const URL = 'https://zingmp3.vn';
const VERSION = '1.6.34';
const SECRET = '2aa2d1c561e809b267f3638c4a307aab';
const API_KEY = '88265e23d4284f25963e6eedac8fbfa3';

const h256 = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));
const sign = (path: string, params: string) => bytesToHex(hmac(sha512, utf8ToBytes(SECRET), utf8ToBytes(path + h256(params))));

let cookieAt = 0;
async function warm() {
  if (Date.now() - cookieAt < 20 * 60_000) return;
  await timed(URL, 6000);
  cookieAt = Date.now();
}

async function timed(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, credentials: 'include' });
  } finally {
    clearTimeout(t);
  }
}

async function call(path: string, q: Record<string, string>, sigParams: string, ctime: string): Promise<any | null> {
  const qs = new URLSearchParams({ ...q, ctime, version: VERSION, sig: sign(path, sigParams), apiKey: API_KEY }).toString();
  const r = await timed(`${URL}${path}?${qs}`, 8000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j?.err !== 0) throw new Error(`err ${j?.err} ${j?.msg ?? ''}`);
  return j.data;
}

// Bỏ dấu, ký tự lạ để so tên bài
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[\(\[].*?[\)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function zingLyrics(title: string, artist: string, duration: number): Promise<{ synced: boolean; lines: LyricLine[] } | null> {
  try {
    await warm();
    const ctime = String(Math.floor(Date.now() / 1000));
    const pSearch = '/api/v2/search/multi';
    const found = await call(pSearch, { q: `${title} ${artist}` }, `ctime=${ctime}version=${VERSION}`, ctime);
    const songs: any[] = Array.isArray(found?.songs) ? found.songs : [];
    const nt = norm(title);
    const na = norm(artist);
    const cand = songs
      .filter((s) => {
        const st = norm(String(s?.title ?? ''));
        const okTitle = st === nt || st.includes(nt) || nt.includes(st);
        const okArtist = !na || norm(String(s?.artistsNames ?? '')).includes(na.split(' ')[0]);
        const okLen = !duration || !s?.duration || Math.abs(Number(s.duration) - duration) <= 4;
        return st && okTitle && okArtist && okLen;
      })
      .slice(0, 2);
    if (!cand.length) {
      log('music', `lời Zing: không tìm thấy "${title}" (${songs.length} kết quả)`);
      return null;
    }
    for (const s of cand) {
      const id = String(s.encodeId);
      const pLyric = '/api/v2/lyric/get/lyric';
      const d = await call(pLyric, { id }, `ctime=${ctime}id=${id}version=${VERSION}`, ctime);
      const sentences: any[] = Array.isArray(d?.sentences) ? d.sentences : [];
      const lines: LyricLine[] = sentences
        .map((x) => {
          const w: any[] = Array.isArray(x?.words) ? x.words : [];
          if (!w.length) return null;
          return { t: Number(w[0].startTime) / 1000, text: w.map((y) => String(y.data ?? '')).join(' ').replace(/\s+/g, ' ').trim() };
        })
        .filter((x): x is { t: number; text: string } => !!x && Number.isFinite(x.t));
      if (lines.length) {
        log('music', `lời Zing: có lời chạy theo câu (${lines.length} câu) cho "${title}"`);
        return { synced: true, lines: lines.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)) };
      }
      // Không có lời theo câu: thử file .lrc nếu có
      if (typeof d?.file === 'string' && d.file.startsWith('http')) {
        const txt = await (await timed(d.file, 6000)).text();
        const out: LyricLine[] = [];
        for (const raw of txt.split('\n')) {
          const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
          if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
        }
        if (out.length) return { synced: true, lines: out };
      }
    }
    log('music', `lời Zing: bài "${title}" không có lời`);
    return null;
  } catch (e) {
    log('error', `lời Zing lỗi: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
