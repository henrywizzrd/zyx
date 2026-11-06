import { Platform } from 'react-native';
import { useMemo } from 'react';
import { kvGet, kvSet, useDbVersion } from './db';
import { profile as mockProfile } from './mock';
import { currentAccount } from './auth';

// Hồ sơ RIÊNG của từng tài khoản (trước đây cả máy dùng chung một hồ sơ → 3 tài khoản cùng tên, cùng ảnh):
//  - Khách: lưu trong máy như cũ
//  - tài khoản ZYX / Google: lưu trên server (bảng profiles + kho ảnh "profiles"), máy chỉ giữ một bản sao để mở là hiện ngay.
//    Đăng nhập tài khoản đó ở máy khác cũng thấy đúng tên, #tag, avatar, ảnh bìa
export interface Profile {
  name: string;
  tag: string;
  avatar?: string; // đường dẫn file ảnh trong thư mục của app
  cover?: string;
  coverTone?: CoverTone; // ảnh bìa tối hay sáng (đo khi lưu ảnh), để chọn màu chữ trên ảnh bìa
  avatarColor: string; // màu khi chưa có ảnh
  wallColor: string;
  avatarRemote?: string; // link ảnh trên server (tài khoản), để biết ảnh trong máy đã khớp với server chưa
  coverRemote?: string;
}

export type CoverTone = 'dark' | 'light';
export type ImageSlot = 'avatar' | 'cover';
const key = () => {
  const acc = currentAccount();
  return acc ? `profile:${acc.id}` : 'profile';
};

export function getProfile(): Profile {
  const acc = currentAccount();
  // Tài khoản mới chưa đặt tên: dùng username làm tên và #tag
  const base = acc ? { ...mockProfile, name: acc.username, tag: acc.username } : mockProfile;
  return { ...base, ...(kvGet<Partial<Profile>>(key()) ?? {}) };
}

function writeLocal(patch: Partial<Profile>) {
  const k = key();
  kvSet(k, { ...(kvGet<Partial<Profile>>(k) ?? {}), ...patch });
}

// Sửa hồ sơ: lưu trong máy ngay, tài khoản thì gửi tiếp lên server (mất mạng thì lần mở app sau gửi lại)
export function updateProfile(patch: Partial<Profile>) {
  writeLocal(patch);
  if (currentAccount()) pushProfile(patch);
}

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;
const BUCKET = 'profiles';
const PENDING = () => `profile:pending:${currentAccount()?.id}`; // các trường chưa gửi lên được

// Trường trong máy → cột trên server
function toRow(patch: Partial<Profile>) {
  const row: Record<string, string | null> = {};
  if ('name' in patch) row.display_name = patch.name ?? null;
  if ('tag' in patch) row.tag = patch.tag ?? null;
  if ('coverTone' in patch) row.cover_tone = patch.coverTone ?? null;
  if ('avatarColor' in patch) row.avatar_color = patch.avatarColor ?? null;
  if ('wallColor' in patch) row.wall_color = patch.wallColor ?? null;
  if ('avatarRemote' in patch) row.avatar_url = patch.avatarRemote ?? null;
  if ('coverRemote' in patch) row.cover_url = patch.coverRemote ?? null;
  return row;
}

async function pushProfile(patch: Partial<Profile>) {
  const acc = currentAccount();
  if (!acc) return;
  const pending = { ...(kvGet<Record<string, string | null>>(PENDING()) ?? {}), ...toRow(patch) };
  if (!Object.keys(pending).length) return;
  try {
    const { error } = await sb().from('profiles').update(pending).eq('id', acc.id);
    if (error?.code === '23505') {
      // Tên#tag vừa bị người khác lấy mất: bỏ thay đổi đó, lấy lại tên / tag đang có trên server
      kvSet(PENDING(), null);
      (require('../components/toastBridge') as typeof import('../components/toastBridge')).showToast('profile.nameTagReset');
      syncProfile();
      return;
    }
    if (error) throw error;
    kvSet(PENDING(), null);
  } catch (e) {
    kvSet(PENDING(), pending);
    console.warn('[profile] push', e);
  }
}

// Tài khoản: Tên#tag mới còn trống không (cặp Tên#tag là duy nhất, kiểu Discord). Mất mạng / server chưa có hàm → cho qua
export async function checkNameTag(name: string, tag: string): Promise<'ok' | 'taken'> {
  if (!currentAccount()) return 'ok';
  try {
    const { data, error } = await sb().rpc('name_tag_free', { p_name: name, p_tag: tag });
    if (error) return 'ok';
    return data === false ? 'taken' : 'ok';
  } catch {
    return 'ok';
  }
}

