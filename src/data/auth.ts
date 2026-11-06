import { useMemo } from 'react';
import { kvGet, kvSet, useDbVersion } from './db';

// ---------------------------------------------------------------------------
// Đăng nhập, dùng server Supabase thật:
//  - tài khoản ZYX = tài khoản Supabase Auth (Gmail + mật khẩu), kèm username riêng không trùng (bảng profiles)
//  - đăng nhập bằng USERNAME: hỏi server "username này + mật khẩu này đúng không" (hàm login_email),
//    đúng thì server trả về Gmail để đăng nhập. Server không bao giờ trả Gmail của người khác khi sai mật khẩu
//  - tạo tài khoản: server gửi MÃ 6 SỐ về Gmail (kèm lời chào mừng), nhập đúng mã mới tạo xong → Gmail chắc chắn có thật
//  - Google: mở trang đăng nhập Google trong trình duyệt của app; lần đầu thì chọn username
//  - Khách: không có tài khoản, chỉ nhớ trong máy là đã chọn Khách
// Phiên đăng nhập được Supabase nhớ trong máy: lần sau mở app vào thẳng. Đăng xuất trong Cài đặt.
// ---------------------------------------------------------------------------

export type Session = { mode: 'guest' } | { mode: 'account'; id?: string; username: string; email: string };
type Current = { id?: string; username: string; email: string };

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
    const cur = kvGet<Current>(CURRENT);
    if (cur) return { mode: 'account', ...cur };
    return kvGet<boolean>(GUEST) ? { mode: 'guest' } : null;
  }, [v]);
}

// Mở app: kiểm tra phiên của Supabase còn hiệu lực không (bị đăng xuất từ chỗ khác, hết hạn...) để khớp lại
export async function syncSession() {
  try {
    const { data } = await sb().auth.getSession();
    const cur = kvGet<Current>(CURRENT);
    if (!data.session && cur) kvSet(CURRENT, null);
    // Bản cũ chưa lưu id tài khoản: bổ sung (hồ sơ / bài đăng giờ lưu riêng theo từng tài khoản)
    else if (data.session && cur && cur.id !== data.session.user.id) kvSet(CURRENT, { ...cur, id: data.session.user.id });
  } catch {}
}

// id tài khoản đang đăng nhập (null = Khách / chưa đăng nhập)
export function currentAccount(): Current | null {
  const cur = kvGet<Current>(CURRENT);
  return cur?.id ? cur : null;
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

// Kết quả 'verify': đã gửi mã 6 số về Gmail, chờ người dùng nhập (verifyCode)
export async function signUp(username: string, email: string, password: string): Promise<'ok' | 'verify' | 'taken' | 'emailTaken' | AuthError> {
  try {
    const { data, error } = await sb().auth.signUp({ email: email.trim(), password, options: { data: { username } } });
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('already registered') || m.includes('already been registered')) return 'emailTaken';
      if (m.includes('database error')) return 'taken'; // username vừa bị người khác lấy (bảng profiles chặn trùng)
      return isNetwork(error) ? 'network' : 'unknown';
    }
    // Gmail đã thuộc tài khoản khác: Supabase không báo lỗi (để người lạ không dò được), nhưng trả về tài khoản rỗng
    if (data.user && (data.user.identities?.length ?? 0) === 0) return 'emailTaken';
    if (!data.session) return 'verify'; // bật "Confirm email": chờ nhập mã gửi về Gmail
    kvSet(CURRENT, { id: data.user?.id, username, email: email.trim() });
    return 'ok';
  } catch {
    return 'network';
  }
}

