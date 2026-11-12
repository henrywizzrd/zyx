// Tải một file nhạc của YouTube về máy theo TỪNG KHÚC (mỗi lần ~1,5 MB, gửi kèm "Range: bytes=a-b").
// Lý do: máy chủ nhạc của YouTube (googlevideo) trả lỗi 403 khi xin cả file trong một lần (Nhật ký: "[download] … status 403"),
// nhưng cho xin từng khúc — đúng cách trình phát nhạc vẫn làm, nên nghe online thì được mà bấm "Tải về" thì lỗi.
import type { File as FsFile } from 'expo-file-system';

const CHUNK = 1_500_000;

function fs() {
  return require('expo-file-system') as typeof import('expo-file-system');
}

async function fetchRange(url: string, start: number, end: number): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: ctrl.signal });
      if (r.status === 206 || r.status === 200) return r;
      // 403 / 410: link hết hạn hoặc bị từ chối → thử lại cũng vô ích, báo lên để lấy link mới
      if (r.status === 403 || r.status === 410) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      if ((e as { status?: number })?.status) throw e;
      last = e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// Ghi url vào file target. Trả về số byte đã ghi. Lỗi thì xoá file dở dang và ném lỗi
export async function rangeDownload(url: string, target: FsFile): Promise<number> {
  const { FileMode } = fs();
  if (target.exists) target.delete();
  target.create();
  const h = target.open(FileMode.ReadWrite);
  let start = 0;
  let total = Number.POSITIVE_INFINITY;
  try {
    while (start < total) {
      const end = Math.min(start + CHUNK, total) - 1;
      const r = await fetchRange(url, start, end);
      if (!Number.isFinite(total)) {
        const cr = r.headers.get('content-range'); // "bytes 0-1499999/4012345"
        const n = cr ? Number(cr.split('/')[1]) : Number(r.headers.get('content-length'));
        if (Number.isFinite(n) && n > 0) total = n;
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length === 0) break;
      await h.writeBytes(buf);
      start += buf.length;
      if (r.status === 200) break; // máy chủ gửi cả file trong một lần
    }
  } catch (e) {
    try {
      h.close();
    } catch {}
    try {
      if (target.exists) target.delete();
    } catch {}
    throw e;
  }
  h.close();
  if (start === 0) {
    try {
      target.delete();
    } catch {}
    throw new Error('file rỗng');
  }
  return start;
}
