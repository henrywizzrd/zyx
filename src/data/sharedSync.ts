// Playlist công khai: playlist trong máy để chế độ Công khai được đưa lên server (bảng shared_playlists)
// để người khác vào hồ sơ mình xem và phát. Chạy lại mỗi khi dữ liệu trong máy đổi (thêm / bớt bài, đổi tên, ảnh bìa,
// bật / tắt Công khai, xoá playlist). Chỉ gửi playlist nào thật sự thay đổi.
import { Platform } from 'react-native';
import { currentAccount } from './auth';
import { getPlaylists, getPlaylistTracks, kvGet, kvSet } from './db';

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;
const HASHES = (uid: string) => `shared:hash:${uid}`; // localId → dấu vân tay nội dung đã gửi
const COVERS = (uid: string) => `shared:covers:${uid}`; // file ảnh bìa trong máy → link trên server

let running = false;
let again = false;

const hashOf = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
};

export async function coverUrl(uid: string, localId: string, cover?: string, fallback?: string) {
  if (!cover) return fallback?.startsWith('http') ? fallback : null;
  if (cover.startsWith('http')) return cover;
  if (Platform.OS === 'web') return null;
  const map = kvGet<Record<string, string>>(COVERS(uid)) ?? {};
  if (map[cover]) return map[cover];
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const ext = (cover.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const path = `${uid}/playlist-${localId}-${Date.now()}.${ext}`;
  const body = await new File(cover).arrayBuffer();
  const { error } = await sb().storage.from('profiles').upload(path, body, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
  if (error) throw error;
  const url = sb().storage.from('profiles').getPublicUrl(path).data.publicUrl;
  kvSet(COVERS(uid), { ...map, [cover]: url });
  return url;
}

export async function syncSharedPlaylists() {
  const uid = currentAccount()?.id;
  if (!uid) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const saved = kvGet<Record<string, string>>(HASHES(uid)) ?? {};
    const hashes = { ...saved };
    const pub = getPlaylists().filter((p) => p.isPublic);
    for (const p of pub) {
      const tracks = getPlaylistTracks(p.id).map(({ id, title, artist, color, duration, thumb, album }) => ({ id, title, artist, color, duration, thumb, album }));
      const h = hashOf(JSON.stringify([p.title, p.description ?? '', p.cover ?? '', tracks.map((t) => t.id)]));
      if (hashes[p.id] === h) continue;
      const cover_url = await coverUrl(uid, p.id, p.cover, tracks[0]?.thumb).catch(() => null);
      const { error } = await sb()
        .from('shared_playlists')
        .upsert(
          { local_id: p.id, title: p.title.slice(0, 100), description: p.description?.slice(0, 500) ?? null, cover_url, tracks, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,local_id' }
        );
      if (error) throw error;
      hashes[p.id] = h;
    }
    // Playlist đã tắt Công khai hoặc đã xoá: gỡ khỏi server
    const keep = new Set(pub.map((p) => p.id));
    const gone = Object.keys(hashes).filter((id) => !keep.has(id));
    if (gone.length) {
      const { error } = await sb().from('shared_playlists').delete().eq('user_id', uid).in('local_id', gone);
      if (error) throw error;
      for (const id of gone) delete hashes[id];
    }
    // Chỉ ghi khi có thay đổi (ghi vào bộ nhớ làm cả app tưởng dữ liệu đổi → lại gọi đồng bộ → lặp mãi)
    if (JSON.stringify(saved) !== JSON.stringify(hashes)) kvSet(HASHES(uid), hashes);
  } catch (e) {
    console.warn('[shared] sync', e);
  } finally {
    running = false;
    if (again) {
      again = false;
      setTimeout(syncSharedPlaylists, 1000);
    }
  }
}
