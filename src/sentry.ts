// Báo lỗi tự động qua Sentry: app văng / lỗi JS được gửi về sentry.io (tổ chức zyx-sg) kèm dòng code gây lỗi.
// DSN là địa chỉ công khai (chỉ dùng để GỬI lỗi lên), để trong code được. Chỉ bật ở bản thật, không bật lúc chạy dev.
import * as Sentry from '@sentry/react-native';

const DSN = 'https://d6d997442437bb2ea3e00da0587668b1@o4512401130782720.ingest.de.sentry.io/4512401137664080';

export function initSentry() {
  if (__DEV__) return;
  try {
    let updateId: string | undefined;
    let channel: string | undefined;
    try {
      const U = require('expo-updates') as typeof import('expo-updates');
      updateId = U.updateId ?? undefined;
      channel = U.channel ?? undefined;
    } catch {}
    Sentry.init({
      dsn: DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0, // chỉ báo lỗi, không đo hiệu năng (đỡ tốn hạn mức miễn phí)
      enableAutoSessionTracking: true,
      environment: channel ?? 'production',
    });
    if (updateId) Sentry.setTag('ota', updateId);
  } catch (e) {
    console.warn('[sentry]', e);
  }
}

export { Sentry };
