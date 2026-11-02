import React from 'react';
import { Platform } from 'react-native';

// Lớp tuyết rơi (bộ Snow). Skia chỉ nạp trên iOS/Android, web bỏ qua
const impl = Platform.OS === 'web' ? null : (require('../theme/effects/AmbientSnow') as typeof import('../theme/effects/AmbientSnow'));

export function AmbientSnow({ paused }: { paused?: boolean }) {
  if (!impl) return null;
  return <impl.AmbientSnow paused={paused} />;
}
