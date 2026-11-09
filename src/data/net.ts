// Trạng thái mạng (không cần thư viện native): hỏi thử một địa chỉ siêu nhẹ của Google khi có dấu hiệu mất mạng
// (không lấy được link bài, Home tải lỗi...). Đang offline thì cứ ~8 giây hỏi lại (chỉ khi app đang mở) để biết lúc có mạng lại.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { log } from './applog';

let offline = false;
let probing: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(v: boolean) {
  if (offline === v) return;
  offline = v;
  log('ui', v ? 'mất mạng → chế độ offline (chỉ phát bài đã tải)' : 'có mạng lại');
  listeners.forEach((l) => l());
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!offline || AppState.currentState !== 'active') return;
  timer = setTimeout(() => {
    isOnline().catch(() => {});
  }, 8000);
}

// Hỏi thử mạng (tối đa 3 giây). Gọi nhiều lần cùng lúc thì dùng chung một lần hỏi
export function isOnline(): Promise<boolean> {
  if (probing) return probing;
  probing = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', signal: ctrl.signal });
      const ok = r.ok || r.status === 204;
      set(!ok);
      return ok;
    } catch {
      set(true);
      return false;
    } finally {
      clearTimeout(t);
      probing = null;
    }
  })();
  return probing;
}

// Có gì đó tải lỗi: kiểm tra xem có phải do mất mạng không
export function checkNetwork() {
  isOnline().catch(() => {});
}

export const getOffline = () => offline;
export function useOffline() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => offline
  );
}

AppState.addEventListener('change', (s) => {
  if (s === 'active' && offline) checkNetwork();
  else schedule();
});
