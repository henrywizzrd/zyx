// Cấu hình Metro mặc định của Expo + Sentry (gắn mã nhận diện vào bản đóng gói để Sentry khớp đúng source map)
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