// Mở app / vừa đăng nhập: gửi nốt phần chưa gửi, rồi lấy hồ sơ từ server về (đăng nhập máy mới thì có ngay tên, ảnh)
export async function syncProfile() {
  const acc = currentAccount();
  if (!acc) return;
  try {
    await pushProfile({});
    const { data, error } = await sb()
      .from('profiles')
      .select('display_name, tag, avatar_url, cover_url, cover_tone, avatar_color, wall_color')
      .eq('id', acc.id)
      .maybeSingle();
    if (error || !data || currentAccount()?.id !== acc.id) return;
    const cur = getProfile();
    const patch: Partial<Profile> = {};
    if (data.display_name) patch.name = data.display_name;
    if (data.tag) patch.tag = data.tag;
    if (data.avatar_color) patch.avatarColor = data.avatar_color;
    if (data.wall_color) patch.wallColor = data.wall_color;
    // Ảnh: server đổi (đổi ở máy khác) thì dùng ảnh trên server; giống nhau thì giữ file trong máy cho nhanh
    if ((data.avatar_url ?? undefined) !== cur.avatarRemote) {
      patch.avatarRemote = data.avatar_url ?? undefined;
      patch.avatar = data.avatar_url ?? undefined;
    }
    if ((data.cover_url ?? undefined) !== cur.coverRemote) {
      patch.coverRemote = data.cover_url ?? undefined;
      patch.cover = data.cover_url ?? undefined;
      patch.coverTone = (data.cover_tone as CoverTone | null) ?? undefined;
    }
    if (Object.keys(patch).length) writeLocal(patch);
  } catch (e) {
    console.warn('[profile] sync', e);
  }
}

// Tải ảnh avatar / ảnh bìa lên kho ảnh của server (thư mục riêng của tài khoản), xoá ảnh cũ trên server
async function uploadImage(slot: ImageSlot, localUri: string) {
  const acc = currentAccount();
  if (!acc || Platform.OS === 'web') return;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const ext = (localUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const path = `${acc.id}/${slot}-${Date.now()}.${ext}`;
    const body = await new File(localUri).arrayBuffer();
    const { error } = await sb().storage.from(BUCKET).upload(path, body, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
    if (error) throw error;
    const url = sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const old = getProfile()[slot === 'avatar' ? 'avatarRemote' : 'coverRemote'];
    // Chỉ ghi link mới nếu trong lúc tải người dùng chưa đổi sang ảnh khác
    if (getProfile()[slot] !== localUri) return;
    updateProfile(slot === 'avatar' ? { avatarRemote: url } : { coverRemote: url });
    removeRemote(old);
  } catch (e) {
    console.warn('[profile] upload', e);
  }
}

function removeRemote(url?: string) {
  const marker = `/object/public/${BUCKET}/`;
  if (!url || !url.includes(marker)) return;
  sb().storage.from(BUCKET).remove([url.split(marker)[1]]).catch(() => {});
}

export function useProfile(): Profile {
  const v = useDbVersion();
  return useMemo(() => getProfile(), [v]);
}

// ---------------------------------------------------------------------------
// Chọn ảnh rồi chép vào thư mục riêng của app (để xoá ảnh gốc trong Photos thì profile vẫn còn)
// ---------------------------------------------------------------------------
export type PickResult = 'ok' | 'canceled' | 'denied' | 'failed';
// Ảnh bìa vừa chọn, chờ người dùng cắt trên màn hình cắt
export type PickedImage = { uri: string; width: number; height: number };
export type CropRect = { originX: number; originY: number; width: number; height: number };

// Avatar: dùng khung cắt vuông của hệ thống rồi lưu luôn.
// Ảnh bìa: không cắt ở đây, trả ảnh về (onCover) để mở màn hình cắt riêng của app (iOS chỉ cắt được hình vuông).
export async function pickProfileImage(
  slot: ImageSlot,
  source: 'library' | 'camera',
  onCover?: (img: PickedImage) => void
): Promise<PickResult> {
  const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return 'denied';
    }
    const options: import('expo-image-picker').ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: slot === 'avatar',
      aspect: [1, 1],
    };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.[0]) return 'canceled';
    const a = res.assets[0];
    if (slot === 'cover' && onCover) {
      onCover({ uri: a.uri, width: a.width, height: a.height });
      return 'ok';
    }
    const uri = await saveImage(slot, a.uri);
    updateProfile(slot === 'avatar' ? { avatar: uri } : { cover: uri });
    uploadImage(slot, uri);
    return 'ok';
  } catch (e) {
    console.warn('[profile] pick', e);
    return 'failed';
  }
}

