import { registerRootComponent } from 'expo';
import { initSentry } from './src/sentry';

// Bật báo lỗi Sentry trước khi nạp app, để bắt được cả lỗi xảy ra ngay lúc khởi động
// (không bọc App bằng Sentry.wrap: phần đó chỉ phục vụ đo hiệu năng / theo dõi chạm, tốn thêm mỗi lần vẽ)
initSentry();

import App from './App';

registerRootComponent(App);
