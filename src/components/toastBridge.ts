import type { StringKey } from '../i18n';

// Cho những chỗ nằm NGOÀI ActionSheetProvider (vd. PlayerProvider) hiện thông báo nhỏ: showToast('player.offline').
// ActionSheetProvider đăng ký hàm hiện toast thật vào đây (tách file riêng để hai bên không import vòng lẫn nhau)
let impl: ((key: StringKey) => void) | null = null;

export function setToastImpl(fn: ((key: StringKey) => void) | null) {
  impl = fn;
}
export function getToastImpl() {
  return impl;
}
export function showToast(key: StringKey) {
  impl?.(key);
}
