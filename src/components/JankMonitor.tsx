import React from 'react';
import { useFrameCallback } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { getLogContext, log } from '../data/applog';

// Khựng ở luồng giao diện (UI thread: hiệu ứng, cuộn, kéo thả): khung hình cách nhau quá lâu thì ghi vào nhật ký.
// Bỏ qua khoảng cách rất dài (> 3s) vì đó là lúc app vào nền / màn hình tắt chứ không phải giật.
function report(ms: number) {
  const c = getLogContext();
  log('jank', `giao diện khựng ${ms}ms${c ? ` · ${c}` : ''}`);
}

export function JankMonitor() {
  useFrameCallback((f) => {
    'worklet';
    const d = f.timeSincePreviousFrame;
    if (d != null && d > 100 && d < 3000) scheduleOnRN(report, Math.round(d));
  });
  return null;
}
