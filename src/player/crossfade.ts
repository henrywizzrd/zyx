// Cài đặt "Chuyển bài mượt" (crossfade 6 giây, xem cuối src/music/audioPlayer.ts). Nhớ trong máy, mặc định tắt
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const KEY = 'zyx:crossfade';
let on = false;
const listeners = new Set<() => void>();
const audio = () => require('../music/audioPlayer') as typeof import('../music/audioPlayer');

function apply(v: boolean) {
  on = v;
  if (Platform.OS !== 'web') audio().setCrossfadeEnabled(v);
  listeners.forEach((l) => l());
}

AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === '1') apply(true);
  })
  .catch(() => {});

export function setCrossfade(v: boolean) {
  apply(v);
  AsyncStorage.setItem(KEY, v ? '1' : '0').catch(() => {});
}

export function useCrossfade() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => on
  );
}