// Cắt ảnh bìa theo vùng người dùng chọn, thu nhỏ còn tối đa 1600px chiều ngang cho nhẹ, rồi lưu
export async function saveCroppedCover(img: PickedImage, rect: CropRect): Promise<PickResult> {
  try {
    let uri = img.uri;
    if (Platform.OS !== 'web') {
      const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
      const ctx = ImageManipulator.manipulate(img.uri).crop(rect);
      if (rect.width > 1600) ctx.resize({ width: 1600 });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      uri = out.uri;
    }
    const saved = await saveImage('cover', uri);
    const coverTone = await measureCoverTone(saved);
    updateProfile({ cover: saved, coverTone });
    uploadImage('cover', saved);
    return 'ok';
  } catch (e) {
    console.warn('[profile] crop', e);
    return 'failed';
  }
}

export function removeProfileImage(slot: ImageSlot) {
  const p = getProfile();
  const old = p[slot];
  updateProfile(slot === 'avatar' ? { avatar: undefined, avatarRemote: undefined } : { cover: undefined, coverTone: undefined, coverRemote: undefined });
  if (old) deleteFile(old);
  removeRemote(slot === 'avatar' ? p.avatarRemote : p.coverRemote);
}

async function saveImage(slot: ImageSlot, src: string): Promise<string> {
  if (Platform.OS === 'web') return src; // web: dùng thẳng link tạm
  const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, 'profile');
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = (src.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  // Tên mới mỗi lần đổi ảnh, để ảnh hiển thị không bị dính bộ nhớ đệm của ảnh cũ
  const dest = new File(dir, `${slot}-${Date.now()}.${ext}`);
  new File(src).copySync(dest);
  const old = getProfile()[slot];
  if (old) deleteFile(old);
  return dest.uri;
}

function deleteFile(uri: string) {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

// ---------------------------------------------------------------------------
// Đo độ sáng ảnh bìa ở vùng có chữ (tên, #tag, chữ "Hồ sơ"): nền tối → chữ trắng, nền sáng → chữ đậm.
// Cách làm: cắt đúng vùng sau chữ, thu nhỏ còn 32px cho nhẹ, rồi dùng Skia đọc màu từng điểm ảnh và tính độ sáng trung bình.
// ---------------------------------------------------------------------------
// Vùng chữ nằm trên ảnh bìa (tính theo tỉ lệ khung ảnh bìa): bên phải avatar, khoảng giữa chiều cao
const TEXT_REGION = { x: 0.3, y: 0.14, w: 0.7, h: 0.28 };
// Độ sáng (0..1) từ ngưỡng này trở lên thì coi là ảnh sáng. Để hơi cao vì chữ trắng có bóng đổ nên vẫn đọc được trên nền trung tính
const LIGHT_THRESHOLD = 0.6;

export async function measureCoverTone(uri: string): Promise<CoverTone | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const src = await ImageManipulator.manipulate(uri).renderAsync();
    const { width: W, height: H } = src;
    const crop = {
      originX: Math.round(W * TEXT_REGION.x),
      originY: Math.round(H * TEXT_REGION.y),
      width: Math.max(1, Math.round(W * TEXT_REGION.w)),
      height: Math.max(1, Math.round(H * TEXT_REGION.h)),
    };
    const small = await ImageManipulator.manipulate(uri).crop(crop).resize({ width: 32 }).renderAsync();
    const out = await small.saveAsync({ format: SaveFormat.PNG });

    const { Skia, AlphaType, ColorType } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const data = await Skia.Data.fromURI(out.uri);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return undefined;
    const w = img.width();
    const h = img.height();
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    deleteFile(out.uri);
    if (!px || px.length < 4) return undefined;

    // Độ sáng cảm nhận (relative luminance, theo chuẩn sRGB), lấy trung bình mọi điểm ảnh
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    let sum = 0;
    let n = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
      n++;
    }
    // Đổi về thang "mắt nhìn" (gần tuyến tính với cảm giác sáng/tối) rồi so ngưỡng
    const perceived = Math.pow(sum / n, 1 / 2.2);
    return perceived >= LIGHT_THRESHOLD ? 'light' : 'dark';
  } catch (e) {
    console.warn('[profile] tone', e);
    return undefined;
  }
}

// Ảnh bìa đặt từ bản cũ (chưa có coverTone): đo bù một lần
export async function ensureCoverTone() {
  const p = getProfile();
  if (!p.cover || p.coverTone) return;
  const tone = await measureCoverTone(p.cover);
  if (tone && getProfile().cover === p.cover) updateProfile({ coverTone: tone });
}
