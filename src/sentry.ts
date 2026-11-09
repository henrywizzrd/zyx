// Báo lỗi tự động qua Sentry: app văng / lỗi JS được gửi về sentry.io (tổ chức zyx-sg) kèm dòng code gây lỗi.
// DSN là địa chỉ công khai (chỉ dùng để GỬI lỗi lên), để trong code được. Chỉ bật ở bản thật, không bật lúc chạy dev.
//
// CHỈ BÁO LỖI, tắt hết phần đo hiệu năng: để tracesSampleRate = 0 vẫn bị Sentry coi là "bật đo hiệu năng"
// → nó gắn thêm đo khung hình, đo luồng JS khựng, theo dõi từng lần chạm, đo mọi lần tải mạng... làm app lag rõ (bản 1.0.2 đầu).
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
      environment: channel ?? 'production',
      // không đặt tracesSampleRate / tracesSampler → không đo hiệu năng
      enableAutoPerformanceTracing: false,
      enableAppStartTracking: false,
      enableNativeFramesTracking: false,
      enableStallTracking: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      enableAutoSessionTracking: true,
      maxBreadcrumbs: 50,
      // Nhật ký của app chép mọi dòng ra console.log → không để Sentry bọc console (mỗi dòng log thành 1 vệt)
      integrations: (list) => list.filter((i) => i.name !== 'Breadcrumbs').concat(Sentry.breadcrumbsIntegration({ console: false, fetch: false, xhr: false })),
    });
    if (updateId) Sentry.setTag('ota', updateId);
  } catch (e) {
    console.warn('[sentry]', e);
  }
}
