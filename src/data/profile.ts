import { Platform } from 'react-native';
import { useMemo } from 'react';
import { kvGet, kvSet, useDbVersion } from './db';
import { profile as mockProfile } from './mock';

// Profile của người dùng trên máy này. Sau này có tài khoản thì đồng bộ lên server,
// và người khác vào xem profile sẽ thấy avatar / ảnh bìa này.
export interface Profile {
  name: string;
  tag: string;
  avatar?: string; // đường dẫn file ảnh trong thư mục của app
  cover?: string;
  avatarColor: string; // màu khi chưa có ảnh
  wallColor: string;
}

export type ImageSlot = 'avatar' | 'cover';
const KEY = 'profile';

export function getProfile(): Profile {
  return { ...mockProfile, ...(kvGet<Partial<Profile>>(KEY) ?? {}) };
}

export function updateProfile(patch: Partial<Profile>) {
  kvSet(KEY, { ...(kvGet<Partial<Profile>>(KEY) ?? {}), ...patch });
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
    updateProfile({ cover: saved });
    return 'ok';
  } catch (e) {
    console.warn('[profile] crop', e);
    return 'failed';
  }
}

export function removeProfileImage(slot: ImageSlot) {
  const old = getProfile()[slot];
  updateProfile(slot === 'avatar' ? { avatar: undefined } : { cover: undefined });
  if (old) deleteFile(old);
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
  if (Platform.OS === 'web') return;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
