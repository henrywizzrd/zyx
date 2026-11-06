import { useMemo } from 'react';
import { kvGet, kvSet, useDbVersion } from './db';

// ---------------------------------------------------------------------------
// Đăng nhập, dùng server Supabase thật:
//  - tài khoản ZYX = tài khoản Supabase Auth (Gmail + mật khẩu), kèm username riêng không trùng (bảng profiles)
//  - đăng nhập bằng USERNAME: hỏi server "username này + mật khẩu này đúng không" (hàm login_email),
//    đúng thì server trả về Gmail để đăng nhập. Server không bao giờ trả Gmail của người khác khi sai mật khẩu
//  - Khách: không có tài khoản, chỉ nhớ trong máy là đã chọn Khách
// Phiên đăng nhập được Supabase nhớ trong máy: lần sau mở app vào thẳng. Đăng xuất trong Cài đặt.
// ---------------------------------------------------------------------------

export type Session = { mode: 'guest' } | { mode: 'account'; username: string; email: string };

const GUEST = 'auth:guest';
const CURRENT = 'auth:current'; // thông tin tài khoản đang đăng nhập (để mở app hiện ngay, không chờ mạng)

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/; // 3–20 ký tự: chữ thường không dấu, số, _ và .
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 6;
export const cleanUsername = (v: string) => v.toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;

// Phiên hiện tại (null = chưa đăng nhập → hiện màn đăng nhập). Tự cập nhật khi đăng nhập / đăng xuất
export function useSession(): Session | null {
  const v = useDbVersion();
  return useMemo(() => {
    const cur = kvGet<{ username: string; email: string }>(CURRENT);
    if (cur) return { mode: 'account', ...cur };
    return kvGet<boolean>(GUEST) ? { mode: 'guest' } : null;
  }, [v]);
}

// Mở app: kiểm tra phiên của Supabase còn hiệu lực không (bị đăng xuất từ chỗ khác, hết hạn...) để khớp lại
export async function syncSession() {
  try {
    const { data } = await sb().auth.getSession();
    if (!data.session && kvGet(CURRENT)) kvSet(CURRENT, null);
  } catch {}
}

export function continueAsGuest() {
  kvSet(GUEST, true);
}

export async function signOut() {
  kvSet(CURRENT, null);
  kvSet(GUEST, null);
  try {
    await sb().auth.signOut();
  } catch {}
}

export type AuthError = 'network' | 'unknown';

export async function usernameExists(username: string): Promise<boolean | AuthError> {
  try {
    const { data, error } = await sb().rpc('username_exists', { p_username: username });
    if (error) return isNetwork(error) ? 'network' : 'unknown';
    return !!data;
  } catch {
    return 'network';
  }
}

export async function signUp(username: string, email: string, password: string): Promise<'ok' | 'taken' | 'emailTaken' | AuthError> {
  try {
    const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { username } } });
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('already registered') || m.includes('already been registered')) return 'emailTaken';
      if (m.includes('database error')) return 'taken'; // username vừa bị người khác lấy (bảng profiles chặn trùng)
      return isNetwork(error) ? 'network' : 'unknown';
    }
    if (!data.session) return 'unknown'; // còn bật "Confirm email" trên Supabase
    kvSet(CURRENT, { username, email: email.trim() });
    return 'ok';
  } catch {
    return 'network';
  }
}

export async function signIn(username: string, password: string): Promise<'ok' | 'wrong' | AuthError> {
  try {
    const { data: email, error } = await sb().rpc('login_email', { p_username: username, p_password: password });
    if (error) return isNetwork(error) ? 'network' : 'unknown';
    if (!email) return 'wrong';
    const r = await sb().auth.signInWithPassword({ email, password });
    if (r.error) return isNetwork(r.error) ? 'network' : 'wrong';
    kvSet(CURRENT, { username, email });
    return 'ok';
  } catch {
    return 'network';
  }
}

const isNetwork = (e: { message?: string }) => /network|fetch|timed? ?out/i.test(e?.message ?? '');

