import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { Track } from './mock';
import { getDownloads, kvGet, kvSet, setDownload } from './db';
import { ytmusic } from '../music/lazy';
import { log } from './applog';
import { rangeDownload } from './rangeDownload';

// Tải bài về máy để nghe không cần mạng.
// File lưu trong thư mục Documents/downloads của app (iOS không tự xoá như thư mục cache).
// Tải đúng loại link mà app đang phát (mp4 có âm thanh, iPhone phát được), nên phát lại y như online.

export type DownloadState = 'none' | 'downloading' | 'done';

const busy = new Set<string>();
let files: Map<string, string> | null = null; // id bài → tên file
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function fs() {
  return require('expo-file-system') as typeof import('expo-file-system');
}
function dir() {
  const { Directory, Paths } = fs();
  const d = new Directory(Paths.document, 'downloads');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}
function known() {
  if (!files) files = getDownloads();
  return files;
}

export function downloadState(id: string): DownloadState {
  if (busy.has(id)) return 'downloading';
  return known().has(id) ? 'done' : 'none';
}

// Đường dẫn file đã tải (null nếu chưa tải, hoặc file đã mất)
export function localUri(id: string): string | null {
  if (Platform.OS === 'web') return null;
  const name = known().get(id);
  if (!name) return null;
  try {
    const f = new (fs().File)(dir(), name);
    if (f.exists) return f.uri;
  } catch {}
  return null;
}

export async function download(t: Track): Promise<boolean> {
  if (Platform.OS === 'web' || busy.has(t.id) || known().has(t.id)) return known().has(t.id);
  busy.add(t.id);
  emit();
  try {
    // Chỉ tải âm thanh (mp4a), không tải hình: nhẹ hơn 3-4 lần so với bản video 360p, tiếng cũng tốt hơn
    const t0 = Date.now();
    const name = `${t.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
    const target = new (fs().File)(dir(), name);
    let bytes = 0;
    // Tải từng khúc (xem rangeDownload.ts).
    // Lần 1: bản CHỈ ÂM THANH (nhẹ hơn 3–4 lần). YouTube hay chặn tải loại này (403) dù vẫn cho phát.
    // Lần 2: đúng bản trình phát đang dùng (mp4 360p có cả hình + tiếng) — nghe online được thì tải loại này được
    let kind = 'âm thanh';
    for (let attempt = 0; ; attempt++) {
      const muxed = attempt > 0;
      const info = await ytmusic().getAudio(t.id, undefined, muxed);
      try {
        bytes = await rangeDownload(info.url, target);
        kind = muxed ? 'bản trình phát (mp4 360p)' : 'âm thanh';
        break;
      } catch (e) {
        if (attempt >= 1 || !(e as { status?: number })?.status) throw e;
        log('music', `tải bài: bản chỉ âm thanh bị chặn (${(e as Error).message}), tải bản trình phát — ${t.title}`);
      }
    }
    known().set(t.id, name);
    setDownload(t, name);
    log('music', `đã tải xong: ${t.title} (${kind}, ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} giây)`);
    return true;
  } catch (e) {
    console.warn('[download]', t.title, e);
    log('error', `tải bài lỗi: ${t.title} — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    busy.delete(t.id);
    emit();
  }
}

export function removeDownload(t: Track) {
  const name = known().get(t.id);
  if (name) {
    try {
      const f = new (fs().File)(dir(), name);
      if (f.exists) f.delete();
    } catch {}
  }
  known().delete(t.id);
  setDownload(t, null);
  emit();
}

// Màn hình nào cần hiện trạng thái tải thì dùng hook này để tự cập nhật
export function useDownloads() {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return downloadState;
}

// ---- Chỉ hiện bài đã tải (nút "Đã tải" ở Thư viện) ----
// Bật: Thư viện chỉ còn các playlist có bài đã tải (Bài hát đã thích + playlist của mình), mở playlist / album nào
// cũng chỉ thấy bài đã tải. Tắt là hiện lại đủ. Nhớ giữa các lần mở app
let onlyDownloaded: boolean | null = null; // đọc lần đầu khi cần (lúc nạp file này cơ sở dữ liệu có thể chưa sẵn)
const onlyListeners = new Set<() => void>();
export function getOnlyDownloaded(): boolean {
  if (onlyDownloaded === null) {
    try {
      onlyDownloaded = kvGet<boolean>('lib:onlyDownloaded') === true;
    } catch {
      onlyDownloaded = false;
    }
  }
  return onlyDownloaded;
}
export function setOnlyDownloaded(v: boolean) {
  onlyDownloaded = v;
  kvSet('lib:onlyDownloaded', v);
  onlyListeners.forEach((l) => l());
}
export function useOnlyDownloaded(): boolean {
  return useSyncExternalStore(
    (l) => {
      onlyListeners.add(l);
      return () => {
        onlyListeners.delete(l);
      };
    },
    getOnlyDownloaded
  );
}
export const isDownloaded = (id: string) => known().has(id);
