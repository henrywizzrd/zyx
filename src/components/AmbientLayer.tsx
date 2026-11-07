import React from 'react';
import { Platform } from 'react-native';

// Lớp hiệu ứng nền của bộ màu (Snow: tuyết rơi, Green: lá rơi). Skia chỉ nạp trên iOS/Android, web bỏ qua
const impl = Platform.OS === 'web' ? null : (require('../theme/effects/Ambient') as typeof import('../theme/effects/Ambient'));

export function AmbientEffect({ paused }: { paused?: boolean }) {
  if (!impl) return null;
  // Cảnh nền đứng yên (Sakura, Mưa sao băng) + phần chuyển động
  return (
    <>
      <impl.ThemeScene />
      <impl.AmbientEffect paused={paused} />
    </>
  );
}
