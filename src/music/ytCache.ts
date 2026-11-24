// Giống kiểu ICache của youtubei.js (thư viện không cho import trực tiếp kiểu này)
interface ICache {
  cache_dir: string;
  get(key: string): Promise<ArrayBuffer | undefined>;
  set(key: string, value: ArrayBuffer): Promise<void>;
  remove(key: string): Promise<void>;
}

// Bộ nhớ đệm cho youtubei.js, lưu thành file trong thư mục cache của app.
// Quan trọng nhất là "player" của YouTube đã phân tích sẵn: lần mở app sau, nếu YouTube chưa đổi player,
// thư viện lấy luôn từ đây thay vì tải lại và phân tích lại (việc nặng nhất khi chuẩn bị phát nhạc).
// Startup diagnostics (log 23/11: iPhone 8 Plus froze 11 s and JS memory hit 264 MB while preparing playback)
function cacheLog(msg: string) {
  try {
    (require('../data/applog') as typeof import('../data/applog')).log('music', `bộ nhớ đệm player: ${msg}`);
  } catch {}
}

export class FileCache implements ICache {
  cache_dir = 'youtubei';

  private file(key: string) {
    const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const dir = new Directory(Paths.cache, this.cache_dir);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return new File(dir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    try {
      const f = this.file(key);
      if (!f.exists) {
        cacheLog(`không có sẵn "${key}" → phải tải và phân tích lại`);
        return undefined;
      }
      const bytes = await f.bytes();
      cacheLog(`dùng lại "${key}" (${Math.round(bytes.byteLength / 1024)}KB)`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ArrayBuffer): Promise<void> {
    try {
      const f = this.file(key);
      if (!f.exists) f.create();
      await f.write(new Uint8Array(value));
      cacheLog(`đã lưu "${key}" (${Math.round(value.byteLength / 1024)}KB)`);
    } catch (e) {
      console.warn('[ytcache] set', e);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const f = this.file(key);
      if (f.exists) f.delete();
    } catch {}
  }
}
