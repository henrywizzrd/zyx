import { Platform } from 'react-native';

// Chọn một ảnh vuông từ thư viện ảnh (khung cắt vuông của hệ thống) rồi lưu vào thư mục riêng của app.
// Trả về đường dẫn file đã lưu, 'canceled' (người dùng huỷ), 'denied' (không cho quyền) hoặc 'failed'.
// Màn hình chọn / cắt ảnh của hệ thống chỉ làm cho màn dọc: đang nằm ngang thì bị khuất mất một phần.
// Nên tạm khoá màn hình dọc trong lúc chọn ảnh, xong thì trả lại chế độ tự xoay
export async function holdPortrait() {
  if (Platform.OS === 'web') return;
  const SO = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
  await SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 350)); // chờ xoay xong rồi mới mở màn chọn ảnh
}
export function releasePortrait() {
  if (Platform.OS === 'web') return;
  const SO = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
  SO.lockAsync(SO.OrientationLock.DEFAULT).catch(() => {});
}

export async function pickSquareImage(folder: string): Promise<string | 'canceled' | 'denied' | 'failed'> {
  await holdPortrait();
  try {
    return await pickSquareImageInner(folder);
  } finally {
    releasePortrait();
  }
}

async function pickSquareImageInner(folder: string): Promise<string | 'canceled' | 'denied' | 'failed'> {
  try {
    const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets?.[0]) return 'canceled';
    return saveToApp(folder, res.assets[0].uri);
  } catch (e) {
    console.warn('[image] pick', e);
    return 'failed';
  }
}

// Chép file vào Documents/<folder>/ (tên mới mỗi lần để ảnh hiển thị không dính bộ nhớ đệm của ảnh cũ)
export function saveToApp(folder: string, src: string): string {
  if (Platform.OS === 'web') return src;
  const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = (src.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const dest = new File(dir, `${Date.now()}.${ext}`);
  new File(src).copySync(dest);
  return dest.uri;
}

export function deleteAppFile(uri?: string | null) {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
