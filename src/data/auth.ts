import { useMemo } from 'react';
import { kvGet, kvSet, useDbVersion } from './db';

// ---------------------------------------------------------------------------
// Đăng nhập. CHƯA CÓ SERVER nên tạm GIẢ LẬP ngay trong máy:
//  - tài khoản ZYX (username, gmail, mật khẩu đã băm) lưu trong máy, chỉ máy này thấy
//  - "username đã tồn tại chưa" = đã có trong máy chưa
// Khi dựng server (Go) thì chỉ thay các hàm usernameExists / signUp / signIn bằng gọi API, màn hình giữ nguyên.
// Phiên đăng nhập được nhớ: lần sau mở app vào thẳng, Đăng xuất trong Cài đặt để quay lại màn đăng nhập.
// ---------------------------------------------------------------------------

export type Session = { mode: 'guest' } | { mode: 'account'; username: string; email: string };

type Account = { username: string; email: string; hash: string; salt: string; createdAt: number };
const ACCOUNTS = 'auth:accounts';
const SESSION = 'auth:session';

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/; // 3–20 ký tự: chữ thường không dấu, số, _ và .
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 6;
export const cleanUsername = (v: string) => v.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);

const accounts = (): Record<string, Account> => kvGet<Record<string, Account>>(ACCOUNTS) ?? {};

// Phiên hiện tại (null = chưa đăng nhập → hiện màn đăng nhập). Tự cập nhật khi đăng nhập / đăng xuất
export function useSession(): Session | null {
  const v = useDbVersion();
  return useMemo(() => kvGet<Session>(SESSION), [v]);
}

export function continueAsGuest() {
  kvSet(SESSION, { mode: 'guest' } satisfies Session);
}

export function signOut() {
  kvSet(SESSION, null);
}

// Giả lập chậm một chút như gọi server thật (để màn hình có trạng thái "đang kiểm tra")
const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));

export async function usernameExists(username: string): Promise<boolean> {
  await wait();
  return !!accounts()[username];
}

export async function signUp(username: string, email: string, password: string): Promise<'ok' | 'taken'> {
  await wait();
  const all = accounts();
  if (all[username]) return 'taken';
  const salt = Math.random().toString(36).slice(2, 12);
  all[username] = { username, email: email.trim(), salt, hash: sha256(salt + password), createdAt: Date.now() };
  kvSet(ACCOUNTS, all);
  kvSet(SESSION, { mode: 'account', username, email: email.trim() } satisfies Session);
  return 'ok';
}

export async function signIn(username: string, password: string): Promise<'ok' | 'wrong'> {
  await wait();
  const a = accounts()[username];
  if (!a || a.hash !== sha256(a.salt + password)) return 'wrong';
  kvSet(SESSION, { mode: 'account', username, email: a.email } satisfies Session);
  return 'ok';
}

// ---- SHA-256 (băm mật khẩu, không lưu mật khẩu gốc). Viết tay vì app chưa có thư viện mã hoá
function sha256(input: string): string {
  const bytes: number[] = [];
  const utf8 = unescape(encodeURIComponent(input));
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
