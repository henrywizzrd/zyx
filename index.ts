import { registerRootComponent } from 'expo';
import { initSentry, Sentry } from './src/sentry';

// Bật báo lỗi Sentry trước khi nạp app, để bắt được cả lỗi xảy ra ngay lúc khởi động
initSentry();

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Sentry.wrap(App));
