// Nhờ trang Tìm kiếm bật bàn phím (thanh "Search" của dock ZYX). Trang Tìm kiếm có thể chưa dựng xong lúc gọi
// (lần đầu mở tab) → ghi nhớ yêu cầu, trang dựng xong thì tự lấy
type Fn = () => void;
let listener: Fn | null = null;
let pending = false;

export function requestSearchFocus() {
  if (listener) {
    // chờ trang Tìm kiếm hiện ra (đổi tab) rồi mới bật bàn phím; ghi nhật ký nếu bước này làm luồng JS đứng lâu
    setTimeout(() => {
      const t0 = Date.now();
      listener?.();
      const dt = Date.now() - t0;
      if (dt > 50) {
        const { log } = require('../data/applog') as typeof import('../data/applog');
        log('jank', `bật bàn phím trang Tìm kiếm: ${dt}ms`);
      }
    }, 120);
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
