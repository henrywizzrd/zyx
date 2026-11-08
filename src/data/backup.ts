// Sao lưu thư viện theo tài khoản (bảng library_backups, xem supabase/008_library_backup.sql).
// Dữ liệu thư viện (playlist, Liked Songs, mục đã lưu, lịch sử nghe) nằm trong máy. Cài lại app = mất sạch,
// nên app tự gửi một bản sao lên tài khoản:
//  - có thay đổi → gửi sau ít nhất 90 giây kể từ lần gửi trước (gom nhiều thay đổi thành một lần), chuyển app xuống nền → gửi ngay
//  - nội dung y như lần gửi trước thì không gửi
// Khôi phục: đăng nhập trên máy có thư viện TRỐNG (vừa cài lại) → tải bản sao về. Chưa có bản sao (bản app cũ chưa sao lưu)
// thì kéo về những playlist từng để Công khai.
// Một máy chỉ sao lưu cho tài khoản đầu tiên dùng nó (đăng nhập tài khoản khác trên cùng máy thì không ghi đè bản của người kia).
import { AppState, Platform } from 'react-native';
import { cacheGet, cacheSet, exportLibrary, importLibrary, isLibraryEmpty, subscribeDb, type LibraryDump } from './db';
import { log } from './applog';

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;

const OWNER = 'backup:owner';
const CHECKED = (uid: string) => `backup:checked:${uid}`;
const HASH = (uid: string) => `backup:hash:${uid}`;
const MIN_GAP = 90_000;

// Theme cũng được sao lưu: ThemeProvider đăng ký cách đọc / đặt theme ở đây
export const themeBridge: { get?: () => unknown; set?: (raw: any) => void } = {};

let uid: string | null = null;
let ready = false; // đã xong bước khôi phục → mới được gửi (không thì bản trống đè mất bản sao trên server)
let dirty = false;
let busy = false;
let lastAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const hashOf = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
};

export function markBackupDirty() {
  dirty = true;
  schedule();
}

function schedule(now = false) {
  if (!uid || !ready || !dirty) return;
  if (timer) {
    if (!now) return;
    clearTimeout(timer);
  }
  const wait = now ? 0 : Math.max(8000, MIN_GAP - (Date.now() - lastAt));
  timer = setTimeout(() => {
    timer = null;
    upload().catch(() => {});
  }, wait);
}

async function upload() {
  const me = uid;
  if (!me || busy) return;
  busy = true;
  dirty = false;
  try {
    const dump = exportLibrary();
    if (!dump) return;
    // Ảnh bìa playlist tự chọn đang là file trong máy → đưa lên server (mỗi ảnh một lần) để máy khác / lần cài sau còn thấy
    const { coverUrl } = require('./sharedSync') as typeof import('./sharedSync');
    for (const p of dump.playlists) {
      if (p[5] && !p[5].startsWith('http')) p[5] = await coverUrl(me, p[0], p[5]).catch(() => null);
    }
    const data = { ...dump, theme: themeBridge.get?.() ?? null };
    const json = JSON.stringify(data);
    const h = hashOf(json);
    if (cacheGet<string>(HASH(me))?.value === h) return;
    const { error } = await sb().from('library_backups').upsert({ data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    cacheSet(HASH(me), h);
    log('ui', `sao lưu thư viện: ${dump.playlists.length} playlist, ${dump.liked.length} bài thích, ${dump.history.length} lượt nghe (${Math.round(json.length / 1024)}KB)`);
  } catch (e: any) {
    dirty = true;
    log('error', `sao lưu thư viện lỗi: ${e?.message ?? e}`);
  } finally {
    lastAt = Date.now();
    busy = false;
    if (dirty) schedule();
  }
}

async function restore(me: string) {
  const { data, error } = await sb().from('library_backups').select('data, updated_at').eq('user_id', me).maybeSingle();
  if (error) throw error;
  if (data?.data) {
    const dump = data.data as LibraryDump & { theme?: unknown };
    importLibrary(dump);
    if (dump.theme) themeBridge.set?.(dump.theme);
    log('ui', `khôi phục thư viện từ bản sao ${String(data.updated_at).slice(0, 16)}: ${dump.playlists?.length ?? 0} playlist, ${dump.liked?.length ?? 0} bài thích`);
    return;
  }
  // Chưa có bản sao: lấy lại các playlist từng để Công khai
  const { data: rows, error: e2 } = await sb()
    .from('shared_playlists')
    .select('local_id, title, description, cover_url, tracks, updated_at')
    .eq('user_id', me)
    .limit(200);
  if (e2) throw e2;
  if (!rows?.length) {
    log('ui', 'khôi phục thư viện: chưa có bản sao nào trên tài khoản');
    return;
  }
  const dump: LibraryDump = { v: 1, tracks: [], liked: [], playlists: [], items: [], saved: [], history: [] };
  const seen = new Set<string>();
  for (const r of rows as any[]) {
    const at = Date.parse(r.updated_at) || Date.now();
    dump.playlists.push([r.local_id, r.title, 1, at, at, r.cover_url ?? null, r.description ?? null]);
    (Array.isArray(r.tracks) ? r.tracks : []).forEach((t: any, i: number) => {
      if (!t?.id) return;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        dump.tracks.push([t.id, t.title ?? '', t.artist ?? '', t.album ?? null, t.duration ?? 0, t.thumb ?? null]);
      }
      dump.items.push([r.local_id, t.id, i, at]);
    });
  }
  importLibrary(dump);
  log('ui', `khôi phục thư viện: lấy lại ${rows.length} playlist Công khai`);
}

// App gọi khi biết tài khoản đang đăng nhập (null = khách / đăng xuất)
export async function startBackup(id: string | null) {
  if (Platform.OS === 'web') return;
  uid = id;
  ready = false;
  if (!id) return;
  const owner = cacheGet<string>(OWNER)?.value;
  if (owner && owner !== id) {
    log('ui', 'sao lưu thư viện: máy này đang sao lưu cho tài khoản khác → bỏ qua');
    return;
  }
  try {
    if (!cacheGet<boolean>(CHECKED(id))?.value && isLibraryEmpty()) await restore(id);
    cacheSet(CHECKED(id), true);
    cacheSet(OWNER, id);
    if (uid !== id) return;
    ready = true;
    dirty = true;
    schedule();
  } catch (e: any) {
    // Chưa chạy file SQL 008, mất mạng...: lần mở app sau thử lại, và chưa gửi gì lên
    log('error', `khôi phục thư viện lỗi: ${e?.message ?? e}`);
  }
}

subscribeDb(markBackupDirty);
AppState.addEventListener('change', (s) => {
  if (s !== 'active') schedule(true);
});