// Kết quả { verify: gmail }: đúng mật khẩu nhưng tài khoản chưa nhập mã xác nhận → gửi lại mã về Gmail đó
export async function signIn(username: string, password: string): Promise<'ok' | 'wrong' | { verify: string } | AuthError> {
  try {
    const { data: email, error } = await sb().rpc('login_email', { p_username: username, p_password: password });
    if (error) return isNetwork(error) ? 'network' : 'unknown';
    if (!email) return 'wrong';
    const r = await sb().auth.signInWithPassword({ email, password });
    if (r.error) {
      if ((r.error as { code?: string }).code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message)) {
        await sb().auth.resend({ type: 'signup', email }).catch(() => {});
        return { verify: email };
      }
      return isNetwork(r.error) ? 'network' : 'wrong';
    }
    kvSet(CURRENT, { id: r.data.user?.id, username, email });
    return 'ok';
  } catch {
    return 'network';
  }
}

const isNetwork = (e: { message?: string }) => /network|fetch|timed? ?out/i.test(e?.message ?? '');

// ---- Mã xác nhận 6 số gửi về Gmail
export async function verifyCode(username: string, email: string, code: string): Promise<'ok' | 'wrong' | AuthError> {
  try {
    const { data, error } = await sb().auth.verifyOtp({ email, token: code, type: 'signup' });
    if (error || !data.session) return error && isNetwork(error) ? 'network' : 'wrong';
    kvSet(CURRENT, { id: data.session.user.id, username, email });
    return 'ok';
  } catch {
    return 'network';
  }
}

export async function resendCode(email: string): Promise<'ok' | 'tooSoon' | AuthError> {
  try {
    const { error } = await sb().auth.resend({ type: 'signup', email });
    if (!error) return 'ok';
    if ((error as { status?: number }).status === 429 || /seconds|rate/i.test(error.message)) return 'tooSoon';
    return isNetwork(error) ? 'network' : 'unknown';
  } catch {
    return 'network';
  }
}

// ---- Đăng nhập Google: mở trang Google trong trình duyệt của app, đăng nhập xong Google gọi ngược về app (zyx://auth-callback)
export const OAUTH_REDIRECT = 'zyx://auth-callback';

// 'pickUsername': đăng nhập Google lần đầu, cần chọn username (chooseUsername)
export async function signInWithGoogle(): Promise<'ok' | 'pickUsername' | 'cancelled' | AuthError> {
  try {
    const WebBrowser = require('expo-web-browser') as typeof import('expo-web-browser');
    const { data, error } = await sb().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return error && isNetwork(error) ? 'network' : 'unknown';
    const res = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT);
    if (res.type !== 'success' || !res.url) return 'cancelled';
    const code = new URL(res.url).searchParams.get('code');
    if (!code) return 'unknown';
    const ex = await sb().auth.exchangeCodeForSession(code);
    if (ex.error || !ex.data.session) return ex.error && isNetwork(ex.error) ? 'network' : 'unknown';
    return await finishOAuth();
  } catch {
    return 'network';
  }
}

// Đã có phiên Google: có username rồi thì vào app, chưa có thì phải chọn
async function finishOAuth(): Promise<'ok' | 'pickUsername' | AuthError> {
  const { data: u } = await sb().auth.getUser();
  const user = u.user;
  if (!user) return 'unknown';
  const { data: prof, error } = await sb().from('profiles').select('username').eq('id', user.id).maybeSingle();
  if (error) return isNetwork(error) ? 'network' : 'unknown';
  if (prof?.username) {
    kvSet(CURRENT, { id: user.id, username: prof.username, email: user.email ?? '' });
    return 'ok';
  }
  return 'pickUsername';
}

export async function chooseUsername(username: string): Promise<'ok' | 'taken' | 'invalid' | AuthError> {
  try {
    const { data, error } = await sb().rpc('set_username', { p_username: username });
    if (error) return isNetwork(error) ? 'network' : 'unknown';
    if (data === 'taken') return 'taken';
    if (data === 'invalid') return 'invalid';
    if (data !== 'ok' && data !== 'already_set') return 'unknown';
    const r = await finishOAuth();
    return r === 'ok' ? 'ok' : r === 'pickUsername' ? 'unknown' : r;
  } catch {
    return 'network';
  }
}
