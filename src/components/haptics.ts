// Rung nhẹ (haptic) — dùng ít thôi: một lần cho một hành động của người dùng, cùng lúc với chuyển động trên màn hình,
// không bao giờ là phản hồi duy nhất (nhiều người tắt rung, Android thường không rung được).
// Nạp lười + bọc try: bản app cũ chưa có thư viện rung (cài trước bản [build] này) nhận bản cập nhật JS vẫn chạy bình thường.
import { Platform } from 'react-native';

type H = typeof import('expo-haptics');
let mod: H | null | undefined;
function h(): H | null {
  if (mod !== undefined) return mod;
  try {
    mod = Platform.OS === 'web' ? null : (require('expo-haptics') as H);
  } catch {
    mod = null;
  }
  return mod;
}

// Lướt qua một nấc (tab, nấc chọn...)
export function hapticTick() {
  try {
    h()?.selectionAsync().catch(() => {});
  } catch {}
}
// Thứ gì đó hít vào chỗ / đóng xong / thả tay chốt
export function hapticSnap() {
  try {
    const m = h();
    m?.impactAsync(m.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {}
}
