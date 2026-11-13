// Bảng DÒ LỖI cho player Đĩa than (Cài đặt → Nhật ký → "Dò lỗi player đĩa than").
// Mỗi phần nặng của player có một công tắc: tắt lần lượt từng phần rồi mở / đóng player vài lần, phần nào tắt đi mà hết
// "luồng JS khựng" / "giao diện khựng" thì đó là thủ phạm. Mỗi lần bật / tắt đều ghi vào nhật ký.
// Chỉ là công cụ dò lỗi tạm thời — tìm ra thủ phạm và sửa xong thì gỡ.
import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from '../data/db';
import { log } from '../data/applog';

export const VINYL_FLAGS = [
  ['smoke', 'Nền khói (shader Skia)'],
  ['coverColor', 'Tách màu ảnh bìa'],
  ['spin', 'Đĩa xoay'],
  ['label', 'Ảnh bìa trên đĩa'],
  ['disc', 'Mặt đĩa + viền'],
  ['ghost', 'Vòng thanh thời gian giả'],
  ['arc', 'Thanh thời gian (Skia)'],
  ['lyricsPre', 'Khung lời dựng sẵn'],
  ['lyricsFetch', 'Tải lời sẵn khi mở player'],
] as const;
export type VinylFlag = (typeof VINYL_FLAGS)[number][0];
type Flags = Record<VinylFlag, boolean>;

const KEY = 'debug:vinylFlags';
const ALL_ON = Object.fromEntries(VINYL_FLAGS.map(([k]) => [k, true])) as Flags;
let flags: Flags = { ...ALL_ON, ...(safeGet() ?? {}) };
const subs = new Set<() => void>();

function safeGet(): Partial<Flags> | null {
  try {
    return kvGet<Partial<Flags>>(KEY);
  } catch {
    return null;
  }
}

export function setVinylFlag(k: VinylFlag, on: boolean) {
  flags = { ...flags, [k]: on };
  try {
    kvSet(KEY, flags);
  } catch {}
  const name = VINYL_FLAGS.find(([id]) => id === k)?.[1] ?? k;
  const off = VINYL_FLAGS.filter(([id]) => !flags[id]).map(([, n]) => n);
  log('ui', `dò lỗi: ${on ? 'BẬT' : 'TẮT'} ${name} · đang tắt: ${off.length ? off.join(', ') : 'không'}`);
  subs.forEach((f) => f());
}
export function resetVinylFlags() {
  flags = { ...ALL_ON };
  try {
    kvSet(KEY, flags);
  } catch {}
  log('ui', 'dò lỗi: bật lại tất cả');
  subs.forEach((f) => f());
}
export function useVinylFlags(): Flags {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => flags
  );
}
