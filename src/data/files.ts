import { Platform } from 'react-native';

// Chép file người dùng chọn (ảnh, video...) vào thư mục riêng của app, để xoá file gốc trong máy thì app vẫn còn.
// Mỗi lần chép dùng tên mới, để ảnh/video hiển thị không bị dính bộ nhớ đệm của file cũ.
export async function copyIntoApp(src: string, folder: string, prefix: string): Promise<string> {
  if (Platform.OS === 'web') return src;
  const { Directory, File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, folder);
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = (src.split('?')[0].split('.').pop() || 'bin').toLowerCase();
  const dest = new File(dir, `${prefix}-${Date.now()}.${ext}`);
  await new File(src).copy(dest); // chép bất đồng bộ: video vài chục MB cũng không làm đơ app
  return dest.uri;
}

// Xoá file đã chép (chỉ xoá file nằm trong thư mục của app)
export function deleteAppFile(uri: string) {
  if (Platform.OS === 'web' || !uri) return;
  try {
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    if (!uri.startsWith(Paths.document.uri)) return;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
