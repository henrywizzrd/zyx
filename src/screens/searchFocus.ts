// Nhờ trang Tìm kiếm bật bàn phím (thanh "Search" của dock ZYX). Trang Tìm kiếm có thể chưa dựng xong lúc gọi
// (lần đầu mở tab) → ghi nhớ yêu cầu, trang dựng xong thì tự lấy
type Fn = () => void;
let listener: Fn | null = null;
let pending = false;

export function requestSearchFocus() {
  if (listener) {
    // chờ trang Tìm kiếm hiện ra (đổi tab) rồi mới bật bàn phím
    setTimeout(() => listener?.(), 120);
  } else pending = true;
}

export function onSearchFocusRequest(fn: Fn) {
  listener = fn;
  if (pending) {
    pending = false;
    setTimeout(fn, 200);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
